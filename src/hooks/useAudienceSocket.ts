import { useCallback, useEffect, useRef, useState } from 'react';
import { AudienceDevice, ShowAudienceSettings, ShowFile, WsMessageToClient } from '../shared/types';
import {
  fetchLiveShowFromFirestore,
  FirestoreDeviceDoc,
  FirestoreLiveShowDoc,
  liveShowDocToShowFile,
  registerOrUpdateAudienceDeviceInFirestore,
  sendAudienceHeartbeatToFirestore,
  subscribeLiveShowInFirestore,
  subscribeShowDevicesInFirestore,
} from '../lib/liveSync';

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

function showTimestamp(s: ShowFile | null | undefined): number {
  if (!s) return 0;
  return Math.max(s.lighting?.updatedAtMs || 0, s.updatedAtMs || 0);
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
  const sessionJoinedAtRef = useRef<number>(Date.now());
  const httpHealthyRef = useRef(false);
  const wsConnectedRef = useRef(false);
  const firestoreHealthyRef = useRef(false);
  const firestoreShowKeyRef = useRef<string | null>(null);
  const lastShowUpdateTsRef = useRef<number>(0);
  const lastShowSourceRef = useRef<'none' | 'firestore' | 'ws' | 'http'>('none');
  const unmountedRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const firestoreHeartbeatTimerRef = useRef<number | null>(null);
  const firestoreUnsubsRef = useRef<Array<() => void>>([]);
  const batteryLevelRef = useRef<number | null>(null);

  const cleanupFirestoreListeners = useCallback(() => {
    for (const unsub of firestoreUnsubsRef.current) {
      unsub();
    }
    firestoreUnsubsRef.current = [];
    if (firestoreHeartbeatTimerRef.current) {
      window.clearInterval(firestoreHeartbeatTimerRef.current);
      firestoreHeartbeatTimerRef.current = null;
    }
  }, []);

  const applyShowState = useCallback(
    (incomingShow: ShowFile, source: 'firestore' | 'ws' | 'http', serverTimeMs?: number) => {
      const incomingTs = showTimestamp(incomingShow);

      // Firestore onSnapshot only fires when the remote show document changed, so always honor it
      if (source !== 'firestore') {
        if (firestoreHealthyRef.current && incomingTs <= lastShowUpdateTsRef.current) {
          return;
        }
        if (lastShowSourceRef.current === 'firestore' && incomingTs < lastShowUpdateTsRef.current) {
          return;
        }
        if (incomingTs > 0 && incomingTs < lastShowUpdateTsRef.current && lastShowSourceRef.current === source) {
          return;
        }
      }

      if (source === 'firestore' || incomingTs > lastShowUpdateTsRef.current) {
        lastShowUpdateTsRef.current = incomingTs;
      }
      lastShowSourceRef.current = source;

      const offset =
        typeof serverTimeMs === 'number' && source !== 'firestore'
          ? serverTimeMs - Date.now()
          : undefined;

      setState((prev) => ({
        ...prev,
        connected: prev.disconnectedByHost ? false : true,
        reconnecting: false,
        serverOffsetMs: offset !== undefined ? offset : prev.serverOffsetMs,
        show: incomingShow,
      }));
    },
    [],
  );

  useEffect(() => {
    unmountedRef.current = false;
    const targetId = showIdParam || 'active';

    // Probe both local Express server AND Firestore in parallel for pre-join show info
    fetch(`/api/public/show/${encodeURIComponent(targetId)}`)
      .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('application/json') ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: PublicShowInfo) => {
        if (!unmountedRef.current) {
          setState((prev) => ({
            ...prev,
            publicInfo: prev.publicInfo || data,
            loadingInfo: false,
          }));
        }
      })
      .catch(() => {
        if (!unmountedRef.current) {
          setState((prev) => ({ ...prev, loadingInfo: false }));
        }
      });

    fetchLiveShowFromFirestore(showIdParam)
      .then((found) => {
        if (!unmountedRef.current && found) {
          firestoreShowKeyRef.current = found.showKey;
          const d = found.showDoc;
          setState((prev) => ({
            ...prev,
            loadingInfo: false,
            publicInfo: {
              id: d.id,
              name: d.name,
              joinCode: d.joinCode,
              audienceSettings: d.audienceSettings,
            },
          }));
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

    const onPageHide = () => {
      if (joinedRef.current && firestoreShowKeyRef.current) {
        sendAudienceHeartbeatToFirestore({
          showKey: firestoreShowKeyRef.current,
          deviceId: deviceIdRef.current,
          orientation: getOrientation(),
          batteryLevel: batteryLevelRef.current,
          screenWidth: window.innerWidth,
          screenHeight: window.innerHeight,
          isFullscreen: Boolean(document.fullscreenElement),
          status: 'disconnected',
        }).catch(() => {});
      }
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      unmountedRef.current = true;
      window.removeEventListener('pagehide', onPageHide);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
      cleanupFirestoreListeners();
      if (wsRef.current) wsRef.current.close();
    };
  }, [showIdParam, cleanupFirestoreListeners]);

  const startFirestoreSync = useCallback(
    async (): Promise<{ ok: boolean; errorDetail?: string }> => {
      if (unmountedRef.current) return { ok: false };
      try {
        let found = await fetchLiveShowFromFirestore(showIdParam);
        if (!found) {
          await new Promise((r) => window.setTimeout(r, 400));
          if (unmountedRef.current) return { ok: false };
          found = await fetchLiveShowFromFirestore(showIdParam);
        }
        if (!found) {
          return { ok: false, errorDetail: 'Live show not found in cloud sync yet' };
        }

        const { showKey, showDoc } = found;
        firestoreShowKeyRef.current = showKey;
        const defaultGroupId = showDoc.groups?.[0]?.id || 'grp-floor';

        const deviceDoc = await registerOrUpdateAudienceDeviceInFirestore({
          showKey,
          deviceId: deviceIdRef.current,
          name: customNameRef.current || undefined,
          deviceType: detectDeviceType(),
          orientation: getOrientation(),
          batteryLevel: batteryLevelRef.current,
          screenWidth: window.innerWidth,
          screenHeight: window.innerHeight,
          isFullscreen: Boolean(document.fullscreenElement),
          defaultGroupId,
        });

        if (unmountedRef.current) return { ok: false };

        firestoreHealthyRef.current = true;
        joinedRef.current = true;
        sessionJoinedAtRef.current = Date.now();
        const showFile = liveShowDocToShowFile(showDoc);
        lastShowUpdateTsRef.current = showTimestamp(showFile);
        lastShowSourceRef.current = 'firestore';

        setState((prev) => ({
          ...prev,
          joining: false,
          joinError: null,
          joined: true,
          connected: true,
          reconnecting: false,
          disconnectedByHost: false,
          show: showFile,
          device: deviceDoc,
          allDevices: prev.allDevices.length > 0 ? prev.allDevices : [deviceDoc],
        }));

        cleanupFirestoreListeners();

        const unsubShow = subscribeLiveShowInFirestore(
          showKey,
          (updatedDoc: FirestoreLiveShowDoc) => {
            if (unmountedRef.current) return;
            firestoreHealthyRef.current = true;
            const nextShow = liveShowDocToShowFile(updatedDoc);
            applyShowState(nextShow, 'firestore');
          },
          () => {
            firestoreHealthyRef.current = false;
          },
        );

        const unsubDevices = subscribeShowDevicesInFirestore(
          showKey,
          (devices: FirestoreDeviceDoc[]) => {
            if (unmountedRef.current) return;
            const self = devices.find((d) => d.id === deviceIdRef.current);
            const kicked = Boolean(self?.kickedAtMs && self.kickedAtMs >= sessionJoinedAtRef.current);
            setState((prev) => ({
              ...prev,
              connected: kicked ? false : prev.connected || firestoreHealthyRef.current,
              disconnectedByHost: kicked || prev.disconnectedByHost,
              device: self || prev.device,
              allDevices: devices.length > 0 ? devices : prev.allDevices,
            }));
          },
          (err) => {
            console.warn('Firestore devices listener warning:', err.message);
          },
        );

        firestoreUnsubsRef.current = [unsubShow, unsubDevices];

        firestoreHeartbeatTimerRef.current = window.setInterval(() => {
          if (!joinedRef.current || unmountedRef.current) return;
          sendAudienceHeartbeatToFirestore({
            showKey,
            deviceId: deviceIdRef.current,
            orientation: getOrientation(),
            batteryLevel: batteryLevelRef.current,
            screenWidth: window.innerWidth,
            screenHeight: window.innerHeight,
            isFullscreen: Boolean(document.fullscreenElement),
          }).catch(() => {});
        }, 4500);

        return { ok: true };
      } catch (err) {
        return { ok: false, errorDetail: err instanceof Error ? err.message : 'Cloud sync error' };
      }
    },
    [applyShowState, cleanupFirestoreListeners, showIdParam],
  );

  const registerViaHttp = useCallback(async (): Promise<{ ok: boolean; errorDetail?: string }> => {
    if (unmountedRef.current) return { ok: false };
    const targetId = showIdParam || 'active';
    const delays = [0, 350, 800];
    let lastError = '';
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) {
        await new Promise((r) => window.setTimeout(r, delays[attempt]));
      }
      if (unmountedRef.current) return { ok: false };
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
        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          continue;
        }
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          lastError = 'Server returned HTML instead of API JSON';
          continue;
        }
        const data = await res.json();
        if (unmountedRef.current) return { ok: false };
        if (!data?.show || !data?.device) {
          lastError = 'Incomplete show payload from server';
          continue;
        }
        httpHealthyRef.current = true;
        joinedRef.current = true;
        setState((prev) => ({
          ...prev,
          joining: false,
          joinError: null,
          joined: true,
          connected: true,
          reconnecting: false,
          disconnectedByHost: false,
          device: prev.device && firestoreHealthyRef.current ? prev.device : data.device,
          allDevices:
            prev.allDevices.length > 0 && firestoreHealthyRef.current
              ? prev.allDevices
              : data.devices || prev.allDevices,
        }));
        applyShowState(data.show, 'http', data.serverTimeMs);
        return { ok: true };
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Network error';
      }
    }

    // Fallback to GET /live?autoRegister=1 in case POST is blocked by a proxy
    try {
      const url = `/api/public/show/${encodeURIComponent(targetId)}/live?deviceId=${encodeURIComponent(
        deviceIdRef.current,
      )}&autoRegister=1&name=${encodeURIComponent(customNameRef.current || '')}&deviceType=${encodeURIComponent(
        detectDeviceType(),
      )}&orientation=${encodeURIComponent(getOrientation())}`;
      const res = await fetch(url);
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json') && !unmountedRef.current) {
        const data = await res.json();
        if (data?.show && data?.device) {
          httpHealthyRef.current = true;
          joinedRef.current = true;
          setState((prev) => ({
            ...prev,
            joining: false,
            joinError: null,
            joined: true,
            connected: true,
            reconnecting: false,
            disconnectedByHost: false,
            device: prev.device && firestoreHealthyRef.current ? prev.device : data.device,
            allDevices:
              prev.allDevices.length > 0 && firestoreHealthyRef.current
                ? prev.allDevices
                : data.devices || prev.allDevices,
          }));
          applyShowState(data.show, 'http', data.serverTimeMs);
          return { ok: true };
        }
      } else if (!res.ok) {
        lastError = `HTTP ${res.status}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : lastError;
    }

    return { ok: false, errorDetail: lastError || 'Server unreachable' };
  }, [applyShowState, showIdParam]);

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
          joinedRef.current = true;
          setState((prev) => ({
            ...prev,
            joining: false,
            joinError: null,
            joined: true,
            connected: true,
            reconnecting: false,
            disconnectedByHost: false,
            device: prev.device && firestoreHealthyRef.current ? prev.device : msg.device || prev.device,
            allDevices:
              prev.allDevices.length > 0 && firestoreHealthyRef.current
                ? prev.allDevices
                : msg.devices || prev.allDevices,
          }));
          if (msg.show) {
            applyShowState(msg.show, 'ws', msg.serverTimeMs);
          }
        } else if (msg.type === 'state_update') {
          setState((prev) => {
            const baseShow = msg.show || prev.show;
            if (!baseShow) return prev;
            const mergedShow: ShowFile = {
              ...baseShow,
              lighting: msg.lighting || baseShow.lighting,
              playback: msg.playback || baseShow.playback,
            };
            const incomingTs = showTimestamp(mergedShow);
            if (lastShowSourceRef.current === 'firestore' && incomingTs < lastShowUpdateTsRef.current) {
              return prev;
            }
            if (incomingTs > lastShowUpdateTsRef.current) {
              lastShowUpdateTsRef.current = incomingTs;
            }
            return {
              ...prev,
              connected: true,
              serverOffsetMs: offset,
              show: mergedShow,
            };
          });
        } else if (msg.type === 'devices_update') {
          if (firestoreHealthyRef.current) return;
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
      setState((prev) => {
        if (!prev.joined && !byHost) return prev;
        const stillHealthy = httpHealthyRef.current || firestoreHealthyRef.current;
        return {
          ...prev,
          connected: byHost ? false : stillHealthy,
          reconnecting: !byHost && joinedRef.current && !stillHealthy,
          disconnectedByHost: byHost,
        };
      });
      if (!unmountedRef.current && joinedRef.current && !byHost && !firestoreHealthyRef.current) {
        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => {
          openWebSocket();
        }, httpHealthyRef.current ? 8000 : 2500);
      }
    };
  }, [applyShowState, showIdParam]);

  const connectAudience = useCallback(
    async (nameOverride?: string) => {
      if (unmountedRef.current) return;
      if (nameOverride !== undefined) customNameRef.current = nameOverride;
      httpHealthyRef.current = false;
      firestoreHealthyRef.current = false;
      sessionJoinedAtRef.current = Date.now();
      setState((prev) => ({
        ...prev,
        joining: true,
        joinError: null,
        disconnectedByHost: false,
      }));

      openWebSocket();

      // Run Firestore cloud sync + Express HTTP registration in parallel; join succeeds as soon as either succeeds
      const [fsResult, httpResult] = await Promise.all([startFirestoreSync(), registerViaHttp()]);

      if (!unmountedRef.current && !fsResult.ok && !httpResult.ok && !joinedRef.current) {
        setState((prev) => {
          if (prev.joined) return prev;
          const detail = fsResult.errorDetail || httpResult.errorDetail || 'connection failed';
          return {
            ...prev,
            joining: false,
            joinError: `Unable to reach the live show (${detail}). Make sure the Host Console is open and tap Join Show again.`,
          };
        });
      }
    },
    [openWebSocket, registerViaHttp, startFirestoreSync],
  );

  // Fast HTTP live polling fallback whenever joined & neither WebSocket nor Firestore is streaming
  useEffect(() => {
    if (!state.joined || state.disconnectedByHost) return;
    const isWsOpen = wsRef.current && wsRef.current.readyState === WebSocket.OPEN;
    if ((isWsOpen && wsConnectedRef.current) || firestoreHealthyRef.current) return;

    const targetId = showIdParam || 'active';
    const poll = async () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
      if (firestoreHealthyRef.current) return;
      try {
        const res = await fetch(
          `/api/public/show/${encodeURIComponent(targetId)}/live?deviceId=${encodeURIComponent(
            deviceIdRef.current,
          )}&autoRegister=1&name=${encodeURIComponent(customNameRef.current || '')}`,
        );
        if (!res.ok || unmountedRef.current) return;
        const data = await res.json();
        httpHealthyRef.current = true;
        if (data.show) {
          applyShowState(data.show, 'http', data.serverTimeMs);
        }
        setState((prev) => ({
          ...prev,
          connected: true,
          reconnecting: false,
          device: data.device || prev.device,
          allDevices: data.devices || prev.allDevices,
        }));
      } catch {
        httpHealthyRef.current = false;
      }
    };

    poll();
    const timer = window.setInterval(poll, 450);
    return () => window.clearInterval(timer);
  }, [state.joined, state.connected, state.disconnectedByHost, showIdParam, applyShowState]);

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
      if (joinedRef.current && firestoreShowKeyRef.current) {
        sendAudienceHeartbeatToFirestore({
          showKey: firestoreShowKeyRef.current,
          deviceId: deviceIdRef.current,
          orientation: getOrientation(),
          batteryLevel: batteryLevelRef.current,
          screenWidth: window.innerWidth,
          screenHeight: window.innerHeight,
          isFullscreen: Boolean(document.fullscreenElement),
        }).catch(() => {});
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
