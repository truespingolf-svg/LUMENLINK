import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
} from 'firebase/firestore';
import { AudienceDevice, ShowFile } from '../shared/types';
import { createBlankShow } from '../engine/shows';
import { db, handleFirestoreError, OperationType, testConnection } from './firebase';

export interface FirestoreLiveShowDoc {
  id: string;
  name: string;
  joinCode: string;
  updatedAtMs: number;
  audienceSettings: ShowFile['audienceSettings'];
  groups: ShowFile['groups'];
  lighting: ShowFile['lighting'];
  playback: ShowFile['playback'];
  sourceOrigin?: string | null;
}

export interface FirestoreDeviceDoc extends AudienceDevice {
  showKey: string;
  kickedAtMs?: number | null;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

export function normalizeShowKey(raw?: string | null): string {
  const cleaned = (raw || 'ACTIVE').trim().replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!cleaned || cleaned.toLowerCase() === 'active') return 'ACTIVE';
  return cleaned.toUpperCase().slice(0, 128);
}

export function buildFirestoreShowPayload(show: ShowFile, sourceOrigin?: string): FirestoreLiveShowDoc {
  return stripUndefined({
    id: String(show.id || 'demo-arena-show').slice(0, 128),
    name: String(show.name || 'LUMENLINK Show').slice(0, 160),
    joinCode: String(show.joinCode || 'LUMEN1').toUpperCase().slice(0, 32),
    updatedAtMs: Math.max(
      Date.now(),
      typeof show.lighting?.updatedAtMs === 'number' ? show.lighting.updatedAtMs : 0,
      show.updatedAtMs || 0,
    ),
    audienceSettings: show.audienceSettings,
    groups: show.groups.slice(0, 50),
    lighting: {
      ...show.lighting,
      layers: (show.lighting?.layers || []).slice(0, 32),
    },
    playback: show.playback,
    sourceOrigin: sourceOrigin ? sourceOrigin.slice(0, 256) : null,
  });
}

export function buildFirestoreDevicePayload(
  showKey: string,
  device: AudienceDevice,
  kickedAtMs: number | null = null,
): FirestoreDeviceDoc {
  const safeFixture = Math.max(1, Math.min(10000, Math.round(device.fixtureNumber || 1)));
  const safeRow = Math.max(0, Math.min(200, Math.round(device.row ?? 0)));
  const safeCol = Math.max(0, Math.min(200, Math.round(device.col ?? 0)));
  const safeX = Math.max(0, Math.min(1, Number.isFinite(device.x) ? device.x : 0.5));
  const safeY = Math.max(0, Math.min(1, Number.isFinite(device.y) ? device.y : 0.5));

  return stripUndefined({
    id: String(device.id).slice(0, 128),
    showKey: normalizeShowKey(showKey),
    fixtureNumber: safeFixture,
    name: (String(device.name || '').trim() || `Fixture ${String(safeFixture).padStart(3, '0')}`).slice(0, 80),
    deviceType: device.deviceType || 'smartphone',
    orientation: device.orientation || 'portrait',
    status: device.status === 'disconnected' ? 'disconnected' : 'connected',
    batteryLevel: typeof device.batteryLevel === 'number' ? Math.max(0, Math.min(100, device.batteryLevel)) : null,
    lastSeenMs: typeof device.lastSeenMs === 'number' ? device.lastSeenMs : Date.now(),
    joinedAtMs: typeof device.joinedAtMs === 'number' ? device.joinedAtMs : Date.now(),
    groupId: String(device.groupId || 'grp-floor').slice(0, 64),
    excluded: Boolean(device.excluded),
    x: safeX,
    y: safeY,
    row: safeRow,
    col: safeCol,
    overrideColor: device.overrideColor ?? null,
    identifyUntilMs: typeof device.identifyUntilMs === 'number' ? device.identifyUntilMs : 0,
    screenWidth:
      typeof device.screenWidth === 'number'
        ? Math.max(0, Math.min(10000, Math.round(device.screenWidth)))
        : undefined,
    screenHeight:
      typeof device.screenHeight === 'number'
        ? Math.max(0, Math.min(10000, Math.round(device.screenHeight)))
        : undefined,
    isFullscreen: Boolean(device.isFullscreen),
    kickedAtMs: kickedAtMs ?? null,
  });
}

export function liveShowDocToShowFile(docData: FirestoreLiveShowDoc, base?: ShowFile | null): ShowFile {
  const templateBase: ShowFile = base || createBlankShow(docData.name || 'LUMENLINK Show');

  return {
    ...templateBase,
    id: docData.id,
    name: docData.name,
    joinCode: docData.joinCode,
    updatedAtMs: docData.updatedAtMs,
    audienceSettings: docData.audienceSettings,
    groups: docData.groups,
    lighting: docData.lighting,
    playback: docData.playback,
  };
}

