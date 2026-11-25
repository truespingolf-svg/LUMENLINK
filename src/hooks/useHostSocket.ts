import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudienceDevice,
  ConnectivityMode,
  MediaAsset,
  NetworkInfo,
  ShowFile,
  WsMessageToClient,
} from '../shared/types';
import { applyHostCommandToState } from '../engine/hostCommands';
import { createDemoShow } from '../engine/shows';
import {
  FirestoreDeviceDoc,
  normalizeShowKey,
  publishShowToFirestore,
  removeDeviceFromFirestore,
  subscribeShowDevicesInFirestore,
  updateHostManagedDeviceInFirestore,
} from '../lib/liveSync';

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

const DEVICE_HEARTBEAT_TIMEOUT_MS = 25000;

function normalizeRemoteDeviceStatus(d: FirestoreDeviceDoc, nowMs: number): AudienceDevice {
  const isFresh = d.status === 'connected' && nowMs - (d.lastSeenMs || 0) <= DEVICE_HEARTBEAT_TIMEOUT_MS;
  return {
    id: d.id,
    fixtureNumber: d.fixtureNumber,
    name: d.name,
    deviceType: d.deviceType,
    orientation: d.orientation,
    status: isFresh ? 'connected' : 'disconnected',
    batteryLevel: d.batteryLevel ?? null,
    lastSeenMs: d.lastSeenMs,
    joinedAtMs: d.joinedAtMs,
    groupId: d.groupId,
    excluded: d.excluded,
    x: d.x,
    y: d.y,
    row: d.row,
    col: d.col,
    overrideColor: d.overrideColor ?? null,
    identifyUntilMs: d.identifyUntilMs || 0,
    screenWidth: d.screenWidth ?? undefined,
    screenHeight: d.screenHeight ?? undefined,
    isFullscreen: Boolean(d.isFullscreen),
  };
}

