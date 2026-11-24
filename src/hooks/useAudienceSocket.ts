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
  const unmountedRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const batteryLevelRef = useRef<number | null>(null);

  useEffect(() => {
    unmountedRef.current = false;
    const targetId = showIdParam || 'active';
    fetch(`/api/public/show/${encodeURIComponent(targetId)}`)
      .then((r) => r.json())
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

  const connectAudience = useCallback(
    (nameOverride?: string) => {
      if (unmountedRef.current) return;
      if (nameOverride !== undefined) customNameRef.current = nameOverride;
      joinedRef.current = true;

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
        if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
        const byHost = ev.code === 4001;
        setState((prev) => ({
          ...prev,
          connected: false,
          reconnecting: !byHost && joinedRef.current,
          disconnectedByHost: byHost,
        }));
        if (!unmountedRef.current && joinedRef.current && !byHost) {
          if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = window.setTimeout(() => {
            connectAudience();
          }, 1500);
        }
      };
    },
    [showIdParam],
  );

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
