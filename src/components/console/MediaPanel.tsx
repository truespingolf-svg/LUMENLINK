import React, { useEffect, useState } from 'react';
import { Film, Image as ImageIcon, Play, Square, Trash2, Upload } from 'lucide-react';
import { AudienceDevice, MediaAsset, MediaFitMode, ShowFile } from '../../shared/types';

interface MediaPanelProps {
  show: ShowFile;
  devices: AudienceDevice[];
  mediaAssets: MediaAsset[];
  selectedDeviceIds: string[];
  onUploadMedia: (file: File) => Promise<{ ok: boolean; asset?: MediaAsset; error?: string }>;
  onDeleteMedia: (mediaId: string) => Promise<void>;
  onCommand: (action: string, payload?: Record<string, unknown>) => void;
}

export const MediaPanel: React.FC<MediaPanelProps> = ({
  show,
  devices,
  mediaAssets,
  selectedDeviceIds,
  onUploadMedia,
  onDeleteMedia,
  onCommand,
}) => {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [targetMode, setTargetMode] = useState<'all' | 'group' | 'selected'>('all');
  const [targetGroupId, setTargetGroupId] = useState(show.groups[0]?.id || 'grp-floor');
  const [sequenceRunning, setSequenceRunning] = useState(false);

  const m = show.lighting.media;

  // Image sequence auto-advancer when sequenceRunning is enabled
  useEffect(() => {
    if (!sequenceRunning || mediaAssets.length === 0) return;
    let idx = 0;
    const timer = window.setInterval(() => {
      idx = (idx + 1) % mediaAssets.length;
      const asset = mediaAssets[idx];
      onCommand('set_media_projection', {
        media: {
          enabled: true,
          mediaId: asset.id,
          url: asset.url,
          kind: asset.kind,
          playbackStartServerMs: Date.now(),
          isPlaying: asset.kind === 'video',
        },
      });
    }, Math.max(1000, m.sequenceIntervalMs || 3000));
    return () => window.clearInterval(timer);
  }, [sequenceRunning, mediaAssets, m.sequenceIntervalMs, onCommand]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    const res = await onUploadMedia(file);
    setUploading(false);
    if (!res.ok) {
      setUploadError(res.error || 'Upload failed');
    } else if (res.asset) {
      projectAsset(res.asset);
    }
    e.target.value = '';
  };

  const projectAsset = (asset: MediaAsset) => {
    onCommand('set_media_projection', {
      media: {
        enabled: true,
        mediaId: asset.id,
        url: asset.url,
        kind: asset.kind,
        targetGroupId: targetMode === 'group' ? targetGroupId : 'all',
        targetDeviceIds: targetMode === 'selected' ? selectedDeviceIds : [],
        playbackStartServerMs: Date.now(),
        isPlaying: asset.kind === 'video',
      },
    });
  };

  const updateProjection = (patch: Partial<typeof m>) => {
    onCommand('set_media_projection', { media: patch });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      {/* Left: Upload & Media Library */}
      <div className="xl:col-span-7 console-panel rounded-md p-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
              Media Library &amp; Distribution Server
            </h3>
            <p className="text-xs text-slate-400">
              Supports PNG, JPG, WEBP, animated GIF, MP4 and WEBM video. Files are served directly from the host server to all audience devices.
            </p>
          </div>

          <label className="console-btn-amber flex items-center gap-1.5 px-3 py-2 rounded text-xs font-semibold cursor-pointer shrink-0">
            <Upload className="w-3.5 h-3.5" />
            <span>{uploading ? 'Uploading...' : 'Upload Media'}</span>
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        </div>

        {uploadError && (
          <div className="bg-red-950/60 border border-red-800 text-red-200 px-3 py-2 rounded text-xs">
            {uploadError}
          </div>
        )}

        {mediaAssets.length === 0 ? (
          <div className="border border-dashed border-[#2C3342] rounded p-10 text-center text-xs text-slate-400">
            <ImageIcon className="w-8 h-8 mx-auto mb-2 text-slate-500" />
            <p className="text-slate-300 font-medium">No media uploaded yet</p>
            <p className="mt-1 text-slate-500">
              Upload an image, GIF, or video to project it across all audience screens.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {mediaAssets.map((asset) => {
              const isLive = m.enabled && m.mediaId === asset.id;
              return (
                <div
                  key={asset.id}
                  className={`rounded border overflow-hidden bg-[#0D1015] flex flex-col ${
                    isLive ? 'border-amber-400' : 'border-[#232934]'
                  }`}
                >
                  <div className="relative h-28 bg-black flex items-center justify-center overflow-hidden">
                    {asset.kind === 'video' ? (
                      <video
                        src={asset.url}
                        muted
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img
                        src={asset.url}
                        alt={asset.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    )}
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono-tabular uppercase text-slate-200">
                      {asset.kind}
                    </span>
                  </div>
                  <div className="p-2 flex flex-col gap-2">
                    <div className="text-xs font-medium text-slate-200 truncate">{asset.name}</div>
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => projectAsset(asset)}
                        className={`flex-1 py-1 rounded text-xs font-semibold ${
                          isLive
                            ? 'bg-emerald-600 text-white'
                            : 'bg-[#1A1F28] text-amber-400 hover:bg-[#232A36]'
                        }`}
                      >
                        {isLive ? 'Live on Screens' : 'Project'}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${asset.name}`}
                        onClick={() => onDeleteMedia(asset.id)}
                        className="p-1.5 rounded bg-[#1A1F28] text-slate-400 hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: Projection Controls, Scaling, Cropping, Sync Video */}
      <div className="xl:col-span-5 console-panel rounded-md p-4 space-y-4 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-amber-400" />
            <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
              Projection Settings
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onCommand('clear_media_projection')}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-red-950/60 border border-red-800/60 text-red-200 hover:border-red-500/70"
          >
            <Square className="w-3 h-3" />
            <span>Stop Media</span>
          </button>
        </div>

        {/* Target audience */}
        <div className="space-y-2">
          <span className="text-slate-400">Projection Target</span>
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'group', 'selected'] as const).map((tm) => (
              <button
                key={tm}
                type="button"
                onClick={() => {
                  setTargetMode(tm);
                  updateProjection({
                    targetGroupId: tm === 'group' ? targetGroupId : 'all',
                    targetDeviceIds: tm === 'selected' ? selectedDeviceIds : [],
                  });
                }}
                className={`px-2.5 py-1 rounded font-medium capitalize ${
                  targetMode === tm
                    ? 'console-btn-amber font-semibold'
                    : 'console-btn text-slate-300'
                }`}
              >
                {tm === 'selected' ? `Selected (${selectedDeviceIds.length})` : tm}
              </button>
            ))}
            {targetMode === 'group' && (
              <select
                aria-label="Target Group for Media"
                value={targetGroupId}
                onChange={(e) => {
                  setTargetGroupId(e.target.value);
                  updateProjection({ targetGroupId: e.target.value, targetDeviceIds: [] });
                }}
                className="console-well rounded px-2 py-1 text-slate-200"
              >
                {show.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Fit Mode */}
        <div className="space-y-2">
          <span className="text-slate-400">Fit / Fill Mode</span>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'cover', label: 'Fill Screen' },
                { id: 'contain', label: 'Fit Inside' },
                { id: 'fill', label: 'Stretch' },
              ] as Array<{ id: MediaFitMode; label: string }>
            ).map((fm) => (
              <button
                key={fm.id}
                type="button"
                onClick={() => updateProjection({ fitMode: fm.id })}
                className={`py-1.5 rounded font-medium ${
                  m.fitMode === fm.id
                    ? 'console-btn-amber font-semibold'
                    : 'console-btn text-slate-300'
                }`}
              >
                {fm.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scale, Opacity, Crop */}
        <div className="space-y-2.5">
          <label className="flex items-center justify-between gap-3 text-slate-300">
            <span className="w-24">Opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={m.opacity}
              onChange={(e) => updateProjection({ opacity: Number(e.target.value) })}
              className="flex-1 accent-amber-500"
            />
            <span className="w-12 text-right font-mono-tabular">{Math.round(m.opacity * 100)}%</span>
          </label>

          <label className="flex items-center justify-between gap-3 text-slate-300">
            <span className="w-24">Scale</span>
            <input
              type="range"
              min={0.5}
              max={2.5}
              step={0.05}
              value={m.scale}
              onChange={(e) => updateProjection({ scale: Number(e.target.value) })}
              className="flex-1 accent-amber-500"
            />
            <span className="w-12 text-right font-mono-tabular">{m.scale.toFixed(2)}x</span>
          </label>

          <label className="flex items-center justify-between gap-3 text-slate-300">
            <span className="w-24">Crop X (%)</span>
            <input
              type="range"
              min={0}
              max={100}
              value={m.cropX}
              onChange={(e) => updateProjection({ cropX: Number(e.target.value) })}
              className="flex-1 accent-amber-500"
            />
            <span className="w-12 text-right font-mono-tabular">{m.cropX}%</span>
          </label>

          <label className="flex items-center justify-between gap-3 text-slate-300">
            <span className="w-24">Crop Y (%)</span>
            <input
              type="range"
              min={0}
              max={100}
              value={m.cropY}
              onChange={(e) => updateProjection({ cropY: Number(e.target.value) })}
              className="flex-1 accent-amber-500"
            />
            <span className="w-12 text-right font-mono-tabular">{m.cropY}%</span>
          </label>

          <label className="flex items-center justify-between gap-3 text-slate-300">
            <span className="w-24">Fade Time</span>
            <input
              type="number"
              min={0}
              max={5000}
              step={100}
              value={m.fadeTimeMs}
              onChange={(e) => updateProjection({ fadeTimeMs: Number(e.target.value) })}
              className="w-24 bg-[#090B0E] border border-[#2A313E] rounded px-2 py-1 font-mono-tabular text-slate-100"
            />
          </label>
        </div>

        {/* Synchronised Video Playback & Image Sequence */}
        <div className="border-t border-[#222833] pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-slate-300 font-medium">Image Sequence Slideshow</span>
            <button
              type="button"
              disabled={mediaAssets.length === 0}
              onClick={() => setSequenceRunning(!sequenceRunning)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded font-semibold ${
                sequenceRunning
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#1A1F28] border border-[#2B3342] text-slate-200 disabled:opacity-40'
              }`}
            >
              <Play className="w-3 h-3" />
              <span>{sequenceRunning ? 'Stop Sequence' : 'Run Sequence'}</span>
            </button>
          </div>

          {m.kind === 'video' && m.enabled && (
            <div className="bg-[#0D1015] border border-[#232934] rounded p-2.5 flex items-center justify-between">
              <span className="text-slate-300">Synchronised Video Clock</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    updateProjection({
                      isPlaying: !m.isPlaying,
                      playbackStartServerMs: Date.now(),
                    })
                  }
                  className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-semibold"
                >
                  {m.isPlaying ? 'Pause Video' : 'Resync & Play'}
                </button>
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            Targeting {devices.filter((d) => d.status === 'connected').length} online devices. Videos automatically align playback time against the host server clock.
          </p>
        </div>
      </div>
    </div>
  );
};
