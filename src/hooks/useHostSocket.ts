import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudienceDevice,
  ConnectivityMode,
  MediaAsset,
  NetworkInfo,
  ShowFile,
  WsMessageToClient,
} from '../shared/types';
import { createDemoShow } from '../engine/shows';

export interface HostSocketState {
  connected: boolean;
  httpSynced: boolean;
  requiresPasscode: boolean;
  passcodeError: string | null;
  hostToken: string | null;
  show: ShowFile;
  showsList: ShowFile[];
  devices: AudienceDevice[];
  mediaAssets: MediaAsset[];
  networkInfo: NetworkInfo | null;
  serverOffsetMs: number;
}

const CACHED_SHOW_KEY = 'lumenlink_cached_active_show';

function getInitialShow(): ShowFile {
  try {
    const raw = window.localStorage.getItem(CACHED_SHOW_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ShowFile;
      if (parsed && parsed.id && parsed.lighting && parsed.posterDesign) {
        return parsed;
      }
    }
  } catch {
    // Ignore invalid cached state
  }
  return createDemoShow();
}

function cacheShowSnapshot(show: ShowFile | undefined): void {
  if (!show) return;
  try {
    window.localStorage.setItem(CACHED_SHOW_KEY, JSON.stringify(show));
  } catch {
    // Ignore storage quota errors
  }
}

