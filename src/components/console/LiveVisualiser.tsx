import React, { useEffect, useMemo, useState } from 'react';
import { Maximize2, Minimize2, Monitor, Smartphone, Tablet } from 'lucide-react';
import { AudienceDevice, FixtureGroup, LiveLightingState } from '../../shared/types';
import { EFFECT_CATALOG, renderFixtureOutput } from '../../engine/effects';

export type VisualiserViewMode = 'grid' | 'layout' | 'list' | 'group';

interface LiveVisualiserProps {
  devices: AudienceDevice[];
  groups: FixtureGroup[];
  lighting: LiveLightingState;
  serverOffsetMs: number;
  selectedDeviceIds: string[];
  onToggleSelectDevice: (id: string) => void;
  fullscreenOpen?: boolean;
  onToggleFullscreen?: () => void;
}

const VIRTUAL_STAGE_FIXTURES: AudienceDevice[] = Array.from({ length: 12 }, (_, idx) => {
  const normX = (idx + 0.5) / 12;
  return {
    id: `virtual-stage-${idx + 1}`,
    fixtureNumber: idx + 1,
    name: `Zone ${idx + 1}`,
    deviceType: 'smartphone',
    orientation: 'portrait',
    status: 'connected',
    batteryLevel: null,
    lastSeenMs: 0,
    joinedAtMs: 0,
    groupId: 'grp-all',
    excluded: false,
    x: normX,
    y: 0.5,
    row: 0,
    col: idx,
    overrideColor: null,
    identifyUntilMs: 0,
  };
});

