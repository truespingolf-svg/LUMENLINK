import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CopyPlus,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sliders,
  Square,
  Trash2,
} from 'lucide-react';
import {
  AudienceDevice,
  CueItem,
  EffectCategory,
  EffectParameters,
  EffectType,
  LiveLightingState,
  MediaAsset,
  ShowFile,
  TimelineBlock,
  TimelineSequence,
  TransitionType,
} from '../../shared/types';
import {
  createDefaultEffectParams,
  EFFECT_CATALOG,
  getDefaultPaletteForEffect,
} from '../../engine/effects';
import { hexToRgb } from '../../engine/colors';
import { RotaryEncoder } from './HardwareControls';
import { EffectStagePreview } from './EffectStagePreview';
import { BeatSequencerControls } from './BeatSequencerControls';

interface CueTimelinePanelProps {
  show: ShowFile;
  devices?: AudienceDevice[];
  mediaAssets: MediaAsset[];
  serverOffsetMs?: number;
  onCommand: (action: string, payload?: Record<string, unknown>) => void;
}

const TRACKS: Array<{ id: TimelineBlock['track']; label: string; color: string }> = [
  { id: 'colour', label: 'Main Colour', color: '#3B82F6' },
  { id: 'movement', label: 'Movement', color: '#06B6D4' },
  { id: 'flash', label: 'Flash', color: '#F59E0B' },
  { id: 'image', label: 'Image / Media', color: '#A855F7' },
  { id: 'intensity', label: 'Intensity', color: '#10B981' },
];

function createBlankCueDraft(cueNumberHint: number): Partial<CueItem> {
  return {
    name: `Cue ${cueNumberHint}`,
    colour: '#0066FF',
    secondaryColour: '#001133',
    effectType: 'solid',
    effectParams: createDefaultEffectParams({ palette: ['#0066FF', '#001133'] }),
    intensity: 100,
    durationMs: 4000,
    fadeInMs: 600,
    fadeOutMs: 400,
    delayMs: 0,
    targetGroupId: 'all',
    mediaId: null,
    transitionType: 'ease_in_out',
    autoFollow: true,
  };
}

function formatSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export const CueTimelinePanel: React.FC<CueTimelinePanelProps> = ({
  show,
  devices = [],
  mediaAssets,
  serverOffsetMs = 0,
  onCommand,
}) => {
  const [subView, setSubView] = useState<'cues' | 'timeline'>('cues');
  const [gotoNum, setGotoNum] = useState('');
  const [editingCueId, setEditingCueId] = useState<string | null>(null);
  const [cueDraft, setCueDraft] = useState<Partial<CueItem>>(() =>
    createBlankCueDraft(show.cues.length + 1),
  );
  const [fxCategory, setFxCategory] = useState<EffectCategory>('colour');
  const [previewSource, setPreviewSource] = useState<'draft' | 'live'>('draft');
  const [nowMs, setNowMs] = useState<number>(() => Date.now() + serverOffsetMs);
  const draftStartMsRef = useRef<number>(Date.now() + serverOffsetMs);

  const activeCueIndex = show.playback.activeCueIndex;
  const activeCue =
    activeCueIndex >= 0 && activeCueIndex < show.cues.length
      ? show.cues[activeCueIndex]
      : null;
  const nextCue =
    show.cues.length > 0
      ? show.cues[(Math.max(-1, activeCueIndex) + 1) % show.cues.length]
      : null;

  // Keep inspector valid if active edited cue gets deleted externally
  useEffect(() => {
    if (editingCueId && !show.cues.some((c) => c.id === editingCueId)) {
      setEditingCueId(null);
      setCueDraft(createBlankCueDraft(show.cues.length + 1));
    }
  }, [editingCueId, show.cues]);

  const hasTimedAutoFollow =
    show.playback.status === 'playing' &&
    Boolean(activeCue?.autoFollow && (activeCue?.durationMs || 0) > 0);

  useEffect(() => {
    setNowMs(Date.now() + serverOffsetMs);
    if (!hasTimedAutoFollow && !show.playback.timelinePlaying) return;
    const id = window.setInterval(() => {
      setNowMs(Date.now() + serverOffsetMs);
    }, 80);
    return () => window.clearInterval(id);
  }, [hasTimedAutoFollow, show.playback.timelinePlaying, serverOffsetMs, show.playback.cueStartedAtMs]);

  const cueProgress = useMemo(() => {
    if (!activeCue || !activeCue.autoFollow || activeCue.durationMs <= 0) {
      return { ratio: 0, elapsedMs: 0, remainingMs: 0 };
    }
    const elapsedMs = Math.max(0, nowMs - show.playback.cueStartedAtMs);
    const ratio = Math.min(1, elapsedMs / activeCue.durationMs);
    const remainingMs = Math.max(0, activeCue.durationMs - elapsedMs);
    return { ratio, elapsedMs, remainingMs };
  }, [activeCue, nowMs, show.playback.cueStartedAtMs]);

  const activeTimeline: TimelineSequence = show.timelines[0] || {
    id: 'tl-main',
    name: 'Main Show Sequence',
    loop: true,
    totalDurationMs: 16000,
    blocks: [],
  };

  const [blockDraft, setBlockDraft] = useState<{
    track: TimelineBlock['track'];
    label: string;
    startMs: number;
    durationMs: number;
    colour: string;
    effectType: EffectType;
    intensity: number;
    mediaId: string;
  }>({
    track: 'movement',
    label: 'Wave Sweep',
    startMs: 0,
    durationMs: 4000,
    colour: '#00E5FF',
    effectType: 'wave_left_to_right',
    intensity: 100,
    mediaId: mediaAssets[0]?.id || '',
  });

  const selectCueForInspector = (cue: CueItem) => {
    setEditingCueId(cue.id);
    const mergedParams = createDefaultEffectParams({
      ...(cue.effectParams || {}),
      intensity: cue.intensity,
      targetGroupId: cue.targetGroupId,
      palette:
        cue.effectParams?.palette && cue.effectParams.palette.length > 0
          ? cue.effectParams.palette
          : [cue.colour, cue.secondaryColour || '#000000'],
    });
    setCueDraft({ ...cue, effectParams: mergedParams });
    const entry = EFFECT_CATALOG.find((fx) => fx.type === cue.effectType);
    if (entry) setFxCategory(entry.category);
    draftStartMsRef.current = Date.now() + serverOffsetMs;
    setPreviewSource('draft');
  };

  const resetToNewCueMode = () => {
    setEditingCueId(null);
    setCueDraft(createBlankCueDraft(show.cues.length + 1));
    setFxCategory('colour');
    draftStartMsRef.current = Date.now() + serverOffsetMs;
    setPreviewSource('draft');
  };

  const draftEffectParams: EffectParameters = useMemo(() => {
    const rawPalette = cueDraft.effectParams?.palette;
    const pri = cueDraft.colour || '#0066FF';
    const sec = cueDraft.secondaryColour || '#001133';
    const palette =
      Array.isArray(rawPalette) && rawPalette.length > 0
        ? [pri, sec, ...rawPalette.slice(2)]
        : [pri, sec];
    return createDefaultEffectParams({
      ...(cueDraft.effectParams || {}),
      intensity: Number(cueDraft.intensity ?? 100),
      targetGroupId: cueDraft.targetGroupId || 'all',
      palette,
    });
  }, [cueDraft]);

  const updateDraftEffectParams = (patch: Partial<EffectParameters>) => {
    setCueDraft((prev) => {
      const currParams = prev.effectParams || {};
      const nextParams = { ...currParams, ...patch };
      const nextColour =
        patch.palette && patch.palette[0] ? patch.palette[0] : prev.colour || '#0066FF';
      const nextSecondary =
        patch.palette && patch.palette[1]
          ? patch.palette[1]
          : prev.secondaryColour || '#001133';
      return {
        ...prev,
        colour: nextColour,
        secondaryColour: nextSecondary,
        intensity:
          typeof patch.intensity === 'number' ? patch.intensity : prev.intensity,
        effectParams: nextParams,
      };
    });
  };

  const selectDraftEffectType = (fxType: EffectType) => {
    const defPal = getDefaultPaletteForEffect(fxType);
    const keepCurrentPalette =
      cueDraft.colour && cueDraft.colour !== '#0066FF'
        ? [cueDraft.colour, cueDraft.secondaryColour || defPal[1] || '#000000', ...defPal.slice(2)]
        : defPal;
    draftStartMsRef.current = Date.now() + serverOffsetMs;
    setCueDraft((prev) => ({
      ...prev,
      effectType: fxType,
      colour: keepCurrentPalette[0] || prev.colour || '#0066FF',
      secondaryColour: keepCurrentPalette[1] || prev.secondaryColour || '#000000',
      effectParams: createDefaultEffectParams({
        ...(prev.effectParams || {}),
        speed: fxType === 'beat_flash' ? 1 : prev.effectParams?.speed ?? 1.5,
        palette: keepCurrentPalette,
      }),
    }));
  };

  // Synthesize a live lighting preview state for the shared EffectStagePreview visualiser
  const cueVisualiserLighting: LiveLightingState = useMemo(() => {
    if (previewSource === 'live') {
      return show.lighting;
    }
    const pri = cueDraft.colour || '#0066FF';
    const fxType = (cueDraft.effectType as EffectType) || 'solid';
    return {
      ...show.lighting,
      blackout: false,
      freeze: false,
      emergencyNeutral: false,
      masterIntensity: Math.max(0, Math.min(100, Number(cueDraft.intensity ?? 100))),
      baseColor: pri,
      colourTransition: null,
      layers:
        fxType === 'solid'
          ? []
          : [
              {
                id: 'layer-cue-preview',
                name: cueDraft.name || 'Cue Preview',
                type: fxType,
                enabled: true,
                blendMode: 'normal',
                opacity: 1,
                startedAtMs: draftStartMsRef.current,
                params: draftEffectParams,
              },
            ],
    };
  }, [cueDraft, draftEffectParams, previewSource, show.lighting]);

  const handleSaveCue = () => {
    const existing = editingCueId ? show.cues.find((c) => c.id === editingCueId) : null;
    const maxNum = show.cues.reduce((m, c) => Math.max(m, c.cueNumber), 0);
    const cue: CueItem = {
      id: existing ? existing.id : `cue-${Math.random().toString(36).slice(2, 7)}`,
      cueNumber: existing ? existing.cueNumber : maxNum + 1,
      name: cueDraft.name?.trim() || `Cue ${existing ? existing.cueNumber : maxNum + 1}`,
      colour: cueDraft.colour || '#0066FF',
      secondaryColour: cueDraft.secondaryColour || '#000000',
      effectType: (cueDraft.effectType as EffectType) || 'solid',
      effectParams: {
        ...draftEffectParams,
        palette: draftEffectParams.palette,
      },
      intensity: Math.max(0, Math.min(100, Number(cueDraft.intensity ?? 100))),
      durationMs: Math.max(0, Number(cueDraft.durationMs ?? 0)),
      fadeInMs: Math.max(0, Number(cueDraft.fadeInMs ?? 500)),
      fadeOutMs: Math.max(0, Number(cueDraft.fadeOutMs ?? 400)),
      delayMs: Math.max(0, Number(cueDraft.delayMs ?? 0)),
      targetGroupId: cueDraft.targetGroupId || 'all',
      mediaId: cueDraft.mediaId || null,
      transitionType: (cueDraft.transitionType as TransitionType) || 'ease_in_out',
      autoFollow: Boolean(cueDraft.autoFollow),
    };
    onCommand('upsert_cue', { cue });
    if (!existing) {
      setEditingCueId(cue.id);
      setCueDraft(cue);
    }
  };

  const handleDeleteCue = (cueId: string) => {
    if (editingCueId === cueId) {
      setEditingCueId(null);
      setCueDraft(createBlankCueDraft(Math.max(1, show.cues.length)));
    }
    onCommand('delete_cue', { cueId });
  };

  const handleAddBlock = () => {
    const blk: TimelineBlock = {
      id: `blk-${Math.random().toString(36).slice(2, 7)}`,
      track: blockDraft.track,
      label: blockDraft.label.trim() || 'Sequence Block',
      startMs: Math.max(0, blockDraft.startMs),
      durationMs: Math.max(500, blockDraft.durationMs),
      colour: blockDraft.colour,
      effectType: blockDraft.effectType,
      intensity: blockDraft.intensity,
      mediaId: blockDraft.track === 'image' ? blockDraft.mediaId || null : null,
      effectParams: { palette: [blockDraft.colour, '#000000'] },
    };
    const nextTl: TimelineSequence = {
      ...activeTimeline,
      blocks: [...activeTimeline.blocks, blk],
      totalDurationMs: Math.max(activeTimeline.totalDurationMs, blk.startMs + blk.durationMs),
    };
    onCommand('save_timeline', { timeline: nextTl });
  };

  const updateBlock = (blkId: string, patch: Partial<TimelineBlock>) => {
    const nextTl: TimelineSequence = {
      ...activeTimeline,
      blocks: activeTimeline.blocks.map((b) => (b.id === blkId ? { ...b, ...patch } : b)),
    };
    onCommand('save_timeline', { timeline: nextTl });
  };

  const removeBlock = (blkId: string) => {
    const nextTl: TimelineSequence = {
      ...activeTimeline,
      blocks: activeTimeline.blocks.filter((b) => b.id !== blkId),
    };
    onCommand('save_timeline', { timeline: nextTl });
  };

  const statusTone =
    show.playback.status === 'playing'
      ? 'text-emerald-400'
      : show.playback.status === 'paused'
        ? 'text-amber-400'
        : 'text-slate-400';

  const statusText =
    show.playback.status === 'playing'
      ? 'RUNNING'
      : show.playback.status === 'paused'
        ? 'PAUSED'
        : 'STANDBY';

  const draftPrimary = cueDraft.colour || '#0066FF';
  const draftSecondary = cueDraft.secondaryColour || '#001133';
  const draftFxEntry = EFFECT_CATALOG.find((fx) => fx.type === cueDraft.effectType);
  const categoryEffects = useMemo(
    () => EFFECT_CATALOG.filter((fx) => fx.category === fxCategory),
    [fxCategory],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Master Playback Deck */}
      <div className="console-panel rounded-md p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Segmented Console Mode Switch */}
          <div className="console-well p-1 rounded flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSubView('cues')}
              className={`px-3 py-1.5 rounded text-xs transition-colors ${
                subView === 'cues'
                  ? 'console-btn-amber font-semibold'
                  : 'text-slate-300 hover:text-white font-medium'
              }`}
            >
              Cue Stack
            </button>
            <button
              type="button"
              onClick={() => setSubView('timeline')}
              className={`px-3 py-1.5 rounded text-xs transition-colors ${
                subView === 'timeline'
                  ? 'console-btn-amber font-semibold'
                  : 'text-slate-300 hover:text-white font-medium'
              }`}
            >
              Timeline Sequencer
            </button>
          </div>

          {/* Unboxed Telemetry Readout */}
          <div className="flex flex-wrap items-center gap-4 text-xs font-mono-tabular">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 uppercase tracking-wider text-[10px]">Deck</span>
              <span className={`font-semibold tracking-wider ${statusTone}`}>{statusText}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 uppercase tracking-wider text-[10px]">Active</span>
              <span className="text-slate-100 font-semibold">
                {activeCue
                  ? `${String(activeCue.cueNumber).padStart(2, '0')} · ${activeCue.name}`
                  : 'None'}
              </span>
            </div>
            {nextCue && (
              <div className="hidden md:flex items-center gap-2 text-slate-400">
                <span className="text-slate-500 uppercase tracking-wider text-[10px]">Next</span>
                <span>
                  {String(nextCue.cueNumber).padStart(2, '0')} · {nextCue.name}
                </span>
              </div>
            )}
          </div>

          {/* Hardware Transport Keycaps */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onCommand('cue_back')}
              className="console-btn flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-slate-200"
              title="Previous Cue"
            >
              <SkipBack className="w-3.5 h-3.5" />
              <span>BACK</span>
            </button>

            <button
              type="button"
              onClick={() =>
                subView === 'timeline'
                  ? onCommand('timeline_play', { timelineId: activeTimeline.id })
                  : onCommand('cue_go')
              }
              className="console-btn-emerald flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-bold tracking-wider"
              title="Execute Current / Next Cue"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>GO</span>
            </button>

            <button
              type="button"
              onClick={() =>
                subView === 'timeline' ? onCommand('timeline_pause') : onCommand('cue_pause')
              }
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold ${
                show.playback.status === 'paused'
                  ? 'console-btn-amber'
                  : 'console-btn text-amber-300'
              }`}
            >
              <Pause className="w-3.5 h-3.5" />
              <span>{show.playback.status === 'paused' ? 'RESUME' : 'PAUSE'}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                subView === 'timeline' ? onCommand('timeline_stop') : onCommand('cue_stop')
              }
              className="console-btn flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-red-300"
            >
              <Square className="w-3.5 h-3.5" />
              <span>STOP</span>
            </button>

            <button
              type="button"
              onClick={() => onCommand('cue_next')}
              className="console-btn flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-slate-200"
            >
              <span>NEXT</span>
              <SkipForward className="w-3.5 h-3.5" />
            </button>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const num = Number(gotoNum);
                if (num > 0) {
                  onCommand('cue_goto', { cueNumber: num });
                  setGotoNum('');
                }
              }}
              className="flex items-center gap-1 ml-1"
            >
              <input
                type="number"
                aria-label="Go to cue number"
                placeholder="#"
                value={gotoNum}
                onChange={(e) => setGotoNum(e.target.value)}
                className="w-12 console-well rounded px-2 py-1.5 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                className="console-btn px-2.5 py-1.5 rounded text-xs font-medium text-slate-200"
              >
                GO TO
              </button>
            </form>

            <button
              type="button"
              onClick={() => onCommand('release_all')}
              className="console-btn px-2.5 py-1.5 rounded text-xs font-semibold text-red-300 border-red-900/60 hover:border-red-500/70"
            >
              RELEASE ALL
            </button>
          </div>
        </div>

        {/* Live Cue Timing / Auto-Follow Bar */}
        {subView === 'cues' && activeCue && (
          <div className="console-well rounded px-3 py-2 flex items-center gap-3">
            <span
              className="w-3 h-3 rounded-xs shrink-0 border border-white/25"
              style={{ backgroundColor: activeCue.colour }}
            />
            <span className="text-[11px] font-mono-tabular text-slate-300 shrink-0">
              Cue {String(activeCue.cueNumber).padStart(2, '0')}
            </span>
            <div className="flex-1 h-1.5 bg-[#12161E] rounded-full overflow-hidden">
              <div
                className={`h-full transition-[width] duration-75 ${
                  hasTimedAutoFollow ? 'bg-emerald-400' : 'bg-amber-400/70'
                }`}
                style={{
                  width: hasTimedAutoFollow ? `${Math.round(cueProgress.ratio * 100)}%` : '100%',
                }}
              />
            </div>
            <span className="text-[11px] font-mono-tabular text-slate-300 shrink-0">
              {hasTimedAutoFollow
                ? `Auto-follow in ${formatSec(cueProgress.remainingMs)}`
                : activeCue.durationMs === 0
                  ? 'Manual Hold (press GO for next)'
                  : `Hold ${formatSec(activeCue.durationMs)} · Manual`}
            </span>
          </div>
        )}
      </div>

      {subView === 'cues' ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          {/* Left: Pro Show Cue Stack Sheet */}
          <div className="xl:col-span-5 console-panel rounded-md overflow-hidden">
            <div className="px-3.5 py-3 border-b border-[#222833] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-baseline gap-2.5">
                <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
                  Show Cue Stack
                </h3>
                <span className="text-xs font-mono-tabular text-slate-400">
                  {show.cues.length} {show.cues.length === 1 ? 'Cue' : 'Cues'}
                </span>
              </div>
              <button
                type="button"
                onClick={resetToNewCueMode}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold ${
                  editingCueId === null
                    ? 'console-btn-amber'
                    : 'console-btn text-slate-200'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Cue</span>
              </button>
            </div>

            {show.cues.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 space-y-2">
                <p className="text-slate-200 font-medium">No cues in this show yet</p>
                <p>Configure a look &amp; effect on the right and click Add Cue to Stack.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#1A1F28] max-h-[780px] overflow-y-auto">
                {show.cues.map((cue, idx) => {
                  const isActive = show.playback.activeCueId === cue.id;
                  const isSelected = editingCueId === cue.id;
                  const fxLabel =
                    EFFECT_CATALOG.find((fx) => fx.type === cue.effectType)?.label ||
                    cue.effectType;
                  const grpName =
                    cue.targetGroupId === 'all'
                      ? 'All'
                      : show.groups.find((g) => g.id === cue.targetGroupId)?.name || 'Group';

                  return (
                    <div
                      key={cue.id}
                      data-testid={`cue-row-${cue.cueNumber}`}
                      onClick={() => selectCueForInspector(cue)}
                      className={`px-3.5 py-2.5 flex flex-col gap-2 cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-emerald-500/12'
                          : isSelected
                            ? 'bg-amber-500/10'
                            : 'hover:bg-[#171C25]'
                      }`}
                    >
                      {/* Cue #, Swatch & Full Title + Meta */}
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="flex items-center gap-1 w-8 shrink-0 font-mono-tabular font-bold text-xs pt-0.5">
                          {isActive ? (
                            <Play className="w-3 h-3 text-emerald-400 fill-current shrink-0" />
                          ) : (
                            <span className="w-3 shrink-0" />
                          )}
                          <span className={isActive ? 'text-emerald-300' : 'text-amber-400'}>
                            {String(cue.cueNumber).padStart(2, '0')}
                          </span>
                        </div>

                        <span
                          className="w-6 h-6 rounded-sm border border-white/25 shrink-0 shadow-inner mt-0.5"
                          style={{
                            background: `linear-gradient(135deg, ${cue.colour} 0%, ${
                              cue.secondaryColour || cue.colour
                            } 100%)`,
                          }}
                          title={`${cue.colour}${cue.secondaryColour ? ` → ${cue.secondaryColour}` : ''}`}
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <span className="font-semibold text-xs text-slate-100 truncate">
                              {cue.name}
                            </span>
                            {isActive && (
                              <span className="text-[10px] font-mono-tabular font-semibold text-emerald-400 uppercase tracking-wider shrink-0">
                                LIVE
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400 font-mono-tabular mt-0.5">
                            <span className="text-slate-300 font-sans truncate">{fxLabel}</span>
                            <span>·</span>
                            <span>{cue.intensity}%</span>
                            <span>·</span>
                            <span>{cue.durationMs === 0 ? 'Hold' : formatSec(cue.durationMs)}</span>
                            <span>·</span>
                            <span className="font-sans">{grpName}</span>
                          </div>
                        </div>
                      </div>

                      {/* Row Action Buttons */}
                      <div
                        className="flex items-center justify-between gap-2 pl-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              onCommand('upsert_cue', {
                                cue: { ...cue, autoFollow: !cue.autoFollow },
                              })
                            }
                            className={`px-2 py-1 rounded text-[10px] font-medium ${
                              cue.autoFollow
                                ? 'console-btn-emerald font-semibold'
                                : 'console-btn text-slate-300'
                            }`}
                          >
                            {cue.autoFollow ? 'Auto' : 'Man'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onCommand('cue_go', { cueIndex: idx })}
                            className="console-btn-emerald px-2.5 py-1 rounded font-semibold text-[11px]"
                            title={`Fire Cue ${cue.cueNumber}`}
                          >
                            GO
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`Move cue ${cue.name} up`}
                            disabled={idx === 0}
                            onClick={() =>
                              onCommand('reorder_cue', { cueId: cue.id, direction: 'up' })
                            }
                            className="console-btn p-1.5 rounded text-slate-300 disabled:opacity-35"
                            title="Move Up"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move cue ${cue.name} down`}
                            disabled={idx === show.cues.length - 1}
                            onClick={() =>
                              onCommand('reorder_cue', { cueId: cue.id, direction: 'down' })
                            }
                            className="console-btn p-1.5 rounded text-slate-300 disabled:opacity-35"
                            title="Move Down"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Duplicate cue ${cue.name}`}
                            onClick={() => onCommand('duplicate_cue', { cueId: cue.id })}
                            className="console-btn p-1.5 rounded text-slate-300"
                            title="Duplicate Cue"
                          >
                            <CopyPlus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            data-testid={`delete-cue-${cue.cueNumber}`}
                            aria-label={`Delete cue ${cue.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCue(cue.id);
                            }}
                            className="console-btn p-1.5 rounded text-red-400 hover:text-red-300 hover:border-red-500/60"
                            title="Delete Cue"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Shared Visualiser (Same as Effects Page) + Full Effect & Beat Cue Maker */}
          <div className="xl:col-span-7 flex flex-col gap-4">
            {/* Shared Visualiser matching Effects Page */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-end gap-1.5 text-[11px]">
                <span className="text-slate-400">Visualiser Mode:</span>
                <button
                  type="button"
                  onClick={() => setPreviewSource('draft')}
                  className={`px-2 py-0.5 rounded ${
                    previewSource === 'draft'
                      ? 'console-btn-amber font-semibold'
                      : 'console-btn text-slate-300'
                  }`}
                >
                  Cue Designer Look
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewSource('live')}
                  className={`px-2 py-0.5 rounded ${
                    previewSource === 'live'
                      ? 'console-btn-emerald font-semibold'
                      : 'console-btn text-slate-300'
                  }`}
                >
                  Live Console Output
                </button>
              </div>
              <EffectStagePreview
                testId="cue-stage-preview"
                title={
                  previewSource === 'live'
                    ? `Live Console Preview — ${activeCue?.name || 'Standby'}`
                    : `Live Cue Preview — ${cueDraft.name || 'New Cue'} (${draftFxEntry?.label || 'Solid'})`
                }
                devices={devices}
                groups={show.groups}
                lighting={cueVisualiserLighting}
                serverOffsetMs={serverOffsetMs}
                isLiveRunning={true}
                statusLabel={previewSource === 'live' ? statusText : 'CUE PREVIEW'}
              />
            </div>

            {/* Cue Maker / Inspector */}
            <div className="console-panel rounded-md p-4 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#222833] pb-2.5">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-amber-400" />
                  <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
                    {editingCueId ? 'Cue Inspector & Effect Editor' : 'New Cue Designer'}
                  </h3>
                </div>
                {editingCueId && (
                  <button
                    type="button"
                    onClick={resetToNewCueMode}
                    className="console-btn flex items-center gap-1 px-2.5 py-1 rounded text-[11px] text-amber-300"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>New Cue</span>
                  </button>
                )}
              </div>

              {/* Cue Name + Colours */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                <label className="flex flex-col gap-1 text-slate-300">
                  <span>Cue Name</span>
                  <input
                    type="text"
                    aria-label="Cue Name"
                    value={cueDraft.name || ''}
                    onChange={(e) => setCueDraft({ ...cueDraft, name: e.target.value })}
                    className="console-well rounded px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-amber-400"
                  />
                </label>

                <label className="flex flex-col gap-1 text-slate-300">
                  <span>Primary Colour</span>
                  <div className="console-well rounded p-1 flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Cue Primary Colour"
                      value={draftPrimary}
                      onChange={(e) => {
                        const col = e.target.value.toUpperCase();
                        updateDraftEffectParams({
                          palette: [col, draftSecondary, ...draftEffectParams.palette.slice(2)],
                        });
                      }}
                      className="w-7 h-6 rounded bg-transparent border border-[#2A313E] cursor-pointer shrink-0"
                    />
                    <span className="font-mono-tabular text-[11px] text-slate-200 uppercase truncate">
                      {draftPrimary}
                    </span>
                  </div>
                </label>

                <label className="flex flex-col gap-1 text-slate-300">
                  <span>Secondary Colour</span>
                  <div className="console-well rounded p-1 flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Cue Secondary Colour"
                      value={draftSecondary}
                      onChange={(e) => {
                        const sec = e.target.value.toUpperCase();
                        updateDraftEffectParams({
                          palette: [draftPrimary, sec, ...draftEffectParams.palette.slice(2)],
                        });
                      }}
                      className="w-7 h-6 rounded bg-transparent border border-[#2A313E] cursor-pointer shrink-0"
                    />
                    <span className="font-mono-tabular text-[11px] text-slate-200 uppercase truncate">
                      {draftSecondary}
                    </span>
                  </div>
                </label>
              </div>

              {/* Effect Picker with Category Tabs & Grid */}
              <div className="console-well rounded p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-display text-xs font-semibold tracking-wider uppercase text-slate-200">
                    Pick Effect Engine
                  </span>
                  <select
                    aria-label="Cue Effect Engine"
                    value={cueDraft.effectType}
                    onChange={(e) => {
                      const fxType = e.target.value as EffectType;
                      const found = EFFECT_CATALOG.find((x) => x.type === fxType);
                      if (found) setFxCategory(found.category);
                      selectDraftEffectType(fxType);
                    }}
                    className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1 text-xs text-amber-300 font-medium focus:outline-none focus:border-amber-400"
                  >
                    {EFFECT_CATALOG.map((fx) => (
                      <option key={fx.type} value={fx.type}>
                        {fx.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 border-b border-[#222833] pb-2">
                  {(['colour', 'movement', 'flash', 'advanced'] as EffectCategory[]).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setFxCategory(cat)}
                      className={`px-2.5 py-1 rounded text-[11px] capitalize ${
                        fxCategory === cat
                          ? 'console-btn-amber font-semibold'
                          : 'console-btn text-slate-300'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-[168px] overflow-y-auto pr-1">
                  {categoryEffects.map((fx) => {
                    const isPicked = cueDraft.effectType === fx.type;
                    return (
                      <button
                        key={fx.type}
                        type="button"
                        onClick={() => selectDraftEffectType(fx.type)}
                        className={`text-left px-2.5 py-1.5 rounded border text-[11px] truncate ${
                          isPicked
                            ? 'border-amber-400 bg-amber-500/20 text-amber-100 font-semibold'
                            : 'console-btn text-slate-300'
                        }`}
                        title={fx.description}
                      >
                        {fx.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Beat Step Sequencer (inside Cue Maker when Beat Step Flash is selected) */}
              {cueDraft.effectType === 'beat_flash' && (
                <BeatSequencerControls
                  compact
                  params={draftEffectParams}
                  startedAtMs={draftStartMsRef.current}
                  serverOffsetMs={serverOffsetMs}
                  onChange={updateDraftEffectParams}
                />
              )}

              {/* Full Effect Editor Knobs inside Cue Maker */}
              <div className="console-well rounded p-3 space-y-3">
                <div className="flex items-center justify-between text-[11px] text-slate-300">
                  <span className="font-display uppercase tracking-wider font-semibold">
                    Cue Effect Parameters
                  </span>
                  <span className="text-slate-400 font-mono-tabular">
                    {draftFxEntry?.label || 'Solid'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <RotaryEncoder
                    label="Speed"
                    value={draftEffectParams.speed}
                    min={0.1}
                    max={10}
                    step={0.1}
                    unit="x"
                    onChange={(val) => updateDraftEffectParams({ speed: val })}
                  />
                  <RotaryEncoder
                    label="Intensity"
                    value={Number(cueDraft.intensity ?? 100)}
                    min={0}
                    max={100}
                    step={5}
                    unit="%"
                    onChange={(val) => updateDraftEffectParams({ intensity: val })}
                  />
                  <RotaryEncoder
                    label="Size"
                    value={draftEffectParams.size}
                    min={5}
                    max={100}
                    step={5}
                    unit="%"
                    onChange={(val) => updateDraftEffectParams({ size: val })}
                  />
                  <RotaryEncoder
                    label="Width"
                    value={draftEffectParams.width}
                    min={5}
                    max={100}
                    step={5}
                    unit="%"
                    onChange={(val) => updateDraftEffectParams({ width: val })}
                  />
                  <RotaryEncoder
                    label="Spread"
                    value={draftEffectParams.spread}
                    min={5}
                    max={100}
                    step={5}
                    unit="%"
                    onChange={(val) => updateDraftEffectParams({ spread: val })}
                  />
                  <RotaryEncoder
                    label="Density"
                    value={draftEffectParams.density}
                    min={5}
                    max={100}
                    step={5}
                    unit="%"
                    onChange={(val) => updateDraftEffectParams({ density: val })}
                  />
                  <RotaryEncoder
                    label="Freq"
                    value={draftEffectParams.frequency}
                    min={0.2}
                    max={20}
                    step={0.2}
                    unit="Hz"
                    onChange={(val) => updateDraftEffectParams({ frequency: val })}
                  />
                  <RotaryEncoder
                    label="Phase"
                    value={draftEffectParams.phaseDeg}
                    min={0}
                    max={360}
                    step={15}
                    unit="°"
                    onChange={(val) => updateDraftEffectParams({ phaseDeg: val })}
                  />
                </div>
              </div>

              {/* Cue Timing, Direction, Curve, Group & Media */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <label className="flex flex-col gap-1 text-slate-300">
                  <span>Direction</span>
                  <select
                    value={draftEffectParams.direction}
                    onChange={(e) =>
                      updateDraftEffectParams({
                        direction: e.target.value as EffectParameters['direction'],
                      })
                    }
                    className="console-well rounded px-2 py-1.5 text-slate-100 focus:outline-none focus:border-amber-400"
                  >
                    <option value="forward">Forward</option>
                    <option value="reverse">Reverse</option>
                    <option value="pingpong">Ping-Pong</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-slate-300">
                  <span>Fade In (ms)</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={cueDraft.fadeInMs ?? 600}
                    onChange={(e) => setCueDraft({ ...cueDraft, fadeInMs: Number(e.target.value) })}
                    className="console-well rounded px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-400"
                  />
                </label>

                <label className="flex flex-col gap-1 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span>Hold (ms)</span>
                    <button
                      type="button"
                      onClick={() =>
                        setCueDraft({
                          ...cueDraft,
                          durationMs: (cueDraft.durationMs ?? 0) === 0 ? 4000 : 0,
                        })
                      }
                      className="text-[10px] text-amber-400 hover:underline font-mono-tabular"
                    >
                      {(cueDraft.durationMs ?? 0) === 0 ? 'Set 4s' : 'Hold (0)'}
                    </button>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={cueDraft.durationMs ?? 4000}
                    onChange={(e) =>
                      setCueDraft({ ...cueDraft, durationMs: Number(e.target.value) })
                    }
                    className="console-well rounded px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-400"
                  />
                </label>

                <label className="flex flex-col gap-1 text-slate-300">
                  <span>Transition Curve</span>
                  <select
                    value={cueDraft.transitionType}
                    onChange={(e) =>
                      setCueDraft({
                        ...cueDraft,
                        transitionType: e.target.value as TransitionType,
                      })
                    }
                    className="console-well rounded px-2 py-1.5 text-slate-100 focus:outline-none focus:border-amber-400"
                  >
                    <option value="ease_in_out">Ease In/Out</option>
                    <option value="linear">Linear</option>
                    <option value="crossfade">Crossfade</option>
                    <option value="cut">Snap Cut</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-slate-300">
                  <span>Target Group</span>
                  <select
                    value={cueDraft.targetGroupId || 'all'}
                    onChange={(e) => setCueDraft({ ...cueDraft, targetGroupId: e.target.value })}
                    className="console-well rounded px-2 py-1.5 text-slate-100 focus:outline-none focus:border-amber-400"
                  >
                    <option value="all">All Groups</option>
                    {show.groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-slate-300">
                  <span>Media Projection</span>
                  <select
                    value={cueDraft.mediaId || ''}
                    onChange={(e) => setCueDraft({ ...cueDraft, mediaId: e.target.value || null })}
                    className="console-well rounded px-2 py-1.5 text-slate-100 focus:outline-none focus:border-amber-400"
                  >
                    <option value="">None</option>
                    {mediaAssets.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex items-center justify-between console-well rounded px-3 py-2 cursor-pointer text-slate-200">
                <span>Auto-follow into next cue</span>
                <input
                  type="checkbox"
                  checked={Boolean(cueDraft.autoFollow)}
                  onChange={(e) => setCueDraft({ ...cueDraft, autoFollow: e.target.checked })}
                  className="accent-amber-500"
                />
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveCue}
                  className="flex-1 console-btn-amber flex items-center justify-center gap-1.5 py-2.5 rounded font-semibold"
                >
                  <Plus className="w-4 h-4" />
                  <span>{editingCueId ? 'Save Cue Changes' : 'Add Cue to Stack'}</span>
                </button>
                {editingCueId && (
                  <button
                    type="button"
                    data-testid="inspector-delete-cue"
                    onClick={() => handleDeleteCue(editingCueId)}
                    className="console-btn flex items-center justify-center gap-1.5 px-4 py-2.5 rounded font-semibold text-red-300 border-red-900/60 hover:border-red-500/80"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Multi-Track Visual Timeline Sequencer */
        <div className="space-y-4">
          <EffectStagePreview
            testId="timeline-stage-preview"
            title={`Live Timeline Visualiser — ${activeTimeline.name}`}
            devices={devices}
            groups={show.groups}
            lighting={show.lighting}
            serverOffsetMs={serverOffsetMs}
            isLiveRunning={show.playback.timelinePlaying}
            statusLabel={show.playback.timelinePlaying ? 'PLAYING' : 'PAUSED'}
          />

          <div className="console-panel rounded-md p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
                  {activeTimeline.name}
                </h3>
                <span className="text-xs font-mono-tabular text-amber-400 console-well px-2.5 py-1 rounded">
                  {(show.playback.timelinePositionMs / 1000).toFixed(1)}s /{' '}
                  {(activeTimeline.totalDurationMs / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    onCommand('save_timeline', {
                      timeline: { ...activeTimeline, loop: !activeTimeline.loop },
                    })
                  }
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded font-medium ${
                    activeTimeline.loop
                      ? 'console-btn-amber font-semibold'
                      : 'console-btn text-slate-300'
                  }`}
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>{activeTimeline.loop ? 'Loop On' : 'Loop Off'}</span>
                </button>
                <label className="flex items-center gap-1.5 text-slate-300">
                  <span>Length (s)</span>
                  <input
                    type="number"
                    min={4}
                    max={300}
                    value={Math.round(activeTimeline.totalDurationMs / 1000)}
                    onChange={(e) =>
                      onCommand('save_timeline', {
                        timeline: {
                          ...activeTimeline,
                          totalDurationMs: Math.max(4000, Number(e.target.value) * 1000),
                        },
                      })
                    }
                    className="w-16 console-well rounded px-2 py-1 font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-400"
                  />
                </label>
              </div>
            </div>

            {/* Time Ruler */}
            <div className="flex items-center gap-2 text-[10px] font-mono-tabular text-slate-500">
              <div className="w-28 shrink-0 text-right pr-2">TIMECODE</div>
              <div className="flex-1 flex justify-between px-1">
                {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
                  <span key={pct}>{formatSec(activeTimeline.totalDurationMs * pct)}</span>
                ))}
              </div>
            </div>

            {/* Tracks Grid */}
            <div className="space-y-2 relative">
              {TRACKS.map((trk) => {
                const trackBlocks = activeTimeline.blocks.filter((b) => b.track === trk.id);
                return (
                  <div key={trk.id} className="flex items-stretch gap-2">
                    <div className="w-28 shrink-0 console-well rounded px-2.5 py-2 text-xs font-medium text-slate-300 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-xs shrink-0" style={{ backgroundColor: trk.color }} />
                      <span className="truncate">{trk.label}</span>
                    </div>
                    <div
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        onCommand('timeline_seek', {
                          positionMs: Math.round(ratio * activeTimeline.totalDurationMs),
                        });
                      }}
                      className="flex-1 relative h-11 console-well rounded overflow-hidden cursor-pointer"
                    >
                      {/* Playhead */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none shadow-[0_0_8px_#F59E0B]"
                        style={{
                          left: `${Math.min(
                            100,
                            (show.playback.timelinePositionMs / Math.max(1, activeTimeline.totalDurationMs)) *
                              100,
                          )}%`,
                        }}
                      />

                      {trackBlocks.map((blk) => {
                        const leftPct = (blk.startMs / Math.max(1, activeTimeline.totalDurationMs)) * 100;
                        const widthPct =
                          (blk.durationMs / Math.max(1, activeTimeline.totalDurationMs)) * 100;
                        const bgHex = blk.colour || trk.color;
                        const { r, g, b } = hexToRgb(bgHex);
                        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                        const isBrightBg = lum > 0.6;
                        return (
                          <div
                            key={blk.id}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              left: `${leftPct}%`,
                              width: `${Math.max(4, widthPct)}%`,
                              backgroundColor: bgHex,
                            }}
                            className={`absolute top-1 bottom-1 rounded px-2 flex items-center justify-between gap-1 text-[11px] font-semibold shadow border overflow-hidden ${
                              isBrightBg
                                ? 'text-slate-950 border-black/25'
                                : 'text-white border-white/25'
                            }`}
                          >
                            <span className="truncate">{blk.label}</span>
                            <div
                              className={`flex items-center gap-1 shrink-0 rounded px-1 ${
                                isBrightBg
                                  ? 'bg-black/15 text-slate-950'
                                  : 'bg-black/50 text-white'
                              }`}
                            >
                              <button
                                type="button"
                                aria-label={`Shift ${blk.label} later`}
                                onClick={() =>
                                  updateBlock(blk.id, { startMs: blk.startMs + 500 })
                                }
                                className="text-[10px] hover:text-amber-300"
                                title="Shift +0.5s"
                              >
                                +
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete timeline block ${blk.label}`}
                                onClick={() => removeBlock(blk.id)}
                                className="text-[10px] hover:text-red-400"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add Block Toolbar */}
            <div className="console-well rounded p-3 flex flex-wrap items-end gap-3 text-xs">
              <label className="flex flex-col gap-1 text-slate-300">
                <span>Track</span>
                <select
                  value={blockDraft.track}
                  onChange={(e) =>
                    setBlockDraft({ ...blockDraft, track: e.target.value as TimelineBlock['track'] })
                  }
                  className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 text-slate-100"
                >
                  {TRACKS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-slate-300">
                <span>Block Label</span>
                <input
                  type="text"
                  value={blockDraft.label}
                  onChange={(e) => setBlockDraft({ ...blockDraft, label: e.target.value })}
                  className="w-36 bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 text-slate-100"
                />
              </label>

              <label className="flex flex-col gap-1 text-slate-300">
                <span>Start (ms)</span>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={blockDraft.startMs}
                  onChange={(e) => setBlockDraft({ ...blockDraft, startMs: Number(e.target.value) })}
                  className="w-20 bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 font-mono-tabular text-slate-100"
                />
              </label>

              <label className="flex flex-col gap-1 text-slate-300">
                <span>Duration (ms)</span>
                <input
                  type="number"
                  min={500}
                  step={500}
                  value={blockDraft.durationMs}
                  onChange={(e) => setBlockDraft({ ...blockDraft, durationMs: Number(e.target.value) })}
                  className="w-20 bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 font-mono-tabular text-slate-100"
                />
              </label>

              <label className="flex flex-col gap-1 text-slate-300">
                <span>Colour</span>
                <input
                  type="color"
                  value={blockDraft.colour}
                  onChange={(e) => setBlockDraft({ ...blockDraft, colour: e.target.value })}
                  className="w-10 h-8 rounded bg-transparent border border-[#2A313E] cursor-pointer"
                />
              </label>

              {blockDraft.track !== 'image' && blockDraft.track !== 'intensity' && (
                <label className="flex flex-col gap-1 text-slate-300">
                  <span>Effect</span>
                  <select
                    value={blockDraft.effectType}
                    onChange={(e) =>
                      setBlockDraft({ ...blockDraft, effectType: e.target.value as EffectType })
                    }
                    className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 text-slate-100"
                  >
                    {EFFECT_CATALOG.map((fx) => (
                      <option key={fx.type} value={fx.type}>
                        {fx.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <button
                type="button"
                onClick={handleAddBlock}
                className="console-btn-amber flex items-center gap-1 px-3 py-1.5 rounded font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add to Timeline</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
