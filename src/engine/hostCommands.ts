import {
  ActiveEffectLayer,
  ActiveMediaProjection,
  AudienceDevice,
  CueItem,
  FixtureGroup,
  MediaAsset,
  PosterDesign,
  SavedLayoutPreset,
  ShowAudienceSettings,
  ShowFile,
  TimelineSequence,
} from '../shared/types';
import { clamp, hexToRgb, lerpRgb, rgbToHex } from './colors';
import { createDefaultEffectParams } from './effects';

export interface HostCommandOutcome {
  show: ShowFile;
  devices: AudienceDevice[];
  devicesChanged: boolean;
  lightingChanged: boolean;
  playbackChanged: boolean;
  showChanged: boolean;
  identifyPayload?: { deviceIds: string[]; untilMs: number };
  disconnectDeviceIds?: string[];
}

export function activateCueAtIndex(
  show: ShowFile,
  mediaAssets: MediaAsset[],
  idx: number,
  nowMs: number,
): void {
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

  show.lighting.layers = [primaryLayer];

  if (cue.mediaId) {
    const asset = mediaAssets.find((m) => m.id === cue.mediaId);
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

export function applyTimelineAtTime(
  show: ShowFile,
  mediaAssets: MediaAsset[],
  nowMs: number,
): boolean {
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
      const asset = mediaAssets.find((m) => m.id === blk.mediaId);
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

/**
 * Pure reducer applying any Host Console command to a show + device list.
 * Used identically on the Express/WS server and for 0ms optimistic client execution.
 */
export function applyHostCommandToState(params: {
  show: ShowFile;
  devices: AudienceDevice[];
  allShows?: ShowFile[];
  mediaAssets: MediaAsset[];
  action: string;
  payload: Record<string, unknown>;
  nowMs?: number;
  mutateInPlace?: boolean;
}): HostCommandOutcome {
  const nowMs = params.nowMs ?? Date.now();
  const show: ShowFile = params.mutateInPlace
    ? params.show
    : (JSON.parse(JSON.stringify(params.show)) as ShowFile);
  let devices: AudienceDevice[] = params.mutateInPlace
    ? params.devices
    : (JSON.parse(JSON.stringify(params.devices)) as AudienceDevice[]);

  const { action, payload, mediaAssets } = params;

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
      devices = devices.filter((d) => !ids.includes(d.id));
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
        if (show.playback.activeCueId) {
          show.playback.activeCueIndex = show.cues.findIndex((c) => c.id === show.playback.activeCueId);
        }
        show.updatedAtMs = nowMs;
        playbackChanged = true;
      }
      break;
    }

    case 'duplicate_cue': {
      const cueId = String(payload.cueId || '');
      const srcIdx = show.cues.findIndex((c) => c.id === cueId);
      if (srcIdx >= 0) {
        const src = show.cues[srcIdx];
        const maxNum = show.cues.reduce((m, c) => Math.max(m, c.cueNumber), 0);
        const clone: CueItem = {
          ...JSON.parse(JSON.stringify(src)),
          id: `cue-${Math.random().toString(36).slice(2, 7)}`,
          cueNumber: maxNum + 1,
          name: `${src.name} (Copy)`,
        };
        show.cues.push(clone);
        show.updatedAtMs = nowMs;
        playbackChanged = true;
      }
      break;
    }

    case 'reorder_cue': {
      const cueId = String(payload.cueId || '');
      const dir = payload.direction === 'up' ? -1 : 1;
      const idx = show.cues.findIndex((c) => c.id === cueId);
      const targetIdx = idx + dir;
      if (idx >= 0 && targetIdx >= 0 && targetIdx < show.cues.length) {
        const [moved] = show.cues.splice(idx, 1);
        show.cues.splice(targetIdx, 0, moved);
        show.cues.forEach((c, i) => {
          c.cueNumber = i + 1;
        });
        if (show.playback.activeCueId) {
          show.playback.activeCueIndex = show.cues.findIndex((c) => c.id === show.playback.activeCueId);
        }
        show.updatedAtMs = nowMs;
        playbackChanged = true;
      }
      break;
    }

    case 'delete_cue': {
      const cueId = String(payload.cueId || '');
      show.cues = show.cues.filter((c) => c.id !== cueId);
      if (show.playback.activeCueId === cueId) {
        show.playback.activeCueId = null;
        show.playback.activeCueIndex = -1;
        show.playback.status = 'stopped';
      } else if (show.playback.activeCueId) {
        show.playback.activeCueIndex = show.cues.findIndex((c) => c.id === show.playback.activeCueId);
      }
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
      activateCueAtIndex(show, mediaAssets, targetIndex, nowMs);
      show.playback.status = 'playing';
      show.playback.timelinePlaying = false;
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
        activateCueAtIndex(show, mediaAssets, nextIdx, nowMs);
        show.playback.status = 'playing';
        show.playback.timelinePlaying = false;
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
        activateCueAtIndex(show, mediaAssets, prevIdx, nowMs);
        show.playback.status = 'playing';
        show.playback.timelinePlaying = false;
        lightingChanged = true;
        playbackChanged = true;
      }
      break;
    }

    case 'cue_goto': {
      const idx = show.cues.findIndex((c) => c.id === payload.cueId || c.cueNumber === payload.cueNumber);
      if (idx >= 0) {
        activateCueAtIndex(show, mediaAssets, idx, nowMs);
        show.playback.status = 'playing';
        show.playback.timelinePlaying = false;
        lightingChanged = true;
        playbackChanged = true;
      }
      break;
    }

    case 'cue_pause': {
      show.playback.status = show.playback.status === 'paused' ? 'playing' : 'paused';
      if (show.playback.status === 'playing' && show.playback.activeCueIndex >= 0) {
        show.playback.cueStartedAtMs = nowMs;
      }
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
        applyTimelineAtTime(show, mediaAssets, nowMs);
        lightingChanged = true;
        playbackChanged = true;
      }
      break;
    }

    case 'timeline_pause': {
      if (show.playback.timelinePlaying) {
        show.playback.timelinePositionMs = Math.max(0, nowMs - show.playback.timelineStartedAtMs);
        show.playback.timelinePlaying = false;
        show.playback.status = 'paused';
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
      applyTimelineAtTime(show, mediaAssets, nowMs);
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
      for (let attempt = 0; attempt < 12; attempt++) {
        let candidate = '';
        for (let i = 0; i < 6; i++) {
          candidate += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
        const collision = (params.allShows || [show]).some(
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

  return {
    show,
    devices,
    devicesChanged,
    lightingChanged,
    playbackChanged,
    showChanged,
    identifyPayload,
    disconnectDeviceIds,
  };
}
