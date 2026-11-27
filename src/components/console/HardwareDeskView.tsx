import React, { useMemo, useState } from 'react';
import {
  EyeOff,
  Pause,
  Play,
  Power,
  ShieldAlert,
  SkipBack,
  SkipForward,
  Square,
  Zap,
} from 'lucide-react';
import { AudienceDevice, ConnectivityMode, EffectParameters, MediaAsset, NetworkInfo, ShowFile } from '../../shared/types';
import { EFFECT_CATALOG, createDefaultEffectParams, getDefaultPaletteForEffect } from '../../engine/effects';
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from '../../engine/colors';
import { RotaryEncoder, VerticalFader } from './HardwareControls';
import { LiveVisualiser } from './LiveVisualiser';
import { ColorPanel } from './ColorPanel';
import { EffectEditorPanel } from './EffectEditorPanel';
import { FixtureLayoutPanel } from './FixtureLayoutPanel';
import { CueTimelinePanel } from './CueTimelinePanel';
import { MediaPanel } from './MediaPanel';
import { JoinPosterStudio } from './JoinPosterStudio';
import { ShowsSettingsPanel } from './ShowsSettingsPanel';

export type DeskScreenTab =
  | 'stage'
  | 'colour'
  | 'effects'
  | 'fixtures'
  | 'cues'
  | 'media'
  | 'join'
  | 'shows';

interface HardwareDeskViewProps {
  show: ShowFile;
  showsList: ShowFile[];
  devices: AudienceDevice[];
  mediaAssets: MediaAsset[];
  networkInfo: NetworkInfo | null;
  serverOffsetMs: number;
  selectedDeviceIds: string[];
  onChangeSelectedDeviceIds: (ids: string[]) => void;
  onToggleSelectDevice: (id: string) => void;
  visualiserFullscreen: boolean;
  onToggleVisualiserFullscreen: () => void;
  onCommand: (action: string, payload?: Record<string, unknown>) => void;
  onCreateShow: (name: string) => Promise<ShowFile | null>;
  onRenameShow: (showId: string, name: string) => Promise<ShowFile | null>;
  onActivateShow: (showId: string) => Promise<void>;
  onDuplicateShow: (showId: string) => Promise<void>;
  onDeleteShow: (showId: string) => Promise<void>;
  onImportShow: (raw: unknown) => Promise<ShowFile | null>;
  onUploadMedia: (file: File) => Promise<{ ok: boolean; asset?: MediaAsset; error?: string }>;
  onDeleteMedia: (mediaId: string) => Promise<void>;
  onSetConnectivityMode: (mode: ConnectivityMode) => void;
}

const DESK_PALETTES = [
  { name: 'Cobalt', hex: '#0055FF' },
  { name: 'Crimson', hex: '#FF1E42' },
  { name: 'Emerald', hex: '#00E676' },
  { name: 'Amber', hex: '#FF9900' },
  { name: 'Cyan', hex: '#00E5FF' },
  { name: 'Violet', hex: '#A855F7' },
  { name: 'Magenta', hex: '#E11D48' },
  { name: 'Warm 3200K', hex: '#FFC58F' },
  { name: 'Daylight', hex: '#FFF4E8' },
  { name: 'Pure White', hex: '#FFFFFF' },
];

const DESK_QUICK_FX = [
  { type: 'wave_left_to_right', label: 'Cyan Wave' },
  { type: 'rainbow_wave', label: 'Rainbow Wave' },
  { type: 'colour_strobe', label: 'Strobe' },
  { type: 'flash_bouncing', label: 'Bounce Flash' },
  { type: 'aurora', label: 'Aurora' },
  { type: 'beat_flash', label: 'Beat Flash' },
] as const;

