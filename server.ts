import 'dotenv/config';
import crypto from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import http from 'http';
import multer from 'multer';
import os from 'os';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { ShowStore } from './src/server/showStore';
import {
  classifyJoinUrlProbe,
  deriveSharedPreviewUrl,
  filterLanIPv4Addresses,
} from './src/server/networkUtils';
import { ConnectivityMode, MediaAsset, WsMessageToClient, WsMessageToServer } from './src/shared/types';

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const STORE_FILE = path.join(DATA_DIR, 'store.json');
const store = new ShowStore(STORE_FILE);
const validHostTokens = new Set<string>();

// Optional host passcode if configured in environment
const HOST_PASSCODE = process.env.HOST_PASSCODE || '';
const HOST_SECRET_FILE = path.join(DATA_DIR, '.host-secret');

function loadOrCreateHostSecret(): string {
  try {
    if (fs.existsSync(HOST_SECRET_FILE)) {
      const existing = fs.readFileSync(HOST_SECRET_FILE, 'utf-8').trim();
      if (existing.length >= 16) return existing;
    }
    const created = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(HOST_SECRET_FILE, created, 'utf-8');
    return created;
  } catch {
    return crypto
      .createHash('sha256')
      .update(`lumenlink:${HOST_PASSCODE || 'open'}:${process.env.APP_URL || 'local'}`)
      .digest('hex');
  }
}

const HOST_SIGNING_SECRET = loadOrCreateHostSecret();

function signTokenPayload(payload: string): string {
  return crypto
    .createHmac('sha256', `${HOST_SIGNING_SECRET}:${HOST_PASSCODE}`)
    .update(payload)
    .digest('hex');
}

function issueHostToken(): string {
  const payload = `${Date.now().toString(36)}.${crypto.randomBytes(12).toString('hex')}`;
  const sig = signTokenPayload(payload);
  const token = `${payload}.${sig}`;
  validHostTokens.add(token);
  return token;
}

function isValidHostToken(token: string): boolean {
  if (!token) return false;
  if (validHostTokens.has(token)) return true;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = signTokenPayload(payload);
  try {
    const a = Buffer.from(parts[2], 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    const valid = crypto.timingSafeEqual(a, b);
    if (valid) validHostTokens.add(token);
    return valid;
  } catch {
    return false;
  }
}

function isHostAuthorized(req: Request): boolean {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7).trim();
  return isValidHostToken(token);
}

function requireHostAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isHostAuthorized(req)) {
    res.status(401).json({ error: 'Host authentication required' });
    return;
  }
  next();
}

function getLanIPv4Addresses(): string[] {
  const nets = os.networkInterfaces();
  const raw: string[] = [];
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const info of list) {
      if (info.family === 'IPv4' && !info.internal) {
        raw.push(info.address);
      }
    }
  }
  return filterLanIPv4Addresses(raw);
}

store.setConnectivityMode('remote');

const ALLOWED_MIME_TYPES: Record<string, { ext: string; kind: MediaAsset['kind'] }> = {
  'image/png': { ext: '.png', kind: 'image' },
  'image/jpeg': { ext: '.jpg', kind: 'image' },
  'image/jpg': { ext: '.jpg', kind: 'image' },
  'image/webp': { ext: '.webp', kind: 'image' },
  'image/gif': { ext: '.gif', kind: 'gif' },
  'video/mp4': { ext: '.mp4', kind: 'video' },
  'video/webm': { ext: '.webm', kind: 'video' },
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const meta = ALLOWED_MIME_TYPES[file.mimetype];
      const ext = meta?.ext || path.extname(file.originalname).toLowerCase() || '.bin';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported media format. Allowed: PNG, JPG, WEBP, GIF, MP4, WEBM.'));
    }
  },
});

interface ConnectedClientMeta {
  ws: WebSocket;
  role: 'host' | 'audience';
  showId: string;
  deviceId?: string;
  hostToken?: string;
}

const clients = new Set<ConnectedClientMeta>();

function sendWs(ws: WebSocket, msg: WsMessageToClient): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastToShow(showId: string, msg: WsMessageToClient, roleFilter?: 'host' | 'audience'): void {
  const serialized = JSON.stringify(msg);
  for (const client of clients) {
    if (client.showId !== showId) continue;
    if (roleFilter && client.role !== roleFilter) continue;
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(serialized);
    }
  }
}

