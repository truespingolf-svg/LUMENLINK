import React, { useEffect, useRef, useState } from 'react';
import { AudienceDevice, FixtureGroup, LiveLightingState } from '../../shared/types';
import { renderFixtureOutput } from '../../engine/effects';

interface EffectStagePreviewProps {
  title: string;
  devices: AudienceDevice[];
  groups: FixtureGroup[];
  lighting: LiveLightingState;
  serverOffsetMs: number;
  isLiveRunning?: boolean;
  statusLabel?: string;
  onEnableLive?: () => void;
  testId?: string;
}

export const EffectStagePreview: React.FC<EffectStagePreviewProps> = ({
  title,
  devices,
  groups,
  lighting,
  serverOffsetMs,
  isLiveRunning = true,
  statusLabel,
  onEnableLive,
  testId = 'effect-stage-preview',
}) => {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [simulatedCount, setSimulatedCount] = useState<number>(18);

  const onlineDevices = devices.filter((d) => d.status === 'connected');
  const useRealLayout = devices.length > 1;

  useEffect(() => {
    let raf = 0;
    const renderPreview = () => {
      const canvas = previewCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.fillStyle = '#090B0E';
          ctx.fillRect(0, 0, w, h);

          const count = Math.max(4, simulatedCount);
          const cols = count <= 6 ? count : count <= 12 ? 6 : count <= 18 ? 6 : count <= 24 ? 8 : 9;
          const rows = Math.max(1, Math.ceil(count / cols));

          const previewDevices: AudienceDevice[] = useRealLayout
            ? devices
            : Array.from({ length: count }, (_, i) => {
                const r = Math.floor(i / cols);
                const c = i % cols;
                return {
                  id: i === 0 && devices[0] ? devices[0].id : `prev-${i}`,
                  fixtureNumber: i === 0 && devices[0] ? devices[0].fixtureNumber : i + 1,
                  name: i === 0 && devices[0] ? devices[0].name : `F${i + 1}`,
                  deviceType: 'smartphone',
                  orientation: 'portrait',
                  status: 'connected',
                  batteryLevel: 100,
                  lastSeenMs: Date.now(),
                  joinedAtMs: Date.now(),
                  groupId:
                    i === 0 && devices[0]
                      ? devices[0].groupId
                      : groups[i % Math.max(1, groups.length)]?.id || 'grp-floor',
                  excluded: false,
                  x: (c + 0.5) / cols,
                  y: (r + 0.5) / rows,
                  row: r,
                  col: c,
                  overrideColor: null,
                  identifyUntilMs: 0,
                };
              });

          const tileW = useRealLayout ? 20 : Math.max(10, Math.min(28, Math.floor((w - 36) / cols) - 10));
          const tileH = useRealLayout ? 30 : Math.max(16, Math.min(36, Math.floor((h - 18) / rows) - 6));

          const now = Date.now() + serverOffsetMs;

          for (let idx = 0; idx < previewDevices.length; idx++) {
            const d = previewDevices[idx];
            const out = renderFixtureOutput(d, previewDevices, groups, lighting, now);
            const px = d.x * w;
            const py = d.y * h;
            ctx.fillStyle = out.colorHex;
            ctx.fillRect(px - tileW / 2, py - tileH / 2, tileW, tileH);
            ctx.strokeStyle =
              devices.length === 1 && idx === 0
                ? '#F59E0B'
                : out.flashActive
                  ? '#F8FAFC'
                  : '#334155';
            ctx.lineWidth = devices.length === 1 && idx === 0 ? 2 : 1;
            ctx.strokeRect(px - tileW / 2, py - tileH / 2, tileW, tileH);
          }
        }
      }
      raf = requestAnimationFrame(renderPreview);
    };
    raf = requestAnimationFrame(renderPreview);
    return () => cancelAnimationFrame(raf);
  }, [devices, groups, lighting, serverOffsetMs, simulatedCount, useRealLayout]);

  return (
    <div data-testid={testId} className="console-panel rounded-md p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100 truncate">
          {title}
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono-tabular">
          {!useRealLayout && (
            <label className="flex items-center gap-1.5 console-well px-2 py-0.5 rounded text-[11px] text-slate-300">
              <span className="text-slate-400">Preview Grid:</span>
              <select
                aria-label="Preview Device Count"
                value={simulatedCount}
                onChange={(e) => setSimulatedCount(Number(e.target.value))}
                className="bg-transparent text-amber-300 font-semibold focus:outline-none cursor-pointer"
              >
                <option value={6} className="bg-[#090B0E]">6 Screens</option>
                <option value={12} className="bg-[#090B0E]">12 Screens</option>
                <option value={18} className="bg-[#090B0E]">18 Screens</option>
                <option value={24} className="bg-[#090B0E]">24 Screens</option>
                <option value={36} className="bg-[#090B0E]">36 Screens</option>
              </select>
            </label>
          )}
          <div className="flex items-center gap-2 console-well px-2.5 py-0.5 rounded">
            <span className={onlineDevices.length > 0 ? 'text-emerald-400' : 'text-slate-400'}>
              {onlineDevices.length} DEVICE{onlineDevices.length === 1 ? '' : 'S'} LIVE
            </span>
            <span className={isLiveRunning ? 'text-amber-400 font-semibold' : 'text-red-400 font-semibold'}>
              · {statusLabel || (isLiveRunning ? 'RUNNING' : 'LAYER OFF')}
            </span>
          </div>
        </div>
      </div>

      <div className="relative">
        <canvas
          ref={previewCanvasRef}
          width={560}
          height={140}
          className="w-full h-36 rounded console-well"
        />
        {!isLiveRunning && onEnableLive && (
          <div className="absolute inset-0 bg-black/55 rounded flex items-center justify-center gap-3 px-4">
            <span className="text-xs font-semibold text-amber-200">
              Layer is OFF (Preview Only)
            </span>
            <button
              type="button"
              onClick={onEnableLive}
              className="console-btn-amber px-3 py-1.5 rounded text-xs font-semibold"
            >
              Enable Live Output
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
