import fs from 'fs';
import path from 'path';
import {
  ActiveEffectLayer,
  ActiveMediaProjection,
  AudienceDevice,
  ConnectivityMode,
  CueItem,
  FixtureGroup,
  MediaAsset,
  PlaybackState,
  PosterDesign,
  SavedLayoutPreset,
  ShowAudienceSettings,
  ShowFile,
  TimelineSequence,
} from '../shared/types';
import { clamp, hexToRgb, lerpRgb, rgbToHex } from '../engine/colors';
import { createDefaultEffectParams } from '../engine/effects';
import { createBlankShow, createDemoShow, validateImportedShow } from '../engine/shows';

export interface PersistedStoreData {
  activeShowId: string;
  connectivityMode: ConnectivityMode;
  shows: ShowFile[];
  devicesByShow: Record<string, AudienceDevice[]>;
  mediaAssets: MediaAsset[];
}

export class ShowStore {
  private shows: Map<string, ShowFile> = new Map();
  private devicesByShow: Map<string, AudienceDevice[]> = new Map();
  private mediaAssets: MediaAsset[] = [];
  private activeShowId: string;
  private connectivityMode: ConnectivityMode = 'remote';
  private dataFilePath: string | null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(dataFilePath: string | null = null) {
    this.dataFilePath = dataFilePath;
    const demo = createDemoShow();
    this.shows.set(demo.id, demo);
    this.devicesByShow.set(demo.id, []);
    this.activeShowId = demo.id;

    if (this.dataFilePath) {
      this.loadFromDisk();
    }
  }

  private loadFromDisk(): void {
    if (!this.dataFilePath || !fs.existsSync(this.dataFilePath)) return;
    try {
      const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedStoreData>;
      if (Array.isArray(parsed.shows) && parsed.shows.length > 0) {
        this.shows.clear();
        for (const s of parsed.shows) {
          if (
            s.posterDesign &&
            s.posterDesign.wifiNoPassword === undefined &&
            (!s.posterDesign.wifiPassword || s.posterDesign.wifiPassword === 'Lumen2025')
          ) {
            s.posterDesign = {
              ...s.posterDesign,
              wifiPassword: '',
              wifiNoPassword: true,
            };
          }
          this.shows.set(s.id, s);
        }
        if (parsed.activeShowId && this.shows.has(parsed.activeShowId)) {
          this.activeShowId = parsed.activeShowId;
        } else {
          this.activeShowId = parsed.shows[0].id;
        }
      }
      if (parsed.connectivityMode === 'local' || parsed.connectivityMode === 'remote') {
        this.connectivityMode = parsed.connectivityMode;
      }
      if (parsed.devicesByShow && typeof parsed.devicesByShow === 'object') {
        this.devicesByShow.clear();
        for (const [sid, list] of Object.entries(parsed.devicesByShow)) {
          if (Array.isArray(list)) {
            // On server boot, mark previously known devices as disconnected until they reconnect
            this.devicesByShow.set(
              sid,
              list.map((d) => ({ ...d, status: 'disconnected' })),
            );
          }
        }
      }
      if (Array.isArray(parsed.mediaAssets)) {
        this.mediaAssets = parsed.mediaAssets;
      }
    } catch {
      // Fall back to fresh demo show if disk store is unreadable
    }
  }

