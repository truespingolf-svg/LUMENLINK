import { useCallback, useEffect, useRef, useState } from 'react';
import { AudienceDevice, ShowAudienceSettings, ShowFile, WsMessageToClient } from '../shared/types';

export interface PublicShowInfo {
  id: string;
  name: string;
  joinCode: string;
  audienceSettings: ShowAudienceSettings;
}

export interface AudienceSocketState {
  publicInfo: PublicShowInfo | null;
  loadingInfo: boolean;
  joining: boolean;
  joinError: string | null;
  joined: boolean;
  connected: boolean;
  reconnecting: boolean;
  disconnectedByHost: boolean;
  device: AudienceDevice | null;
  allDevices: AudienceDevice[];
  show: ShowFile | null;
  serverOffsetMs: number;
}

function getOrCreateDeviceId(): string {
  const key = 'lumenlink_device_id';
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const fresh = `dev-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return `dev-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function detectDeviceType(): AudienceDevice['deviceType'] {
  const ua = navigator.userAgent.toLowerCase();
  const w = window.innerWidth;
  if (/ipad|tablet/.test(ua) || (w >= 600 && w <= 1024 && 'ontouchstart' in window)) return 'tablet';
  if (/iphone|android|mobile/.test(ua) || w < 600) return 'smartphone';
  return 'desktop';
}

function getOrientation(): 'portrait' | 'landscape' {
  return window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape';
}

export function useAudienceSocket(showIdParam?: string) {
  const [state, setState] = useState<AudienceSocketState>({
    publicInfo: null,
    loadingInfo: true,
    joining: false,
    joinError: null,
    joined: false,
    connected: false,
    reconnecting: false,
    disconnectedByHost: false,
    device: null,
    allDevices: [],
    show: null,
    serverOffsetMs: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const deviceIdRef = useRef<string>(getOrCreateDeviceId());
  const customNameRef = useRef<string>('');
  const joinedRef = useRef(false);
  const httpHealthyRef = useRef(false);
  const wsConnectedRef = useRef(false);
  const unmountedRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const batteryLevelRef = useRef<number | null>(null);

  useEffect(() => {
    unmountedRef.current = false;
    const targetId = showIdParam || 'active';
    fetch(`/api/public/show/${encodeURIComponent(targetId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: PublicShowInfo) => {
        if (!unmountedRef.current) {
          setState((prev) => ({ ...prev, publicInfo: data, loadingInfo: false }));
        }
      })
      .catch(() => {
        if (!unmountedRef.current) {
          setState((prev) => ({ ...prev, loadingInfo: false }));
        }
      });

    // Optional Battery Status API
    const navWithBattery = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; addEventListener: (e: string, cb: () => void) => void }>;
    };
    if (typeof navWithBattery.getBattery === 'function') {
      navWithBattery
        .getBattery()
        .then((bat) => {
          batteryLevelRef.current = Math.round(bat.level * 100);
          bat.addEventListener('levelchange', () => {
            batteryLevelRef.current = Math.round(bat.level * 100);
          });
        })
        .catch(() => {});
    }

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [showIdParam]);

  const registerViaHttp = useCallback(async (): Promise<boolean> => {
    if (unmountedRef.current) return false;
    const targetId = showIdParam || 'active';
    const delays = [0, 350, 800];
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) {
        await new Promise((r) => window.setTimeout(r, delays[attempt]));
      }
      if (unmountedRef.current) return false;
      try {
        const res = await fetch('/api/public/audience/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            showId: showIdParam || undefined,
            deviceId: deviceIdRef.current,
            payload: {
              name: customNameRef.current || undefined,
              deviceType: detectDeviceType(),
              orientation: getOrientation(),
              batteryLevel: batteryLevelRef.current,
              screenWidth: window.innerWidth,
              screenHeight: window.innerHeight,
            },
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (unmountedRef.current) return false;
        httpHealthyRef.current = true;
        const offset = data.serverTimeMs ? data.serverTimeMs - Date.now() : 0;
        setState((prev) => ({
          ...prev,
          joining: false,
          joinError: null,
          joined: true,
          connected: true,
          reconnecting: false,
          disconnectedByHost: false,
          serverOffsetMs: offset,
          show: data.show || prev.show,
          device: data.device || prev.device,
          allDevices: data.devices || prev.allDevices,
        }));
        return true;
      } catch {
        // Retry next attempt
      }
    }

    // Fallback to GET /live?autoRegister=1 in case POST is blocked by a proxy
    try {
      const url = `/api/public/show/${encodeURIComponent(targetId)}/live?deviceId=${encodeURIComponent(
        deviceIdRef.current,
      )}&autoRegister=1&name=${encodeURIComponent(customNameRef.current || '')}`;
      const res = await fetch(url);
      if (res.ok && !unmountedRef.current) {
        const data = await res.json();
        httpHealthyRef.current = true;
        const offset = data.serverTimeMs ? data.serverTimeMs - Date.now() : 0;
        setState((prev) => ({
          ...prev,
          joining: false,
          joinError: null,
          joined: true,
          connected: true,
          reconnecting: false,
          disconnectedByHost: false,
          serverOffsetMs: offset,
          show: data.show || prev.show,
          device: data.device || prev.device,
          allDevices: data.devices || prev.allDevices,
        }));
        return true;
      }
    } catch {
      // Ignore fallback error
    }

    return false;
  }, [showIdParam]);

  const openWebSocket = useCallback(() => {
    if (unmountedRef.current) return;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    let ws: WebSocket;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    } catch {
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      wsConnectedRef.current = true;
      ws.send(
        JSON.stringify({
          type: 'register_audience',
          showId: showIdParam || undefined,
          deviceId: deviceIdRef.current,
          payload: {
            name: customNameRef.current || undefined,
            deviceType: detectDeviceType(),
            orientation: getOrientation(),
            batteryLevel: batteryLevelRef.current,
            screenWidth: window.innerWidth,
            screenHeight: window.innerHeight,
          },
        }),
      );

      if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'audience_heartbeat',
              deviceId: deviceIdRef.current,
              payload: {
                orientation: getOrientation(),
                batteryLevel: batteryLevelRef.current,
                screenWidth: window.innerWidth,
                screenHeight: window.innerHeight,
                isFullscreen: Boolean(document.fullscreenElement),
              },
            }),
          );
        }
      }, 4000);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WsMessageToClient;
        const offset = msg.serverTimeMs ? msg.serverTimeMs - Date.now() : 0;

        if (msg.type === 'welcome_sync') {
          setState((prev) => ({
            ...prev,
            joining: false,
            joinError: null,
            joined: true,
            connected: true,
            reconnecting: false,
            disconnectedByHost: false,
            serverOffsetMs: offset,
            show: msg.show || prev.show,
            device: msg.device || prev.device,
            allDevices: msg.devices || prev.allDevices,
          }));
        } else if (msg.type === 'state_update') {
          setState((prev) => {
            const baseShow = msg.show || prev.show;
            const mergedShow = baseShow
              ? {
                  ...baseShow,
                  lighting: msg.lighting || baseShow.lighting,
                  playback: msg.playback || baseShow.playback,
                }
              : null;
            return {
              ...prev,
              connected: true,
              serverOffsetMs: offset,
              show: mergedShow,
            };
          });
        } else if (msg.type === 'devices_update') {
          setState((prev) => {
            const updatedSelf = msg.devices?.find((d) => d.id === deviceIdRef.current) || prev.device;
            return {
              ...prev,
              device: updatedSelf,
              allDevices: msg.devices || prev.allDevices,
            };
          });
        } else if (msg.type === 'identify_pulse') {
          setState((prev) => ({
            ...prev,
            device: prev.device
              ? { ...prev.device, identifyUntilMs: msg.identifyUntilMs || Date.now() + 4000 }
              : prev.device,
          }));
        } else if (msg.type === 'ping_sync') {
          setState((prev) => ({ ...prev, serverOffsetMs: offset }));
        }
      } catch {
        // Ignore malformed message
      }
    };

    ws.onclose = (ev) => {
      wsConnectedRef.current = false;
      if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
      const byHost = ev.code === 4001;
      setState((prev) => ({
        ...prev,
        connected: byHost ? false : httpHealthyRef.current ? true : false,
        reconnecting: !byHost && joinedRef.current && !httpHealthyRef.current,
        disconnectedByHost: byHost,
      }));
      if (!unmountedRef.current && joinedRef.current && !byHost) {
        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => {
          openWebSocket();
        }, httpHealthyRef.current ? 5000 : 1800);
      }
    };
  }, [showIdParam]);

  const connectAudience = useCallback(
    (nameOverride?: string) => {
      if (unmountedRef.current) return;
      if (nameOverride !== undefined) customNameRef.current = nameOverride;
      joinedRef.current = true;
      httpHealthyRef.current = true;
      setState((prev) => ({
        ...prev,
        joining: false,
        joinError: null,
        joined: true,
        connected: true,
        reconnecting: false,
        disconnectedByHost: false,
      }));

      openWebSocket();
      registerViaHttp().catch(() => {});
    },
    [openWebSocket, registerViaHttp],
  );

  // Fast HTTP live polling fallback whenever joined & WebSocket is not open
  useEffect(() => {
    if (!state.joined || state.disconnectedByHost) return;
    const isWsOpen = wsRef.current && wsRef.current.readyState === WebSocket.OPEN;
    if (isWsOpen && wsConnectedRef.current) return;

    const targetId = showIdParam || 'active';
    const poll = async () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
      try {
        const res = await fetch(
          `/api/public/show/${encodeURIComponent(targetId)}/live?deviceId=${encodeURIComponent(deviceIdRef.current)}`,
        );
        if (!res.ok || unmountedRef.current) return;
        const data = await res.json();
        httpHealthyRef.current = true;
        const offset = data.serverTimeMs ? data.serverTimeMs - Date.now() : 0;
        setState((prev) => ({
          ...prev,
          connected: true,
          reconnecting: false,
          serverOffsetMs: offset,
          show: data.show || prev.show,
          device: data.device || prev.device,
          allDevices: data.devices || prev.allDevices,
        }));
      } catch {
        httpHealthyRef.current = false;
      }
    };

    const timer = window.setInterval(poll, 450);
    return () => window.clearInterval(timer);
  }, [state.joined, state.connected, state.disconnectedByHost, showIdParam]);

  // Sync orientation and fullscreen changes immediately
  useEffect(() => {
    const syncMeta = () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && joinedRef.current) {
        ws.send(
          JSON.stringify({
            type: 'audience_update_meta',
            deviceId: deviceIdRef.current,
            payload: {
              orientation: getOrientation(),
              batteryLevel: batteryLevelRef.current,
              screenWidth: window.innerWidth,
              screenHeight: window.innerHeight,
              isFullscreen: Boolean(document.fullscreenElement),
            },
          }),
        );
      }
    };
    window.addEventListener('resize', syncMeta);
    document.addEventListener('fullscreenchange', syncMeta);
    return () => {
      window.removeEventListener('resize', syncMeta);
      document.removeEventListener('fullscreenchange', syncMeta);
    };
  }, []);

  const simulateDropForTest = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
  }, []);

  return {
    ...state,
    joinShow: connectAudience,
    simulateDropForTest,
  };
}
