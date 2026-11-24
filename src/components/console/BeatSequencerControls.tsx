import React, { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { EffectParameters } from '../../shared/types';

interface BeatSequencerControlsProps {
  params: Partial<EffectParameters>;
  startedAtMs?: number;
  serverOffsetMs?: number;
  onChange: (patch: Partial<EffectParameters>) => void;
  compact?: boolean;
}

function buildPattern(steps: number, every: number, existing?: boolean[]): boolean[] {
  if (Array.isArray(existing) && existing.length === steps) {
    return existing;
  }
  const safeEvery = Math.max(1, every);
  return Array.from({ length: steps }, (_, i) => i % safeEvery === 0);
}

export const BeatSequencerControls: React.FC<BeatSequencerControlsProps> = ({
  params,
  startedAtMs = 0,
  serverOffsetMs = 0,
  onChange,
  compact = false,
}) => {
  const bpm = Math.max(40, Math.min(240, Math.round(params.bpm ?? 120)));
  const beatSteps = Math.max(2, Math.min(16, Math.round(params.beatSteps ?? 8)));
  const beatFlashEvery = Math.max(1, Math.min(16, Math.round(params.beatFlashEvery ?? 2)));
  const beatSpreadMode = params.beatSpreadMode || 'all';
  const speed = Math.max(0.2, params.speed ?? 1);
  const pattern = buildPattern(beatSteps, beatFlashEvery, params.beatStepPattern);

  const [activeStepIdx, setActiveStepIdx] = useState<number>(0);
  const tapTimesRef = useRef<number[]>([]);

  useEffect(() => {
    let raf = 0;
    let lastDrawn = 0;
    const tick = (ts: number) => {
      if (ts - lastDrawn >= 45) {
        lastDrawn = ts;
        const now = Date.now() + serverOffsetMs;
        const elapsedSec = Math.max(0, (now - startedAtMs) / 1000);
        const rate = (bpm / 60) * speed;
        const phaseOffset = (params.phaseDeg || 0) / 360;
        const idx = Math.floor(elapsedSec * rate + phaseOffset * beatSteps);
        const mod = ((idx % beatSteps) + beatSteps) % beatSteps;
        setActiveStepIdx(mod);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bpm, beatSteps, speed, startedAtMs, serverOffsetMs, params.phaseDeg]);

  const handleTapTempo = () => {
    const now = performance.now();
    const recent = tapTimesRef.current.filter((t) => now - t < 2500);
    recent.push(now);
    tapTimesRef.current = recent.slice(-6);
    if (recent.length >= 2) {
      let total = 0;
      for (let i = 1; i < recent.length; i++) {
        total += recent[i] - recent[i - 1];
      }
      const avgMs = total / (recent.length - 1);
      if (avgMs > 200) {
        const nextBpm = Math.max(40, Math.min(240, Math.round(60000 / avgMs)));
        onChange({ bpm: nextBpm });
      }
    }
  };

  const setStepsCount = (nextSteps: number) => {
    const nextPattern = Array.from({ length: nextSteps }, (_, i) =>
      i < pattern.length ? pattern[i] : i % beatFlashEvery === 0,
    );
    onChange({ beatSteps: nextSteps, beatStepPattern: nextPattern });
  };

  const applyFlashEvery = (every: number) => {
    const nextPattern = Array.from({ length: beatSteps }, (_, i) => i % every === 0);
    onChange({ beatFlashEvery: every, beatStepPattern: nextPattern });
  };

  const toggleStep = (idx: number) => {
    const next = [...pattern];
    next[idx] = !next[idx];
    // Keep at least one step active only if user clicks intentionally — allow all off if desired
    onChange({ beatStepPattern: next });
  };

  const bpmFillPct = ((bpm - 40) / 200) * 100;

  return (
    <div
      data-testid="beat-sequencer-controls"
      className={`console-well rounded ${compact ? 'p-2.5 space-y-2.5' : 'p-3.5 space-y-3'} border border-amber-500/35`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-amber-400" />
          <span className="font-display text-xs font-semibold tracking-wider uppercase text-amber-300">
            Beat Step Sequencer
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleTapTempo}
            className="console-btn-amber px-2.5 py-1 rounded text-[11px] font-semibold"
            title="Tap repeatedly to match live music tempo"
          >
            Tap Tempo
          </button>
          <span className="font-mono-tabular text-xs font-bold text-amber-300 bg-[#07090D] border border-[#252D3B] px-2 py-0.5 rounded">
            {bpm} BPM
          </span>
        </div>
      </div>

      {/* BPM Slider + Steps + Every Nth Step */}
      <div className={`grid grid-cols-1 ${compact ? 'gap-2' : 'sm:grid-cols-3 gap-3'} text-xs`}>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-300">
            <span>Tempo (BPM)</span>
            <input
              type="number"
              aria-label="Beat BPM"
              min={40}
              max={240}
              value={bpm}
              onChange={(e) => onChange({ bpm: Math.max(40, Math.min(240, Number(e.target.value) || 120)) })}
              className="w-14 bg-[#07090D] border border-[#252D3B] rounded px-1.5 py-0.5 text-right font-mono-tabular text-amber-300"
            />
          </div>
          <input
            type="range"
            aria-label="Beat BPM Slider"
            min={40}
            max={240}
            value={bpm}
            style={{
              '--slider-track-bg': `linear-gradient(90deg, #F59E0B 0%, #F59E0B ${bpmFillPct}%, #07090D ${bpmFillPct}%, #07090D 100%)`,
            } as React.CSSProperties}
            onChange={(e) => onChange({ bpm: Number(e.target.value) })}
            className="w-full"
          />
        </div>

        <div className="space-y-1">
          <span className="block text-[11px] text-slate-300">Steps Per Bar</span>
          <div className="grid grid-cols-4 gap-1">
            {[4, 8, 12, 16].map((cnt) => (
              <button
                key={cnt}
                type="button"
                onClick={() => setStepsCount(cnt)}
                className={`py-1 rounded text-[11px] font-mono-tabular ${
                  beatSteps === cnt
                    ? 'console-btn-amber font-semibold'
                    : 'console-btn text-slate-300'
                }`}
              >
                {cnt}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <span className="block text-[11px] text-slate-300">Flash Every Nth Step</span>
          <div className="grid grid-cols-4 gap-1">
            {[
              { n: 1, label: 'All' },
              { n: 2, label: '2nd' },
              { n: 3, label: '3rd' },
              { n: 4, label: '4th' },
            ].map((item) => (
              <button
                key={item.n}
                type="button"
                onClick={() => applyFlashEvery(item.n)}
                className={`py-1 rounded text-[11px] font-medium ${
                  beatFlashEvery === item.n
                    ? 'console-btn-amber font-semibold'
                    : 'console-btn text-slate-300'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Clickable Step-to-Flash Pads */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>Active Flash Steps (tap any step to toggle flash on beat)</span>
          <span className="font-mono-tabular text-amber-300">
            Step {activeStepIdx + 1}/{beatSteps}
          </span>
        </div>
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${Math.min(8, beatSteps)}, minmax(0, 1fr))` }}
        >
          {pattern.map((isOn, idx) => {
            const isNow = idx === activeStepIdx;
            return (
              <button
                key={idx}
                type="button"
                data-testid={`beat-step-pad-${idx + 1}`}
                aria-pressed={isOn}
                onClick={() => toggleStep(idx)}
                className={`h-9 rounded flex flex-col items-center justify-center font-mono-tabular text-[11px] transition-all border ${
                  isOn
                    ? isNow
                      ? 'bg-amber-400 border-white text-slate-950 font-bold shadow-[0_0_12px_rgba(245,158,11,0.85)]'
                      : 'bg-amber-500/25 border-amber-400/80 text-amber-100 font-semibold'
                    : isNow
                      ? 'bg-[#1D2330] border-slate-400 text-slate-100'
                      : 'bg-[#090B0E] border-[#252D3B] text-slate-500 hover:text-slate-300'
                }`}
              >
                <span>{idx + 1}</span>
                <span
                  className={`w-1.5 h-1.5 rounded-full mt-0.5 ${
                    isOn ? (isNow ? 'bg-slate-950' : 'bg-amber-400') : 'bg-slate-700'
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Device Spread Mode across rig */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[11px]">
        <span className="text-slate-300">Device Spread on Beat:</span>
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              { id: 'all', label: 'All Devices' },
              { id: 'chase', label: 'Chase Across Devices' },
              { id: 'alternate', label: 'Odd / Even' },
              { id: 'random', label: 'Random Spark' },
            ] as const
          ).map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => onChange({ beatSpreadMode: mode.id })}
              className={`px-2 py-1 rounded text-[11px] ${
                beatSpreadMode === mode.id
                  ? 'console-btn-amber font-semibold'
                  : 'console-btn text-slate-300'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
