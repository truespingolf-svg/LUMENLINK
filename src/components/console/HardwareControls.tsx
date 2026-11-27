import React, { useRef, useState } from 'react';
import { EyeOff, Pause, Power, ShieldAlert, Square } from 'lucide-react';
import { LiveLightingState } from '../../shared/types';

interface VerticalFaderProps {
  label: string;
  value: number; // 0..100
  onChange: (val: number) => void;
  accentColor?: string;
  heightClass?: string;
  disabled?: boolean;
  testId?: string;
}

export const VerticalFader: React.FC<VerticalFaderProps> = ({
  label,
  value,
  onChange,
  accentColor = '#F59E0B',
  heightClass = 'h-40',
  disabled = false,
  testId,
}) => {
  const grooveRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const lastEmittedRef = useRef<number>(value);

  const clampedValue = Math.max(0, Math.min(100, Math.round(value)));
  lastEmittedRef.current = clampedValue;

  const emitIfChanged = (next: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(next)));
    if (clamped !== lastEmittedRef.current) {
      lastEmittedRef.current = clamped;
      onChange(clamped);
    }
  };

  const updateFromClientY = (clientY: number) => {
    const rect = grooveRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    const ratio = 1 - (clientY - rect.top) / rect.height;
    emitIfChanged(ratio * 100);
  };

  return (
    <div className="flex flex-col items-center gap-2 select-none" data-testid={testId}>
      <div className="text-[10px] font-display font-semibold text-slate-300 tracking-[0.14em] uppercase whitespace-nowrap">
        {label}
      </div>
      <div className="flex items-center gap-1.5 bg-[#0A0D12] border border-[#222937] rounded-md px-2 py-2 shadow-inner">
        {/* Tick scale */}
        <div className={`flex flex-col justify-between ${heightClass} py-2 text-[9px] font-mono-tabular text-slate-500 text-right pr-0.5`}>
          <span>100</span>
          <span>75</span>
          <span>50</span>
          <span>25</span>
          <span>0</span>
        </div>

        {/* Interactive fader slot */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clampedValue}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
              e.preventDefault();
              emitIfChanged(clampedValue + 5);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
              e.preventDefault();
              emitIfChanged(clampedValue - 5);
            } else if (e.key === 'PageUp') {
              e.preventDefault();
              emitIfChanged(clampedValue + 10);
            } else if (e.key === 'PageDown') {
              e.preventDefault();
              emitIfChanged(clampedValue - 10);
            } else if (e.key === 'Home') {
              e.preventDefault();
              emitIfChanged(0);
            } else if (e.key === 'End') {
              e.preventDefault();
              emitIfChanged(100);
            }
          }}
          onWheel={(e) => {
            if (disabled) return;
            e.preventDefault();
            const step = e.deltaY < 0 ? 5 : -5;
            emitIfChanged(clampedValue + step);
          }}
          onPointerDown={(e) => {
            if (disabled) return;
            e.preventDefault();
            try {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } catch {}
            draggingRef.current = true;
            updateFromClientY(e.clientY);
          }}
          onPointerMove={(e) => {
            if (draggingRef.current && !disabled) {
              updateFromClientY(e.clientY);
            }
          }}
          onPointerUp={(e) => {
            draggingRef.current = false;
            try {
              (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            } catch {}
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
          }}
          onLostPointerCapture={() => {
            draggingRef.current = false;
          }}
          className={`relative w-10 ${heightClass} rounded console-well cursor-ns-resize touch-none flex justify-center px-1 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500`}
        >
          {/* Inner exact-travel groove (matches cap half-height padding top/bottom) */}
          <div ref={grooveRef} className="relative w-full h-full flex justify-center">
            {/* Calibration tick lines behind groove */}
            <div className="absolute inset-x-0.5 inset-y-0 flex flex-col justify-between pointer-events-none opacity-45">
              {Array.from({ length: 9 }).map((_, idx) => (
                <div key={idx} className="flex justify-between items-center">
                  <span className="w-1.5 h-px bg-slate-500" />
                  <span className="w-1.5 h-px bg-slate-500" />
                </div>
              ))}
            </div>

            {/* Center LED meter groove */}
            <div className="w-1.5 h-full bg-[#05070A] border border-[#1E2532] rounded-full relative overflow-hidden">
              <div
                className="absolute bottom-0 left-0 right-0"
                style={{
                  height: `${clampedValue}%`,
                  backgroundColor: accentColor,
                  boxShadow: clampedValue > 0 ? `0 0 8px ${accentColor}` : 'none',
                }}
              />
            </div>

            {/* Sculpted 3D Metallic Fader Cap */}
            <div
              className="absolute left-0 right-0 h-6 -mb-3 rounded-[3px] pointer-events-none flex flex-col justify-between py-1 px-1"
              style={{
                bottom: `${clampedValue}%`,
                background:
                  'linear-gradient(180deg, #738299 0%, #3E4A5E 18%, #222936 46%, #181E28 54%, #313C4E 84%, #141923 100%)',
                border: '1px solid #94A3B8',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.45), 0 3px 6px rgba(0,0,0,0.85)',
              }}
            >
              <div className="w-full h-px bg-black/50" />
              <div
                className="w-full h-[2px] rounded-full"
                style={{
                  backgroundColor: accentColor,
                  boxShadow: clampedValue > 0 ? `0 0 5px ${accentColor}` : 'none',
                }}
              />
              <div className="w-full h-px bg-black/50" />
            </div>
          </div>
        </div>
      </div>

      <div
        data-testid={testId ? `${testId}-value` : undefined}
        className="font-mono-tabular text-[11px] font-semibold text-amber-200 console-well px-2.5 py-0.5 rounded"
      >
        {clampedValue}%
      </div>
    </div>
  );
};