export async function publishShowToFirestore(show: ShowFile, sourceOrigin?: string): Promise<void> {
  await testConnection();
  const payload = buildFirestoreShowPayload(show, sourceOrigin);
  const keys = Array.from(new Set([normalizeShowKey(show.joinCode), 'ACTIVE']));
  await Promise.all(
    keys.map(async (key) => {
      const path = `liveShows/${key}`;
      try {
        await setDoc(doc(db, 'liveShows', key), payload);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    }),
  );
}

export async function fetchLiveShowFromFirestore(showKeyRaw?: string): Promise<{
  showKey: string;
  showDoc: FirestoreLiveShowDoc;
} | null> {
  await testConnection();
  const primaryKey = normalizeShowKey(showKeyRaw);
  const candidates = primaryKey === 'ACTIVE' ? ['ACTIVE'] : [primaryKey, 'ACTIVE'];
  for (const key of candidates) {
    const path = `liveShows/${key}`;
    try {
      const snap = await getDocFromServer(doc(db, 'liveShows', key));
      if (snap.exists()) {
        const data = snap.data() as FirestoreLiveShowDoc;
        if (key === primaryKey || primaryKey === 'ACTIVE' || data.id === showKeyRaw || data.joinCode.toUpperCase() === primaryKey) {
          return { showKey: key, showDoc: data };
        }
      }
    } catch (error) {
      try {
        const cacheSnap = await getDoc(doc(db, 'liveShows', key));
        if (cacheSnap.exists()) {
          return { showKey: key, showDoc: cacheSnap.data() as FirestoreLiveShowDoc };
        }
      } catch {
        // Fallback to permission diagnostic if truly denied
      }
      if (error instanceof Error && error.message.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.GET, path);
      }
    }
  }
  return null;
}