function broadcastToAllHosts(msg: WsMessageToClient): void {
  const serialized = JSON.stringify(msg);
  for (const client of clients) {
    if (client.role === 'host' && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(serialized);
    }
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (req.path.startsWith('/public/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  // Health & network discovery
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, serverTimeMs: Date.now() });
  });

  app.get('/api/network-info', (req, res) => {
    const fwdProto = String(req.headers['x-forwarded-proto'] || '');
    const protocol = fwdProto.includes('https') || req.protocol === 'https' ? 'https' : 'http';
    const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`);
    const requestOrigin = `${protocol}://${hostHeader}`.replace(/\/$/, '');
    const isRequestLocal = /^https?:\/\/(localhost|127\.|192\.168\.|10\.)/i.test(requestOrigin);
    const isRequestDev = /^https?:\/\/ais-dev-/i.test(requestOrigin);
    const envPublic = process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL'
      ? process.env.APP_URL.replace(/\/$/, '')
      : '';
    // Prefer the real live published requestOrigin over APP_URL (which may still point to ais-dev in deployed containers)
    const candidatePublic = !isRequestLocal && !isRequestDev ? requestOrigin : (envPublic || requestOrigin);
    const urlInfo = deriveSharedPreviewUrl(candidatePublic);
    const lanAddresses = getLanIPv4Addresses();
    res.json({
      port: PORT,
      lanAddresses,
      hasRealLanAddress: lanAddresses.length > 0,
      publicUrl: urlInfo.resolvedUrl,
      isAiStudioDevUrl: urlInfo.isAiStudioDevUrl,
      suggestedSharedUrl: urlInfo.suggestedSharedUrl,
      connectivityMode: store.getConnectivityMode(),
      internetReachableHint: !hostHeader.startsWith('localhost') && !hostHeader.startsWith('127.'),
    });
  });

  app.post('/api/network-mode', requireHostAuth, (req, res) => {
    const mode = req.body?.mode as ConnectivityMode;
    if (mode !== 'local' && mode !== 'remote') {
      res.status(400).json({ error: 'Invalid mode' });
      return;
    }
    store.setConnectivityMode(mode);
    res.json({ connectivityMode: store.getConnectivityMode() });
  });

  app.get('/api/check-join-url', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      res.status(400).json({ status: 'unreachable', httpStatus: 0, message: 'Invalid URL format.' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ status: 'unreachable', httpStatus: 0, message: 'Only HTTP/HTTPS URLs are allowed.' });
      return;
    }
    // Block cloud metadata SSRF targets
    if (parsed.hostname === '169.254.169.254' || parsed.hostname === 'metadata.google.internal') {
      res.status(400).json({ status: 'unreachable', httpStatus: 0, message: 'Blocked host.' });
      return;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const upstream = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      });
      clearTimeout(timer);
      const locationHeader = upstream.headers.get('location');
      const result = classifyJoinUrlProbe({
        httpStatus: upstream.status,
        locationHeader,
        url: parsed.toString(),
      });
      res.json({
        ...result,
        httpStatus: upstream.status,
        locationHeader: locationHeader || null,
      });
    } catch {
      res.json({
        status: 'unreachable',
        httpStatus: 0,
        message: 'Could not reach this URL from the server.',
      });
    }
  });

  // Host session creation
  app.post('/api/host/session', (req, res) => {
    if (HOST_PASSCODE && req.body?.passcode !== HOST_PASSCODE) {
      res.status(403).json({ error: 'Invalid host passcode', requiresPasscode: true });
      return;
    }
    const token = issueHostToken();
    res.json({ hostToken: token, requiresPasscode: Boolean(HOST_PASSCODE) });
  });

  app.get('/api/host/auth-status', (_req, res) => {
    res.json({ requiresPasscode: Boolean(HOST_PASSCODE) });
  });

  // Public show info & HTTP fallback for Audience Join page
  app.get('/api/public/show/:showId', (req, res) => {
    const show = store.getShow(req.params.showId);
    res.json({
      id: show.id,
      name: show.name,
      joinCode: show.joinCode,
      audienceSettings: show.audienceSettings,
    });
  });

  function buildLightAudienceShow(show: ReturnType<typeof store.getShow>) {
    return {
      ...show,
      cues: [],
      timelines: [],
      posterDesign: {
        ...show.posterDesign,
        logoDataUrl: null,
      },
    };
  }

  app.get('/api/public/show/:showId/live', (req, res) => {
    const nowMs = Date.now();
    const show = store.getShow(req.params.showId);
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
    let devicesChanged = false;
    if (deviceId) {
      const existing = store.getDevices(show.id).find((d) => d.id === deviceId);
      if (existing) {
        const wasDisconnected = existing.status !== 'connected';
        store.updateAudienceMeta(show.id, deviceId, {}, nowMs);
        if (wasDisconnected) devicesChanged = true;
      } else if (req.query.autoRegister === '1') {
        store.registerAudienceDevice(
          show.id,
          {
            deviceId,
            name: typeof req.query.name === 'string' && req.query.name.trim() ? req.query.name.trim() : undefined,
            deviceType:
              req.query.deviceType === 'tablet' || req.query.deviceType === 'desktop'
                ? req.query.deviceType
                : 'smartphone',
            orientation: req.query.orientation === 'landscape' ? 'landscape' : 'portrait',
          },
          nowMs,
        );
        devicesChanged = true;
      }
    }
    const devices = store.getDevices(show.id);
    if (devicesChanged) {
      broadcastToShow(show.id, {
        type: 'devices_update',
        serverTimeMs: nowMs,
        devices,
      });
    }
    const selfDevice = deviceId ? devices.find((d) => d.id === deviceId) || null : null;
    res.json({
      serverTimeMs: nowMs,
      show: buildLightAudienceShow(show),
      lighting: show.lighting,
      playback: show.playback,
      device: selfDevice,
      devices,
    });
  });

  app.post('/api/public/audience/register', (req, res) => {
    const nowMs = Date.now();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const show = store.getShow(
      typeof body.showId === 'string'
        ? body.showId
        : typeof req.query.showId === 'string'
          ? req.query.showId
          : undefined,
    );
    const deviceId =
      typeof body.deviceId === 'string' && body.deviceId
        ? body.deviceId
        : `dev-${crypto.randomUUID().slice(0, 8)}`;
    const p = body.payload && typeof body.payload === 'object' ? body.payload : {};
    const device = store.registerAudienceDevice(
      show.id,
      {
        deviceId,
        name: typeof p.name === 'string' ? p.name : undefined,
        deviceType: (p.deviceType as 'smartphone' | 'tablet' | 'desktop' | 'unknown') || 'smartphone',
        orientation: (p.orientation as 'portrait' | 'landscape') || 'portrait',
        batteryLevel: typeof p.batteryLevel === 'number' ? p.batteryLevel : null,
        screenWidth: typeof p.screenWidth === 'number' ? p.screenWidth : undefined,
        screenHeight: typeof p.screenHeight === 'number' ? p.screenHeight : undefined,
      },
      nowMs,
    );
    const devices = store.getDevices(show.id);
    broadcastToShow(show.id, {
      type: 'devices_update',
      serverTimeMs: nowMs,
      devices,
    });
    res.json({
      serverTimeMs: nowMs,
      show: buildLightAudienceShow(show),
      lighting: show.lighting,
      playback: show.playback,
      device,
      devices,
    });
  });

  // Host show management & HTTP command fallback APIs
  app.get('/api/shows', requireHostAuth, (_req, res) => {
    const activeShow = store.getActiveShow();
    res.json({
      serverTimeMs: Date.now(),
      activeShowId: activeShow.id,
      activeShow,
      devices: store.getDevices(activeShow.id),
      shows: store.listShows(),
    });
  });

  app.post('/api/host/command', requireHostAuth, (req, res) => {
    const nowMs = Date.now();
    const action = String(req.body?.action || '');
    const showId = typeof req.body?.showId === 'string' ? req.body.showId : store.getActiveShow().id;
    const payload = (req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {}) as Record<string, unknown>;
    const result = store.applyHostCommand(showId, action, payload, nowMs);

    if (result.lightingChanged || result.playbackChanged || result.showChanged) {
      broadcastToShow(result.show.id, {
        type: 'state_update',
        serverTimeMs: nowMs,
        show: result.show,
        lighting: result.show.lighting,
        playback: result.show.playback,
      });
    }
    if (result.devicesChanged) {
      broadcastToShow(result.show.id, {
        type: 'devices_update',
        serverTimeMs: nowMs,
        devices: store.getDevices(result.show.id),
      });
    }
    if (result.identifyPayload) {
      for (const client of clients) {
        if (
          client.role === 'audience' &&
          client.showId === result.show.id &&
          client.deviceId &&
          result.identifyPayload.deviceIds.includes(client.deviceId)
        ) {
          sendWs(client.ws, {
            type: 'identify_pulse',
            serverTimeMs: nowMs,
            identifyUntilMs: result.identifyPayload.untilMs,
          });
        }
      }
    }
    if (result.disconnectDeviceIds && result.disconnectDeviceIds.length > 0) {
      for (const client of clients) {
        if (
          client.role === 'audience' &&
          client.showId === result.show.id &&
          client.deviceId &&
          result.disconnectDeviceIds.includes(client.deviceId)
        ) {
          client.ws.close(4001, 'Disconnected by host console');
        }
      }
    }

    res.json({
      serverTimeMs: nowMs,
      show: result.show,
      devices: store.getDevices(result.show.id),
      shows: store.listShows(),
    });
  });

  app.post('/api/shows', requireHostAuth, (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Show name is required' });
      return;
    }
    const show = store.createShow(name);
    res.status(201).json({ show, shows: store.listShows() });
  });

  app.patch('/api/shows/:showId', requireHostAuth, (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Show name is required' });
      return;
    }
    const show = store.renameShow(req.params.showId, name);
    if (!show) {
      res.status(404).json({ error: 'Show not found' });
      return;
    }
    res.json({ show, shows: store.listShows() });
  });

  app.post('/api/shows/:showId/activate', requireHostAuth, (req, res) => {
    const show = store.setActiveShow(req.params.showId);
    if (!show) {
      res.status(404).json({ error: 'Show not found' });
      return;
    }
    res.json({
      show,
      devices: store.getDevices(show.id),
      mediaAssets: store.getMediaAssets(),
    });
  });

  app.post('/api/shows/:showId/duplicate', requireHostAuth, (req, res) => {
    const show = store.duplicateShow(req.params.showId);
    if (!show) {
      res.status(404).json({ error: 'Show not found' });
      return;
    }
    res.status(201).json({ show, shows: store.listShows() });
  });

  app.delete('/api/shows/:showId', requireHostAuth, (req, res) => {
    const ok = store.deleteShow(req.params.showId);
    if (!ok) {
      res.status(400).json({ error: 'Cannot delete the only remaining show' });
      return;
    }
    res.json({ activeShow: store.getActiveShow(), shows: store.listShows() });
  });

  app.post('/api/shows/import', requireHostAuth, (req, res) => {
    const imported = store.importShow(req.body?.show);
    if (!imported) {
      res.status(400).json({ error: 'Invalid LUMENLINK show file format' });
      return;
    }
    res.status(201).json({ show: imported, shows: store.listShows() });
  });

  // Media upload and distribution
  app.get('/api/media', (_req, res) => {
    res.json({ mediaAssets: store.getMediaAssets() });
  });

  app.post('/api/media/upload', requireHostAuth, upload.single('file'), (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No media file provided' });
      return;
    }
    const mimeMeta = ALLOWED_MIME_TYPES[file.mimetype];
    if (!mimeMeta) {
      res.status(400).json({ error: 'Unsupported media type' });
      return;
    }
    const asset: MediaAsset = {
      id: `media-${crypto.randomUUID().slice(0, 8)}`,
      name: path.basename(file.originalname, path.extname(file.originalname)) || 'Uploaded Media',
      originalName: file.originalname,
      mimeType: file.mimetype,
      kind: mimeMeta.kind,
      url: `/api/media/file/${file.filename}`,
      sizeBytes: file.size,
      uploadedAtMs: Date.now(),
    };
    store.addMediaAsset(asset);
    broadcastToAllHosts({
      type: 'state_update',
      serverTimeMs: Date.now(),
      mediaAssets: store.getMediaAssets(),
    });
    res.status(201).json({ asset, mediaAssets: store.getMediaAssets() });
  });

  app.delete('/api/media/:id', requireHostAuth, (req, res) => {
    const assets = store.getMediaAssets();
    const target = assets.find((m) => m.id === req.params.id);
    if (target) {
      const filename = path.basename(target.url);
      const resolved = path.resolve(UPLOAD_DIR, filename);
      if (resolved.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
      store.deleteMediaAsset(target.id);
    }
    res.json({ mediaAssets: store.getMediaAssets() });
  });

  app.get('/api/media/file/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename || '');
    const resolved = path.resolve(UPLOAD_DIR, safeName);
    if (!resolved.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Media file not found' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(resolved);
  });

  // Multer error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Server error' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let clientMeta: ConnectedClientMeta | null = null;

    ws.on('message', (raw) => {
      let msg: WsMessageToServer;
      try {
        msg = JSON.parse(raw.toString()) as WsMessageToServer;
      } catch {
        sendWs(ws, { type: 'error', serverTimeMs: Date.now(), message: 'Invalid JSON message' });
        return;
      }

      const nowMs = Date.now();

      if (msg.type === 'register_host') {
        const token = msg.hostToken || '';
        if (!isValidHostToken(token)) {
          sendWs(ws, { type: 'error', serverTimeMs: nowMs, message: 'Unauthorized host session' });
          return;
        }
        const show = store.getShow(msg.showId);
        if (clientMeta) clients.delete(clientMeta);
        clientMeta = { ws, role: 'host', showId: show.id, hostToken: token };
        clients.add(clientMeta);

        sendWs(ws, {
          type: 'welcome_sync',
          serverTimeMs: nowMs,
          show,
          lighting: show.lighting,
          playback: show.playback,
          devices: store.getDevices(show.id),
          mediaAssets: store.getMediaAssets(),
        });
        return;
      }

      if (msg.type === 'register_audience') {
        const show = store.getShow(msg.showId);
        const deviceId = msg.deviceId || `dev-${crypto.randomUUID().slice(0, 8)}`;
        const p = msg.payload || {};
        const device = store.registerAudienceDevice(
          show.id,
          {
            deviceId,
            name: typeof p.name === 'string' ? p.name : undefined,
            deviceType: (p.deviceType as 'smartphone' | 'tablet' | 'desktop' | 'unknown') || 'smartphone',
            orientation: (p.orientation as 'portrait' | 'landscape') || 'portrait',
            batteryLevel: typeof p.batteryLevel === 'number' ? p.batteryLevel : null,
            screenWidth: typeof p.screenWidth === 'number' ? p.screenWidth : undefined,
            screenHeight: typeof p.screenHeight === 'number' ? p.screenHeight : undefined,
          },
          nowMs,
        );

        if (clientMeta) clients.delete(clientMeta);
        clientMeta = { ws, role: 'audience', showId: show.id, deviceId: device.id };
        clients.add(clientMeta);

        // Send full current state to the joining/reconnecting audience device
        sendWs(ws, {
          type: 'welcome_sync',
          serverTimeMs: nowMs,
          show,
          lighting: show.lighting,
          playback: show.playback,
          device,
          devices: store.getDevices(show.id),
        });

        // Notify host consoles and audience spatial views of updated device list
        broadcastToShow(show.id, {
          type: 'devices_update',
          serverTimeMs: nowMs,
          devices: store.getDevices(show.id),
        });
        return;
      }

      if (msg.type === 'audience_heartbeat' || msg.type === 'audience_update_meta') {
        if (!clientMeta || clientMeta.role !== 'audience' || !clientMeta.deviceId) return;
        const p = msg.payload || {};
        store.updateAudienceMeta(
          clientMeta.showId,
          clientMeta.deviceId,
          {
            orientation: p.orientation as 'portrait' | 'landscape' | undefined,
            batteryLevel: typeof p.batteryLevel === 'number' ? p.batteryLevel : undefined,
            screenWidth: typeof p.screenWidth === 'number' ? p.screenWidth : undefined,
            screenHeight: typeof p.screenHeight === 'number' ? p.screenHeight : undefined,
            isFullscreen: typeof p.isFullscreen === 'boolean' ? p.isFullscreen : undefined,
          },
          nowMs,
        );
        sendWs(ws, { type: 'ping_sync', serverTimeMs: nowMs });
        if (msg.type === 'audience_update_meta') {
          broadcastToShow(
            clientMeta.showId,
            {
              type: 'devices_update',
              serverTimeMs: nowMs,
              devices: store.getDevices(clientMeta.showId),
            },
            'host',
          );
        }
        return;
      }

      if (msg.type === 'host_command') {
        if (!clientMeta || clientMeta.role !== 'host' || !clientMeta.hostToken || !isValidHostToken(clientMeta.hostToken)) {
          sendWs(ws, { type: 'error', serverTimeMs: nowMs, message: 'Unauthorized command' });
          return;
        }
        const action = String(msg.payload?.action || '');
        const showId = msg.showId || clientMeta.showId;
        const result = store.applyHostCommand(showId, action, msg.payload || {}, nowMs);

        if (result.lightingChanged || result.playbackChanged || result.showChanged) {
          broadcastToShow(result.show.id, {
            type: 'state_update',
            serverTimeMs: nowMs,
            show: result.show,
            lighting: result.show.lighting,
            playback: result.show.playback,
          });
        }
        if (result.devicesChanged) {
          broadcastToShow(result.show.id, {
            type: 'devices_update',
            serverTimeMs: nowMs,
            devices: store.getDevices(result.show.id),
          });
        }
        if (result.identifyPayload) {
          for (const client of clients) {
            if (
              client.role === 'audience' &&
              client.showId === result.show.id &&
              client.deviceId &&
              result.identifyPayload.deviceIds.includes(client.deviceId)
            ) {
              sendWs(client.ws, {
                type: 'identify_pulse',
                serverTimeMs: nowMs,
                identifyUntilMs: result.identifyPayload.untilMs,
              });
            }
          }
        }
        if (result.disconnectDeviceIds && result.disconnectDeviceIds.length > 0) {
          for (const client of clients) {
            if (
              client.role === 'audience' &&
              client.showId === result.show.id &&
              client.deviceId &&
              result.disconnectDeviceIds.includes(client.deviceId)
            ) {
              client.ws.close(4001, 'Disconnected by host console');
            }
          }
        }
      }
    });

    ws.on('close', () => {
      if (clientMeta) {
        clients.delete(clientMeta);
        if (clientMeta.role === 'audience' && clientMeta.deviceId) {
          const changed = store.markDeviceDisconnected(clientMeta.showId, clientMeta.deviceId);
          if (changed) {
            broadcastToShow(clientMeta.showId, {
              type: 'devices_update',
              serverTimeMs: Date.now(),
              devices: store.getDevices(clientMeta.showId),
            });
          }
        }
      }
    });
  });

  // Playback tick loop (cues & timeline sequences)
  setInterval(() => {
    const nowMs = Date.now();
    const activeShow = store.getActiveShow();
    const { lightingUpdated, playbackUpdated } = store.tickPlayback(nowMs);
    if (lightingUpdated || playbackUpdated) {
      broadcastToShow(activeShow.id, {
        type: 'state_update',
        serverTimeMs: nowMs,
        show: activeShow,
        lighting: activeShow.lighting,
        playback: activeShow.playback,
      });
    }
  }, 100);

  // Stale device heartbeat sweep
  setInterval(() => {
    const nowMs = Date.now();
    const changedShows = store.sweepStaleDevices(15000, nowMs);
    for (const sid of changedShows) {
      broadcastToShow(sid, {
        type: 'devices_update',
        serverTimeMs: nowMs,
        devices: store.getDevices(sid),
      });
    }
  }, 5000);

  // Vite dev middleware or static production serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          }
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    const ips = getLanIPv4Addresses();
    console.log(`LUMENLINK Server listening on http://0.0.0.0:${PORT}`);
    console.log(`Local LAN addresses: ${ips.map((ip) => `http://${ip}:${PORT}`).join(', ')}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start LUMENLINK server:', err);
  process.exit(1);
});
