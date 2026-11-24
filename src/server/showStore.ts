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
import {
  activateCueAtIndex as applyCueAtIndex,
  applyHostCommandToState,
  applyTimelineAtTime as applyTimelineAtTimestamp,
} from '../engine/hostCommands';
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
    const outcome = applyHostCommandToState({
      show,
      devices,
      allShows: Array.from(this.shows.values()),
      mediaAssets: this.mediaAssets,
      action,
      payload,
      nowMs,
      mutateInPlace: true,
    });
    if (outcome.devicesChanged && outcome.devices !== devices) {
      this.devicesByShow.set(show.id, outcome.devices);
    }
    if (
      action === 'delete_cue' ||
      action === 'upsert_cue' ||
      action === 'duplicate_cue' ||
      action === 'reorder_cue' ||
      action === 'save_timeline'
    ) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveNow();
    } else {
      this.scheduleSave();
    }
    return {
      show: outcome.show,
      devicesChanged: outcome.devicesChanged,
      lightingChanged: outcome.lightingChanged,
      playbackChanged: outcome.playbackChanged,
      showChanged: outcome.showChanged,
      identifyPayload: outcome.identifyPayload,
      disconnectDeviceIds: outcome.disconnectDeviceIds,
    };
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
          applyCueAtIndex(show, this.mediaAssets, nextIdx, nowMs);
          lightingUpdated = true;
          playbackUpdated = true;
        }
      }
    }

    if (show.playback.timelinePlaying) {
      const prevLayerSignature = show.lighting.layers.map((l) => l.id).join(',');
      applyTimelineAtTimestamp(show, this.mediaAssets, nowMs);
      const nextLayerSignature = show.lighting.layers.map((l) => l.id).join(',');
      if (prevLayerSignature !== nextLayerSignature || !show.playback.timelinePlaying) {
        lightingUpdated = true;
        playbackUpdated = true;
      }
    }

    return { lightingUpdated, playbackUpdated };
  }
}