export const HardwareDeskView: React.FC<HardwareDeskViewProps> = ({
  show,
  showsList,
  devices,
  mediaAssets,
  networkInfo,
  serverOffsetMs,
  selectedDeviceIds,
  onChangeSelectedDeviceIds,
  onToggleSelectDevice,
  visualiserFullscreen,
  onToggleVisualiserFullscreen,
  onCommand,
  onCreateShow,
  onRenameShow,
  onActivateShow,
  onDuplicateShow,
  onDeleteShow,
  onImportShow,
  onUploadMedia,
  onDeleteMedia,
  onSetConnectivityMode,
}) => {
  const [screenTab, setScreenTab] = useState<DeskScreenTab>('stage');
  const [encoderBank, setEncoderBank] = useState<'fx' | 'colour'>('fx');
  const [gotoCueNum, setGotoCueNum] = useState('');
  const [savedGroupLevels, setSavedGroupLevels] = useState<Record<string, number>>({});

  const onlineCount = devices.filter((d) => d.status === 'connected').length;
  const activeCueIndex = show.playback.activeCueIndex;
  const activeCue =
    activeCueIndex >= 0 && activeCueIndex < show.cues.length ? show.cues[activeCueIndex] : null;
  const nextCue =
    show.cues.length > 0 ? show.cues[(Math.max(-1, activeCueIndex) + 1) % show.cues.length] : null;

  const primaryLayer = useMemo(() => {
    const enabled = show.lighting.layers.find((l) => l.enabled);
    if (enabled) return enabled;
    return (
      show.lighting.layers[0] || {
        id: 'layer-primary',
        name: 'Primary Effect',
        type: 'wave_left_to_right' as const,
        enabled: false,
        blendMode: 'normal' as const,
        opacity: 1,
        startedAtMs: Date.now() + serverOffsetMs,
        params: createDefaultEffectParams(),
      }
    );
  }, [show.lighting.layers, serverOffsetMs]);

  const activeFxLabel = useMemo(() => {
    const enabled = show.lighting.layers.filter((l) => l.enabled);
    if (enabled.length === 0) return 'Solid Base Look';
    return enabled
      .map((l) => EFFECT_CATALOG.find((fx) => fx.type === l.type)?.label || l.name || l.type)
      .join(' + ');
  }, [show.lighting.layers]);

  const baseRgb = hexToRgb(show.lighting.baseColor || '#0055FF');
  const baseHsv = rgbToHsv(baseRgb.r, baseRgb.g, baseRgb.b);

  const updatePrimaryFxParams = (patch: Partial<EffectParameters>) => {
    onCommand('upsert_effect_layer', {
      layer: {
        ...primaryLayer,
        enabled: true,
        params: { ...primaryLayer.params, ...patch },
      },
    });
  };

  const triggerQuickFx = (type: (typeof DESK_QUICK_FX)[number]['type'], label: string) => {
    onCommand('upsert_effect_layer', {
      layer: {
        id: primaryLayer.id || 'layer-primary',
        name: label,
        type,
        enabled: true,
        blendMode: 'normal',
        opacity: 1,
        startedAtMs: Date.now() + serverOffsetMs,
        params: createDefaultEffectParams({
          ...primaryLayer.params,
          speed: type === 'beat_flash' ? 1 : primaryLayer.params.speed,
          palette: getDefaultPaletteForEffect(type),
        }),
      },
    });
  };

  const toggleGroupMute = (groupId: string, currentVal: number) => {
    if (currentVal > 0) {
      setSavedGroupLevels((prev) => ({ ...prev, [groupId]: currentVal }));
      onCommand('update_group', { groupId, masterIntensity: 0 });
    } else {
      const restore = savedGroupLevels[groupId] || 100;
      onCommand('update_group', { groupId, masterIntensity: restore });
    }
  };

  const screenTabs: Array<{ id: DeskScreenTab; label: string }> = [
    { id: 'stage', label: 'Live Stage' },
    { id: 'colour', label: 'Colour' },
    { id: 'effects', label: 'Effects' },
    { id: 'fixtures', label: 'Fixtures' },
    { id: 'cues', label: 'Cue Stack' },
    { id: 'media', label: 'Media' },
    { id: 'join', label: 'QR Join' },
    { id: 'shows', label: 'Shows' },
  ];

  const groupsBank = show.groups.slice(0, 4);
  const cuesBank = show.cues.slice(0, 4);

  return (
    <div
      data-testid="hardware-console-desk"
      className="flex-1 p-2 sm:p-2.5 overflow-y-auto flex flex-col items-center"
    >
      {/* Physical Anodized Console Chassis */}
      <div className="w-full max-w-[1600px] desk-chassis rounded-xl overflow-hidden flex flex-col">
        {/* Top Console Bezel Bar */}
        <div className="px-3.5 py-1.5 bg-[#0B0E14] border-b border-[#222938] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="font-display text-xs font-bold tracking-[0.2em] uppercase text-slate-300">
              Hardware Console Desk
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="text-xs font-mono-tabular text-amber-300 truncate">
              {show.name}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono-tabular text-slate-400">
            <span>
              Base <strong className="text-slate-100">{show.lighting.baseColor.toUpperCase()}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Master <strong className="text-amber-300">{show.lighting.masterIntensity}%</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Online <strong className="text-emerald-400">{onlineCount}</strong>/{devices.length}
            </span>
          </div>
        </div>

        {/* UPPER SECTION: Dual Recessed TFT Touchscreens */}
        <div className="p-2.5 sm:p-3 grid grid-cols-1 xl:grid-cols-12 gap-2.5 bg-[#090C11]">
          {/* Primary Left/Center Desk Touchscreen */}
          <div className="xl:col-span-8 desk-tft-bezel rounded-lg flex flex-col overflow-hidden min-h-[270px]">
            {/* Internal TFT Screen Softkey Tabs */}
            <div className="px-2.5 py-1 bg-[#0C1018] border-b border-[#1E2534] flex items-center justify-between gap-2 overflow-x-auto">
              <div className="flex items-center gap-1">
                {screenTabs.map((t) => {
                  const isActive = screenTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setScreenTab(t.id)}
                      className={`px-2.5 py-1 rounded text-[11px] whitespace-nowrap shrink-0 transition-colors ${
                        isActive
                          ? 'bg-amber-500 text-slate-950 font-semibold'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-[#161C28]'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <span className="text-[10px] font-mono-tabular text-slate-500 whitespace-nowrap shrink-0 hidden sm:inline">
                {activeFxLabel}
              </span>
            </div>

            {/* Active Touchscreen Viewport */}
            <div className="p-2.5 flex-1 overflow-y-auto max-h-[340px]">
              {screenTab === 'stage' && (
                <LiveVisualiser
                  devices={devices}
                  groups={show.groups}
                  lighting={show.lighting}
                  serverOffsetMs={serverOffsetMs}
                  selectedDeviceIds={selectedDeviceIds}
                  onToggleSelectDevice={onToggleSelectDevice}
                  fullscreenOpen={visualiserFullscreen}
                  onToggleFullscreen={onToggleVisualiserFullscreen}
                />
              )}
              {screenTab === 'colour' && (
                <ColorPanel
                  show={show}
                  devices={devices}
                  selectedDeviceIds={selectedDeviceIds}
                  onCommand={onCommand}
                />
              )}
              {screenTab === 'effects' && (
                <EffectEditorPanel
                  show={show}
                  devices={devices}
                  serverOffsetMs={serverOffsetMs}
                  onCommand={onCommand}
                />
              )}
              {screenTab === 'fixtures' && (
                <FixtureLayoutPanel
                  show={show}
                  devices={devices}
                  serverOffsetMs={serverOffsetMs}
                  selectedDeviceIds={selectedDeviceIds}
                  onChangeSelectedDeviceIds={onChangeSelectedDeviceIds}
                  onCommand={onCommand}
                />
              )}
              {screenTab === 'cues' && (
                <CueTimelinePanel
                  show={show}
                  devices={devices}
                  mediaAssets={mediaAssets}
                  serverOffsetMs={serverOffsetMs}
                  onCommand={onCommand}
                />
              )}
              {screenTab === 'media' && (
                <MediaPanel
                  show={show}
                  devices={devices}
                  mediaAssets={mediaAssets}
                  selectedDeviceIds={selectedDeviceIds}
                  onUploadMedia={onUploadMedia}
                  onDeleteMedia={onDeleteMedia}
                  onCommand={onCommand}
                />
              )}
              {screenTab === 'join' && (
                <JoinPosterStudio
                  show={show}
                  networkInfo={networkInfo}
                  onSetConnectivityMode={onSetConnectivityMode}
                  onCommand={onCommand}
                />
              )}
              {screenTab === 'shows' && (
                <ShowsSettingsPanel
                  activeShow={show}
                  showsList={showsList}
                  onCreateShow={onCreateShow}
                  onRenameShow={onRenameShow}
                  onActivateShow={onActivateShow}
                  onDuplicateShow={onDuplicateShow}
                  onDeleteShow={onDeleteShow}
                  onImportShow={onImportShow}
                  onCommand={onCommand}
                />
              )}
            </div>
          </div>

          {/* Right Auxiliary TFT Screen: Command Readout, Quick Palettes & Mini Cue Monitor */}
          <div className="xl:col-span-4 desk-tft-bezel rounded-lg p-3 flex flex-col justify-between gap-3">
            {/* Live Command Line & Output Summary */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono-tabular">
                <span className="text-slate-400 uppercase tracking-wider">Command Readout</span>
                <span
                  className={
                    show.lighting.blackout
                      ? 'text-red-400 font-semibold'
                      : show.lighting.freeze
                        ? 'text-sky-400 font-semibold'
                        : 'text-emerald-400 font-semibold'
                  }
                >
                  {show.lighting.blackout
                    ? 'BLACKOUT'
                    : show.lighting.freeze
                      ? 'FROZEN'
                      : show.lighting.emergencyNeutral
                        ? 'NEUTRAL'
                        : 'LIVE'}
                </span>
              </div>
              <div className="bg-[#040508] border border-[#1E2534] rounded px-3 py-2 font-mono-tabular text-xs text-amber-300 flex items-center justify-between gap-2">
                <span className="truncate">
                  {activeCue
                    ? `CUE ${String(activeCue.cueNumber).padStart(2, '0')} · ${activeCue.name}`
                    : `BASE ${show.lighting.baseColor.toUpperCase()} @ ${show.lighting.masterIntensity}%`}
                </span>
                <span
                  className="w-3.5 h-3.5 rounded-xs border border-white/20 shrink-0"
                  style={{
                    backgroundColor: show.lighting.blackout ? '#000000' : show.lighting.baseColor,
                  }}
                />
              </div>
              {nextCue && (
                <div className="text-[11px] font-mono-tabular text-slate-400 flex items-center justify-between px-1">
                  <span>Next in Stack</span>
                  <span className="text-slate-200 truncate max-w-[200px]">
                    {String(nextCue.cueNumber).padStart(2, '0')} · {nextCue.name}
                  </span>
                </div>
              )}
            </div>

            {/* Direct Colour Palette Matrix (Softkey Bank) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-display uppercase tracking-wider text-slate-400">
                <span>Colour Palette Softkeys</span>
                <span className="font-mono-tabular text-slate-500">All Fixtures</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {DESK_PALETTES.map((pal) => {
                  const isCur =
                    show.lighting.baseColor.toUpperCase() === pal.hex.toUpperCase() &&
                    !show.lighting.layers.some((l) => l.enabled);
                  return (
                    <button
                      key={pal.name}
                      type="button"
                      onClick={() =>
                        onCommand('set_base_color', {
                          color: pal.hex,
                          transitionMs: 300,
                          clearNormalEffects: true,
                        })
                      }
                      className={`console-btn p-1.5 rounded flex flex-col items-center gap-1 ${
                        isCur ? 'border-amber-400 ring-1 ring-amber-400/50' : ''
                      }`}
                      title={`Project ${pal.name} (${pal.hex})`}
                    >
                      <span
                        className="w-full h-3 rounded-xs border border-black/40"
                        style={{ backgroundColor: pal.hex }}
                      />
                      <span className="text-[10px] text-slate-300 truncate w-full text-center">
                        {pal.name.split(' ')[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Instant Effect Palette Keys */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-display uppercase tracking-wider text-slate-400">
                <span>Effect Triggers</span>
                <button
                  type="button"
                  onClick={() => onCommand('stop_all_effects')}
                  className="text-[10px] font-mono-tabular text-slate-400 hover:text-amber-300"
                >
                  Clear FX
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {DESK_QUICK_FX.map((fx) => {
                  const isOn = primaryLayer.enabled && primaryLayer.type === fx.type;
                  return (
                    <button
                      key={fx.type}
                      type="button"
                      onClick={() => triggerQuickFx(fx.type, fx.label)}
                      className={`px-2 py-1.5 rounded text-[11px] font-medium truncate ${
                        isOn ? 'console-btn-amber font-semibold' : 'console-btn text-slate-200'
                      }`}
                    >
                      {fx.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Hardware Encoder Attribute Bank */}
            <div className="bg-[#06080C] border border-[#1E2534] rounded-md p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-display uppercase tracking-wider text-slate-400">
                  Rotary Encoders
                </span>
                <div className="flex items-center gap-1 bg-[#0D1017] p-0.5 rounded border border-[#1F2736]">
                  <button
                    type="button"
                    onClick={() => setEncoderBank('fx')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      encoderBank === 'fx'
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Effects
                  </button>
                  <button
                    type="button"
                    onClick={() => setEncoderBank('colour')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      encoderBank === 'colour'
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Colour HSV
                  </button>
                </div>
              </div>

              {encoderBank === 'fx' ? (
                <div className="grid grid-cols-4 gap-2 pt-1">
                  <RotaryEncoder
                    label="Speed"
                    value={primaryLayer.params.speed}
                    min={0.1}
                    max={10}
                    step={0.1}
                    unit="x"
                    onChange={(val) => updatePrimaryFxParams({ speed: val })}
                  />
                  <RotaryEncoder
                    label="Size"
                    value={primaryLayer.params.size}
                    min={5}
                    max={100}
                    step={5}
                    unit="%"
                    onChange={(val) => updatePrimaryFxParams({ size: val })}
                  />
                  <RotaryEncoder
                    label="Width"
                    value={primaryLayer.params.width}
                    min={5}
                    max={100}
                    step={5}
                    unit="%"
                    onChange={(val) => updatePrimaryFxParams({ width: val })}
                  />
                  <RotaryEncoder
                    label="Density"
                    value={primaryLayer.params.density}
                    min={5}
                    max={100}
                    step={5}
                    unit="%"
                    onChange={(val) => updatePrimaryFxParams({ density: val })}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2 pt-1">
                  <RotaryEncoder
                    label="Hue"
                    value={baseHsv.h}
                    min={0}
                    max={360}
                    step={5}
                    unit="°"
                    onChange={(val) => {
                      const next = hsvToRgb(val, baseHsv.s, baseHsv.v || 100);
                      onCommand('set_base_color', {
                        color: rgbToHex(next.r, next.g, next.b),
                        transitionMs: 0,
                        clearNormalEffects: true,
                      });
                    }}
                  />
                  <RotaryEncoder
                    label="Sat"
                    value={baseHsv.s}
                    min={0}
                    max={100}
                    step={5}
                    unit="%"
                    onChange={(val) => {
                      const next = hsvToRgb(baseHsv.h, val, baseHsv.v || 100);
                      onCommand('set_base_color', {
                        color: rgbToHex(next.r, next.g, next.b),
                        transitionMs: 0,
                        clearNormalEffects: true,
                      });
                    }}
                  />
                  <RotaryEncoder
                    label="Value"
                    value={baseHsv.v}
                    min={0}
                    max={100}
                    step={5}
                    unit="%"
                    onChange={(val) => {
                      const next = hsvToRgb(baseHsv.h, baseHsv.s, val);
                      onCommand('set_base_color', {
                        color: rgbToHex(next.r, next.g, next.b),
                        transitionMs: 0,
                        clearNormalEffects: true,
                      });
                    }}
                  />
                  <RotaryEncoder
                    label="Dimmer"
                    value={show.lighting.masterIntensity}
                    min={0}
                    max={100}
                    step={5}
                    unit="%"
                    onChange={(val) => onCommand('set_master_intensity', { intensity: val })}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* LOWER SECTION: Physical Tactile Console Control Surface */}
        <div className="desk-surface-deck p-2.5 sm:p-3 grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
          {/* Left 8 Executor Strips (4 Group Faders + 4 Cue Executors) */}
          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
            {/* Strips 1-4: Group Dimmer Faders */}
            {groupsBank.map((grp, idx) => (
              <div
                key={grp.id}
                className="desk-strip-well rounded-lg p-1.5 flex flex-col items-center justify-between gap-1.5"
              >
                <div className="w-full flex items-center justify-between text-[10px] font-mono-tabular text-slate-500 px-0.5">
                  <span>CH {idx + 1}</span>
                  <span
                    className="w-2 h-2 rounded-xs"
                    style={{ backgroundColor: grp.color }}
                  />
                </div>

                <VerticalFader
                  label={grp.name.slice(0, 10)}
                  value={grp.masterIntensity}
                  accentColor={grp.color}
                  heightClass="h-24"
                  onChange={(val) =>
                    onCommand('update_group', { groupId: grp.id, masterIntensity: val })
                  }
                />

                <div className="w-full grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      onCommand('update_group', { groupId: grp.id, masterIntensity: 100 })
                    }
                    className="console-btn py-1 rounded text-[10px] font-semibold text-amber-300"
                    title={`Full 100% on ${grp.name}`}
                  >
                    FULL
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleGroupMute(grp.id, grp.masterIntensity)}
                    className={`py-1 rounded text-[10px] font-semibold ${
                      grp.masterIntensity === 0
                        ? 'console-btn-danger'
                        : 'console-btn text-slate-300'
                    }`}
                    title={`Mute / Restore ${grp.name}`}
                  >
                    {grp.masterIntensity === 0 ? 'OFF' : 'MUTE'}
                  </button>
                </div>
              </div>
            ))}

            {/* Strips 5-8: Live Cue Playback Executors */}
            {cuesBank.map((cue, idx) => {
              const isActive = show.playback.activeCueId === cue.id;
              return (
                <div
                  key={cue.id}
                  className={`desk-strip-well rounded-lg p-2 flex flex-col items-center justify-between gap-2 ${
                    isActive ? 'border-emerald-500/60' : ''
                  }`}
                >
                  <div className="w-full flex items-center justify-between text-[10px] font-mono-tabular text-slate-500 px-0.5">
                    <span>EX {idx + 1}</span>
                    <span
                      className="w-2.5 h-2 rounded-xs border border-black/40"
                      style={{ backgroundColor: cue.colour }}
                    />
                  </div>

                  <div className="w-full flex-1 flex flex-col items-center justify-between gap-1.5">
                    <div className="w-full bg-[#05070A] border border-[#1E2533] rounded px-1.5 py-1.5 text-center">
                      <div className="text-[10px] font-mono-tabular text-amber-300">
                        CUE {String(cue.cueNumber).padStart(2, '0')}
                      </div>
                      <div className="text-[10px] text-slate-200 font-medium truncate mt-0.5">
                        {cue.name}
                      </div>
                    </div>

                    <div className="text-[10px] font-mono-tabular text-slate-400">
                      {cue.intensity}% · {(cue.fadeInMs / 1000).toFixed(1)}s
                    </div>

                    <button
                      type="button"
                      onClick={() => onCommand('cue_go', { cueIndex: idx })}
                      className={`w-full py-2 rounded text-[11px] font-bold tracking-wider flex items-center justify-center gap-1 ${
                        isActive ? 'console-btn-emerald' : 'console-btn text-slate-200'
                      }`}
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>{isActive ? 'ACTIVE' : 'GO'}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onCommand('identify_devices', {
                        deviceIds: devices.map((d) => d.id),
                      })
                    }
                    className="w-full console-btn py-1 rounded text-[10px] font-medium text-slate-300 flex items-center justify-center gap-1"
                    title="Flash Identify Pulse"
                  >
                    <Zap className="w-2.5 h-2.5 text-amber-400" />
                    <span>FLASH</span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Right 4 Columns: Grand Master Fader + Hardware Transport + Safety Guarded Keys */}
          <div className="lg:col-span-4 desk-strip-well rounded-lg p-2.5 flex flex-col sm:flex-row items-stretch gap-2.5">
            {/* Grand Master Fader */}
            <div className="flex items-center justify-center px-2 border-b sm:border-b-0 sm:border-r border-[#1E2534] pb-2 sm:pb-0 sm:pr-2.5">
              <VerticalFader
                label="GRAND MASTER"
                testId="desk-grand-master"
                value={show.lighting.masterIntensity}
                accentColor="#F59E0B"
                heightClass="h-28"
                onChange={(val) => onCommand('set_master_intensity', { intensity: val })}
              />
            </div>

            {/* Transport & Safety Keys Matrix */}
            <div className="flex-1 flex flex-col justify-between gap-2.5">
              {/* Top Row: Guarded Blackout & Safety Keys */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    onCommand('set_blackout', { blackout: !show.lighting.blackout })
                  }
                  className={`py-2 px-2 rounded text-xs font-bold tracking-wider flex items-center justify-center gap-1.5 ${
                    show.lighting.blackout
                      ? 'console-btn-danger'
                      : 'console-btn text-red-400 hover:border-red-500/60'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{show.lighting.blackout ? 'DBO ON' : 'BLACKOUT'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onCommand('set_freeze', { freeze: !show.lighting.freeze })}
                  className={`py-2 px-2 rounded text-xs font-semibold flex items-center justify-center gap-1.5 ${
                    show.lighting.freeze ? 'console-btn-sky' : 'console-btn text-slate-200'
                  }`}
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>{show.lighting.freeze ? 'FROZEN' : 'FREEZE'}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onCommand('set_emergency_neutral', {
                      emergencyNeutral: !show.lighting.emergencyNeutral,
                    })
                  }
                  className={`py-1.5 px-2 rounded text-[11px] font-semibold flex items-center justify-center gap-1 ${
                    show.lighting.emergencyNeutral
                      ? 'console-btn-amber'
                      : 'console-btn text-amber-300'
                  }`}
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>NEUTRAL</span>
                </button>

                <button
                  type="button"
                  onClick={() => onCommand('release_all')}
                  className="console-btn py-1.5 px-2 rounded text-[11px] font-semibold text-slate-200 flex items-center justify-center gap-1"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>RELEASE</span>
                </button>
              </div>

              {/* Cue Go-To Keypad */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const num = Number(gotoCueNum);
                  if (num > 0) {
                    onCommand('cue_goto', { cueNumber: num });
                    setGotoCueNum('');
                  }
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  type="number"
                  aria-label="Desk Go To Cue"
                  placeholder="Cue #"
                  value={gotoCueNum}
                  onChange={(e) => setGotoCueNum(e.target.value)}
                  className="flex-1 min-w-0 console-well rounded px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  className="console-btn px-3 py-1.5 rounded text-xs font-semibold text-slate-200 whitespace-nowrap"
                >
                  GOTO
                </button>
              </form>

              {/* Master Cue Playback Transport */}
              <div className="space-y-1.5">
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onCommand('cue_back')}
                    className="console-btn py-1.5 rounded text-xs font-semibold text-slate-200 flex items-center justify-center gap-1"
                  >
                    <SkipBack className="w-3.5 h-3.5" />
                    <span>BACK</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onCommand('cue_stop')}
                    className="console-btn py-1.5 rounded text-xs font-semibold text-red-300 flex items-center justify-center gap-1"
                  >
                    <Square className="w-3 h-3" />
                    <span>STOP</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onCommand('cue_next')}
                    className="console-btn py-1.5 rounded text-xs font-semibold text-slate-200 flex items-center justify-center gap-1"
                  >
                    <span>NEXT</span>
                    <SkipForward className="w-3.5 h-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onCommand('cue_go')}
                  className="w-full py-2.5 rounded font-display text-base font-bold tracking-[0.2em] uppercase console-btn-emerald flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>MASTER GO+</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
