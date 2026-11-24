import React, { useState } from 'react';
import { BookOpen, Copy, Download, FolderOpen, Plus, Trash2, Upload } from 'lucide-react';
import { ShowFile } from '../../shared/types';

interface ShowsSettingsPanelProps {
  activeShow: ShowFile;
  showsList: ShowFile[];
  onCreateShow: (name: string) => Promise<ShowFile | null>;
  onRenameShow: (showId: string, name: string) => Promise<ShowFile | null>;
  onActivateShow: (showId: string) => Promise<void>;
  onDuplicateShow: (showId: string) => Promise<void>;
  onDeleteShow: (showId: string) => Promise<void>;
  onImportShow: (raw: unknown) => Promise<ShowFile | null>;
  onCommand: (action: string, payload?: Record<string, unknown>) => void;
}

export const ShowsSettingsPanel: React.FC<ShowsSettingsPanelProps> = ({
  activeShow,
  showsList,
  onCreateShow,
  onRenameShow,
  onActivateShow,
  onDuplicateShow,
  onDeleteShow,
  onImportShow,
  onCommand,
}) => {
  const [newShowName, setNewShowName] = useState('');
  const [renameDraft, setRenameDraft] = useState(activeShow.name);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const exportShowJson = (show: ShowFile) => {
    const blob = new Blob([JSON.stringify(show, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${show.id}.lumenlink.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = await onImportShow(parsed);
      setImportStatus(imported ? `Imported "${imported.name}"` : 'Invalid LUMENLINK show file');
    } catch {
      setImportStatus('Failed to parse JSON show file');
    }
    e.target.value = '';
  };

  const aud = activeShow.audienceSettings;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 text-xs">
      {/* Show File Management */}
      <div className="xl:col-span-6 bg-[#12151B] border border-[#232934] rounded p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-amber-400" />
            <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
              Show File Management
            </h3>
          </div>
          <label className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#1A1F28] border border-[#2B3342] text-slate-200 cursor-pointer hover:bg-[#232A36]">
            <Upload className="w-3.5 h-3.5" />
            <span>Import Show JSON</span>
            <input type="file" accept=".json" onChange={handleImportFile} className="hidden" />
          </label>
        </div>

        {importStatus && (
          <div className="px-3 py-2 rounded bg-[#0D1015] border border-amber-500/40 text-amber-200">
            {importStatus}
          </div>
        )}

        {/* Create Show */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newShowName.trim()) return;
            await onCreateShow(newShowName.trim());
            setNewShowName('');
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            aria-label="New Show Name"
            placeholder="New show name (e.g., Arena Tour 2026)..."
            value={newShowName}
            onChange={(e) => setNewShowName(e.target.value)}
            className="flex-1 bg-[#090B0E] border border-[#2A313E] rounded px-2.5 py-1.5 text-slate-100"
          />
          <button
            type="submit"
            className="flex items-center gap-1 px-3 py-1.5 rounded font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Show</span>
          </button>
        </form>

        {/* Rename Active Show */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (renameDraft.trim()) {
              await onRenameShow(activeShow.id, renameDraft.trim());
            }
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            aria-label="Rename Active Show"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            className="flex-1 bg-[#090B0E] border border-[#2A313E] rounded px-2.5 py-1.5 text-slate-100"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded bg-[#1A1F28] border border-[#2B3342] text-slate-200 hover:bg-[#232A36]"
          >
            Rename Active
          </button>
        </form>

        {/* Saved Shows List */}
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {showsList.map((s) => {
            const isActive = s.id === activeShow.id;
            return (
              <div
                key={s.id}
                className={`flex items-center justify-between gap-2 p-2.5 rounded border ${
                  isActive
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-[#232934] bg-[#0D1015]'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-100 truncate">{s.name}</div>
                  <div className="text-[11px] font-mono-tabular text-slate-400">
                    Code: {s.joinCode} · {s.cues.length} cues · {s.groups.length} groups
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => onActivateShow(s.id)}
                      className="px-2 py-1 rounded bg-emerald-600 text-white font-semibold"
                    >
                      Load
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Export ${s.name}`}
                    onClick={() => exportShowJson(s)}
                    className="p-1.5 rounded bg-[#1A1F28] text-slate-300 hover:text-white"
                    title="Export Show JSON"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Duplicate ${s.name}`}
                    onClick={() => onDuplicateShow(s.id)}
                    className="p-1.5 rounded bg-[#1A1F28] text-slate-300 hover:text-white"
                    title="Duplicate Show"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {showsList.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Delete ${s.name}`}
                      onClick={() => onDeleteShow(s.id)}
                      className="p-1.5 rounded bg-[#1A1F28] text-slate-400 hover:text-red-400"
                      title="Delete Show"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Audience Welcome Experience + Operations Guide */}
      <div className="xl:col-span-6 flex flex-col gap-4">
        <div className="bg-[#12151B] border border-[#232934] rounded p-4 space-y-3">
          <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
            Audience Welcome Screen Customisation
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-slate-300">
              <span>Event Title</span>
              <input
                type="text"
                value={aud.eventTitle}
                onChange={(e) =>
                  onCommand('update_audience_settings', {
                    settings: { eventTitle: e.target.value },
                  })
                }
                className="bg-[#090B0E] border border-[#2A313E] rounded px-2.5 py-1.5 text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-slate-300">
              <span>Brand Accent Colour</span>
              <input
                type="color"
                value={aud.brandColor}
                onChange={(e) =>
                  onCommand('update_audience_settings', {
                    settings: { brandColor: e.target.value },
                  })
                }
                className="w-full h-8 rounded bg-transparent border border-[#2A313E]"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-slate-300">
            <span>Host Welcome Message</span>
            <textarea
              rows={2}
              value={aud.welcomeMessage}
              onChange={(e) =>
                onCommand('update_audience_settings', {
                  settings: { welcomeMessage: e.target.value },
                })
              }
              className="bg-[#090B0E] border border-[#2A313E] rounded px-2.5 py-1.5 text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-slate-300">
            <span>Optional Audience Instructions</span>
            <input
              type="text"
              value={aud.instructions}
              onChange={(e) =>
                onCommand('update_audience_settings', {
                  settings: { instructions: e.target.value },
                })
              }
              className="bg-[#090B0E] border border-[#2A313E] rounded px-2.5 py-1.5 text-slate-100"
            />
          </label>
        </div>

        {/* Setup & Operations Manual */}
        <div className="bg-[#12151B] border border-[#232934] rounded p-4 space-y-2.5 text-slate-300 leading-relaxed">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-amber-400" />
            <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
              Deployment, Windows LAN &amp; Offline Hotspot Guide
            </h3>
          </div>
          <p>
            <strong>Windows / Local Venue Setup:</strong> Install Node.js 20+, run{' '}
            <code className="font-mono-tabular text-amber-300">npm install &amp;&amp; npm run dev</code>, and allow port 3000 through Windows Defender Firewall.
          </p>
          <p>
            <strong>Internet-Free Venue Mode:</strong> Enable Mobile Hotspot on the host Windows laptop or connect to a dedicated local Wi-Fi router. Switch Join Mode to <em>Local LAN / Hotspot</em> and print the generated QR poster—audience phones connect directly to the host IP without internet access.
          </p>
          <p>
            <strong>Remote Cloud Mode:</strong> Deploy with <code className="font-mono-tabular text-amber-300">npm run build &amp;&amp; npm start</code> behind HTTPS/WSS (optionally set <code className="font-mono-tabular text-amber-300">HOST_PASSCODE</code> in environment secrets).
          </p>
        </div>
      </div>
    </div>
  );
};
