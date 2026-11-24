import React, { useState } from 'react';
import {
  Copy,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
} from 'lucide-react';
import {
  CueItem,
  EffectType,
  MediaAsset,
  ShowFile,
  TimelineBlock,
  TimelineSequence,
  TransitionType,
} from '../../shared/types';
import { EFFECT_CATALOG } from '../../engine/effects';

interface CueTimelinePanelProps {
  show: ShowFile;
  mediaAssets: MediaAsset[];
  onCommand: (action: string, payload?: Record<string, unknown>) => void;
}

const TRACKS: Array<{ id: TimelineBlock['track']; label: string; color: string }> = [
  { id: 'colour', label: 'Main Colour', color: '#3B82F6' },
  { id: 'movement', label: 'Movement', color: '#06B6D4' },
  { id: 'flash', label: 'Flash', color: '#F59E0B' },
  { id: 'image', label: 'Image / Media', color: '#A855F7' },
  { id: 'intensity', label: 'Intensity', color: '#10B981' },
];

export const CueTimelinePanel: React.FC<CueTimelinePanelProps> = ({
  show,
  mediaAssets,
  onCommand,
}) => {
  const [subView, setSubView] = useState<'cues' | 'timeline'>('cues');
  const [gotoNum, setGotoNum] = useState('');
  const [copiedCue, setCopiedCue] = useState<CueItem | null>(null);

  const [newCue, setNewCue] = useState<Partial<CueItem>>({
    name: 'New Lighting Cue',
    colour: '#0066FF',
    secondaryColour: '#001133',
    effectType: 'solid',
    intensity: 100,
    durationMs: 4000,
    fadeInMs: 600,
    fadeOutMs: 400,
    delayMs: 0,
    targetGroupId: 'all',
    mediaId: null,
    transitionType: 'ease_in_out',
    autoFollow: true,
  });

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

  const handleAddCue = () => {
    const maxNum = show.cues.reduce((m, c) => Math.max(m, c.cueNumber), 0);
    const cue: CueItem = {
      id: `cue-${Math.random().toString(36).slice(2, 7)}`,
      cueNumber: maxNum + 1,
      name: newCue.name?.trim() || `Cue ${maxNum + 1}`,
      colour: newCue.colour || '#0066FF',
      secondaryColour: newCue.secondaryColour,
      effectType: (newCue.effectType as EffectType) || 'solid',
      effectParams: {
        palette: [newCue.colour || '#0066FF', newCue.secondaryColour || '#000000'],
      },
      intensity: Number(newCue.intensity ?? 100),
      durationMs: Number(newCue.durationMs ?? 4000),
      fadeInMs: Number(newCue.fadeInMs ?? 500),
      fadeOutMs: Number(newCue.fadeOutMs ?? 400),
      delayMs: Number(newCue.delayMs ?? 0),
      targetGroupId: newCue.targetGroupId || 'all',
      mediaId: newCue.mediaId || null,
      transitionType: (newCue.transitionType as TransitionType) || 'ease_in_out',
      autoFollow: Boolean(newCue.autoFollow),
    };
    onCommand('upsert_cue', { cue });
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

  return (
    <div className="flex flex-col gap-4">
      {/* Transport & Mode Header */}
      <div className="bg-[#12151B] border border-[#232934] rounded p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSubView('cues')}
            className={`px-3 py-1.5 rounded text-xs font-semibold ${
              subView === 'cues'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-[#1A1F28] text-slate-300 hover:bg-[#232A36]'
            }`}
          >
            Cue List &amp; Playback
          </button>
          <button
            type="button"
            onClick={() => setSubView('timeline')}
            className={`px-3 py-1.5 rounded text-xs font-semibold ${
              subView === 'timeline'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-[#1A1F28] text-slate-300 hover:bg-[#232A36]'
            }`}
          >
            Multi-Track Timeline Editor
          </button>
        </div>

        {/* Cue Transport Deck */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onCommand('cue_back')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-[#1A1F28] border border-[#2B3342] text-slate-200 hover:bg-[#232A36]"
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
            className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500"
          >
            <Play className="w-3.5 h-3.5" />
            <span>GO</span>
          </button>

          <button
            type="button"
            onClick={() =>
              subView === 'timeline' ? onCommand('timeline_pause') : onCommand('cue_pause')
            }
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-[#1A1F28] border border-[#2B3342] text-amber-300 hover:bg-[#232A36]"
          >
            <Pause className="w-3.5 h-3.5" />
            <span>PAUSE</span>
          </button>

          <button
            type="button"
            onClick={() =>
              subView === 'timeline' ? onCommand('timeline_stop') : onCommand('cue_stop')
            }
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-[#1A1F28] border border-[#2B3342] text-red-300 hover:bg-[#232A36]"
          >
            <Square className="w-3.5 h-3.5" />
            <span>STOP</span>
          </button>

          <button
            type="button"
            onClick={() => onCommand('cue_next')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-[#1A1F28] border border-[#2B3342] text-slate-200 hover:bg-[#232A36]"
          >
            <span>NEXT CUE</span>
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
            className="flex items-center gap-1"
          >
            <input
              type="number"
              aria-label="Go to cue number"
              placeholder="Cue #"
              value={gotoNum}
              onChange={(e) => setGotoNum(e.target.value)}
              className="w-16 bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1 text-xs font-mono-tabular text-slate-100"
            />
            <button
              type="submit"
              className="px-2 py-1 rounded text-xs bg-[#1A1F28] border border-[#2B3342] text-slate-200"
            >
              GO TO
            </button>
          </form>

          <button
            type="button"
            onClick={() => onCommand('release_all')}
            className="px-2.5 py-1.5 rounded text-xs bg-red-950/60 border border-red-800/60 text-red-200"
          >
            RELEASE ALL
          </button>
        </div>
      </div>

      {subView === 'cues' ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* Cue List Table */}
          <div className="xl:col-span-8 bg-[#12151B] border border-[#232934] rounded p-3 overflow-x-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
                Show Cue List ({show.cues.length} Cues)
              </h3>
              <span className="text-xs font-mono-tabular text-slate-400">
                Status: {show.playback.status.toUpperCase()}
                {show.playback.activeCueIndex >= 0
                  ? ` · Active Cue #${show.cues[show.playback.activeCueIndex]?.cueNumber ?? ''}`
                  : ''}
              </span>
            </div>

            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#232934] text-slate-400">
                  <th className="py-2 px-2">Cue</th>
                  <th className="py-2 px-2">Name</th>
                  <th className="py-2 px-2">Colour</th>
                  <th className="py-2 px-2">Effect</th>
                  <th className="py-2 px-2">Int</th>
                  <th className="py-2 px-2">Fade In</th>
                  <th className="py-2 px-2">Duration</th>
                  <th className="py-2 px-2">Follow</th>
                  <th className="py-2 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {show.cues.map((cue, idx) => {
                  const isActive = show.playback.activeCueId === cue.id;
                  return (
                    <tr
                      key={cue.id}
                      className={`border-b border-[#1A1F28] ${
                        isActive ? 'bg-emerald-500/15' : 'hover:bg-[#171B23]'
                      }`}
                    >
                      <td className="py-2 px-2 font-mono-tabular font-bold text-amber-400">
                        {cue.cueNumber}
                      </td>
                      <td className="py-2 px-2 font-medium text-slate-100">{cue.name}</td>
                      <td className="py-2 px-2">
                        <span
                          className="inline-block w-4 h-4 rounded-sm border border-slate-600 align-middle"
                          style={{ backgroundColor: cue.colour }}
                        />
                      </td>
                      <td className="py-2 px-2 text-slate-300">{cue.effectType}</td>
                      <td className="py-2 px-2 font-mono-tabular text-slate-300">{cue.intensity}%</td>
                      <td className="py-2 px-2 font-mono-tabular text-slate-300">{cue.fadeInMs}ms</td>
                      <td className="py-2 px-2 font-mono-tabular text-slate-300">
                        {cue.durationMs === 0 ? 'Hold' : `${cue.durationMs}ms`}
                      </td>
                      <td className="py-2 px-2">
                        <button
                          type="button"
                          onClick={() =>
                            onCommand('upsert_cue', {
                              cue: { ...cue, autoFollow: !cue.autoFollow },
                            })
                          }
                          className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                            cue.autoFollow
                              ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-700'
                              : 'bg-[#1A1F28] text-slate-400'
                          }`}
                        >
                          {cue.autoFollow ? 'Auto' : 'Manual'}
                        </button>
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onCommand('cue_go', { cueIndex: idx })}
                            className="px-2 py-0.5 rounded bg-emerald-600 text-white font-semibold text-[11px]"
                          >
                            GO
                          </button>
                          <button
                            type="button"
                            aria-label={`Copy cue ${cue.name}`}
                            onClick={() => setCopiedCue(cue)}
                            className="p-1 text-slate-400 hover:text-slate-100"
                            title="Copy Cue"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete cue ${cue.name}`}
                            onClick={() => onCommand('delete_cue', { cueId: cue.id })}
                            className="p-1 text-slate-500 hover:text-red-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Add Cue Form */}
          <div className="xl:col-span-4 bg-[#12151B] border border-[#232934] rounded p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
                Create New Cue
              </h3>
              {copiedCue && (
                <button
                  type="button"
                  onClick={() => {
                    const maxNum = show.cues.reduce((m, c) => Math.max(m, c.cueNumber), 0);
                    onCommand('upsert_cue', {
                      cue: {
                        ...copiedCue,
                        id: `cue-${Math.random().toString(36).slice(2, 7)}`,
                        cueNumber: maxNum + 1,
                        name: `${copiedCue.name} (Copy)`,
                      },
                    });
                  }}
                  className="text-amber-400 hover:underline"
                >
                  Paste Copied Cue
                </button>
              )}
            </div>

            <label className="flex flex-col gap-1 text-slate-300">
              <span>Cue Name</span>
              <input
                type="text"
                value={newCue.name || ''}
                onChange={(e) => setNewCue({ ...newCue, name: e.target.value })}
                className="bg-[#090B0E] border border-[#2A313E] rounded px-2.5 py-1.5 text-slate-100"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-slate-300">
                <span>Primary Colour</span>
                <input
                  type="color"
                  value={newCue.colour || '#0066FF'}
                  onChange={(e) => setNewCue({ ...newCue, colour: e.target.value })}
                  className="w-full h-8 rounded bg-transparent border border-[#2A313E] cursor-pointer"
                />
              </label>
              <label className="flex flex-col gap-1 text-slate-300">
                <span>Secondary Colour</span>
                <input
                  type="color"
                  value={newCue.secondaryColour || '#000000'}
                  onChange={(e) => setNewCue({ ...newCue, secondaryColour: e.target.value })}
                  className="w-full h-8 rounded bg-transparent border border-[#2A313E] cursor-pointer"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-slate-300">
              <span>Effect Type</span>
              <select
                value={newCue.effectType}
                onChange={(e) => setNewCue({ ...newCue, effectType: e.target.value as EffectType })}
                className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 text-slate-100"
              >
                {EFFECT_CATALOG.map((fx) => (
                  <option key={fx.type} value={fx.type}>
                    {fx.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-slate-300">
                <span>Intensity (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={newCue.intensity ?? 100}
                  onChange={(e) => setNewCue({ ...newCue, intensity: Number(e.target.value) })}
                  className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 font-mono-tabular text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-slate-300">
                <span>Duration (ms)</span>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={newCue.durationMs ?? 4000}
                  onChange={(e) => setNewCue({ ...newCue, durationMs: Number(e.target.value) })}
                  className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 font-mono-tabular text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-slate-300">
                <span>Fade In (ms)</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={newCue.fadeInMs ?? 600}
                  onChange={(e) => setNewCue({ ...newCue, fadeInMs: Number(e.target.value) })}
                  className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 font-mono-tabular text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-slate-300">
                <span>Transition</span>
                <select
                  value={newCue.transitionType}
                  onChange={(e) =>
                    setNewCue({ ...newCue, transitionType: e.target.value as TransitionType })
                  }
                  className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 text-slate-100"
                >
                  <option value="ease_in_out">Ease In/Out</option>
                  <option value="linear">Linear</option>
                  <option value="crossfade">Crossfade</option>
                  <option value="cut">Snap Cut</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-slate-300">
                <span>Target Group</span>
                <select
                  value={newCue.targetGroupId || 'all'}
                  onChange={(e) => setNewCue({ ...newCue, targetGroupId: e.target.value })}
                  className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 text-slate-100"
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
                <span>Media (Optional)</span>
                <select
                  value={newCue.mediaId || ''}
                  onChange={(e) => setNewCue({ ...newCue, mediaId: e.target.value || null })}
                  className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 text-slate-100"
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

            <label className="flex items-center gap-2 text-slate-300">
              <input
                type="checkbox"
                checked={Boolean(newCue.autoFollow)}
                onChange={(e) => setNewCue({ ...newCue, autoFollow: e.target.checked })}
              />
              <span>Auto-follow into next cue automatically</span>
            </label>

            <button
              type="button"
              onClick={handleAddCue}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400"
            >
              <Plus className="w-4 h-4" />
              <span>Add Cue to Sequence</span>
            </button>
          </div>
        </div>
      ) : (
        /* Multi-Track Visual Timeline Editor */
        <div className="bg-[#12151B] border border-[#232934] rounded p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
                {activeTimeline.name}
              </h3>
              <span className="text-xs font-mono-tabular text-amber-400">
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
                className={`flex items-center gap-1 px-2.5 py-1 rounded border ${
                  activeTimeline.loop
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                    : 'bg-[#1A1F28] border-[#2B3342] text-slate-400'
                }`}
              >
                <Repeat className="w-3.5 h-3.5" />
                <span>{activeTimeline.loop ? 'Loop On' : 'Loop Off'}</span>
              </button>
              <label className="flex items-center gap-1 text-slate-300">
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
                  className="w-16 bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1 font-mono-tabular text-slate-100"
                />
              </label>
            </div>
          </div>

          {/* Tracks Grid */}
          <div className="space-y-2 relative">
            {TRACKS.map((trk) => {
              const trackBlocks = activeTimeline.blocks.filter((b) => b.track === trk.id);
              return (
                <div key={trk.id} className="flex items-stretch gap-2">
                  <div className="w-28 shrink-0 bg-[#0D1015] border border-[#232934] rounded px-2 py-2 text-xs font-medium text-slate-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-xs shrink-0" style={{ backgroundColor: trk.color }} />
                    <span className="truncate">{trk.label}</span>
                  </div>
                  <div
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const ratio = (e.clientX - rect.left) / rect.width;
                      onCommand('timeline_seek', {
                        positionMs: Math.round(ratio * activeTimeline.totalDurationMs),
                      });
                    }}
                    className="flex-1 relative h-11 bg-[#080A0D] border border-[#232934] rounded overflow-hidden cursor-pointer"
                  >
                    {/* Playhead */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none"
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
                      return (
                        <div
                          key={blk.id}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            left: `${leftPct}%`,
                            width: `${Math.max(4, widthPct)}%`,
                            backgroundColor: blk.colour || trk.color,
                          }}
                          className="absolute top-1 bottom-1 rounded px-1.5 flex items-center justify-between gap-1 text-[11px] font-medium text-white shadow border border-white/25 overflow-hidden"
                        >
                          <span className="truncate drop-shadow">{blk.label}</span>
                          <div className="flex items-center gap-1 shrink-0 bg-black/40 rounded px-1">
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
                              className="text-[10px] hover:text-red-300"
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
          <div className="border-t border-[#222833] pt-3 flex flex-wrap items-end gap-3 text-xs">
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
              className="flex items-center gap-1 px-3 py-1.5 rounded font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add to Timeline</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