export async function registerOrUpdateAudienceDeviceInFirestore(params: {
  showKey: string;
  deviceId: string;
  name?: string;
  deviceType: AudienceDevice['deviceType'];
  orientation: AudienceDevice['orientation'];
  batteryLevel: number | null;
  screenWidth: number;
  screenHeight: number;
  isFullscreen: boolean;
  defaultGroupId: string;
}): Promise<FirestoreDeviceDoc> {
  const key = normalizeShowKey(params.showKey);
  const path = `liveShows/${key}/devices/${params.deviceId}`;
  const ref = doc(db, 'liveShows', key, 'devices', params.deviceId);
  const nowMs = Date.now();

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      const existing = existingSnap.data() as FirestoreDeviceDoc;
      const nextName = (params.name?.trim() || existing.name || `Fixture ${String(existing.fixtureNumber || 1).padStart(3, '0')}`).slice(0, 80);
      const telemetryPatch = stripUndefined({
        name: nextName,
        deviceType: params.deviceType,
        orientation: params.orientation,
        status: 'connected' as const,
        batteryLevel: typeof params.batteryLevel === 'number' ? Math.max(0, Math.min(100, params.batteryLevel)) : null,
        lastSeenMs: nowMs,
        screenWidth: Math.max(0, Math.min(10000, Math.round(params.screenWidth))),
        screenHeight: Math.max(0, Math.min(10000, Math.round(params.screenHeight))),
        isFullscreen: Boolean(params.isFullscreen),
        kickedAtMs: null,
      });
      await updateDoc(ref, telemetryPatch);
      return buildFirestoreDevicePayload(
        key,
        {
          ...existing,
          ...telemetryPatch,
          screenWidth: telemetryPatch.screenWidth,
          screenHeight: telemetryPatch.screenHeight,
        },
        null,
      );
    }

    // Compute a reasonable initial slot index among currently listed devices
    let existingCount = 0;
    let maxNum = 0;
    try {
      const listSnap = await getDocs(
        query(collection(db, 'liveShows', key, 'devices'), where('showKey', '==', key)),
      );
      existingCount = listSnap.size;
      listSnap.forEach((d) => {
        const item = d.data() as Partial<FirestoreDeviceDoc>;
        if (typeof item.fixtureNumber === 'number' && item.fixtureNumber > maxNum) {
          maxNum = item.fixtureNumber;
        }
      });
    } catch {
      // Proceed with default slot 1 if list fails
    }

    const fixtureNumber = maxNum + 1;
    const cols = 6;
    const row = Math.floor(existingCount / cols);
    const col = existingCount % cols;
    const x = Number(((col + 0.5) / cols).toFixed(4));
    const y = Number(Math.min(0.92, (row + 0.5) / 4).toFixed(4));

    const created = buildFirestoreDevicePayload(
      key,
      {
        id: params.deviceId,
        fixtureNumber,
        name: params.name?.trim() || `Fixture ${String(fixtureNumber).padStart(3, '0')}`,
        deviceType: params.deviceType,
        orientation: params.orientation,
        status: 'connected',
        batteryLevel: params.batteryLevel,
        lastSeenMs: nowMs,
        joinedAtMs: nowMs,
        groupId: params.defaultGroupId || 'grp-floor',
        excluded: false,
        x,
        y,
        row,
        col,
        overrideColor: null,
        identifyUntilMs: 0,
        screenWidth: params.screenWidth,
        screenHeight: params.screenHeight,
        isFullscreen: params.isFullscreen,
      },
      null,
    );
    await setDoc(ref, created);
    return created;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function sendAudienceHeartbeatToFirestore(params: {
  showKey: string;
  deviceId: string;
  orientation: AudienceDevice['orientation'];
  batteryLevel: number | null;
  screenWidth: number;
  screenHeight: number;
  isFullscreen: boolean;
  status?: 'connected' | 'disconnected';
}): Promise<void> {
  const key = normalizeShowKey(params.showKey);
  const path = `liveShows/${key}/devices/${params.deviceId}`;
  try {
    await updateDoc(
      doc(db, 'liveShows', key, 'devices', params.deviceId),
      stripUndefined({
        orientation: params.orientation,
        batteryLevel: params.batteryLevel,
        screenWidth: Math.max(0, Math.min(10000, Math.round(params.screenWidth))),
        screenHeight: Math.max(0, Math.min(10000, Math.round(params.screenHeight))),
        isFullscreen: params.isFullscreen,
        status: params.status || 'connected',
        lastSeenMs: Date.now(),
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('permission')) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export async function updateHostManagedDeviceInFirestore(
  showKey: string,
  device: AudienceDevice,
  kickedAtMs: number | null = null,
): Promise<void> {
  const key = normalizeShowKey(showKey);
  const path = `liveShows/${key}/devices/${device.id}`;
  try {
    await updateDoc(
      doc(db, 'liveShows', key, 'devices', device.id),
      stripUndefined({
        fixtureNumber: Math.max(1, Math.min(10000, Math.round(device.fixtureNumber))),
        name: (device.name || `Fixture ${String(device.fixtureNumber).padStart(3, '0')}`).slice(0, 80),
        status: device.status,
        groupId: String(device.groupId || 'grp-floor').slice(0, 64),
        excluded: Boolean(device.excluded),
        x: Math.max(0, Math.min(1, device.x)),
        y: Math.max(0, Math.min(1, device.y)),
        row: Math.max(0, Math.min(200, Math.round(device.row ?? 0))),
        col: Math.max(0, Math.min(200, Math.round(device.col ?? 0))),
        overrideColor: device.overrideColor ?? null,
        identifyUntilMs: typeof device.identifyUntilMs === 'number' ? device.identifyUntilMs : 0,
        kickedAtMs: kickedAtMs ?? null,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('permission')) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export async function removeDeviceFromFirestore(showKey: string, deviceId: string): Promise<void> {
  const key = normalizeShowKey(showKey);
  const path = `liveShows/${key}/devices/${deviceId}`;
  try {
    await deleteDoc(doc(db, 'liveShows', key, 'devices', deviceId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeLiveShowInFirestore(
  showKeyRaw: string,
  onData: (showDoc: FirestoreLiveShowDoc) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const key = normalizeShowKey(showKeyRaw);
  const path = `liveShows/${key}`;
  return onSnapshot(
    doc(db, 'liveShows', key),
    (snap) => {
      if (snap.exists()) {
        onData(snap.data() as FirestoreLiveShowDoc);
      }
    },
    (error) => {
      if (onError) {
        onError(error);
      } else {
        handleFirestoreError(error, OperationType.GET, path);
      }
    },
  );
}

export function subscribeShowDevicesInFirestore(
  showKeyRaw: string,
  onDevices: (devices: FirestoreDeviceDoc[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const key = normalizeShowKey(showKeyRaw);
  const path = `liveShows/${key}/devices`;
  const devicesQuery = query(collection(db, 'liveShows', key, 'devices'), where('showKey', '==', key));
  return onSnapshot(
    devicesQuery,
    (snap) => {
      const list: FirestoreDeviceDoc[] = [];
      snap.forEach((d) => {
        list.push(d.data() as FirestoreDeviceDoc);
      });
      list.sort((a, b) => a.fixtureNumber - b.fixtureNumber);
      onDevices(list);
    },
    (error) => {
      if (onError) {
        onError(error);
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    },
  );
}