export const LiveVisualiser: React.FC<LiveVisualiserProps> = ({
  devices,
  groups,
  lighting,
  serverOffsetMs,
  selectedDeviceIds,
  onToggleSelectDevice,
  fullscreenOpen = false,
  onToggleFullscreen,
}) => {
  const [viewMode, setViewMode] = useState<VisualiserViewMode>('grid');
  const [tickMs, setTickMs] = useState<number>(() => Date.now() + serverOffsetMs);

  const hasDynamicEffect =
    lighting.layers.some((l) => l.enabled) ||
    Boolean(lighting.colourTransition?.active) ||
    devices.some((d) => d.identifyUntilMs > Date.now() + serverOffsetMs);

  useEffect(() => {
    setTickMs(Date.now() + serverOffsetMs);
    if (!hasDynamicEffect) return;
    let rafId = 0;
    let lastDraw = 0;
    const loop = (ts: number) => {
      if (ts - lastDraw >= 33) {
        lastDraw = ts;
        setTickMs(Date.now() + serverOffsetMs);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [serverOffsetMs, hasDynamicEffect, lighting]);

  const enabledLayers = lighting.layers.filter((l) => l.enabled);
  const activeLayerLabels = enabledLayers
    .map((l) => EFFECT_CATALOG.find((fx) => fx.type === l.type)?.label || l.name || l.type)
    .join(' + ');

  // Always compute live stage output across 12 spatial zones so colour/effects/fades
  // reflect instantaneously on the console even when 0 phones are currently connected.
  const stageZoneOutputs = useMemo(
    () =>
      VIRTUAL_STAGE_FIXTURES.map((vf) =>
        renderFixtureOutput(vf, VIRTUAL_STAGE_FIXTURES, groups, lighting, tickMs),
      ),
    [groups, lighting, tickMs],
  );

  const centerOutput = stageZoneOutputs[Math.floor(stageZoneOutputs.length / 2)];
  const statusTag = lighting.blackout
    ? 'BLACKOUT'
    : lighting.emergencyNeutral
      ? 'NEUTRAL WHITE'
      : lighting.freeze
        ? 'FROZEN'
        : 'LIVE OUTPUT';

  const statusTone = lighting.blackout
    ? 'text-red-400'
    : lighting.emergencyNeutral
      ? 'text-slate-100'
      : lighting.freeze
        ? 'text-sky-400'
        : 'text-emerald-400';

  const renderMiniPhone = (device: AudienceDevice, positioned = false) => {
    const out = renderFixtureOutput(device, devices, groups, lighting, tickMs);
    const isSelected = selectedDeviceIds.includes(device.id);
    const isDisconnected = device.status === 'disconnected';
    const group = groups.find((g) => g.id === device.groupId);
    const numLabel = String(device.fixtureNumber).padStart(3, '0');

    const stylePos = positioned
      ? {
          position: 'absolute' as const,
          left: `${device.x * 100}%`,
          top: `${device.y * 100}%`,
          transform: 'translate(-50%, -50%)',
        }
      : undefined;

    return (
      <button
        key={device.id}
        type="button"
        onClick={() => onToggleSelectDevice(device.id)}
        style={stylePos}
        aria-label={`Fixture ${numLabel} ${device.name} (${device.status})`}
        className={`group flex flex-col items-center gap-1 p-1.5 rounded border transition-colors ${
          isSelected
            ? 'border-amber-400 bg-amber-500/10'
            : 'border-[#252B36] bg-[#0D1015] hover:border-slate-500'
        } ${isDisconnected ? 'opacity-50' : ''}`}
      >
        <div
          className={`relative overflow-hidden rounded-sm border border-slate-700/80 flex items-center justify-center ${
            device.orientation === 'landscape' ? 'w-14 h-9' : 'w-9 h-14'
          }`}
          style={{
            backgroundColor: isDisconnected ? '#15181F' : out.colorHex,
          }}
        >
          {!isDisconnected && out.mediaUrl && out.mediaKind !== 'video' && (
            <img
              src={out.mediaUrl}
              alt={device.name}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
              style={{ opacity: out.mediaOpacity }}
            />
          )}
          {!isDisconnected && out.mediaUrl && out.mediaKind === 'video' && (
            <span className="text-[9px] font-mono-tabular px-1 bg-black/70 text-white rounded">VID</span>
          )}
          {isDisconnected && (
            <span className="text-[9px] font-mono-tabular text-red-400 font-semibold">OFF</span>
          )}
          {out.identifying && (
            <span className="absolute inset-0 border-2 border-white flex items-center justify-center text-[9px] font-bold text-black bg-white/40">
              ID
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] font-mono-tabular text-slate-300">
          <span>{numLabel}</span>
          {group && (
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: group.color }}
              title={group.name}
            />
          )}
        </div>
        <span className="text-[10px] text-slate-400 max-w-[68px] truncate">{device.name}</span>
      </button>
    );
  };

  const connectedCount = devices.filter((d) => d.status === 'connected').length;

  return (
    <section
      data-testid="live-visualiser"
      className={
        fullscreenOpen
          ? 'fixed inset-0 z-50 bg-[#090B0E] flex flex-col p-4'
          : 'console-panel rounded-md flex flex-col h-full min-h-[280px]'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[#222833]">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-sm font-semibold tracking-wider text-slate-100 uppercase">
            Live Output Visualiser
          </h2>
          <span className="text-xs font-mono-tabular text-slate-300 console-well px-2 py-0.5 rounded">
            {connectedCount}/{devices.length} online
          </span>
        </div>

        <div className="flex items-center gap-1">
          {(['grid', 'layout', 'list', 'group'] as VisualiserViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`px-2 py-1 text-[11px] rounded capitalize ${
                viewMode === mode
                  ? 'console-btn-amber font-semibold'
                  : 'console-btn text-slate-300 font-medium'
              }`}
            >
              {mode}
            </button>
          ))}
          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              aria-label={fullscreenOpen ? 'Exit Fullscreen Visualiser' : 'Fullscreen Visualiser'}
              className="console-btn ml-1 p-1.5 rounded text-slate-300"
            >
              {fullscreenOpen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Always-On Live Stage Output Monitor — reflects colour, intensity, fades, effects & safety states instantaneously */}
      <div
        data-testid="live-stage-monitor"
        className="mx-3 mt-3 console-well rounded p-2.5 space-y-2 shrink-0"
      >
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-4 h-4 rounded-sm border border-white/25 shrink-0"
              style={{
                backgroundColor: centerOutput.colorHex,
                boxShadow: lighting.blackout ? 'none' : `0 0 10px ${centerOutput.colorHex}66`,
              }}
            />
            <span
              data-testid="live-output-hex"
              className="font-mono-tabular font-semibold text-slate-100 uppercase"
            >
              {centerOutput.colorHex}
            </span>
            <span className="font-mono-tabular text-slate-400">
              {lighting.masterIntensity}%
            </span>
          </div>
          <span className={`font-mono-tabular font-semibold tracking-wider uppercase ${statusTone}`}>
            {statusTag}
          </span>
        </div>

        {/* 12-Zone Spatial Preview Array */}
        <div
          className="grid grid-cols-12 gap-1 h-11 p-1 bg-[#06070A] rounded border border-[#1E2430]"
          aria-label="12-Zone Live Stage Output Array"
        >
          {stageZoneOutputs.map((out, idx) => (
            <div
              key={idx}
              className="relative rounded-[2px] border border-white/10 overflow-hidden transition-[background-color] duration-75"
              style={{
                backgroundColor: out.colorHex,
                boxShadow:
                  lighting.blackout || out.intensity < 0.05
                    ? 'none'
                    : `0 0 8px ${out.colorHex}45`,
              }}
              title={`Zone ${idx + 1}: ${out.colorHex}`}
            >
              {out.mediaUrl && out.mediaKind !== 'video' && (
                <img
                  src={out.mediaUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                  style={{ opacity: out.mediaOpacity }}
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400 font-mono-tabular">
          <span className="truncate">
            {activeLayerLabels ? `FX: ${activeLayerLabels}` : 'FX: Solid Base Look'}
          </span>
          <span className="shrink-0">
            RGB({centerOutput.rgb[0]},{centerOutput.rgb[1]},{centerOutput.rgb[2]})
          </span>
        </div>
      </div>

      {/* Connected Audience Fixtures Grid / Layout / Group / List */}
      <div className="flex-1 p-3 overflow-auto">
        {devices.length === 0 ? (
          <div className="h-full min-h-[120px] flex flex-col items-center justify-center text-center gap-1.5 text-slate-400 py-4">
            <Smartphone className="w-6 h-6 text-slate-500" />
            <p className="text-xs font-medium text-slate-300">No audience fixtures joined yet</p>
            <p className="text-[11px] text-slate-500 max-w-xs">
              Use the Join &amp; Poster tab to open the Audience link or scan the QR code on phones.
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
            {devices.map((d) => renderMiniPhone(d, false))}
          </div>
        ) : viewMode === 'layout' ? (
          <div className="relative w-full min-h-[240px] h-full bg-[#090B0E] border border-[#232934] rounded overflow-hidden">
            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] font-mono-tabular text-slate-500 tracking-widest uppercase">
              STAGE FRONT
            </div>
            {devices.map((d) => renderMiniPhone(d, true))}
          </div>
        ) : viewMode === 'group' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {groups.map((grp) => {
              const members = devices.filter((d) => d.groupId === grp.id);
              return (
                <div key={grp.id} className="bg-[#0D1015] border border-[#232934] rounded p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: grp.color }} />
                      <span className="text-xs font-semibold text-slate-200">{grp.name}</span>
                    </div>
                    <span className="text-xs font-mono-tabular text-slate-400">
                      {members.length} fixtures · {grp.masterIntensity}%
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {members.length === 0 ? (
                      <span className="text-xs text-slate-500">No fixtures assigned</span>
                    ) : (
                      members.map((d) => renderMiniPhone(d, false))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#232934] text-slate-400 font-medium">
                  <th className="py-1.5 px-2">No.</th>
                  <th className="py-1.5 px-2">Name</th>
                  <th className="py-1.5 px-2">Type</th>
                  <th className="py-1.5 px-2">Group</th>
                  <th className="py-1.5 px-2">Output</th>
                  <th className="py-1.5 px-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const out = renderFixtureOutput(d, devices, groups, lighting, tickMs);
                  const grp = groups.find((g) => g.id === d.groupId);
                  return (
                    <tr
                      key={d.id}
                      onClick={() => onToggleSelectDevice(d.id)}
                      className="border-b border-[#1A1F28] hover:bg-[#171B23] cursor-pointer"
                    >
                      <td className="py-1.5 px-2 font-mono-tabular text-amber-400">
                        {String(d.fixtureNumber).padStart(3, '0')}
                      </td>
                      <td className="py-1.5 px-2 text-slate-200">{d.name}</td>
                      <td className="py-1.5 px-2 text-slate-400 flex items-center gap-1">
                        {d.deviceType === 'tablet' ? (
                          <Tablet className="w-3.5 h-3.5" />
                        ) : d.deviceType === 'desktop' ? (
                          <Monitor className="w-3.5 h-3.5" />
                        ) : (
                          <Smartphone className="w-3.5 h-3.5" />
                        )}
                        <span>{d.orientation}</span>
                      </td>
                      <td className="py-1.5 px-2 text-slate-300">{grp?.name || '-'}</td>
                      <td className="py-1.5 px-2">
                        <div className="flex items-center gap-1.5 font-mono-tabular">
                          <span
                            className="w-3.5 h-3.5 rounded-sm border border-slate-700"
                            style={{ backgroundColor: out.colorHex }}
                          />
                          <span>{out.colorHex}</span>
                        </div>
                      </td>
                      <td className="py-1.5 px-2">
                        <span className={d.status === 'connected' ? 'text-emerald-400' : 'text-red-400'}>
                          {d.status === 'connected' ? 'Online' : 'Offline'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
