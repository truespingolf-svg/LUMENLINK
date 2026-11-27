import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookmarkPlus, Layers, Palette, Thermometer } from 'lucide-react';
import {
  COLOUR_TEMPERATURE_PRESETS,
  hexToRgb,
  hsvToRgb,
  rgbToHex,
  rgbToHsv,
} from '../../engine/colors';
import { AudienceDevice, FixtureGroup, ShowFile } from '../../shared/types';
import { createDefaultEffectParams } from '../../engine/effects';

interface ColorPanelProps {
  show: ShowFile;
  devices: AudienceDevice[];
  selectedDeviceIds: string[];
  onCommand: (action: string, payload?: Record<string, unknown>) => void;
}

export const ColorPanel: React.FC<ColorPanelProps> = ({
  show,
  devices,
  selectedDeviceIds,
  onCommand,
}) => {
  const baseColor = show.lighting.baseColor || '#0066FF';
  const [hexInput, setHexInput] = useState(baseColor);
  const [transFrom, setTransFrom] = useState('#FF1E42');
  const [transTo, setTransTo] = useState('#0055FF');
  const [transDurationMs, setTransDurationMs] = useState(2500);
  const [gradientColors, setGradientColors] = useState<string[]>(['#0055FF', '#00E5FF', '#A855F7']);
  const [solidFadeMs, setSolidFadeMs] = useState<number>(600);
  const [targetScope, setTargetScope] = useState<'all' | 'group' | 'selected'>('all');
  const [targetGroupId, setTargetGroupId] = useState<string>(show.groups[0]?.id || 'grp-floor');

  const wheelCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setHexInput(baseColor);
  }, [baseColor]);

  // Draw HSV color wheel once
  useEffect(() => {
    const canvas = wheelCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width;
    const r = size / 2;
    const img = ctx.createImageData(size, size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - r;
        const dy = y - r;
        const dist = Math.hypot(dx, dy);
        const idx = (y * size + x) * 4;
        if (dist <= r) {
          const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
          const sat = (dist / r) * 100;
          const rgb = hsvToRgb(angle, sat, 100);
          img.data[idx] = rgb.r;
          img.data[idx + 1] = rgb.g;
          img.data[idx + 2] = rgb.b;
          img.data[idx + 3] = 255;
        } else {
          img.data[idx + 3] = 0;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  const rgb = hexToRgb(baseColor);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);

  const satLowRgb = hsvToRgb(hsv.h, 0, hsv.v || 100);
  const satHighRgb = hsvToRgb(hsv.h, 100, hsv.v || 100);
  const valHighRgb = hsvToRgb(hsv.h, hsv.s, 100);

  const rgbTracks = {
    r: `linear-gradient(90deg, rgb(0, ${rgb.g}, ${rgb.b}), rgb(255, ${rgb.g}, ${rgb.b}))`,
    g: `linear-gradient(90deg, rgb(${rgb.r}, 0, ${rgb.b}), rgb(${rgb.r}, 255, ${rgb.b}))`,
    b: `linear-gradient(90deg, rgb(${rgb.r}, ${rgb.g}, 0), rgb(${rgb.r}, ${rgb.g}, 255))`,
  };

  const hsvTracks = {
    h: 'linear-gradient(90deg, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
    s: `linear-gradient(90deg, rgb(${satLowRgb.r}, ${satLowRgb.g}, ${satLowRgb.b}), rgb(${satHighRgb.r}, ${satHighRgb.g}, ${satHighRgb.b}))`,
    v: `linear-gradient(90deg, #000000, rgb(${valHighRgb.r}, ${valHighRgb.g}, ${valHighRgb.b}))`,
  };

  const applyColor = (hex: string, transitionMs?: number) => {
    setHexInput(hex);
    if (targetScope === 'all') {
      onCommand('set_base_color', {
        color: hex,
        transitionMs: transitionMs ?? solidFadeMs,
        clearNormalEffects: true,
      });
    } else if (targetScope === 'group') {
      onCommand('update_group', { groupId: targetGroupId, overrideColor: hex });
    } else if (targetScope === 'selected' && selectedDeviceIds.length > 0) {
      onCommand('bulk_update_devices', { deviceIds: selectedDeviceIds, overrideColor: hex });
    }
  };

  const handleWheelPick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = wheelCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const r = rect.width / 2;
    const dx = x - r;
    const dy = y - r;
    const dist = Math.min(r, Math.hypot(dx, dy));
    const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const sat = (dist / r) * 100;
    const picked = hsvToRgb(hue, sat, hsv.v || 100);
    applyColor(rgbToHex(picked.r, picked.g, picked.b), 0);
  };

  const applyGradient = (colors: string[]) => {
    const primaryLayerId = show.lighting.layers[0]?.id || 'layer-primary';
    onCommand('upsert_effect_layer', {
      layer: {
        id: primaryLayerId,
        name: 'Custom Gradient',
        type: colors.length === 2 ? 'two_colour_gradient' : 'multi_colour_gradient',
        enabled: true,
        blendMode: 'normal',
        opacity: 1,
        startedAtMs: Date.now(),
        params: createDefaultEffectParams({ palette: colors }),
      },
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Left: Wheel & Sliders */}
      <div className="lg:col-span-5 console-panel rounded-md p-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <Palette className="w-4 h-4 text-amber-400" />
            <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100 whitespace-nowrap">
              Live Colour Programmer
            </h3>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <label className="flex items-center gap-1 text-[11px] text-slate-400">
              <span>Fade</span>
              <input
                type="number"
                aria-label="Solid Colour Fade ms"
                min={0}
                max={5000}
                step={100}
                value={solidFadeMs}
                onChange={(e) => setSolidFadeMs(Math.max(0, Number(e.target.value)))}
                className="w-14 console-well rounded px-1.5 py-1 text-xs font-mono-tabular text-slate-200"
              />
              <span>ms</span>
            </label>
            <span
              className="w-6 h-6 rounded border border-slate-500 shadow-inner shrink-0"
              style={{ backgroundColor: baseColor, boxShadow: `0 0 10px ${baseColor}44` }}
            />
            <input
              type="text"
              aria-label="HEX Colour"
              value={hexInput}
              onChange={(e) => {
                const v = e.target.value;
                setHexInput(v);
                if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
                  applyColor(v.toUpperCase());
                }
              }}
              className="w-20 console-well rounded px-2 py-1 text-xs font-mono-tabular text-slate-100"
            />
          </div>
        </div>

        {/* Target selector */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">Target:</span>
          {(['all', 'group', 'selected'] as const).map((sc) => (
            <button
              key={sc}
              type="button"
              onClick={() => setTargetScope(sc)}
              className={`px-2.5 py-1 rounded font-medium capitalize ${
                targetScope === sc
                  ? 'console-btn-amber font-semibold'
                  : 'console-btn text-slate-300'
              }`}
            >
              {sc === 'selected' ? `Selected (${selectedDeviceIds.length})` : sc}
            </button>
          ))}
          {targetScope === 'group' && (
            <select
              aria-label="Target Group"
              value={targetGroupId}
              onChange={(e) => setTargetGroupId(e.target.value)}
              className="console-well rounded px-2 py-1 text-xs text-slate-200"
            >
              {show.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
          {targetScope !== 'all' && (
            <button
              type="button"
              onClick={() => {
                if (targetScope === 'group') {
                  onCommand('update_group', { groupId: targetGroupId, overrideColor: null });
                } else {
                  onCommand('bulk_update_devices', { deviceIds: selectedDeviceIds, overrideColor: null });
                }
              }}
              className="text-xs text-slate-400 hover:text-slate-200 underline"
            >
              Clear Override
            </button>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex justify-center">
            <div className="console-well p-2.5 rounded-full border border-[#2C3546] shadow-[0_6px_18px_rgba(0,0,0,0.75)]">
              <canvas
                ref={wheelCanvasRef}
                width={156}
                height={156}
                onClick={handleWheelPick}
                onMouseMove={(e) => {
                  if (e.buttons === 1) handleWheelPick(e);
                }}
                className="rounded-full cursor-crosshair border border-slate-700 shrink-0 block"
              />
            </div>
          </div>

          <div className="w-full min-w-0 space-y-2.5 text-xs console-well p-3 rounded-md">
            {/* RGB sliders */}
            {(
              [
                { key: 'r', label: 'R', val: rgb.r, track: rgbTracks.r },
                { key: 'g', label: 'G', val: rgb.g, track: rgbTracks.g },
                { key: 'b', label: 'B', val: rgb.b, track: rgbTracks.b },
              ] as const
            ).map((ch) => (
              <div key={ch.key} className="flex items-center gap-2.5">
                <span className="w-4 font-mono-tabular font-semibold text-slate-300">{ch.label}</span>
                <input
                  type="range"
                  aria-label={`RGB ${ch.label}`}
                  min={0}
                  max={255}
                  value={ch.val}
                  style={{ '--slider-track-bg': ch.track } as React.CSSProperties}
                  onChange={(e) => {
                    const next = { ...rgb, [ch.key]: Number(e.target.value) };
                    applyColor(rgbToHex(next.r, next.g, next.b), 0);
                  }}
                  className="flex-1"
                />
                <span className="w-9 text-right font-mono-tabular text-slate-100 bg-[#05070A] border border-[#222937] rounded px-1 py-0.5">
                  {ch.val}
                </span>
              </div>
            ))}

            <div className="border-t border-[#222833] pt-2.5 space-y-2.5">
              {/* HSV sliders */}
              {(
                [
                  { key: 'h', label: 'H', max: 360, val: hsv.h, track: hsvTracks.h },
                  { key: 's', label: 'S', max: 100, val: hsv.s, track: hsvTracks.s },
                  { key: 'v', label: 'V', max: 100, val: hsv.v, track: hsvTracks.v },
                ] as const
              ).map((ch) => (
                <div key={ch.key} className="flex items-center gap-2.5">
                  <span className="w-4 font-mono-tabular font-semibold text-slate-300">{ch.label}</span>
                  <input
                    type="range"
                    aria-label={`HSV ${ch.label}`}
                    min={0}
                    max={ch.max}
                    value={ch.val}
                    style={{ '--slider-track-bg': ch.track } as React.CSSProperties}
                    onChange={(e) => {
                      const next = { ...hsv, [ch.key]: Number(e.target.value) };
                      const out = hsvToRgb(next.h, next.s, next.v);
                      applyColor(rgbToHex(out.r, out.g, out.b), 0);
                    }}
                    className="flex-1"
                  />
                  <span className="w-9 text-right font-mono-tabular text-slate-100 bg-[#05070A] border border-[#222937] rounded px-1 py-0.5">
                    {ch.val}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quick solid colour buttons */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {[
            { name: 'Blue', hex: '#0055FF' },
            { name: 'Red', hex: '#FF1E42' },
            { name: 'Green', hex: '#00E676' },
            { name: 'Amber', hex: '#FF9900' },
            { name: 'Cyan', hex: '#00E5FF' },
            { name: 'Magenta', hex: '#E11D48' },
            { name: 'White', hex: '#FFFFFF' },
          ].map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => applyColor(preset.hex)}
              className="console-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-slate-200"
            >
              <span
                className="w-2.5 h-2.5 rounded-sm border border-black/40"
                style={{ backgroundColor: preset.hex }}
              />
              <span>{preset.name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onCommand('save_color', { color: baseColor })}
            className="console-btn ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-amber-300"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            <span>Save Swatch</span>
          </button>
        </div>
      </div>

      {/* Right: Kelvin, Saved Swatches, Smooth Transitions, Gradients */}
      <div className="lg:col-span-7 flex flex-col gap-4">
        {/* Smooth Timed Colour Transition */}
        <div className="console-panel rounded-md p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
              Smooth Colour Transition
            </h3>
            <span className="text-xs text-slate-400">Synchronised fade across all connected screens</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <span>From</span>
              <input
                type="color"
                aria-label="Transition From Colour"
                value={transFrom}
                onChange={(e) => setTransFrom(e.target.value)}
                className="w-8 h-8 rounded bg-transparent border border-[#2B3342] cursor-pointer"
              />
            </label>
            <ArrowRight className="w-4 h-4 text-slate-500" />
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <span>To</span>
              <input
                type="color"
                aria-label="Transition To Colour"
                value={transTo}
                onChange={(e) => setTransTo(e.target.value)}
                className="w-8 h-8 rounded bg-transparent border border-[#2B3342] cursor-pointer"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <span>Duration (ms)</span>
              <input
                type="number"
                aria-label="Transition Duration ms"
                min={200}
                max={20000}
                step={100}
                value={transDurationMs}
                onChange={(e) => setTransDurationMs(Number(e.target.value))}
                className="w-20 console-well rounded px-2 py-1 font-mono-tabular text-slate-100"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                onCommand('stop_all_effects');
                onCommand('start_colour_transition', {
                  fromColor: transFrom,
                  toColor: transTo,
                  durationMs: transDurationMs,
                  easing: 'ease_in_out',
                });
              }}
              className="console-btn-amber px-3.5 py-1.5 rounded text-xs font-semibold"
            >
              Run Transition
            </button>
          </div>
        </div>

        {/* Colour Temperature & Saved Swatches */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="console-panel rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <Thermometer className="w-4 h-4 text-amber-400" />
              <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
                Colour Temperature
              </h3>
            </div>
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-1.5">
              {COLOUR_TEMPERATURE_PRESETS.map((ct) => (
                <button
                  key={ct.kelvin}
                  type="button"
                  onClick={() => applyColor(ct.hex)}
                  className="console-btn flex items-center justify-between gap-2 px-2.5 py-1.5 rounded text-xs"
                >
                  <span className="flex items-center gap-2 text-slate-200 truncate">
                    <span className="w-3 h-3 rounded-sm shrink-0 border border-black/30" style={{ backgroundColor: ct.hex }} />
                    <span className="truncate">{ct.label}</span>
                  </span>
                  <span className="font-mono-tabular text-slate-400 shrink-0">{ct.kelvin}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="console-panel rounded-md p-4">
            <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100 mb-3">
              Saved Swatches &amp; Palettes
            </h3>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {show.savedColors.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Apply swatch ${c}`}
                  onClick={() => applyColor(c)}
                  className="w-7 h-7 rounded border border-slate-500/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_2px_4px_rgba(0,0,0,0.6)] hover:scale-105 transition-transform"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="space-y-1.5">
              {show.savedPalettes.map((pal, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => applyGradient(pal)}
                  className="console-btn w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs"
                >
                  <div className="flex items-center gap-1">
                    {pal.map((c, i) => (
                      <span key={i} className="w-4 h-3 rounded-xs border border-black/30" style={{ backgroundColor: c }} />
                    ))}
                  </div>
                  <span className="text-slate-300">Apply Gradient</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Custom Gradient Builder */}
        <div className="console-panel rounded-md p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-400" />
              <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
                Custom Spatial Gradient
              </h3>
            </div>
            <button
              type="button"
              onClick={() => applyGradient(gradientColors)}
              className="console-btn-amber px-3 py-1 rounded text-xs font-semibold"
            >
              Project Gradient
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {gradientColors.map((c, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <input
                  type="color"
                  aria-label={`Gradient Stop ${idx + 1}`}
                  value={c}
                  onChange={(e) => {
                    const next = [...gradientColors];
                    next[idx] = e.target.value.toUpperCase();
                    setGradientColors(next);
                  }}
                  className="w-8 h-8 rounded bg-transparent border border-[#2B3342] cursor-pointer"
                />
                {gradientColors.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setGradientColors(gradientColors.filter((_, i) => i !== idx))}
                    className="text-xs text-slate-500 hover:text-red-400"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {gradientColors.length < 5 && (
              <button
                type="button"
                onClick={() => setGradientColors([...gradientColors, '#FFFFFF'])}
                className="px-2 py-1 rounded text-xs bg-[#1A1F28] border border-[#2B3342] text-slate-300"
              >
                + Stop
              </button>
            )}
            <div
              className="flex-1 h-6 rounded border border-[#2B3342] min-w-[120px]"
              style={{ background: `linear-gradient(90deg, ${gradientColors.join(', ')})` }}
            />
          </div>
        </div>

        {/* Devices active info */}
        {devices.length > 0 && (
          <div className="text-xs text-slate-400 flex items-center justify-between px-1">
            <span>
              Broadcasting colour changes live to {devices.filter((d) => d.status === 'connected').length} connected devices.
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
