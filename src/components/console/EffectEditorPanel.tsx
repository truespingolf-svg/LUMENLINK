import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Mic, MicOff, Palette, Plus, RotateCcw, Trash2, Unlock, Zap } from 'lucide-react';
import {
  ActiveEffectLayer,
  AudienceDevice,
  EffectCategory,
  EffectParameters,
  EffectType,
  ShowFile,
} from '../../shared/types';
import {
  createDefaultEffectParams,
  EFFECT_CATALOG,
  getDefaultPaletteForEffect,
} from '../../engine/effects';
import { RotaryEncoder } from './HardwareControls';
import { EffectStagePreview } from './EffectStagePreview';
import { BeatSequencerControls } from './BeatSequencerControls';

interface EffectEditorPanelProps {
  show: ShowFile;
  devices: AudienceDevice[];
  serverOffsetMs: number;
  onCommand: (action: string, payload?: Record<string, unknown>) => void;
}

function normalizeHexInput(hex: string): string {
  const cleaned = (hex || '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(cleaned)) return cleaned.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(cleaned)) {
    return `#${cleaned[1]}${cleaned[1]}${cleaned[2]}${cleaned[2]}${cleaned[3]}${cleaned[3]}`.toUpperCase();
  }
  return '#0066FF';
}

const HexPaletteInput: React.FC<{
  ariaLabel: string;
  value: string;
  onValidChange: (hex: string) => void;
}> = ({ ariaLabel, value, onValidChange }) => {
  const [draft, setDraft] = useState(value.toUpperCase());
  useEffect(() => {
    setDraft(value.toUpperCase());
  }, [value]);
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => {
        const v = e.target.value.toUpperCase();
        setDraft(v);
        if (/^#[0-9A-F]{6}$/.test(v)) {
          onValidChange(v);
        }
      }}
      onBlur={() => {
        const fixed = normalizeHexInput(draft);
        setDraft(fixed);
        if (fixed !== value.toUpperCase()) {
          onValidChange(fixed);
        }
      }}
      className="w-[68px] bg-transparent font-mono-tabular text-[11px] text-slate-200 focus:outline-none border-b border-transparent focus:border-amber-400"
    />
  );
};