function mergeDeviceLists(
  serverDevices: AudienceDevice[],
  firestoreJoinDevices: FirestoreDeviceDoc[],
  firestoreActiveDevices: FirestoreDeviceDoc[],
  hostEditedDevices: Map<string, AudienceDevice>,
): AudienceDevice[] {
  const nowMs = Date.now();
  const byId = new Map<string, AudienceDevice>();

  for (const sd of serverDevices) {
    byId.set(sd.id, sd);
  }

  const allRemote = [...firestoreActiveDevices, ...firestoreJoinDevices];
  const usedNumbers = new Set<number>(serverDevices.map((d) => d.fixtureNumber));
  let maxNumber = serverDevices.reduce((m, d) => Math.max(m, d.fixtureNumber), 0);

  for (const rd of allRemote) {
    if (rd.kickedAtMs && rd.kickedAtMs > (rd.lastSeenMs || 0)) continue;
    const normalized = normalizeRemoteDeviceStatus(rd, nowMs);
    const existing = byId.get(normalized.id);
    if (!existing) {
      let assignedNumber = normalized.fixtureNumber;
      if (usedNumbers.has(assignedNumber)) {
        maxNumber += 1;
        assignedNumber = maxNumber;
      } else {
        maxNumber = Math.max(maxNumber, assignedNumber);
      }
      usedNumbers.add(assignedNumber);
      byId.set(normalized.id, { ...normalized, fixtureNumber: assignedNumber });
    } else {
      // Pick fresher online status / heartbeat while keeping host-configured group/layout
      const remoteNewer = (normalized.lastSeenMs || 0) >= (existing.lastSeenMs || 0);
      byId.set(normalized.id, {
        ...existing,
        status:
          normalized.status === 'connected' || existing.status === 'connected'
            ? normalized.status === 'connected'
              ? 'connected'
              : existing.status
            : 'disconnected',
        lastSeenMs: Math.max(existing.lastSeenMs || 0, normalized.lastSeenMs || 0),
        orientation: remoteNewer ? normalized.orientation : existing.orientation,
        batteryLevel: remoteNewer ? normalized.batteryLevel : existing.batteryLevel,
        screenWidth: remoteNewer ? normalized.screenWidth : existing.screenWidth,
        screenHeight: remoteNewer ? normalized.screenHeight : existing.screenHeight,
        isFullscreen: remoteNewer ? normalized.isFullscreen : existing.isFullscreen,
      });
    }
  }

  for (const [id, edited] of hostEditedDevices.entries()) {
    const cur = byId.get(id);
    if (cur) {
      byId.set(id, {
        ...cur,
        groupId: edited.groupId,
        excluded: edited.excluded,
        x: edited.x,
        y: edited.y,
        row: edited.row,
        col: edited.col,
        overrideColor: edited.overrideColor,
        identifyUntilMs: edited.identifyUntilMs,
        status: edited.status,
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.fixtureNumber - b.fixtureNumber);
}

const IMMEDIATE_ACTIONS = new Set([
  'set_base_color',
  'apply_gradient',
  'run_colour_transition',
  'toggle_blackout',
  'toggle_emergency_neutral',
  'toggle_freeze',
  'set_strobe_override',
  'trigger_cue',
  'go_next_cue',
  'go_prev_cue',
  'stop_playback',
  'upsert_effect_layer',
  'remove_effect_layer',
  'stop_all_effects',
  'release_all',
  'play_timeline',
  'stop_timeline',
  'regenerate_join_code',
  'update_audience_settings',
  'create_group',
  'update_group',
  'delete_group',
  'set_media_projection',
  'stop_media_projection',
]);

const DEVICE_EDIT_ACTIONS = new Set([
  'assign_device_group',
  'exclude_device',
  'override_device_color',
  'update_fixture_position',
  'identify_devices',
  'auto_grid_layout',
  'apply_layout_preset',
  'disconnect_device',
]);

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
  const wsRegisteredRef = useRef<boolean>(false);
  const tokenRef = useRef<string | null>(null);
  const showIdRef = useRef<string | undefined>(initialShow.id);
  const joinCodeRef = useRef<string>(initialShow.joinCode || 'LUMEN1');
  const reconnectTimerRef = useRef<number | null>(null);
  const authRetryTimerRef = useRef<number | null>(null);
  const firestorePublishTimerRef = useRef<number | null>(null);
  const pendingFirestoreShowRef = useRef<ShowFile | null>(null);
  const unmountedRef = useRef(false);
  const lastLocalMutationAtRef = useRef<number>(0);
  const localMutationSeqRef = useRef<number>(0);
  const serverOffsetRef = useRef<number>(0);
  const pendingCommandsRef = useRef<Array<{ action: string; payload: Record<string, unknown>; showId: string }>>([]);
  const authFnRef = useRef<(passcode?: string) => Promise<boolean>>(async () => false);

  const serverDevicesRef = useRef<AudienceDevice[]>([]);
  const firestoreJoinDevicesRef = useRef<FirestoreDeviceDoc[]>([]);
  const firestoreActiveDevicesRef = useRef<FirestoreDeviceDoc[]>([]);
  const hostEditedDevicesRef = useRef<Map<string, AudienceDevice>>(new Map());
  const firestoreJoinKeyMapRef = useRef<Map<string, string>>(new Map());

  const rebuildMergedDevices = useCallback(() => {
    const merged = mergeDeviceLists(
      serverDevicesRef.current,
      firestoreJoinDevicesRef.current,
      firestoreActiveDevicesRef.current,
      hostEditedDevicesRef.current,
    );
    if (!unmountedRef.current) {
      setState((prev) => ({ ...prev, devices: merged }));
    }
    return merged;
  }, []);

  const scheduleFirestoreShowSync = useCallback((show: ShowFile, immediate = false) => {
    pendingFirestoreShowRef.current = show;
    joinCodeRef.current = show.joinCode || joinCodeRef.current;

    const flush = () => {
      firestorePublishTimerRef.current = null;
      const target = pendingFirestoreShowRef.current;
      if (!target) return;
      publishShowToFirestore(target, window.location.origin).catch(() => {
        // Keep console smooth even if offline
      });
    };

    if (immediate) {
      if (firestorePublishTimerRef.current) {
        window.clearTimeout(firestorePublishTimerRef.current);
        firestorePublishTimerRef.current = null;
      }
      flush();
    } else if (!firestorePublishTimerRef.current) {
      firestorePublishTimerRef.current = window.setTimeout(flush, 55);
    }
  }, []);

  const sendCommandViaHttp = useCallback(
    async (
      token: string,
      action: string,
      showId: string,
      payload: Record<string, unknown>,
      allowRetry = true,
      cmdSeq = localMutationSeqRef.current,
    ) => {
      try {
        const res = await fetch('/api/host/command', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action, showId, payload }),
        });
        if (res.status === 401 && allowRetry) {
          tokenRef.current = null;
          const ok = await authFnRef.current();
          if (ok && tokenRef.current) {
            await sendCommandViaHttp(tokenRef.current, action, showId, payload, false, cmdSeq);
          }
          return;
        }
        if (!res.ok || unmountedRef.current) return;
        const data = await res.json();
        if (typeof data.serverTimeMs === 'number') {
          serverOffsetRef.current = data.serverTimeMs - Date.now();
        }
        const isLatestMutation = localMutationSeqRef.current === cmdSeq;
        if (isLatestMutation && data.show) {
          showIdRef.current = data.show.id;
          cacheShowSnapshot(data.show);
          scheduleFirestoreShowSync(data.show, IMMEDIATE_ACTIONS.has(action));
        }
        if (Array.isArray(data.devices)) {
          serverDevicesRef.current = data.devices;
        }
        const mergedDevices = mergeDeviceLists(
          serverDevicesRef.current,
          firestoreJoinDevicesRef.current,
          firestoreActiveDevicesRef.current,
          hostEditedDevicesRef.current,
        );
        setState((prev) => ({
          ...prev,
          httpSynced: true,
          serverOffsetMs: serverOffsetRef.current,
          show: isLatestMutation && data.show ? data.show : prev.show,
          devices: mergedDevices,
          showsList: isLatestMutation && data.shows ? data.shows : prev.showsList,
        }));
      } catch {
        // Network issue — optimistic local state keeps console responsive
      }
    },
    [scheduleFirestoreShowSync],
  );

  const flushPendingCommands = useCallback(
    (token: string) => {
      const queue = pendingCommandsRef.current.splice(0, pendingCommandsRef.current.length);
      for (const cmd of queue) {
        sendCommandViaHttp(token, cmd.action, cmd.showId, cmd.payload);
      }
    },
    [sendCommandViaHttp],
  );

  const fetchShowsAndNetwork = useCallback(
    async (token: string) => {
      try {
        const reqStartedAt = Date.now();
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
          }
          if (Array.isArray(data.devices)) {
            devicesFromHttp = data.devices;
            serverDevicesRef.current = data.devices;
          }
          if (typeof data.serverTimeMs === 'number') {
            const srvTime = data.serverTimeMs;
            serverTimeFromHttp = srvTime;
            serverOffsetRef.current = srvTime - Date.now();
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
          const hasRecentLocalEdit = lastLocalMutationAtRef.current > reqStartedAt;
          if (!hasRecentLocalEdit && activeShowFromHttp) {
            cacheShowSnapshot(activeShowFromHttp);
            scheduleFirestoreShowSync(activeShowFromHttp, true);
          }
          const mergedDevices = devicesFromHttp
            ? mergeDeviceLists(
                serverDevicesRef.current,
                firestoreJoinDevicesRef.current,
                firestoreActiveDevicesRef.current,
                hostEditedDevicesRef.current,
              )
            : undefined;
          setState((prev) => ({
            ...prev,
            httpSynced: showsRes.ok || prev.httpSynced,
            serverOffsetMs:
              typeof serverTimeFromHttp === 'number'
                ? serverTimeFromHttp - Date.now()
                : prev.serverOffsetMs,
            show: hasRecentLocalEdit ? prev.show : activeShowFromHttp || prev.show,
            showsList: hasRecentLocalEdit ? prev.showsList : showsFromHttp || prev.showsList,
            devices: mergedDevices || prev.devices,
            networkInfo: netFromHttp || prev.networkInfo,
            mediaAssets: mediaFromHttp || prev.mediaAssets,
          }));
        }
      } catch {
        // Ignore transient startup errors
      }
    },
    [scheduleFirestoreShowSync],
  );

  const connectWs = useCallback(
    (token: string, targetShowId?: string) => {
      if (unmountedRef.current) return;
      wsRegisteredRef.current = false;
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
          const offset = msg.serverTimeMs ? msg.serverTimeMs - Date.now() : serverOffsetRef.current;
          if (msg.serverTimeMs) serverOffsetRef.current = offset;

          if (msg.type === 'error' && msg.message === 'Unauthorized host session') {
            wsRegisteredRef.current = false;
            tokenRef.current = null;
            authFnRef.current();
            return;
          }

          if (msg.type === 'welcome_sync') {
            wsRegisteredRef.current = true;
            if (msg.show) {
              showIdRef.current = msg.show.id;
              cacheShowSnapshot(msg.show);
              scheduleFirestoreShowSync(msg.show, true);
            }
            if (msg.devices) {
              serverDevicesRef.current = msg.devices;
            }
            const merged = mergeDeviceLists(
              serverDevicesRef.current,
              firestoreJoinDevicesRef.current,
              firestoreActiveDevicesRef.current,
              hostEditedDevicesRef.current,
            );
            setState((prev) => ({
              ...prev,
              connected: true,
              httpSynced: true,
              serverOffsetMs: offset,
              show: msg.show || prev.show,
              devices: merged,
              mediaAssets: msg.mediaAssets || prev.mediaAssets,
            }));
          } else if (msg.type === 'state_update') {
            const activeDragWindow = Date.now() - lastLocalMutationAtRef.current < 180;
            if (!activeDragWindow && msg.show) {
              cacheShowSnapshot(msg.show);
              scheduleFirestoreShowSync(msg.show, false);
            }
            setState((prev) => ({
              ...prev,
              serverOffsetMs: offset,
              show: !activeDragWindow && msg.show ? msg.show : prev.show,
              showsList:
                !activeDragWindow && msg.show
                  ? prev.showsList.map((s) => (s.id === msg.show!.id ? msg.show! : s))
                  : prev.showsList,
              mediaAssets: msg.mediaAssets || prev.mediaAssets,
            }));
          } else if (msg.type === 'devices_update') {
            if (msg.devices) {
              serverDevicesRef.current = msg.devices;
            }
            rebuildMergedDevices();
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRegisteredRef.current = false;
        setState((prev) => ({ ...prev, connected: false }));
        if (!unmountedRef.current && tokenRef.current) {
          if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = window.setTimeout(() => {
            if (tokenRef.current) connectWs(tokenRef.current, showIdRef.current);
          }, 1500);
        }
      };
    },
    [rebuildMergedDevices, scheduleFirestoreShowSync],
  );

  // Subscribe to Firestore connected audience devices for the active joinCode & ACTIVE fallback
  useEffect(() => {
    const joinKey = normalizeShowKey(state.show.joinCode);
    const unsubs: Array<() => void> = [];

    const handleSnapshot = (list: FirestoreDeviceDoc[], sourceKey: string, isJoinList: boolean) => {
      for (const item of list) {
        firestoreJoinKeyMapRef.current.set(item.id, sourceKey);
      }
      if (isJoinList) {
        firestoreJoinDevicesRef.current = list;
      } else {
        firestoreActiveDevicesRef.current = list;
      }
      rebuildMergedDevices();
    };

    unsubs.push(
      subscribeShowDevicesInFirestore(
        joinKey,
        (list) => handleSnapshot(list, joinKey, true),
        () => {
          // Keep Express/WS working cleanly if Firestore is temporarily unreachable
        },
      ),
    );
    if (joinKey !== 'ACTIVE') {
      unsubs.push(
        subscribeShowDevicesInFirestore(
          'ACTIVE',
          (list) => handleSnapshot(list, 'ACTIVE', false),
          () => {},
        ),
      );
    }

    // Periodically mark stale Firestore-only devices as disconnected in UI
    const staleTimer = window.setInterval(() => {
      if (firestoreJoinDevicesRef.current.length > 0 || firestoreActiveDevicesRef.current.length > 0) {
        rebuildMergedDevices();
      }
    }, 5000);

    return () => {
      window.clearInterval(staleTimer);
      for (const u of unsubs) u();
    };
  }, [state.show.joinCode, rebuildMergedDevices]);

  // Publish initial show state immediately on mount so phones can always find the active show in Firestore
  useEffect(() => {
    scheduleFirestoreShowSync(state.show, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        flushPendingCommands(data.hostToken);
        await fetchShowsAndNetwork(data.hostToken);
        connectWs(data.hostToken);
        return true;
      } catch {
        if (!unmountedRef.current && !passcode) {
          if (authRetryTimerRef.current) window.clearTimeout(authRetryTimerRef.current);
          authRetryTimerRef.current = window.setTimeout(() => {
            if (!unmountedRef.current && !tokenRef.current) {
              authFnRef.current();
            }
          }, 1500);
        }
        return false;
      }
    },
    [connectWs, fetchShowsAndNetwork, flushPendingCommands],
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
      if (firestorePublishTimerRef.current) window.clearTimeout(firestorePublishTimerRef.current);
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
      lastLocalMutationAtRef.current = Date.now();
      const cmdSeq = ++localMutationSeqRef.current;
      const targetShowId = showIdRef.current || state.show.id;
      let nextShowForSync: ShowFile | null = null;
      let nextDevicesForSync: AudienceDevice[] | null = null;

      // Apply optimistically at 0ms so console buttons, colour pickers, cues & sliders always reflect immediately
      setState((prev) => {
        const outcome = applyHostCommandToState({
          show: prev.show,
          devices: prev.devices,
          allShows: prev.showsList,
          mediaAssets: prev.mediaAssets,
          action,
          payload,
          nowMs: Date.now() + serverOffsetRef.current,
          mutateInPlace: false,
        });
        cacheShowSnapshot(outcome.show);
        nextShowForSync = outcome.show;
        nextDevicesForSync = outcome.devices;

        if (DEVICE_EDIT_ACTIONS.has(action)) {
          for (const d of outcome.devices) {
            hostEditedDevicesRef.current.set(d.id, d);
          }
        }

        return {
          ...prev,
          show: outcome.show,
          devices: outcome.devices,
          showsList: prev.showsList.map((s) => (s.id === outcome.show.id ? outcome.show : s)),
        };
      });

      queueMicrotask(() => {
        if (nextShowForSync) {
          scheduleFirestoreShowSync(nextShowForSync, IMMEDIATE_ACTIONS.has(action));
        }
        if (DEVICE_EDIT_ACTIONS.has(action) && nextDevicesForSync) {
          const fallbackKey = normalizeShowKey(nextShowForSync?.joinCode || state.show.joinCode);
          const kickedIds = new Set(
            action === 'disconnect_device' && typeof payload.deviceId === 'string'
              ? [payload.deviceId]
              : [],
          );
          for (const d of nextDevicesForSync) {
            const devKey = firestoreJoinKeyMapRef.current.get(d.id) || fallbackKey;
            if (firestoreJoinDevicesRef.current.some((x) => x.id === d.id) || firestoreActiveDevicesRef.current.some((x) => x.id === d.id)) {
              if (action === 'disconnect_device' && kickedIds.has(d.id)) {
                updateHostManagedDeviceInFirestore(devKey, d, Date.now()).catch(() => {});
              } else {
                updateHostManagedDeviceInFirestore(devKey, d, null).catch(() => {});
              }
            }
          }
        }
        if (action === 'clear_offline_devices') {
          const fallbackKey = normalizeShowKey(nextShowForSync?.joinCode || state.show.joinCode);
          for (const rd of [...firestoreJoinDevicesRef.current, ...firestoreActiveDevicesRef.current]) {
            if (rd.status === 'disconnected' || Date.now() - (rd.lastSeenMs || 0) > DEVICE_HEARTBEAT_TIMEOUT_MS) {
              const devKey = firestoreJoinKeyMapRef.current.get(rd.id) || fallbackKey;
              removeDeviceFromFirestore(devKey, rd.id).catch(() => {});
            }
          }
        }
      });

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && wsRegisteredRef.current) {
        ws.send(
          JSON.stringify({
            type: 'host_command',
            showId: targetShowId,
            payload: { action, ...payload },
          }),
        );
        return;
      }

      if (tokenRef.current) {
        sendCommandViaHttp(tokenRef.current, action, targetShowId, payload, true, cmdSeq);
      } else {
        pendingCommandsRef.current.push({ action, payload, showId: targetShowId });
        authFnRef.current();
      }
    },
    [scheduleFirestoreShowSync, sendCommandViaHttp, state.show.id, state.show.joinCode],
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
      scheduleFirestoreShowSync(data.show, true);
      setState((prev) => ({ ...prev, show: data.show, showsList: data.shows }));
      connectWs(tokenRef.current, data.show.id);
      return data.show as ShowFile;
    },
    [connectWs, scheduleFirestoreShowSync],
  );

  const renameShow = useCallback(
    async (showId: string, name: string) => {
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
      if (showIdRef.current === showId && data.show) {
        scheduleFirestoreShowSync(data.show, true);
      }
      setState((prev) => ({
        ...prev,
        show: prev.show?.id === showId ? data.show : prev.show,
        showsList: data.shows,
      }));
      return data.show as ShowFile;
    },
    [scheduleFirestoreShowSync],
  );

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
      scheduleFirestoreShowSync(data.show, true);
      serverDevicesRef.current = data.devices || [];
      setState((prev) => ({
        ...prev,
        show: data.show,
        devices: mergeDeviceLists(
          serverDevicesRef.current,
          firestoreJoinDevicesRef.current,
          firestoreActiveDevicesRef.current,
          hostEditedDevicesRef.current,
        ),
      }));
      connectWs(tokenRef.current, data.show.id);
    },
    [connectWs, scheduleFirestoreShowSync],
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
      scheduleFirestoreShowSync(data.show, true);
      setState((prev) => ({ ...prev, show: data.show, showsList: data.shows }));
      connectWs(tokenRef.current, data.show.id);
    },
    [connectWs, scheduleFirestoreShowSync],
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
      scheduleFirestoreShowSync(data.activeShow, true);
      setState((prev) => ({ ...prev, show: data.activeShow, showsList: data.shows }));
      connectWs(tokenRef.current, data.activeShow.id);
    },
    [connectWs, scheduleFirestoreShowSync],
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
      scheduleFirestoreShowSync(data.show, true);
      setState((prev) => ({ ...prev, show: data.show, showsList: data.shows }));
      connectWs(tokenRef.current, data.show.id);
      return data.show as ShowFile;
    },
    [connectWs, scheduleFirestoreShowSync],
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