  private scheduleSave(): void {
    if (!this.dataFilePath) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 150);
  }

  public saveNow(): void {
    if (!this.dataFilePath) return;
    try {
      fs.mkdirSync(path.dirname(this.dataFilePath), { recursive: true });
      const payload: PersistedStoreData = {
        activeShowId: this.activeShowId,
        connectivityMode: this.connectivityMode,
        shows: Array.from(this.shows.values()),
        devicesByShow: Object.fromEntries(this.devicesByShow.entries()),
        mediaAssets: this.mediaAssets,
      };
      fs.writeFileSync(this.dataFilePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {
      // Ignore write failures in read-only environments
    }
  }

  public getConnectivityMode(): ConnectivityMode {
    return this.connectivityMode;
  }

  public setConnectivityMode(mode: ConnectivityMode): void {
    this.connectivityMode = mode;
    this.scheduleSave();
  }

  public getActiveShow(): ShowFile {
    const show = this.shows.get(this.activeShowId);
    if (show) return show;
    const first = Array.from(this.shows.values())[0];
    if (first) {
      this.activeShowId = first.id;
      return first;
    }
    const demo = createDemoShow();
    this.shows.set(demo.id, demo);
    this.activeShowId = demo.id;
    return demo;
  }

  public getShow(showId?: string): ShowFile {
    if (showId && this.shows.has(showId)) {
      return this.shows.get(showId)!;
    }
    if (showId) {
      const byCode = Array.from(this.shows.values()).find(
        (s) => s.joinCode.toUpperCase() === showId.toUpperCase(),
      );
      if (byCode) return byCode;
    }
    return this.getActiveShow();
  }

  public listShows(): ShowFile[] {
    return Array.from(this.shows.values()).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  public setActiveShow(showId: string): ShowFile | null {
    const show = this.shows.get(showId);
    if (!show) return null;
    this.activeShowId = show.id;
    this.scheduleSave();
    return show;
  }

  public createShow(name: string): ShowFile {
    const show = createBlankShow(name);
    this.shows.set(show.id, show);
    this.devicesByShow.set(show.id, []);
    this.activeShowId = show.id;
    this.scheduleSave();
    return show;
  }

  public renameShow(showId: string, name: string): ShowFile | null {
    const show = this.shows.get(showId);
    if (!show || !name.trim()) return null;
    show.name = name.trim();
    show.audienceSettings.eventTitle = name.trim();
    show.posterDesign.eventName = name.trim();
    show.updatedAtMs = Date.now();
    this.scheduleSave();
    return show;
  }

  public duplicateShow(showId: string): ShowFile | null {
    const src = this.shows.get(showId);
    if (!src) return null;
    const now = Date.now();
    const copy: ShowFile = JSON.parse(JSON.stringify(src));
    copy.id = `${src.id.slice(0, 18)}-copy-${Math.random().toString(36).slice(2, 5)}`;
    copy.name = `${src.name} (Copy)`;
    copy.joinCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    copy.createdAtMs = now;
    copy.updatedAtMs = now;
    this.shows.set(copy.id, copy);
    this.devicesByShow.set(copy.id, []);
    this.activeShowId = copy.id;
    this.scheduleSave();
    return copy;
  }

  public deleteShow(showId: string): boolean {
    if (this.shows.size <= 1) return false;
    const removed = this.shows.delete(showId);
    this.devicesByShow.delete(showId);
    if (this.activeShowId === showId) {
      const next = Array.from(this.shows.values())[0];
      if (next) this.activeShowId = next.id;
    }
    this.scheduleSave();
    return removed;
  }

  public importShow(raw: unknown): ShowFile | null {
    const validated = validateImportedShow(raw);
    if (!validated) return null;
    this.shows.set(validated.id, validated);
    if (!this.devicesByShow.has(validated.id)) {
      this.devicesByShow.set(validated.id, []);
    }
    this.activeShowId = validated.id;
    this.scheduleSave();
    return validated;
  }

  public getDevices(showId: string): AudienceDevice[] {
    const list = this.devicesByShow.get(showId) || [];
    return [...list].sort((a, b) => a.fixtureNumber - b.fixtureNumber);
  }

  public getMediaAssets(): MediaAsset[] {
    return [...this.mediaAssets].sort((a, b) => b.uploadedAtMs - a.uploadedAtMs);
  }

  public addMediaAsset(asset: MediaAsset): MediaAsset {
    this.mediaAssets.unshift(asset);
    this.scheduleSave();
    return asset;
  }

  public deleteMediaAsset(assetId: string): boolean {
    const before = this.mediaAssets.length;
    this.mediaAssets = this.mediaAssets.filter((m) => m.id !== assetId);
    this.scheduleSave();
    return this.mediaAssets.length < before;
  }

  public registerAudienceDevice(
    showId: string,
    input: {
      deviceId: string;
      name?: string;
      deviceType?: AudienceDevice['deviceType'];
      orientation?: AudienceDevice['orientation'];
      batteryLevel?: number | null;
      screenWidth?: number;
      screenHeight?: number;
    },
    nowMs: number = Date.now(),
  ): AudienceDevice {
    const show = this.getShow(showId);
    const list = this.devicesByShow.get(show.id) || [];
    const existing = list.find((d) => d.id === input.deviceId);
    if (existing) {
      existing.status = 'connected';
      existing.lastSeenMs = nowMs;
      if (input.name && input.name.trim()) existing.name = input.name.trim();
      if (input.deviceType) existing.deviceType = input.deviceType;
      if (input.orientation) existing.orientation = input.orientation;
      if (input.batteryLevel !== undefined) existing.batteryLevel = input.batteryLevel;
      if (input.screenWidth) existing.screenWidth = input.screenWidth;
      if (input.screenHeight) existing.screenHeight = input.screenHeight;
      this.devicesByShow.set(show.id, list);
      this.scheduleSave();
      return existing;
    }

    const maxNum = list.reduce((m, d) => Math.max(m, d.fixtureNumber), 0);
    const fixtureNumber = maxNum + 1;
    const cols = 6;
    const idx = list.length;
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const x = Number(((col + 0.5) / cols).toFixed(4));
    const y = Number((Math.min(0.92, (row + 0.5) / 4)).toFixed(4));
    const defaultGroup = show.groups[idx % Math.max(1, show.groups.length)]?.id || 'grp-floor';

    const device: AudienceDevice = {
      id: input.deviceId,
      fixtureNumber,
      name: input.name?.trim() || `Fixture ${String(fixtureNumber).padStart(3, '0')}`,
      deviceType: input.deviceType || 'smartphone',
      orientation: input.orientation || 'portrait',
      status: 'connected',
      batteryLevel: input.batteryLevel ?? null,
      lastSeenMs: nowMs,
      joinedAtMs: nowMs,
      groupId: defaultGroup,
      excluded: false,
      x,
      y,
      row,
      col,
      overrideColor: null,
      identifyUntilMs: 0,
      screenWidth: input.screenWidth,
      screenHeight: input.screenHeight,
      isFullscreen: false,
    };

    list.push(device);
    this.devicesByShow.set(show.id, list);
    this.scheduleSave();
    return device;
  }

  public updateAudienceMeta(
    showId: string,
    deviceId: string,
    meta: Partial<Pick<AudienceDevice, 'orientation' | 'batteryLevel' | 'screenWidth' | 'screenHeight' | 'isFullscreen'>>,
    nowMs: number = Date.now(),
  ): AudienceDevice | null {
    const list = this.devicesByShow.get(showId);
    if (!list) return null;
    const device = list.find((d) => d.id === deviceId);
    if (!device) return null;
    device.status = 'connected';
    device.lastSeenMs = nowMs;
    if (meta.orientation) device.orientation = meta.orientation;
    if (meta.batteryLevel !== undefined) device.batteryLevel = meta.batteryLevel;
    if (meta.screenWidth) device.screenWidth = meta.screenWidth;
    if (meta.screenHeight) device.screenHeight = meta.screenHeight;
    if (meta.isFullscreen !== undefined) device.isFullscreen = meta.isFullscreen;
    return device;
  }

  public markDeviceDisconnected(showId: string, deviceId: string): boolean {
    const list = this.devicesByShow.get(showId);
    if (!list) return false;
    const device = list.find((d) => d.id === deviceId);
    if (!device || device.status === 'disconnected') return false;
    device.status = 'disconnected';
    this.scheduleSave();
    return true;
  }

  public sweepStaleDevices(timeoutMs: number, nowMs: number = Date.now()): string[] {
    const changedShows: string[] = [];
    for (const [showId, list] of this.devicesByShow.entries()) {
      let changed = false;
      for (const d of list) {
        if (d.status === 'connected' && nowMs - d.lastSeenMs > timeoutMs) {
          d.status = 'disconnected';
          changed = true;
        }
      }
      if (changed) changedShows.push(showId);
    }
    if (changedShows.length > 0) this.scheduleSave();
    return changedShows;
  }

  public applyHostCommand(
    showId: string,
    action: string,
    payload: Record<string, unknown>,
    nowMs: number = Date.now(),
  ): {
    show: ShowFile;
    devicesChanged: boolean;
    lightingChanged: boolean;
    playbackChanged: boolean;
    showChanged: boolean;
    identifyPayload?: { deviceIds: string[]; untilMs: number };
    disconnectDeviceIds?: string[];
  } {
    const show = this.getShow(showId);
    const devices = this.devicesByShow.get(show.id) || [];
    let devicesChanged = false;
    let lightingChanged = false;
    let playbackChanged = false;
    let showChanged = false;
    let identifyPayload: { deviceIds: string[]; untilMs: number } | undefined;
    let disconnectDeviceIds: string[] | undefined;

    switch (action) {
      case 'set_base_color': {
        const color = String(payload.color || '#0066FF');
        const transitionMs = Number(payload.transitionMs || 0);
        let currentBase = show.lighting.baseColor;
        if (show.lighting.colourTransition?.active) {
          const tr = show.lighting.colourTransition;
          const progress = clamp((nowMs - tr.startedAtMs) / Math.max(1, tr.durationMs), 0, 1);
          const eased =
            tr.easing === 'cut'
              ? progress >= 1
                ? 1
                : 0
              : tr.easing === 'ease_in_out' || tr.easing === 'crossfade'
                ? progress < 0.5
                  ? 2 * progress * progress
                  : 1 - Math.pow(-2 * progress + 2, 2) / 2
                : progress;
          const midRgb = lerpRgb(hexToRgb(tr.fromColor), hexToRgb(tr.toColor), eased);
          currentBase = rgbToHex(midRgb.r, midRgb.g, midRgb.b);
        }
        if (transitionMs > 0) {
          show.lighting.colourTransition = {
            active: true,
            fromColor: currentBase,
            toColor: color,
            startedAtMs: nowMs,
            durationMs: transitionMs,
            easing: (payload.easing as ShowFile['cues'][0]['transitionType']) || 'ease_in_out',
          };
        } else {
          show.lighting.colourTransition = null;
        }
        if (payload.clearNormalEffects) {
          show.lighting.layers = show.lighting.layers.map((l) =>
            l.blendMode === 'normal' ? { ...l, enabled: false } : l,
          );
          show.playback.timelinePlaying = false;
        }
        show.lighting.baseColor = color;
        show.lighting.blackout = false;
        show.lighting.emergencyNeutral = false;
        show.lighting.updatedAtMs = nowMs;
        lightingChanged = true;
        break;
      }

      case 'start_colour_transition': {
        const fromColor = String(payload.fromColor || show.lighting.baseColor || '#FF0000');
        const toColor = String(payload.toColor || '#0000FF');
        const durationMs = Math.max(100, Number(payload.durationMs || 2500));
        show.lighting.colourTransition = {
          active: true,
          fromColor,
          toColor,
          startedAtMs: nowMs,
          durationMs,
          easing: (payload.easing as ShowFile['cues'][0]['transitionType']) || 'ease_in_out',
        };
        show.lighting.baseColor = toColor;
        show.lighting.blackout = false;
        show.lighting.emergencyNeutral = false;
        show.lighting.updatedAtMs = nowMs;
        lightingChanged = true;
        break;
      }

      case 'set_master_intensity': {
        show.lighting.masterIntensity = Math.max(0, Math.min(100, Number(payload.intensity ?? 100)));
        show.lighting.updatedAtMs = nowMs;
        lightingChanged = true;
        break;
      }

      case 'set_blackout': {
        show.lighting.blackout = Boolean(payload.blackout);
        show.lighting.updatedAtMs = nowMs;
        lightingChanged = true;
        break;
      }

      case 'set_freeze': {
        show.lighting.freeze = Boolean(payload.freeze);
        show.lighting.updatedAtMs = nowMs;
        lightingChanged = true;
        break;
      }

      case 'set_emergency_neutral': {
        show.lighting.emergencyNeutral = Boolean(payload.emergencyNeutral);
        if (show.lighting.emergencyNeutral) {
          show.lighting.blackout = false;
        }
        show.lighting.updatedAtMs = nowMs;
        lightingChanged = true;
        break;
      }

      case 'stop_all_effects': {
        show.lighting.layers = show.lighting.layers.map((l) => ({ ...l, enabled: false }));
        show.playback.timelinePlaying = false;
        show.playback.status = 'stopped';
        show.lighting.updatedAtMs = nowMs;
        lightingChanged = true;
        playbackChanged = true;
        break;
      }

      case 'release_all': {
        show.lighting.blackout = false;
        show.lighting.freeze = false;
        show.lighting.emergencyNeutral = false;
        show.lighting.colourTransition = null;
        show.lighting.baseColor = '#000000';
        show.lighting.layers = show.lighting.layers.map((l) => ({ ...l, enabled: false }));
        show.lighting.media.enabled = false;
        for (const g of show.groups) g.overrideColor = null;
        for (const d of devices) d.overrideColor = null;
        show.playback.status = 'stopped';
        show.playback.activeCueId = null;
        show.playback.activeCueIndex = -1;
        show.playback.timelinePlaying = false;
        show.lighting.updatedAtMs = nowMs;
        lightingChanged = true;
        playbackChanged = true;
        devicesChanged = true;
        break;
      }

      case 'upsert_effect_layer': {
        const layer = payload.layer as ActiveEffectLayer;
        if (layer && layer.id) {
          const idx = show.lighting.layers.findIndex((l) => l.id === layer.id);
          const existing = idx >= 0 ? show.lighting.layers[idx] : null;
          const resetStart =
            !existing ||
            existing.type !== layer.type ||
            (!existing.enabled && layer.enabled);
          const normalized: ActiveEffectLayer = {
            ...layer,
            startedAtMs: resetStart ? nowMs : (layer.startedAtMs || existing?.startedAtMs || nowMs),
            params: createDefaultEffectParams(layer.params),
          };
          if (idx >= 0) {
            show.lighting.layers[idx] = normalized;
          } else {
            show.lighting.layers.push(normalized);
          }
          if (normalized.enabled) {
            show.lighting.freeze = false;
            show.lighting.blackout = false;
            show.lighting.emergencyNeutral = false;
            show.lighting.colourTransition = null;
            show.lighting.media.enabled = false;
            show.playback.timelinePlaying = false;
            if (show.playback.status === 'playing') {
              show.playback.status = 'paused';
            }
          }
          show.lighting.updatedAtMs = nowMs;
          lightingChanged = true;
          playbackChanged = true;
        }
        break;
      }

      case 'remove_effect_layer': {
        const layerId = String(payload.layerId || '');
        show.lighting.layers = show.lighting.layers.filter((l) => l.id !== layerId);
        show.lighting.updatedAtMs = nowMs;
        lightingChanged = true;
        break;
      }

      case 'set_media_projection': {
        const mediaPatch = payload.media as Partial<ActiveMediaProjection>;
        show.lighting.media = {
          ...show.lighting.media,
          ...mediaPatch,
          playbackStartServerMs: mediaPatch.playbackStartServerMs ?? nowMs,
        };
        show.lighting.blackout = false;
        show.lighting.updatedAtMs = nowMs;
        lightingChanged = true;
        break;
      }

      case 'clear_media_projection': {
        show.lighting.media.enabled = false;
        show.lighting.media.isPlaying = false;
        show.lighting.updatedAtMs = nowMs;
        lightingChanged = true;
        break;
      }

      case 'update_device': {
        const deviceId = String(payload.deviceId || '');
        const d = devices.find((x) => x.id === deviceId);
        if (d) {
          if (typeof payload.name === 'string') d.name = payload.name.trim() || d.name;
          if (typeof payload.groupId === 'string') d.groupId = payload.groupId;
          if (typeof payload.excluded === 'boolean') d.excluded = payload.excluded;
          if (typeof payload.x === 'number') d.x = Math.max(0.02, Math.min(0.98, payload.x));
          if (typeof payload.y === 'number') d.y = Math.max(0.02, Math.min(0.98, payload.y));
          if (typeof payload.row === 'number') d.row = payload.row;
          if (typeof payload.col === 'number') d.col = payload.col;
          if (payload.overrideColor !== undefined) {
            d.overrideColor = payload.overrideColor ? String(payload.overrideColor) : null;
          }
          if (typeof payload.fixtureNumber === 'number' && payload.fixtureNumber >= 1) {
            d.fixtureNumber = Math.round(payload.fixtureNumber);
          }
          devicesChanged = true;
        }
        break;
      }

      case 'bulk_update_devices': {
        const ids = Array.isArray(payload.deviceIds) ? (payload.deviceIds as string[]) : [];
        const targetSet = new Set(ids);
        for (const d of devices) {
          if (targetSet.size > 0 && !targetSet.has(d.id)) continue;
          if (typeof payload.groupId === 'string') d.groupId = payload.groupId;
          if (typeof payload.excluded === 'boolean') d.excluded = payload.excluded;
          if (payload.overrideColor !== undefined) {
            d.overrideColor = payload.overrideColor ? String(payload.overrideColor) : null;
          }
        }
        if (payload.autoGrid && typeof payload.cols === 'number') {
          const cols = Math.max(1, Math.min(20, Math.round(payload.cols)));
          const sorted = [...devices].sort((a, b) => a.fixtureNumber - b.fixtureNumber);
          const totalRows = Math.max(1, Math.ceil(sorted.length / cols));
          sorted.forEach((d, idx) => {
            const r = Math.floor(idx / cols);
            const c = idx % cols;
            d.row = r;
            d.col = c;
            d.x = Number(((c + 0.5) / cols).toFixed(4));
            d.y = Number(((r + 0.5) / totalRows).toFixed(4));
          });
        }
        devicesChanged = true;
        break;
      }

      case 'reorder_device': {
        const deviceId = String(payload.deviceId || '');
        const direction = payload.direction === 'up' ? -1 : 1;
        const sorted = [...devices].sort((a, b) => a.fixtureNumber - b.fixtureNumber);
        const idx = sorted.findIndex((d) => d.id === deviceId);
        const swapIdx = idx + direction;
        if (idx >= 0 && swapIdx >= 0 && swapIdx < sorted.length) {
          const numA = sorted[idx].fixtureNumber;
          sorted[idx].fixtureNumber = sorted[swapIdx].fixtureNumber;
          sorted[swapIdx].fixtureNumber = numA;
          devicesChanged = true;
        }
        break;
      }

      case 'identify_devices': {
        const ids = Array.isArray(payload.deviceIds) ? (payload.deviceIds as string[]) : [];
        const untilMs = nowMs + 4000;
        for (const d of devices) {
          if (ids.includes(d.id)) {
            d.identifyUntilMs = untilMs;
          }
        }
        identifyPayload = { deviceIds: ids, untilMs };
        devicesChanged = true;
        break;
      }

      case 'disconnect_devices': {
        const ids = Array.isArray(payload.deviceIds) ? (payload.deviceIds as string[]) : [];
        this.devicesByShow.set(
          show.id,
          devices.filter((d) => !ids.includes(d.id)),
        );
        disconnectDeviceIds = ids;
        devicesChanged = true;
        break;
      }

      case 'create_group': {
        const name = String(payload.name || 'New Group').trim();
        const color = String(payload.color || '#38BDF8');
        const group: FixtureGroup = {
          id: `grp-${Math.random().toString(36).slice(2, 7)}`,
          name,
          color,
          masterIntensity: 100,
          overrideColor: null,
          sectionLabel: payload.sectionLabel ? String(payload.sectionLabel) : undefined,
        };
        show.groups.push(group);
        show.updatedAtMs = nowMs;
        lightingChanged = true;
        break;
      }

      case 'update_group': {
        const g = show.groups.find((x) => x.id === payload.groupId);
        if (g) {
          if (typeof payload.name === 'string') g.name = payload.name.trim() || g.name;
          if (typeof payload.color === 'string') g.color = payload.color;
          if (typeof payload.masterIntensity === 'number') {
            g.masterIntensity = Math.max(0, Math.min(100, payload.masterIntensity));
          }
          if (payload.overrideColor !== undefined) {
            g.overrideColor = payload.overrideColor ? String(payload.overrideColor) : null;
          }
          show.updatedAtMs = nowMs;
          lightingChanged = true;
        }
        break;
      }

      case 'delete_group': {
        const gid = String(payload.groupId || '');
        if (show.groups.length > 1) {
          show.groups = show.groups.filter((x) => x.id !== gid);
          const fallback = show.groups[0].id;
          for (const d of devices) {
            if (d.groupId === gid) d.groupId = fallback;
          }
          devicesChanged = true;
          lightingChanged = true;
        }
        break;
      }

      case 'save_layout_preset': {
        const name = String(payload.name || 'Custom Layout').trim();
        const positions: SavedLayoutPreset['positions'] = {};
        for (const d of devices) {
          positions[d.id] = { x: d.x, y: d.y, row: d.row, col: d.col, groupId: d.groupId };
        }
        show.layoutPresets.push({
          id: `preset-${Math.random().toString(36).slice(2, 7)}`,
          name,
          rows: Number(payload.rows || 4),
          cols: Number(payload.cols || 6),
          positions,
        });
        show.updatedAtMs = nowMs;
        break;
      }

      case 'apply_layout_preset': {
        const preset = show.layoutPresets.find((p) => p.id === payload.presetId);
        if (preset) {
          const hasPositions = Object.keys(preset.positions).length > 0;
          if (hasPositions) {
            for (const d of devices) {
              const pos = preset.positions[d.id];
              if (pos) {
                d.x = pos.x;
                d.y = pos.y;
                d.row = pos.row;
                d.col = pos.col;
                if (pos.groupId) d.groupId = pos.groupId;
              }
            }
          } else {
            const cols = Math.max(1, preset.cols);
            const sorted = [...devices].sort((a, b) => a.fixtureNumber - b.fixtureNumber);
            const totalRows = Math.max(1, Math.ceil(sorted.length / cols));
            sorted.forEach((d, idx) => {
              const r = Math.floor(idx / cols);
              const c = idx % cols;
              d.row = r;
              d.col = c;
              d.x = Number(((c + 0.5) / cols).toFixed(4));
              d.y = Number(((r + 0.5) / totalRows).toFixed(4));
            });
          }
          devicesChanged = true;
        }
        break;
      }

      case 'upsert_cue': {
        const cue = payload.cue as CueItem;
        if (cue && cue.id) {
          const idx = show.cues.findIndex((c) => c.id === cue.id);
          if (idx >= 0) show.cues[idx] = cue;
          else show.cues.push(cue);
          show.cues.sort((a, b) => a.cueNumber - b.cueNumber);
          show.updatedAtMs = nowMs;
          playbackChanged = true;
        }
        break;
      }

      case 'delete_cue': {
        const cueId = String(payload.cueId || '');
        show.cues = show.cues.filter((c) => c.id !== cueId);
        show.updatedAtMs = nowMs;
        playbackChanged = true;
        break;
      }

      case 'cue_go': {
        const targetIndex =
          typeof payload.cueIndex === 'number'
            ? payload.cueIndex
            : show.playback.activeCueIndex < 0
              ? 0
              : show.playback.activeCueIndex;
        this.activateCueAtIndex(show, targetIndex, nowMs);
        show.playback.status = 'playing';
        lightingChanged = true;
        playbackChanged = true;
        break;
      }

      case 'cue_next': {
        const nextIdx =
          show.cues.length === 0
            ? -1
            : (show.playback.activeCueIndex + 1) % show.cues.length;
        if (nextIdx >= 0) {
          this.activateCueAtIndex(show, nextIdx, nowMs);
          show.playback.status = 'playing';
          lightingChanged = true;
          playbackChanged = true;
        }
        break;
      }

      case 'cue_back': {
        if (show.cues.length > 0) {
          const prevIdx =
            show.playback.activeCueIndex <= 0
              ? show.cues.length - 1
              : show.playback.activeCueIndex - 1;
          this.activateCueAtIndex(show, prevIdx, nowMs);
          show.playback.status = 'playing';
          lightingChanged = true;
          playbackChanged = true;
        }
        break;
      }

      case 'cue_goto': {
        const idx = show.cues.findIndex((c) => c.id === payload.cueId || c.cueNumber === payload.cueNumber);
        if (idx >= 0) {
          this.activateCueAtIndex(show, idx, nowMs);
          show.playback.status = 'playing';
          lightingChanged = true;
          playbackChanged = true;
        }
        break;
      }

      case 'cue_pause': {
        show.playback.status = 'paused';
        playbackChanged = true;
        break;
      }

      case 'cue_stop': {
        show.playback.status = 'stopped';
        show.playback.activeCueId = null;
        show.playback.activeCueIndex = -1;
        playbackChanged = true;
        break;
      }

      case 'save_timeline': {
        const tl = payload.timeline as TimelineSequence;
        if (tl && tl.id) {
          const idx = show.timelines.findIndex((t) => t.id === tl.id);
          if (idx >= 0) show.timelines[idx] = tl;
          else show.timelines.push(tl);
          show.updatedAtMs = nowMs;
          playbackChanged = true;
        }
        break;
      }

      case 'timeline_play': {
        const tlId = String(payload.timelineId || show.timelines[0]?.id || '');
        if (tlId) {
          show.playback.activeTimelineId = tlId;
          show.playback.timelinePlaying = true;
          show.playback.timelineStartedAtMs = nowMs - (show.playback.timelinePositionMs || 0);
          show.playback.status = 'playing';
          this.applyTimelineAtTime(show, nowMs);
          lightingChanged = true;
          playbackChanged = true;
        }
        break;
      }

      case 'timeline_pause': {
        if (show.playback.timelinePlaying) {
          show.playback.timelinePositionMs = Math.max(0, nowMs - show.playback.timelineStartedAtMs);
          show.playback.timelinePlaying = false;
          playbackChanged = true;
        }
        break;
      }

      case 'timeline_stop': {
        show.playback.timelinePlaying = false;
        show.playback.timelinePositionMs = 0;
        show.playback.status = 'stopped';
        playbackChanged = true;
        break;
      }

      case 'timeline_seek': {
        const posMs = Math.max(0, Number(payload.positionMs || 0));
        show.playback.timelinePositionMs = posMs;
        show.playback.timelineStartedAtMs = nowMs - posMs;
        this.applyTimelineAtTime(show, nowMs);
        lightingChanged = true;
        playbackChanged = true;
        break;
      }

      case 'update_audience_settings': {
        show.audienceSettings = {
          ...show.audienceSettings,
          ...(payload.settings as Partial<ShowAudienceSettings>),
        };
        show.updatedAtMs = nowMs;
        showChanged = true;
        break;
      }

      case 'update_poster_design': {
        show.posterDesign = {
          ...show.posterDesign,
          ...(payload.posterDesign as Partial<PosterDesign>),
        };
        show.updatedAtMs = nowMs;
        showChanged = true;
        break;
      }

      case 'save_palette': {
        const colors = Array.isArray(payload.colors) ? (payload.colors as string[]) : null;
        if (colors && colors.length > 0) {
          show.savedPalettes.unshift(colors);
          show.savedPalettes = show.savedPalettes.slice(0, 12);
          show.updatedAtMs = nowMs;
          showChanged = true;
        }
        break;
      }

      case 'save_color': {
        const color = String(payload.color || '');
        if (color && !show.savedColors.includes(color)) {
          show.savedColors.unshift(color);
          show.savedColors = show.savedColors.slice(0, 24);
          show.updatedAtMs = nowMs;
          showChanged = true;
        }
        break;
      }

      case 'regenerate_join_code': {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let attempt = 0; attempt < 10; attempt++) {
          let candidate = '';
          for (let i = 0; i < 6; i++) {
            candidate += alphabet[Math.floor(Math.random() * alphabet.length)];
          }
          const collision = Array.from(this.shows.values()).some(
            (s) => s.joinCode.toUpperCase() === candidate || s.id.toUpperCase() === candidate,
          );
          if (!collision && candidate !== show.joinCode.toUpperCase()) {
            code = candidate;
            break;
          }
        }
        if (code) {
          show.joinCode = code;
          show.updatedAtMs = nowMs;
          showChanged = true;
        }
        break;
      }
    }

    this.scheduleSave();
    return {
      show,
      devicesChanged,
      lightingChanged,
      playbackChanged,
      showChanged,
      identifyPayload,
      disconnectDeviceIds,
    };
  }

  private activateCueAtIndex(show: ShowFile, idx: number, nowMs: number): void {
    const cue = show.cues[idx];
    if (!cue) return;
    show.playback.activeCueId = cue.id;
    show.playback.activeCueIndex = idx;
    show.playback.cueStartedAtMs = nowMs;

    const prevColor = show.lighting.baseColor;
    show.lighting.baseColor = cue.colour;
    show.lighting.masterIntensity = cue.intensity;
    show.lighting.blackout = false;
    show.lighting.emergencyNeutral = false;

    if (cue.fadeInMs > 0 && cue.transitionType !== 'cut') {
      show.lighting.colourTransition = {
        active: true,
        fromColor: prevColor,
        toColor: cue.colour,
        startedAtMs: nowMs,
        durationMs: cue.fadeInMs,
        easing: cue.transitionType,
      };
    } else {
      show.lighting.colourTransition = null;
    }

    const palette = [cue.colour];
    if (cue.secondaryColour) palette.push(cue.secondaryColour);
    if (cue.effectParams?.palette && cue.effectParams.palette.length > 0) {
      palette.splice(0, palette.length, ...cue.effectParams.palette);
    }

    const primaryLayer: ActiveEffectLayer = {
      id: 'layer-cue-main',
      name: cue.name,
      type: cue.effectType,
      enabled: cue.effectType !== 'solid',
      blendMode: 'normal',
      opacity: 1,
      startedAtMs: nowMs,
      params: createDefaultEffectParams({
        ...cue.effectParams,
        intensity: cue.intensity,
        targetGroupId: cue.targetGroupId,
        palette,
      }),
    };

    // Keep cue layer as primary layer
    show.lighting.layers = [primaryLayer];

    if (cue.mediaId) {
      const asset = this.mediaAssets.find((m) => m.id === cue.mediaId);
      if (asset) {
        show.lighting.media = {
          ...show.lighting.media,
          enabled: true,
          mediaId: asset.id,
          url: asset.url,
          kind: asset.kind,
          fitMode: cue.mediaFitMode || 'cover',
          targetGroupId: cue.targetGroupId,
          playbackStartServerMs: nowMs,
          isPlaying: asset.kind === 'video',
        };
      }
    } else {
      show.lighting.media.enabled = false;
    }

    show.lighting.updatedAtMs = nowMs;
  }

  private applyTimelineAtTime(show: ShowFile, nowMs: number): boolean {
    const tl = show.timelines.find((t) => t.id === show.playback.activeTimelineId);
    if (!tl) return false;
    let pos = Math.max(0, nowMs - show.playback.timelineStartedAtMs);
    if (tl.totalDurationMs > 0) {
      if (tl.loop) {
        pos = pos % tl.totalDurationMs;
      } else if (pos >= tl.totalDurationMs) {
        show.playback.timelinePlaying = false;
        show.playback.timelinePositionMs = tl.totalDurationMs;
        show.playback.status = 'stopped';
        return true;
      }
    }
    show.playback.timelinePositionMs = pos;

    const activeBlocks = tl.blocks.filter((b) => pos >= b.startMs && pos < b.startMs + b.durationMs);
    const layers: ActiveEffectLayer[] = [];
    let baseColor = show.lighting.baseColor;
    let mediaBlockApplied = false;

    for (const blk of activeBlocks) {
      if (blk.track === 'intensity' && typeof blk.intensity === 'number') {
        show.lighting.masterIntensity = blk.intensity;
      } else if (blk.track === 'image' && blk.mediaId) {
        const asset = this.mediaAssets.find((m) => m.id === blk.mediaId);
        if (asset) {
          show.lighting.media = {
            ...show.lighting.media,
            enabled: true,
            mediaId: asset.id,
            url: asset.url,
            kind: asset.kind,
            playbackStartServerMs: show.playback.timelineStartedAtMs + blk.startMs,
            isPlaying: asset.kind === 'video',
          };
          mediaBlockApplied = true;
        }
      } else if (blk.effectType) {
        if (blk.track === 'colour' && blk.colour) {
          baseColor = blk.colour;
        }
        layers.push({
          id: `tl-${blk.id}`,
          name: blk.label,
          type: blk.effectType,
          enabled: blk.effectType !== 'solid',
          blendMode: blk.track === 'flash' ? 'add' : 'normal',
          opacity: 1,
          startedAtMs: show.playback.timelineStartedAtMs + blk.startMs,
          params: createDefaultEffectParams({
            ...blk.effectParams,
            palette: blk.effectParams?.palette || (blk.colour ? [blk.colour, '#000000'] : ['#0088FF', '#FFFFFF']),
          }),
        });
      }
    }

    if (!mediaBlockApplied && show.lighting.media.enabled) {
      show.lighting.media.enabled = false;
    }

    show.lighting.baseColor = baseColor;
    show.lighting.layers = layers;
    show.lighting.updatedAtMs = nowMs;
    return true;
  }

  public tickPlayback(nowMs: number = Date.now()): { lightingUpdated: boolean; playbackUpdated: boolean } {
    const show = this.getActiveShow();
    let lightingUpdated = false;
    let playbackUpdated = false;

    if (show.playback.status === 'playing' && show.playback.activeCueIndex >= 0 && !show.playback.timelinePlaying) {
      const cue = show.cues[show.playback.activeCueIndex];
      if (cue && cue.autoFollow && cue.durationMs > 0) {
        if (nowMs - show.playback.cueStartedAtMs >= cue.durationMs) {
          const nextIdx = (show.playback.activeCueIndex + 1) % show.cues.length;
          this.activateCueAtIndex(show, nextIdx, nowMs);
          lightingUpdated = true;
          playbackUpdated = true;
        }
      }
    }

    if (show.playback.timelinePlaying) {
      const prevLayerSignature = show.lighting.layers.map((l) => l.id).join(',');
      this.applyTimelineAtTime(show, nowMs);
      const nextLayerSignature = show.lighting.layers.map((l) => l.id).join(',');
      if (prevLayerSignature !== nextLayerSignature || !show.playback.timelinePlaying) {
        lightingUpdated = true;
        playbackUpdated = true;
      }
    }

    return { lightingUpdated, playbackUpdated };
  }
}