export const EffectEditorPanel: React.FC<EffectEditorPanelProps> = ({
  show,
  devices,
  serverOffsetMs,
  onCommand,
}) => {
  const [category, setCategory] = useState<EffectCategory>('movement');
  const layers = show.lighting.layers;
  const [selectedLayerId, setSelectedLayerId] = useState<string>(
    layers[0]?.id || 'layer-primary',
  );
  const [lockCustomPalette, setLockCustomPalette] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const micStopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (layers.length > 0 && !layers.some((l) => l.id === selectedLayerId)) {
      setSelectedLayerId(layers[0].id);
    }
  }, [layers, selectedLayerId]);

  const activeLayer: ActiveEffectLayer = useMemo(() => {
    const found = layers.find((l) => l.id === selectedLayerId) || layers[0];
    if (found) return found;
    return {
      id: 'layer-primary',
      name: 'Primary Effect',
      type: 'wave_left_to_right',
      enabled: false,
      blendMode: 'normal',
      opacity: 1,
      startedAtMs: Date.now() + serverOffsetMs,
      params: createDefaultEffectParams(),
    };
  }, [layers, selectedLayerId, serverOffsetMs]);

  const filteredEffects = useMemo(
    () => EFFECT_CATALOG.filter((e) => e.category === category),
    [category],
  );

  const previewLighting = useMemo(
    () => ({
      ...show.lighting,
      layers: activeLayer.enabled ? show.lighting.layers : [{ ...activeLayer, enabled: true }],
    }),
    [activeLayer, show.lighting],
  );

  // Microphone audio level capture for sound_reactive effect
  useEffect(() => {
    return () => {
      if (micStopRef.current) micStopRef.current();
    };
  }, []);

  const toggleMic = async () => {
    if (micActive) {
      if (micStopRef.current) micStopRef.current();
      micStopRef.current = null;
      setMicActive(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      setMicActive(true);

      const timer = window.setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / Math.max(1, data.length);
        const level = Math.min(1, Number((avg / 140).toFixed(2)));
        updateParams({ audioLevel: level });
      }, 120);

      micStopRef.current = () => {
        window.clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
      };
    } catch {
      setMicActive(false);
    }
  };

  const pushLayer = (next: ActiveEffectLayer) => {
    onCommand('upsert_effect_layer', { layer: next });
  };

  const isPrimaryOrSoleLayer = layers.length <= 1 || activeLayer.id === layers[0]?.id;

  const disableMaskingNormalLayersAbove = () => {
    const activeIdx = layers.findIndex((l) => l.id === activeLayer.id);
    if (activeIdx < 0) return;
    for (let i = activeIdx + 1; i < layers.length; i++) {
      const upper = layers[i];
      if (upper.enabled && upper.blendMode === 'normal') {
        pushLayer({ ...upper, enabled: false });
      }
    }
  };

  const updateParams = (patch: Partial<EffectParameters>) => {
    disableMaskingNormalLayersAbove();
    pushLayer({
      ...activeLayer,
      enabled: true,
      blendMode:
        patch.palette && isPrimaryOrSoleLayer && activeLayer.blendMode !== 'normal'
          ? 'normal'
          : activeLayer.blendMode,
      params: { ...activeLayer.params, ...patch },
    });
  };

  const selectEffectType = (type: EffectType, label: string) => {
    setSelectedLayerId(activeLayer.id);
    disableMaskingNormalLayersAbove();
    const nextPalette = lockCustomPalette
      ? activeLayer.params.palette
      : getDefaultPaletteForEffect(type);
    pushLayer({
      ...activeLayer,
      name: label,
      type,
      enabled: true,
      blendMode: isPrimaryOrSoleLayer ? 'normal' : activeLayer.blendMode,
      opacity: 1,
      startedAtMs: Date.now() + serverOffsetMs,
      params: {
        ...activeLayer.params,
        speed: type === 'beat_flash' ? 1 : activeLayer.params.speed,
        repetitions: 0,
        delayMs: 0,
        fixtureRangeStart: 1,
        fixtureRangeEnd: 0,
        palette: nextPalette,
      },
    });
  };

  const addLayer = () => {
    const id = `layer-${Math.random().toString(36).slice(2, 7)}`;
    const hasRunningLayer = layers.some((l) => l.enabled);
    const defaultType: EffectType = hasRunningLayer ? 'flash_bouncing' : 'wave_left_to_right';
    const fresh: ActiveEffectLayer = {
      id,
      name: `Layer ${layers.length + 1}`,
      type: defaultType,
      enabled: true,
      blendMode: hasRunningLayer ? 'add' : 'normal',
      opacity: 1,
      startedAtMs: Date.now() + serverOffsetMs,
      params: createDefaultEffectParams({ palette: getDefaultPaletteForEffect(defaultType) }),
    };
    pushLayer(fresh);
    setSelectedLayerId(id);
  };

  const p = activeLayer.params;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      {/* Left: Effect Library & Layer Stack */}
      <div className="xl:col-span-5 flex flex-col gap-4">
        {/* Layer Stack */}
        <div className="console-panel rounded-md p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
              Active Effect Layers
            </h3>
            <button
              type="button"
              onClick={addLayer}
              className="console-btn flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-amber-400"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Layer</span>
            </button>
          </div>
          <div className="space-y-1.5">
            {layers.map((layer) => (
              <div
                key={layer.id}
                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border text-xs ${
                  layer.id === activeLayer.id
                    ? 'border-amber-500/80 bg-amber-500/10 shadow-[inset_0_1px_0_rgba(245,158,11,0.18)]'
                    : 'console-well'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedLayerId(layer.id)}
                  className="flex-1 text-left font-medium text-slate-200 truncate"
                >
                  {layer.name}
                </button>
                <select
                  aria-label={`Blend mode for ${layer.name}`}
                  value={layer.blendMode}
                  onChange={(e) =>
                    pushLayer({
                      ...layer,
                      blendMode: e.target.value as ActiveEffectLayer['blendMode'],
                    })
                  }
                  className="console-well rounded px-1.5 py-0.5 text-[11px] text-slate-300"
                >
                  <option value="normal">Normal</option>
                  <option value="add">Add</option>
                  <option value="screen">Screen</option>
                  <option value="multiply">Multiply</option>
                </select>
                <button
                  type="button"
                  onClick={() => pushLayer({ ...layer, enabled: !layer.enabled })}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                    layer.enabled
                      ? 'console-btn-emerald'
                      : 'console-btn text-slate-400'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      layer.enabled ? 'bg-white shadow-[0_0_5px_#fff]' : 'bg-slate-600'
                    }`}
                  />
                  <span>{layer.enabled ? 'RUN' : 'OFF'}</span>
                </button>
                {layers.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove ${layer.name}`}
                    onClick={() => onCommand('remove_effect_layer', { layerId: layer.id })}
                    className="text-slate-500 hover:text-red-400 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Effect Catalog */}
        <div className="console-panel rounded-md p-3 flex-1">
          <div className="flex items-center gap-1.5 mb-3 border-b border-[#222833] pb-2">
            {(['colour', 'movement', 'flash', 'advanced'] as EffectCategory[]).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 rounded text-xs capitalize ${
                  category === cat
                    ? 'console-btn-amber font-semibold'
                    : 'console-btn text-slate-300 font-medium'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 max-h-[340px] overflow-y-auto pr-1">
            {filteredEffects.map((fx) => {
              const isSelected = activeLayer.type === fx.type && activeLayer.enabled;
              return (
                <button
                  key={fx.type}
                  type="button"
                  onClick={() => selectEffectType(fx.type, fx.label)}
                  className={`text-left p-2.5 rounded border ${
                    isSelected
                      ? 'border-amber-400 bg-gradient-to-b from-amber-500/20 to-amber-500/5 text-amber-100 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                      : 'console-btn text-slate-200'
                  }`}
                >
                  <div className="text-xs font-semibold flex items-center justify-between gap-1">
                    <span className="truncate">{fx.label}</span>
                    {isSelected && <Zap className="w-3 h-3 text-amber-400 shrink-0" />}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{fx.description}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right: Effect Parameters + Live Preview */}
      <div className="xl:col-span-7 flex flex-col gap-4">
        {/* Live Effect Preview */}
        <EffectStagePreview
          title={`Live Effect Preview — ${activeLayer.name}`}
          devices={devices}
          groups={show.groups}
          lighting={previewLighting}
          serverOffsetMs={serverOffsetMs}
          isLiveRunning={activeLayer.enabled}
          onEnableLive={() => pushLayer({ ...activeLayer, enabled: true })}
        />

        {/* Effect Colours & Palette (Prominent per-effect colour adjuster) */}
        <div className="console-panel rounded-md p-3.5 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-amber-400" />
              <h4 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
                Effect Colours — {activeLayer.name}
              </h4>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLockCustomPalette((v) => !v)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium ${
                  lockCustomPalette
                    ? 'console-btn-amber font-semibold'
                    : 'console-btn text-slate-300'
                }`}
                title="Keep your chosen colours when switching between effects"
              >
                {lockCustomPalette ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                <span>{lockCustomPalette ? 'Colours Locked' : 'Lock Colours'}</span>
              </button>
              <button
                type="button"
                onClick={() => updateParams({ palette: getDefaultPaletteForEffect(activeLayer.type) })}
                className="console-btn flex items-center gap-1 px-2.5 py-1 rounded text-slate-300 hover:text-white text-[11px]"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Default</span>
              </button>
            </div>
          </div>

          {activeLayer.blendMode !== 'normal' && (
            <div className="flex items-center justify-between gap-2 bg-amber-950/40 border border-amber-500/40 rounded px-2.5 py-1.5 text-[11px] text-amber-200">
              <span>
                Blend mode is <strong>{activeLayer.blendMode}</strong> — mixing with base colour{' '}
                <code className="font-mono-tabular">{show.lighting.baseColor}</code>.
              </span>
              <button
                type="button"
                onClick={() => pushLayer({ ...activeLayer, enabled: true, blendMode: 'normal' })}
                className="console-btn-amber px-2 py-0.5 rounded font-semibold shrink-0"
              >
                Use Normal Blend
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            {p.palette.map((c, idx) => {
              const safeHex = normalizeHexInput(c);
              return (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 console-well rounded px-2 py-1"
                >
                  <span className="text-[10px] text-slate-400 font-medium">
                    {idx === 0 ? 'Primary' : idx === 1 ? 'Secondary' : `Stop ${idx + 1}`}
                  </span>
                  <input
                    type="color"
                    aria-label={`Effect Colour ${idx + 1}`}
                    value={safeHex}
                    onChange={(e) => {
                      const next = [...p.palette];
                      next[idx] = e.target.value.toUpperCase();
                      updateParams({ palette: next });
                    }}
                    className="w-6 h-6 rounded bg-transparent border border-[#2B3342] cursor-pointer"
                  />
                  <HexPaletteInput
                    ariaLabel={`Effect Colour ${idx + 1} HEX`}
                    value={c}
                    onValidChange={(hex) => {
                      const next = [...p.palette];
                      next[idx] = hex;
                      updateParams({ palette: next });
                    }}
                  />
                  {p.palette.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove Effect Colour ${idx + 1}`}
                      onClick={() => updateParams({ palette: p.palette.filter((_, i) => i !== idx) })}
                      className="text-slate-500 hover:text-red-400 pl-0.5"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            {p.palette.length < 6 && (
              <button
                type="button"
                onClick={() => updateParams({ palette: [...p.palette, '#FFFFFF'] })}
                className="console-btn px-2.5 py-1.5 rounded text-xs text-slate-200"
              >
                + Add Colour
              </button>
            )}
          </div>

          {/* Quick Primary & Quick Secondary Colour Swatches */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400 mr-0.5">Quick Primary:</span>
              {show.savedColors.slice(0, 8).map((hex) => (
                <button
                  key={`pri-${hex}`}
                  type="button"
                  aria-label={`Set effect primary colour ${hex}`}
                  onClick={() => {
                    const next = p.palette.length > 0 ? [hex.toUpperCase(), ...p.palette.slice(1)] : [hex.toUpperCase()];
                    updateParams({ palette: next });
                  }}
                  className="w-5 h-5 rounded border border-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] hover:scale-110 transition-transform"
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400 mr-0.5">Quick Secondary:</span>
              {['#000000', ...show.savedColors.slice(0, 6)].map((hex) => (
                <button
                  key={`sec-${hex}`}
                  type="button"
                  aria-label={`Set effect secondary colour ${hex}`}
                  onClick={() => {
                    const base = p.palette.length > 0 ? [...p.palette] : ['#0066FF'];
                    base[1] = hex.toUpperCase();
                    updateParams({ palette: base });
                  }}
                  className="w-5 h-5 rounded border border-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] hover:scale-110 transition-transform"
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Beat Step Sequencer (when Beat Step Flash is active) */}
        {activeLayer.type === 'beat_flash' && (
          <BeatSequencerControls
            params={p}
            startedAtMs={activeLayer.startedAtMs}
            serverOffsetMs={serverOffsetMs}
            onChange={(patch) => updateParams(patch)}
          />
        )}

        {/* Parameters */}
        <div className="console-panel rounded-md p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#222833] pb-4">
            <RotaryEncoder
              label="Speed"
              value={p.speed}
              min={0.1}
              max={10}
              step={0.1}
              unit="x"
              onChange={(val) => updateParams({ speed: val })}
            />
            <RotaryEncoder
              label="Intensity"
              value={p.intensity}
              min={0}
              max={100}
              step={5}
              unit="%"
              onChange={(val) => updateParams({ intensity: val })}
            />
            <RotaryEncoder
              label="Size"
              value={p.size}
              min={5}
              max={100}
              step={5}
              unit="%"
              onChange={(val) => updateParams({ size: val })}
            />
            <RotaryEncoder
              label="Width"
              value={p.width}
              min={5}
              max={100}
              step={5}
              unit="%"
              onChange={(val) => updateParams({ width: val })}
            />
            <RotaryEncoder
              label="Spread"
              value={p.spread}
              min={5}
              max={100}
              step={5}
              unit="%"
              onChange={(val) => updateParams({ spread: val })}
            />
            <RotaryEncoder
              label="Density"
              value={p.density}
              min={5}
              max={100}
              step={5}
              unit="%"
              onChange={(val) => updateParams({ density: val })}
            />
            <RotaryEncoder
              label="Frequency"
              value={p.frequency}
              min={0.2}
              max={20}
              step={0.2}
              unit="Hz"
              onChange={(val) => updateParams({ frequency: val })}
            />
            <RotaryEncoder
              label="Phase"
              value={p.phaseDeg}
              min={0}
              max={360}
              step={15}
              unit="°"
              onChange={(val) => updateParams({ phaseDeg: val })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <label className="flex flex-col gap-1 text-slate-300">
              <span>Direction</span>
              <select
                value={p.direction}
                onChange={(e) =>
                  updateParams({ direction: e.target.value as EffectParameters['direction'] })
                }
                className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 text-slate-100"
              >
                <option value="forward">Forward</option>
                <option value="reverse">Reverse</option>
                <option value="pingpong">Ping-Pong</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-slate-300">
              <span>Target Group</span>
              <select
                value={p.targetGroupId}
                onChange={(e) => updateParams({ targetGroupId: e.target.value })}
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
              <span>Sync Mode</span>
              <select
                value={p.syncMode}
                onChange={(e) =>
                  updateParams({ syncMode: e.target.value as EffectParameters['syncMode'] })
                }
                className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 text-slate-100"
              >
                <option value="global_clock">Global Clock Sync</option>
                <option value="phase_locked">Phase Locked</option>
                <option value="free_run">Free Run (Offset)</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-slate-300">
              <span>Fade Time (ms)</span>
              <input
                type="number"
                min={0}
                max={10000}
                step={50}
                value={p.fadeTimeMs}
                onChange={(e) => updateParams({ fadeTimeMs: Number(e.target.value) })}
                className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 font-mono-tabular text-slate-100"
              />
            </label>

            <label className="flex flex-col gap-1 text-slate-300">
              <span>Transition Time (ms)</span>
              <input
                type="number"
                min={100}
                max={15000}
                step={100}
                value={p.transitionTimeMs}
                onChange={(e) => updateParams({ transitionTimeMs: Number(e.target.value) })}
                className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 font-mono-tabular text-slate-100"
              />
            </label>

            <label className="flex flex-col gap-1 text-slate-300">
              <span>Delay (ms)</span>
              <input
                type="number"
                min={0}
                max={5000}
                step={50}
                value={p.delayMs}
                onChange={(e) => updateParams({ delayMs: Number(e.target.value) })}
                className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 font-mono-tabular text-slate-100"
              />
            </label>

            <label className="flex flex-col gap-1 text-slate-300">
              <span>Repetitions (0 = ∞)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={p.repetitions}
                onChange={(e) => updateParams({ repetitions: Number(e.target.value) })}
                className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 font-mono-tabular text-slate-100"
              />
            </label>

            <label className="flex flex-col gap-1 text-slate-300">
              <span>Fixture Range Start</span>
              <input
                type="number"
                min={1}
                value={p.fixtureRangeStart}
                onChange={(e) => updateParams({ fixtureRangeStart: Math.max(1, Number(e.target.value)) })}
                className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 font-mono-tabular text-slate-100"
              />
            </label>

            <label className="flex flex-col gap-1 text-slate-300">
              <span>Fixture Range End (0 = All)</span>
              <input
                type="number"
                min={0}
                value={p.fixtureRangeEnd}
                onChange={(e) => updateParams({ fixtureRangeEnd: Math.max(0, Number(e.target.value)) })}
                className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1.5 font-mono-tabular text-slate-100"
              />
            </label>
          </div>

          {/* Sound & Custom Waveform controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#222833]">
            <div className="text-[11px] text-slate-400">
              Changes transmit live over WebSocket to all matching fixtures.
            </div>

            <div className="flex items-center gap-2">
              {activeLayer.type === 'custom_script' && (
                <select
                  aria-label="Custom Waveform"
                  value={p.customPulseShape || 'sine'}
                  onChange={(e) =>
                    updateParams({
                      customPulseShape: e.target.value as EffectParameters['customPulseShape'],
                    })
                  }
                  className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1 text-xs text-slate-200"
                >
                  <option value="sine">Sine Wave</option>
                  <option value="square">Square Pulse</option>
                  <option value="triangle">Triangle Wave</option>
                  <option value="sawtooth">Sawtooth Ramp</option>
                </select>
              )}

              <button
                type="button"
                onClick={toggleMic}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium ${
                  micActive
                    ? 'console-btn-emerald font-semibold'
                    : 'console-btn text-slate-300'
                }`}
              >
                {micActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                <span>{micActive ? 'Live Audio Input' : 'Enable Mic Sync'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