export function useHostSocket() {
  const [initialShow] = useState<ShowFile>(() => getInitialShow());
  const [state, setState] = useState<HostSocketState>({
    connected: false,
    httpSynced: false,
    requiresPasscode: false,
    passcodeError: null,
    hostToken: null,
    show: initialShow,
    showsList: [initialShow],
    devices: [],
    mediaAssets: [],
    networkInfo: null,
    serverOffsetMs: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef<string | null>(null);
  const showIdRef = useRef<string | undefined>(undefined);
  const reconnectTimerRef = useRef<number | null>(null);
  const authRetryTimerRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);
  const authFnRef = useRef<(passcode?: string) => Promise<boolean>>(async () => false);

  const fetchShowsAndNetwork = useCallback(async (token: string) => {
    try {
      const [showsRes, netRes, mediaRes] = await Promise.all([
        fetch('/api/shows', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/network-info'),
        fetch('/api/media'),
      ]);

      if (showsRes.status === 401) {
        tokenRef.current = null;
        if (!unmountedRef.current) {
          authFnRef.current();
        }
        return;
      }

      let activeShowFromHttp: ShowFile | undefined;
      let showsFromHttp: ShowFile[] | undefined;
      let devicesFromHttp: AudienceDevice[] | undefined;
      let serverTimeFromHttp: number | undefined;
      let netFromHttp: NetworkInfo | undefined;
      let mediaFromHttp: MediaAsset[] | undefined;

      if (showsRes.ok) {
        const data = await showsRes.json();
        showsFromHttp = data.shows || [];
        activeShowFromHttp =
          data.activeShow ||
          showsFromHttp?.find((s: ShowFile) => s.id === (showIdRef.current || data.activeShowId)) ||
          showsFromHttp?.[0];
        if (activeShowFromHttp) {
          showIdRef.current = activeShowFromHttp.id;
          cacheShowSnapshot(activeShowFromHttp);
        }
        if (Array.isArray(data.devices)) {
          devicesFromHttp = data.devices;
        }
        if (typeof data.serverTimeMs === 'number') {
          serverTimeFromHttp = data.serverTimeMs;
        }
      }
      if (netRes.ok) {
        netFromHttp = (await netRes.json()) as NetworkInfo;
      }
      if (mediaRes.ok) {
        const m = await mediaRes.json();
        mediaFromHttp = m.mediaAssets || [];
      }

      if (!unmountedRef.current) {
        setState((prev) => ({
          ...prev,
          httpSynced: showsRes.ok || prev.httpSynced,
          serverOffsetMs:
            typeof serverTimeFromHttp === 'number'
              ? serverTimeFromHttp - Date.now()
              : prev.serverOffsetMs,
          show: activeShowFromHttp || prev.show,
          showsList: showsFromHttp || prev.showsList,
          devices: devicesFromHttp || prev.devices,
          networkInfo: netFromHttp || prev.networkInfo,
          mediaAssets: mediaFromHttp || prev.mediaAssets,
        }));
      }
    } catch {
      // Ignore transient startup errors
    }
  }, []);

  const connectWs = useCallback((token: string, targetShowId?: string) => {
    if (unmountedRef.current) return;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'register_host',
          hostToken: token,
          showId: targetShowId || showIdRef.current,
        }),
      );
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WsMessageToClient;
        const offset = msg.serverTimeMs ? msg.serverTimeMs - Date.now() : 0;

        if (msg.type === 'error' && msg.message === 'Unauthorized host session') {
          tokenRef.current = null;
          authFnRef.current();
          return;
        }

        if (msg.type === 'welcome_sync') {
          if (msg.show) {
            showIdRef.current = msg.show.id;
            cacheShowSnapshot(msg.show);
          }
          setState((prev) => ({
            ...prev,
            connected: true,
            httpSynced: true,
            serverOffsetMs: offset,
            show: msg.show || prev.show,
            devices: msg.devices || prev.devices,
            mediaAssets: msg.mediaAssets || prev.mediaAssets,
          }));
        } else if (msg.type === 'state_update') {
          if (msg.show) cacheShowSnapshot(msg.show);
          setState((prev) => ({
            ...prev,
            serverOffsetMs: offset,
            show: msg.show || prev.show,
            showsList: msg.show
              ? prev.showsList.map((s) => (s.id === msg.show!.id ? msg.show! : s))
              : prev.showsList,
            mediaAssets: msg.mediaAssets || prev.mediaAssets,
          }));
        } else if (msg.type === 'devices_update') {
          setState((prev) => ({
            ...prev,
            devices: msg.devices || prev.devices,
          }));
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, connected: false }));
      if (!unmountedRef.current && tokenRef.current) {
        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => {
          if (tokenRef.current) connectWs(tokenRef.current, showIdRef.current);
        }, 1500);
      }
    };
  }, []);

  const authenticateHost = useCallback(
    async (passcode?: string): Promise<boolean> => {
      try {
        const res = await fetch('/api/host/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode }),
        });
        const data = await res.json();
        if (!res.ok) {
          setState((prev) => ({
            ...prev,
            requiresPasscode: Boolean(data.requiresPasscode),
            passcodeError: data.error || 'Authentication failed',
          }));
          return false;
        }
        tokenRef.current = data.hostToken;
        setState((prev) => ({
          ...prev,
          hostToken: data.hostToken,
          requiresPasscode: false,
          passcodeError: null,
        }));
        await fetchShowsAndNetwork(data.hostToken);
        connectWs(data.hostToken);
        return true;
      } catch {
        // Retry automatically if server is still warming up (e.g. cold boot after publish)
        if (!unmountedRef.current && !passcode) {
          if (authRetryTimerRef.current) window.clearTimeout(authRetryTimerRef.current);
          authRetryTimerRef.current = window.setTimeout(() => {
            if (!unmountedRef.current && !tokenRef.current) {
              authFnRef.current();
            }
          }, 2000);
        }
        return false;
      }
    },
    [connectWs, fetchShowsAndNetwork],
  );

  useEffect(() => {
    authFnRef.current = authenticateHost;
  }, [authenticateHost]);

  useEffect(() => {
    unmountedRef.current = false;
    (async () => {
      try {
        const statusRes = await fetch('/api/host/auth-status');
        const status = await statusRes.json();
        if (status.requiresPasscode) {
          setState((prev) => ({ ...prev, requiresPasscode: true }));
        } else {
          await authenticateHost();
        }
      } catch {
        await authenticateHost();
      }
    })();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (authRetryTimerRef.current) window.clearTimeout(authRetryTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [authenticateHost]);

  // Lightweight HTTP sync fallback whenever WebSocket is unavailable
  useEffect(() => {
    if (state.connected || !state.hostToken) return;
    const timer = window.setInterval(() => {
      if (tokenRef.current) {
        fetchShowsAndNetwork(tokenRef.current);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [state.connected, state.hostToken, fetchShowsAndNetwork]);

  const sendHostCommand = useCallback(
    (action: string, payload: Record<string, unknown> = {}) => {
      if (action === 'update_poster_design' && payload.posterDesign) {
        setState((prev) => ({
          ...prev,
          show: {
            ...prev.show,
            posterDesign: {
              ...prev.show.posterDesign,
              ...(payload.posterDesign as Record<string, unknown>),
            },
          },
        }));
      }

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'host_command',
            showId: showIdRef.current || state.show.id,
            payload: { action, ...payload },
          }),
        );
        return;
      }

      // HTTP REST fallback when WebSocket is disconnected or proxy-blocked
      if (tokenRef.current) {
        fetch('/api/host/command', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenRef.current}`,
          },
          body: JSON.stringify({
            action,
            showId: showIdRef.current || state.show.id,
            payload,
          }),
        })
          .then(async (res) => {
            if (res.status === 401) {
              tokenRef.current = null;
              authFnRef.current();
              return;
            }
            if (!res.ok) return;
            const data = await res.json();
            if (data.show) cacheShowSnapshot(data.show);
            setState((prev) => ({
              ...prev,
              httpSynced: true,
              serverOffsetMs:
                typeof data.serverTimeMs === 'number'
                  ? data.serverTimeMs - Date.now()
                  : prev.serverOffsetMs,
              show: data.show || prev.show,
              devices: data.devices || prev.devices,
              showsList: data.shows || prev.showsList,
            }));
          })
          .catch(() => {});
      }
    },
    [state.show.id],
  );

  const createShow = useCallback(
    async (name: string) => {
      if (!tokenRef.current) return null;
      const res = await fetch('/api/shows', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      showIdRef.current = data.show.id;
      cacheShowSnapshot(data.show);
      setState((prev) => ({ ...prev, show: data.show, showsList: data.shows }));
      connectWs(tokenRef.current, data.show.id);
      return data.show as ShowFile;
    },
    [connectWs],
  );

  const renameShow = useCallback(async (showId: string, name: string) => {
    if (!tokenRef.current) return null;
    const res = await fetch(`/api/shows/${showId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenRef.current}`,
      },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    setState((prev) => ({
      ...prev,
      show: prev.show?.id === showId ? data.show : prev.show,
      showsList: data.shows,
    }));
    return data.show as ShowFile;
  }, []);

  const activateShow = useCallback(
    async (showId: string) => {
      if (!tokenRef.current) return;
      const res = await fetch(`/api/shows/${showId}/activate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      showIdRef.current = data.show.id;
      cacheShowSnapshot(data.show);
      setState((prev) => ({
        ...prev,
        show: data.show,
        devices: data.devices || [],
      }));
      connectWs(tokenRef.current, data.show.id);
    },
    [connectWs],
  );

  const duplicateShow = useCallback(
    async (showId: string) => {
      if (!tokenRef.current) return;
      const res = await fetch(`/api/shows/${showId}/duplicate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      showIdRef.current = data.show.id;
      cacheShowSnapshot(data.show);
      setState((prev) => ({ ...prev, show: data.show, showsList: data.shows }));
      connectWs(tokenRef.current, data.show.id);
    },
    [connectWs],
  );

  const deleteShow = useCallback(
    async (showId: string) => {
      if (!tokenRef.current) return;
      const res = await fetch(`/api/shows/${showId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      showIdRef.current = data.activeShow.id;
      cacheShowSnapshot(data.activeShow);
      setState((prev) => ({ ...prev, show: data.activeShow, showsList: data.shows }));
      connectWs(tokenRef.current, data.activeShow.id);
    },
    [connectWs],
  );

  const importShowFile = useCallback(
    async (showObj: unknown) => {
      if (!tokenRef.current) return null;
      const res = await fetch('/api/shows/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ show: showObj }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      showIdRef.current = data.show.id;
      cacheShowSnapshot(data.show);
      setState((prev) => ({ ...prev, show: data.show, showsList: data.shows }));
      connectWs(tokenRef.current, data.show.id);
      return data.show as ShowFile;
    },
    [connectWs],
  );

  const uploadMedia = useCallback(async (file: File) => {
    if (!tokenRef.current) return { ok: false, error: 'Host not authenticated' };
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/media/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenRef.current}` },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error || 'Upload failed' };
    }
    setState((prev) => ({ ...prev, mediaAssets: data.mediaAssets || prev.mediaAssets }));
    return { ok: true, asset: data.asset as MediaAsset };
  }, []);

  const deleteMedia = useCallback(async (mediaId: string) => {
    if (!tokenRef.current) return;
    const res = await fetch(`/api/media/${mediaId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenRef.current}` },
    });
    if (res.ok) {
      const data = await res.json();
      setState((prev) => ({ ...prev, mediaAssets: data.mediaAssets || [] }));
    }
  }, []);

  const setConnectivityMode = useCallback(async (mode: ConnectivityMode) => {
    if (!tokenRef.current) return;
    const res = await fetch('/api/network-mode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenRef.current}`,
      },
      body: JSON.stringify({ mode }),
    });
    if (res.ok) {
      setState((prev) => ({
        ...prev,
        networkInfo: prev.networkInfo ? { ...prev.networkInfo, connectivityMode: mode } : prev.networkInfo,
      }));
    }
  }, []);

  return {
    ...state,
    authenticateHost,
    sendHostCommand,
    createShow,
    renameShow,
    activateShow,
    duplicateShow,
    deleteShow,
    importShowFile,
    uploadMedia,
    deleteMedia,
    setConnectivityMode,
  };
}
