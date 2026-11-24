import React, { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Battery,
  Grid,
  Move,
  Plus,
  Save,
  Trash2,
  Unplug,
  Zap,
} from 'lucide-react';
import { AudienceDevice, ShowFile } from '../../shared/types';
import { renderFixtureOutput } from '../../engine/effects';

interface FixtureLayoutPanelProps {
  show: ShowFile;
  devices: AudienceDevice[];
  serverOffsetMs: number;
  selectedDeviceIds: string[];
  onChangeSelectedDeviceIds: (ids: string[]) => void;
  onCommand: (action: string, payload?: Record<string, unknown>) => void;
}

export const FixtureLayoutPanel: React.FC<FixtureLayoutPanelProps> = ({
  show,
  devices,
  serverOffsetMs,
  selectedDeviceIds,
  onChangeSelectedDeviceIds,
  onCommand,
}) => {
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#38BDF8');
  const [gridCols, setGridCols] = useState(6);
  const [presetName, setPresetName] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  const mapRef = useRef<HTMLDivElement>(null);

  const toggleSelect = (id: string) => {
    if (selectedDeviceIds.includes(id)) {
      onChangeSelectedDeviceIds(selectedDeviceIds.filter((x) => x !== id));
    } else {
      onChangeSelectedDeviceIds([...selectedDeviceIds, id]);
    }
  };

  const selectAll = () => {
    if (selectedDeviceIds.length === devices.length) {
      onChangeSelectedDeviceIds([]);
    } else {
      onChangeSelectedDeviceIds(devices.map((d) => d.id));
    }
  };

  const handleMapPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingId || !mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const x = Math.max(0.03, Math.min(0.97, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0.05, Math.min(0.95, (e.clientY - rect.top) / rect.height));
    onCommand('update_device', {
      deviceId: draggingId,
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      col: Math.round(x * Math.max(1, gridCols - 1)),
      row: Math.round(y * 3),
    });
  };

  const nowMs = Date.now() + serverOffsetMs;
  const activeEffectName =
    show.lighting.layers.filter((l) => l.enabled).map((l) => l.name).join(', ') || 'Solid';

  return (
    <div className="flex flex-col gap-4">
      {/* Top Row: Virtual Audience Pixel Mapping Canvas + Group Manager */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Interactive Spatial Pixel Map */}
        <div className="xl:col-span-8 bg-[#12151B] border border-[#232934] rounded p-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Move className="w-4 h-4 text-amber-400" />
              <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
                Audience Pixel Map &amp; Fixture Positioning
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5 text-slate-300">
                <span>Cols</span>
                <input
                  type="number"
                  aria-label="Auto Grid Columns"
                  min={1}
                  max={16}
                  value={gridCols}
                  onChange={(e) => setGridCols(Math.max(1, Number(e.target.value)))}
                  className="w-14 bg-[#090B0E] border border-[#2A313E] rounded px-1.5 py-1 font-mono-tabular text-slate-100"
                />
              </label>
              <button
                type="button"
                onClick={() => onCommand('bulk_update_devices', { autoGrid: true, cols: gridCols })}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#1A1F28] border border-[#2B3342] text-slate-200 hover:bg-[#232A36]"
              >
                <Grid className="w-3.5 h-3.5" />
                <span>Auto-Grid</span>
              </button>

              <input
                type="text"
                aria-label="Layout Preset Name"
                placeholder="Layout name..."
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                className="w-28 bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1 text-xs text-slate-100"
              />
              <button
                type="button"
                onClick={() => {
                  onCommand('save_layout_preset', {
                    name: presetName.trim() || `Layout ${show.layoutPresets.length + 1}`,
                    cols: gridCols,
                    rows: Math.max(1, Math.ceil(devices.length / gridCols)),
                  });
                  setPresetName('');
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Layout</span>
              </button>
              <select
                aria-label="Load Layout Preset"
                value=""
                onChange={(e) => {
                  if (e.target.value) onCommand('apply_layout_preset', { presetId: e.target.value });
                }}
                className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1 text-slate-200"
              >
                <option value="">Load Layout...</option>
                {show.layoutPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-[#080A0D] border border-[#232934] rounded overflow-hidden select-none">
            <div className="px-3 py-1 bg-[#12161E] border-b border-[#232934] text-center text-[10px] font-mono-tabular tracking-widest text-slate-400 uppercase">
              STAGE / FRONT OF HOUSE
            </div>
            <div
              ref={mapRef}
              data-testid="pixel-map-canvas"
              onPointerMove={handleMapPointerMove}
              onPointerUp={() => setDraggingId(null)}
              onPointerLeave={() => setDraggingId(null)}
              className="relative w-full h-68"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)',
                backgroundSize: '10% 25%',
              }}
            >

            {devices.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                Connected audience devices will appear here. Drag fixtures to match real venue positions.
              </div>
            ) : (
              devices.map((d) => {
                const out = renderFixtureOutput(d, devices, show.groups, show.lighting, nowMs);
                const grp = show.groups.find((g) => g.id === d.groupId);
                const isSelected = selectedDeviceIds.includes(d.id);
                return (
                  <div
                    key={d.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Drag fixture ${String(d.fixtureNumber).padStart(3, '0')} ${d.name}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                      setDraggingId(d.id);
                      if (!isSelected) toggleSelect(d.id);
                    }}
                    style={{
                      left: `${d.x * 100}%`,
                      top: `${d.y * 100}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    className={`absolute flex flex-col items-center cursor-grab active:cursor-grabbing ${
                      d.status === 'disconnected' ? 'opacity-45' : ''
                    }`}
                  >
                    <div
                      className={`w-8 h-11 rounded-sm border-2 flex items-center justify-center text-[10px] font-mono-tabular font-bold shadow ${
                        isSelected ? 'border-amber-400' : 'border-slate-600'
                      }`}
                      style={{
                        backgroundColor: d.status === 'disconnected' ? '#161A22' : out.colorHex,
                        color: '#FFFFFF',
                        textShadow: '0 1px 2px rgba(0,0,0,0.9)',
                      }}
                    >
                      {String(d.fixtureNumber).padStart(3, '0')}
                    </div>
                    <span
                      className="mt-0.5 text-[10px] px-1 rounded bg-black/75 text-slate-200 whitespace-nowrap border"
                      style={{ borderColor: grp?.color || '#334155' }}
                    >
                      {d.name}
                    </span>
                  </div>
                );
              })
            )}
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            Drag any fixture icon to match physical placement. Spatial wave and bouncing flash effects follow exact X/Y coordinates.
          </p>
        </div>

        {/* Group Manager */}
        <div className="xl:col-span-4 bg-[#12151B] border border-[#232934] rounded p-3 flex flex-col gap-3">
          <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
            Audience Groups &amp; Sections
          </h3>

          <div className="flex items-center gap-2 min-w-0">
            <input
              type="color"
              aria-label="New Group Colour"
              value={newGroupColor}
              onChange={(e) => setNewGroupColor(e.target.value)}
              className="w-8 h-8 rounded bg-transparent border border-[#2B3342] cursor-pointer shrink-0"
            />
            <input
              type="text"
              aria-label="New Group Name"
              placeholder="New group name..."
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="flex-1 min-w-0 bg-[#090B0E] border border-[#2A313E] rounded px-2.5 py-1.5 text-xs text-slate-100"
            />
            <button
              type="button"
              onClick={() => {
                if (!newGroupName.trim()) return;
                onCommand('create_group', { name: newGroupName.trim(), color: newGroupColor });
                setNewGroupName('');
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400 shrink-0 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {show.groups.map((grp) => {
              const count = devices.filter((d) => d.groupId === grp.id).length;
              return (
                <div
                  key={grp.id}
                  className="bg-[#0D1015] border border-[#232934] rounded p-2.5 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: grp.color }} />
                      <input
                        type="text"
                        aria-label={`Group name ${grp.name}`}
                        defaultValue={grp.name}
                        onBlur={(e) => {
                          if (e.target.value.trim() && e.target.value !== grp.name) {
                            onCommand('update_group', { groupId: grp.id, name: e.target.value });
                          }
                        }}
                        className="bg-transparent text-xs font-semibold text-slate-100 focus:outline-none focus:border-b focus:border-amber-400 w-full"
                      />
                    </div>
                    <span className="text-[11px] font-mono-tabular text-slate-400">{count} dev</span>
                    {show.groups.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Delete group ${grp.name}`}
                        onClick={() => onCommand('delete_group', { groupId: grp.id })}
                        className="text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400 w-14">Master</span>
                    <input
                      type="range"
                      aria-label={`Master intensity for ${grp.name}`}
                      min={0}
                      max={100}
                      value={grp.masterIntensity}
                      onChange={(e) =>
                        onCommand('update_group', {
                          groupId: grp.id,
                          masterIntensity: Number(e.target.value),
                        })
                      }
                      className="flex-1 accent-amber-500"
                    />
                    <span className="font-mono-tabular text-slate-200 w-9 text-right">
                      {grp.masterIntensity}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Row: Complete Fixture Patch & Device Management Table */}
      <div className="bg-[#12151B] border border-[#232934] rounded p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
              Fixture Patch &amp; Live Device Management
            </h3>
            <span className="text-xs font-mono-tabular text-slate-400">
              {selectedDeviceIds.length} selected
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={selectAll}
              className="px-2.5 py-1 rounded bg-[#1A1F28] border border-[#2B3342] text-slate-200 hover:bg-[#232A36]"
            >
              {selectedDeviceIds.length === devices.length && devices.length > 0 ? 'Deselect All' : 'Select All'}
            </button>

            <select
              aria-label="Bulk Assign Group"
              disabled={selectedDeviceIds.length === 0}
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  onCommand('bulk_update_devices', {
                    deviceIds: selectedDeviceIds,
                    groupId: e.target.value,
                  });
                }
              }}
              className="bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1 text-slate-200 disabled:opacity-40"
            >
              <option value="">Assign Selected to Group...</option>
              {show.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={selectedDeviceIds.length === 0}
              onClick={() => onCommand('identify_devices', { deviceIds: selectedDeviceIds })}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-semibold disabled:opacity-40"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Identify Flash</span>
            </button>

            <button
              type="button"
              disabled={selectedDeviceIds.length === 0}
              onClick={() =>
                onCommand('bulk_update_devices', { deviceIds: selectedDeviceIds, excluded: true })
              }
              className="px-2.5 py-1 rounded bg-[#1A1F28] border border-[#2B3342] text-slate-200 disabled:opacity-40"
            >
              Exclude FX
            </button>

            <button
              type="button"
              disabled={selectedDeviceIds.length === 0}
              onClick={() =>
                onCommand('bulk_update_devices', { deviceIds: selectedDeviceIds, excluded: false })
              }
              className="px-2.5 py-1 rounded bg-[#1A1F28] border border-[#2B3342] text-slate-200 disabled:opacity-40"
            >
              Include FX
            </button>

            <button
              type="button"
              disabled={selectedDeviceIds.length === 0}
              onClick={() => {
                onCommand('disconnect_devices', { deviceIds: selectedDeviceIds });
                onChangeSelectedDeviceIds([]);
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-red-950/60 border border-red-800/60 text-red-300 disabled:opacity-40"
            >
              <Unplug className="w-3.5 h-3.5" />
              <span>Disconnect</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#232934] text-slate-400">
                <th className="py-2 px-2 w-8">Sel</th>
                <th className="py-2 px-2">No.</th>
                <th className="py-2 px-2">Device ID</th>
                <th className="py-2 px-2">Name</th>
                <th className="py-2 px-2">Type</th>
                <th className="py-2 px-2">Orient</th>
                <th className="py-2 px-2">Status</th>
                <th className="py-2 px-2">Battery</th>
                <th className="py-2 px-2">Last Comm</th>
                <th className="py-2 px-2">Group</th>
                <th className="py-2 px-2">Colour</th>
                <th className="py-2 px-2">Effect</th>
                <th className="py-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-8 text-center text-slate-500">
                    No fixtures registered yet. Have audience members scan the QR code or open /join.
                  </td>
                </tr>
              ) : (
                devices.map((d, idx) => {
                  const out = renderFixtureOutput(d, devices, show.groups, show.lighting, nowMs);
                  const isSel = selectedDeviceIds.includes(d.id);
                  const lastSec = Math.max(0, Math.round((Date.now() - d.lastSeenMs) / 1000));
                  return (
                    <tr
                      key={d.id}
                      className={`border-b border-[#1A1F28] ${
                        isSel ? 'bg-amber-500/10' : 'hover:bg-[#171B23]'
                      }`}
                    >
                      <td className="py-2 px-2">
                        <input
                          type="checkbox"
                          aria-label={`Select fixture ${String(d.fixtureNumber).padStart(3, '0')}`}
                          checked={isSel}
                          onChange={() => toggleSelect(d.id)}
                        />
                      </td>
                      <td className="py-2 px-2 font-mono-tabular font-semibold text-amber-400">
                        {String(d.fixtureNumber).padStart(3, '0')}
                      </td>
                      <td className="py-2 px-2 font-mono-tabular text-slate-400">{d.id}</td>
                      <td className="py-2 px-2">
                        {editingNameId === d.id ? (
                          <input
                            type="text"
                            autoFocus
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onBlur={() => {
                              onCommand('update_device', { deviceId: d.id, name: nameDraft });
                              setEditingNameId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                onCommand('update_device', { deviceId: d.id, name: nameDraft });
                                setEditingNameId(null);
                              }
                            }}
                            className="bg-[#090B0E] border border-amber-400 rounded px-1.5 py-0.5 text-slate-100 w-28"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingNameId(d.id);
                              setNameDraft(d.name);
                            }}
                            className="text-slate-100 hover:text-amber-300 text-left font-medium"
                            title="Click to rename"
                          >
                            {d.name}
                          </button>
                        )}
                      </td>
                      <td className="py-2 px-2 capitalize text-slate-300">{d.deviceType}</td>
                      <td className="py-2 px-2 capitalize text-slate-300">{d.orientation}</td>
                      <td className="py-2 px-2">
                        <span
                          className={`font-medium ${
                            d.status === 'connected' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {d.status === 'connected' ? 'Connected' : 'Disconnected'}
                        </span>
                      </td>
                      <td className="py-2 px-2 font-mono-tabular text-slate-300">
                        {d.batteryLevel !== null ? (
                          <span className="inline-flex items-center gap-1">
                            <Battery className="w-3.5 h-3.5 text-slate-400" />
                            {d.batteryLevel}%
                          </span>
                        ) : (
                          'N/A'
                        )}
                      </td>
                      <td className="py-2 px-2 font-mono-tabular text-slate-400">
                        {lastSec === 0 ? 'Now' : `${lastSec}s ago`}
                      </td>
                      <td className="py-2 px-2">
                        <select
                          aria-label={`Group for ${d.name}`}
                          value={d.groupId}
                          onChange={(e) =>
                            onCommand('update_device', { deviceId: d.id, groupId: e.target.value })
                          }
                          className="bg-[#090B0E] border border-[#2A313E] rounded px-1.5 py-1 text-slate-200"
                        >
                          {show.groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-2 font-mono-tabular">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3.5 h-3.5 rounded-sm border border-slate-600"
                            style={{ backgroundColor: out.colorHex }}
                          />
                          <span>{out.colorHex}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-slate-300 max-w-[130px] truncate">
                        {d.excluded ? 'Excluded' : activeEffectName}
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            aria-label={`Move ${d.name} up`}
                            onClick={() =>
                              onCommand('reorder_device', { deviceId: d.id, direction: 'up' })
                            }
                            className="p-1 rounded bg-[#1A1F28] text-slate-300 disabled:opacity-30"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === devices.length - 1}
                            aria-label={`Move ${d.name} down`}
                            onClick={() =>
                              onCommand('reorder_device', { deviceId: d.id, direction: 'down' })
                            }
                            className="p-1 rounded bg-[#1A1F28] text-slate-300 disabled:opacity-30"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Identify ${d.name}`}
                            onClick={() => onCommand('identify_devices', { deviceIds: [d.id] })}
                            className="p-1 rounded bg-[#1A1F28] text-amber-400 hover:bg-[#232A36]"
                            title="Flash Identify"
                          >
                            <Zap className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
