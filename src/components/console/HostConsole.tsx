import React, { useState } from 'react';
import {
  Film,
  FolderCog,
  Grid,
  Layers,
  Lock,
  Palette,
  PlaySquare,
  QrCode,
  Radio,
  Sliders,
} from 'lucide-react';
import { useHostSocket } from '../../hooks/useHostSocket';
import { SafetyBar, VerticalFader } from './HardwareControls';
import { LiveVisualiser } from './LiveVisualiser';
import { ColorPanel } from './ColorPanel';
import { EffectEditorPanel } from './EffectEditorPanel';
import { FixtureLayoutPanel } from './FixtureLayoutPanel';
import { CueTimelinePanel } from './CueTimelinePanel';
import { MediaPanel } from './MediaPanel';
import { JoinPosterStudio } from './JoinPosterStudio';
import { ShowsSettingsPanel } from './ShowsSettingsPanel';

type ConsoleTab =
  | 'colour'
  | 'effects'
  | 'fixtures'
  | 'cues'
  | 'media'
  | 'join'
  | 'shows';

export const HostConsole: React.FC = () => {
  const host = useHostSocket();
  const [activeTab, setActiveTab] = useState<ConsoleTab>('colour');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [visualiserFullscreen, setVisualiserFullscreen] = useState(false);
  const [workspaceLayout, setWorkspaceLayout] = useState<'split' | 'stacked'>('split');
  const [passcodeInput, setPasscodeInput] = useState('');

  if (host.requiresPasscode) {
    return (
      <div className="min-h-screen bg-[#0B0D10] text-slate-100 flex items-center justify-center p-6">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await host.authenticateHost(passcodeInput);
          }}
          className="w-full max-w-sm bg-[#12151B] border border-[#232934] rounded p-6 space-y-4"
        >
          <div className="flex items-center gap-2 text-amber-400">
            <Lock className="w-5 h-5" />
            <h1 className="font-display text-lg font-bold tracking-wider uppercase">
              LUMENLINK Host Authentication
            </h1>
          </div>
          <p className="text-xs text-slate-400">
            Enter the configured host console passcode to unlock live lighting control.
          </p>
          {host.passcodeError && (
            <div className="text-xs text-red-400 bg-red-950/50 border border-red-800 rounded p-2">
              {host.passcodeError}
            </div>
          )}
          <input
            type="password"
            aria-label="Host Passcode"
            value={passcodeInput}
            onChange={(e) => setPasscodeInput(e.target.value)}
            placeholder="Host passcode..."
            className="w-full bg-[#090B0E] border border-[#2A313E] rounded px-3 py-2 text-sm text-slate-100"
          />
          <button
            type="submit"
            className="w-full py-2 rounded font-semibold text-sm bg-amber-500 text-slate-950 hover:bg-amber-400"
          >
            Unlock Console
          </button>
        </form>
      </div>
    );
  }

  const show = host.show;
  const onlineCount = host.devices.filter((d) => d.status === 'connected').length;

  const toggleSelectDevice = (id: string) => {
    setSelectedDeviceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const tabs: Array<{ id: ConsoleTab; label: string; icon: React.ReactNode }> = [
    { id: 'colour', label: 'Colour', icon: <Palette className="w-3.5 h-3.5" /> },
    { id: 'effects', label: 'Effects', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'fixtures', label: 'Fixtures & Map', icon: <Grid className="w-3.5 h-3.5" /> },
    { id: 'cues', label: 'Cues & Timeline', icon: <PlaySquare className="w-3.5 h-3.5" /> },
    { id: 'media', label: 'Media', icon: <Film className="w-3.5 h-3.5" /> },
    { id: 'join', label: 'Join & Poster', icon: <QrCode className="w-3.5 h-3.5" /> },
    { id: 'shows', label: 'Shows & Setup', icon: <FolderCog className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="min-h-screen bg-[#0B0D10] text-slate-100 flex flex-col">
      {/* Top Console Header — Clean 3-zone layout */}
      <header className="h-14 px-4 bg-gradient-to-b from-[#151A24] to-[#0E1117] border-b border-[#252D3B] flex items-center justify-between gap-6 shrink-0 shadow-[0_4px_16px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_#F59E0B]" />
          <span className="font-display text-lg font-bold tracking-widest text-amber-400 whitespace-nowrap">
            LUMENLINK
          </span>
        </div>

        <nav className="flex items-center gap-1.5 overflow-x-auto py-1">
          {tabs.map((t) => {
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded text-xs whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'console-btn-amber font-semibold'
                    : 'console-btn text-slate-300 font-medium hover:text-white'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('join')}
            className="console-btn flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold text-amber-300 whitespace-nowrap shrink-0"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                onlineCount > 0
                  ? 'bg-emerald-400 shadow-[0_0_6px_#34D399]'
                  : 'bg-amber-400/80 shadow-[0_0_6px_#F59E0B]'
              }`}
            />
            <span>QR / Join ({onlineCount})</span>
          </button>
        </div>
      </header>

      {/* Secondary Console Workspace Bar (Show Switcher + Safety Strip + Layout Toggle) */}
      <div className="px-4 py-2 bg-[#0D1016] border-b border-[#202631] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 font-mono-tabular console-well px-2.5 py-1 rounded">
            <Radio
              className={`w-3.5 h-3.5 ${
                host.connected
                  ? 'text-emerald-400'
                  : host.httpSynced
                    ? 'text-sky-400'
                    : 'text-amber-400'
              }`}
            />
            <span
              className={
                host.connected
                  ? 'text-emerald-400'
                  : host.httpSynced
                    ? 'text-sky-400'
                    : 'text-amber-400'
              }
            >
              {host.connected ? 'SERVER SYNC' : host.httpSynced ? 'HTTP SYNC' : 'SYNCING'}
            </span>
          </div>
          <label className="flex items-center gap-1.5 text-slate-300">
            <span className="text-slate-400">Show:</span>
            <select
              aria-label="Active Show Selector"
              value={show.id}
              onChange={(e) => host.activateShow(e.target.value)}
              className="console-well rounded px-2.5 py-1 text-xs font-medium text-slate-100 focus:outline-none focus:border-amber-400"
            >
              {(host.showsList.length > 0 ? host.showsList : [show]).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <span className="font-mono-tabular text-slate-400 console-well px-2.5 py-1 rounded">
            Devices: <strong className="text-slate-100">{onlineCount}</strong>/{host.devices.length}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SafetyBar lighting={show.lighting} onCommand={host.sendHostCommand} />
          <button
            type="button"
            onClick={() =>
              setWorkspaceLayout((l) => (l === 'split' ? 'stacked' : 'split'))
            }
            aria-label="Toggle Workspace Layout"
            className="console-btn flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-slate-200 whitespace-nowrap"
            title="Switch Console Workspace Layout"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-400" />
            <span>{workspaceLayout === 'split' ? 'Split Desk' : 'Stacked Desk'}</span>
          </button>
        </div>
      </div>

      {/* Main Console Body */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Master Fader Wing */}
        <aside className="lg:w-56 bg-gradient-to-b from-[#11151E] to-[#0B0E14] border-b lg:border-b-0 lg:border-r border-[#222937] p-3 flex lg:flex-col items-center lg:items-stretch gap-4 overflow-x-auto shrink-0">
          <div className="flex items-center justify-center gap-3">
            <VerticalFader
              label="MASTER"
              value={show.lighting.masterIntensity}
              accentColor="#F59E0B"
              onChange={(val) => host.sendHostCommand('set_master_intensity', { intensity: val })}
            />
            {show.groups.slice(0, 1).map((grp) => (
              <VerticalFader
                key={grp.id}
                label={grp.name.slice(0, 9)}
                value={grp.masterIntensity}
                accentColor={grp.color}
                onChange={(val) =>
                  host.sendHostCommand('update_group', { groupId: grp.id, masterIntensity: val })
                }
              />
            ))}
          </div>

          <div className="hidden lg:block border-t border-[#222833] pt-3 space-y-2.5">
            <div className="text-[11px] font-display uppercase tracking-wider text-slate-400">
              Group Masters
            </div>
            {show.groups.map((grp) => {
              const fillTrack = `linear-gradient(90deg, ${grp.color} 0%, ${grp.color} ${grp.masterIntensity}%, #07090D ${grp.masterIntensity}%, #07090D 100%)`;
              return (
                <div key={grp.id} className="space-y-1 console-well p-2 rounded">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-slate-200 font-medium truncate">
                      <span
                        className="w-2 h-2 rounded-xs shrink-0"
                        style={{ backgroundColor: grp.color, boxShadow: `0 0 6px ${grp.color}` }}
                      />
                      {grp.name}
                    </span>
                    <span className="font-mono-tabular text-amber-200">{grp.masterIntensity}%</span>
                  </div>
                  <input
                    type="range"
                    aria-label={`${grp.name} Master Fader`}
                    min={0}
                    max={100}
                    value={grp.masterIntensity}
                    style={{ '--slider-track-bg': fillTrack } as React.CSSProperties}
                    onChange={(e) =>
                      host.sendHostCommand('update_group', {
                        groupId: grp.id,
                        masterIntensity: Number(e.target.value),
                      })
                    }
                    className="w-full"
                  />
                </div>
              );
            })}
          </div>

          <div className="hidden lg:block border-t border-[#222833] pt-3 space-y-1.5 mt-auto">
            <div className="text-[11px] font-display uppercase tracking-wider text-slate-400">
              Quick Cue Executors
            </div>
            {show.cues.slice(0, 4).map((cue, idx) => {
              const isActiveCue = show.playback.activeCueId === cue.id;
              return (
                <button
                  key={cue.id}
                  type="button"
                  onClick={() => host.sendHostCommand('cue_go', { cueIndex: idx })}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded text-[11px] ${
                    isActiveCue
                      ? 'console-btn-emerald font-semibold'
                      : 'console-btn text-slate-200'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isActiveCue ? 'bg-white shadow-[0_0_5px_#fff]' : 'bg-slate-600'
                      }`}
                    />
                    <span className="truncate">
                      {cue.cueNumber}. {cue.name}
                    </span>
                  </span>
                  <span
                    className="w-2.5 h-2.5 rounded-xs shrink-0 ml-1 border border-black/40"
                    style={{ backgroundColor: cue.colour }}
                  />
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main Workspace Viewport */}
        <main className="flex-1 p-4 overflow-y-auto flex flex-col gap-4">
          {workspaceLayout === 'stacked' && (
            <div className="shrink-0">
              <LiveVisualiser
                devices={host.devices}
                groups={show.groups}
                lighting={show.lighting}
                serverOffsetMs={host.serverOffsetMs}
                selectedDeviceIds={selectedDeviceIds}
                onToggleSelectDevice={toggleSelectDevice}
                fullscreenOpen={visualiserFullscreen}
                onToggleFullscreen={() => setVisualiserFullscreen((v) => !v)}
              />
            </div>
          )}

          <div
            className={
              workspaceLayout === 'split'
                ? 'grid grid-cols-1 xl:grid-cols-12 gap-4 items-start'
                : 'flex flex-col gap-4'
            }
          >
            <div className={workspaceLayout === 'split' ? 'xl:col-span-9 min-w-0' : ''}>
              {activeTab === 'colour' && (
                <ColorPanel
                  show={show}
                  devices={host.devices}
                  selectedDeviceIds={selectedDeviceIds}
                  onCommand={host.sendHostCommand}
                />
              )}
              {activeTab === 'effects' && (
                <EffectEditorPanel
                  show={show}
                  devices={host.devices}
                  serverOffsetMs={host.serverOffsetMs}
                  onCommand={host.sendHostCommand}
                />
              )}
              {activeTab === 'fixtures' && (
                <FixtureLayoutPanel
                  show={show}
                  devices={host.devices}
                  serverOffsetMs={host.serverOffsetMs}
                  selectedDeviceIds={selectedDeviceIds}
                  onChangeSelectedDeviceIds={setSelectedDeviceIds}
                  onCommand={host.sendHostCommand}
                />
              )}
              {activeTab === 'cues' && (
                <CueTimelinePanel
                  show={show}
                  mediaAssets={host.mediaAssets}
                  serverOffsetMs={host.serverOffsetMs}
                  onCommand={host.sendHostCommand}
                />
              )}
              {activeTab === 'media' && (
                <MediaPanel
                  show={show}
                  devices={host.devices}
                  mediaAssets={host.mediaAssets}
                  selectedDeviceIds={selectedDeviceIds}
                  onUploadMedia={host.uploadMedia}
                  onDeleteMedia={host.deleteMedia}
                  onCommand={host.sendHostCommand}
                />
              )}
              {activeTab === 'join' && (
                <JoinPosterStudio
                  show={show}
                  networkInfo={host.networkInfo}
                  onSetConnectivityMode={host.setConnectivityMode}
                  onCommand={host.sendHostCommand}
                />
              )}
              {activeTab === 'shows' && (
                <ShowsSettingsPanel
                  activeShow={show}
                  showsList={host.showsList}
                  onCreateShow={host.createShow}
                  onRenameShow={host.renameShow}
                  onActivateShow={host.activateShow}
                  onDuplicateShow={host.duplicateShow}
                  onDeleteShow={host.deleteShow}
                  onImportShow={host.importShowFile}
                  onCommand={host.sendHostCommand}
                />
              )}
            </div>

            {workspaceLayout === 'split' && (
              <div className="xl:col-span-3 min-w-0">
                <LiveVisualiser
                  devices={host.devices}
                  groups={show.groups}
                  lighting={show.lighting}
                  serverOffsetMs={host.serverOffsetMs}
                  selectedDeviceIds={selectedDeviceIds}
                  onToggleSelectDevice={toggleSelectDevice}
                  fullscreenOpen={visualiserFullscreen}
                  onToggleFullscreen={() => setVisualiserFullscreen((v) => !v)}
                />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