interface RotaryEncoderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (val: number) => void;
}

export const RotaryEncoder: React.FC<RotaryEncoderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}) => {
  const startYRef = useRef<number | null>(null);
  const startValRef = useRef<number>(value);

  const norm = Math.max(0, Math.min(1, (value - min) / Math.max(0.0001, max - min)));
  const angle = -135 + norm * 270;
  const radius = 21;
  const circumference = 2 * Math.PI * radius;
  const arcFraction = 270 / 360;
  const activeLength = circumference * arcFraction * norm;
  const trackLength = circumference * arcFraction;

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault();
            onChange(Math.min(max, Number((value + step).toFixed(2))));
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault();
            onChange(Math.max(min, Number((value - step).toFixed(2))));
          }
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {}
          startYRef.current = e.clientY;
          startValRef.current = value;
        }}
        onPointerMove={(e) => {
          if (startYRef.current === null) return;
          const dy = startYRef.current - e.clientY;
          const span = max - min;
          const raw = startValRef.current + (dy / 110) * span;
          const stepped = Math.round(raw / step) * step;
          onChange(Math.max(min, Math.min(max, Number(stepped.toFixed(2)))));
        }}
        onPointerUp={() => {
          startYRef.current = null;
        }}
        onPointerCancel={() => {
          startYRef.current = null;
        }}
        onLostPointerCapture={() => {
          startYRef.current = null;
        }}
        onWheel={(e) => {
          e.preventDefault();
          const delta = e.deltaY < 0 ? step : -step;
          onChange(Math.max(min, Math.min(max, Number((value + delta).toFixed(2)))));
        }}
        className="relative w-14 h-14 rounded-full flex items-center justify-center cursor-ns-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 group"
        title={`${label}: drag up/down or scroll`}
      >
        {/* SVG LED Arc Ring */}
        <svg className="absolute inset-0 w-full h-full -rotate-[225deg] pointer-events-none" viewBox="0 0 52 52">
          <circle
            cx="26"
            cy="26"
            r={radius}
            fill="none"
            stroke="#1E2532"
            strokeWidth="3"
            strokeDasharray={`${trackLength} ${circumference}`}
            strokeLinecap="round"
          />
          <circle
            cx="26"
            cy="26"
            r={radius}
            fill="none"
            stroke="#F59E0B"
            strokeWidth="3"
            strokeDasharray={`${activeLength} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>

        {/* Knurled Metallic Dial Cap */}
        <div
          className="w-9 h-9 rounded-full relative flex items-start justify-center transition-shadow group-hover:ring-1 group-hover:ring-amber-400/50"
          style={{
            transform: `rotate(${angle}deg)`,
            background:
              'radial-gradient(circle at 35% 28%, #475569 0%, #242B37 45%, #12161E 100%)',
            border: '1px solid #4B5568',
            boxShadow:
              'inset 0 1px 1px rgba(255,255,255,0.28), 0 3px 6px rgba(0,0,0,0.85)',
          }}
        >
          <div className="w-1 h-3 bg-amber-400 rounded-full mt-1 shadow-[0_0_6px_#F59E0B]" />
        </div>
      </div>
      <span className="text-[10px] font-display font-semibold tracking-wider uppercase text-slate-400 whitespace-nowrap">
        {label}
      </span>
      <span className="text-[11px] font-mono-tabular text-slate-100 bg-[#080A0E] border border-[#222937] px-1.5 py-0.5 rounded">
        {value}
        {unit}
      </span>
    </div>
  );
};

interface SafetyBarProps {
  lighting: LiveLightingState;
  onCommand: (action: string, payload?: Record<string, unknown>) => void;
}

export const SafetyBar: React.FC<SafetyBarProps> = ({ lighting, onCommand }) => {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onCommand('set_blackout', { blackout: !lighting.blackout })}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold whitespace-nowrap ${
          lighting.blackout
            ? 'console-btn-danger'
            : 'console-btn text-red-400 hover:border-red-500/60'
        }`}
      >
        <Power className="w-3.5 h-3.5" />
        <span>{lighting.blackout ? 'BLACKOUT ON' : 'Blackout'}</span>
      </button>

      <button
        type="button"
        onClick={() => onCommand('set_freeze', { freeze: !lighting.freeze })}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap ${
          lighting.freeze ? 'console-btn-sky font-semibold' : 'console-btn text-slate-200'
        }`}
      >
        <Pause className="w-3.5 h-3.5" />
        <span>{lighting.freeze ? 'Frozen' : 'Freeze'}</span>
      </button>

      <button
        type="button"
        onClick={() => onCommand('set_emergency_neutral', { emergencyNeutral: !lighting.emergencyNeutral })}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap ${
          lighting.emergencyNeutral
            ? 'console-btn-amber font-semibold'
            : 'console-btn text-amber-300'
        }`}
      >
        <ShieldAlert className="w-3.5 h-3.5" />
        <span>{lighting.emergencyNeutral ? 'Neutral On' : 'Neutral'}</span>
      </button>

      <button
        type="button"
        onClick={() => onCommand('stop_all_effects')}
        className="console-btn flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-slate-200 whitespace-nowrap"
      >
        <Square className="w-3.5 h-3.5" />
        <span>Stop FX</span>
      </button>

      <button
        type="button"
        onClick={() => onCommand('release_all')}
        className="console-btn flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-slate-200 whitespace-nowrap"
      >
        <EyeOff className="w-3.5 h-3.5" />
        <span>Release</span>
      </button>
    </div>
  );
};
