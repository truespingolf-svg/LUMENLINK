import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudienceDevice,
  ConnectivityMode,
  MediaAsset,
  NetworkInfo,
  ShowFile,
  WsMessageToClient,
} from '../shared/types';

export interface HostSocketState {
  connected: boolean;
  requiresPasscode: boolean;
  passcodeError: string | null;
  hostToken: string | null;
  show: ShowFile | null;
  showsList: ShowFile[];
  devices: AudienceDevice[];
  mediaAssets: MediaAsset[];
  networkInfo: NetworkInfo | null;
  serverOffsetMs: number;
}

export function useHostSocket() {
  const [state, setState] = useState<HostSocketState>({
    connected: false,
    requiresPasscode: false,
    passcodeError: null,
    hostToken: null,
    show: null,
    showsList: [],
    devices: [],
    mediaAssets: [],
    networkInfo: null,
    serverOffsetMs: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef<string | null>(null);
  const showIdRef = useRef<string | undefined>(undefined);
  const reconnectTimerRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  const fetchShowsAndNetwork = useCallback(async (token: string) => {
    try {
      const [showsRes, netRes, mediaRes] = await Promise.all([
        fetch('/api/shows', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/network-info'),
        fetch('/api/media'),
      ]);
      if (showsRes.ok) {
        const data = await showsRes.json();
        setState((prev) => ({ ...prev, showsList: data.shows || [] }));
      }
      if (netRes.ok) {
        const net = (await netRes.json()) as NetworkInfo;
        setState((prev) => ({ ...prev, networkInfo: net }));
      }
      if (mediaRes.ok) {
        const m = await mediaRes.json();
        setState((prev) => ({ ...prev, mediaAssets: m.mediaAssets || [] }));
      }
    } catch {
      // Ignore transient startup errors
    }
  }, []);

  const connectWs = useCallback((token: string, targetShowId?: string) => {
    if (unmountedRef.current) return;
    if (wsRef.current) {
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

        if (msg.type === 'welcome_sync') {
          if (msg.show) showIdRef.current = msg.show.id;
          setState((prev) => ({
            ...prev,
            connected: true,
            serverOffsetMs: offset,
            show: msg.show || prev.show,
            devices: msg.devices || prev.devices,
            mediaAssets: msg.mediaAssets || prev.mediaAssets,
          }));
        } else if (msg.type === 'state_update') {
          setState((prev) => ({
            ...prev,
            serverOffsetMs: offset,
            show: msg.show || prev.show,
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
    async (passcode?: string) => {
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
        return false;
      }
    },
    [connectWs, fetchShowsAndNetwork],
  );

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
      if (wsRef.current) wsRef.current.close();
    };
  }, [authenticateHost]);

  const sendHostCommand = useCallback((action: string, payload: Record<string, unknown> = {}) => {
    if (action === 'update_poster_design' && payload.posterDesign) {
      setState((prev) =>
        prev.show
          ? {
              ...prev,
              show: {
                ...prev.show,
                posterDesign: {
                  ...prev.show.posterDesign,
                  ...(payload.posterDesign as Record<string, unknown>),
                },
              },
            }
          : prev,
      );
    }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: 'host_command',
        showId: showIdRef.current,
        payload: { action, ...payload },
      }),
    );
  }, []);

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
