import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Printer,
  QrCode,
  RefreshCw,
  Upload,
} from 'lucide-react';
import {
  ConnectivityMode,
  NetworkInfo,
  PosterDesign,
  PosterElementLayout,
  PosterTemplateId,
  ShowFile,
} from '../../shared/types';
import { POSTER_TEMPLATES } from '../../engine/shows';
import {
  deriveSharedPreviewUrl,
  JoinUrlProbeStatus,
  resolvePublicJoinBaseUrl,
} from '../../server/networkUtils';

interface JoinPosterStudioProps {
  show: ShowFile;
  networkInfo: NetworkInfo | null;
  onSetConnectivityMode?: (mode: ConnectivityMode) => void;
  onCommand: (action: string, payload?: Record<string, unknown>) => void;
}

interface JoinProbeState {
  checking: boolean;
  status: JoinUrlProbeStatus | null;
  httpStatus: number | null;
  detail: string;
}

const CUSTOM_REMOTE_URL_KEY = 'lumenlink_custom_remote_base_url';

function isPrivateOrLocalBase(url: string): boolean {
  return /^https?:\/\/(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);
}

export const JoinPosterStudio: React.FC<JoinPosterStudioProps> = ({
  show,
  networkInfo,
  onCommand,
}) => {
  const design = show.posterDesign;
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrSvgString, setQrSvgString] = useState<string>('');
  const [customRemoteBase, setCustomRemoteBase] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem(CUSTOM_REMOTE_URL_KEY) || '';
      if (!saved || isPrivateOrLocalBase(saved)) {
        if (saved) window.localStorage.removeItem(CUSTOM_REMOTE_URL_KEY);
        return '';
      }
      const info = deriveSharedPreviewUrl(saved);
      return info.suggestedSharedUrl || info.resolvedUrl;
    } catch {
      return '';
    }
  });
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [draggingElem, setDraggingElem] = useState<PosterElementLayout['id'] | null>(null);
  const [selectedElem, setSelectedElem] = useState<PosterElementLayout['id']>('qr');
  const [probeTrigger, setProbeTrigger] = useState(0);
  const [probe, setProbe] = useState<JoinProbeState>({
    checking: false,
    status: null,
    httpStatus: null,
    detail: '',
  });

  const posterRef = useRef<HTMLDivElement>(null);

  const detectedPublicInfo = useMemo(() => {
    const raw = networkInfo?.publicUrl || window.location.origin;
    return deriveSharedPreviewUrl(raw);
  }, [networkInfo?.publicUrl]);

  const effectivePublicBase = useMemo(
    () =>
      resolvePublicJoinBaseUrl({
        customBaseUrl: customRemoteBase,
        publicUrl: networkInfo?.publicUrl,
        fallbackOrigin: window.location.origin,
      }),
    [customRemoteBase, networkInfo?.publicUrl],
  );

  const isEnteringDevUrl = useMemo(
    () => /^https?:\/\/ais-dev-/i.test(effectivePublicBase),
    [effectivePublicBase],
  );

  const joinUrl = useMemo(() => {
    return `${effectivePublicBase}/join/${show.joinCode}`;
  }, [effectivePublicBase, show.joinCode]);

  // Live probe of whether the QR join URL is actually reachable by audience phones right now
  useEffect(() => {
    if (!/^https?:\/\//i.test(joinUrl)) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      if (!active) return;
      setProbe((prev) => ({ ...prev, checking: true }));
      try {
        const res = await fetch(`/api/check-join-url?url=${encodeURIComponent(joinUrl)}`);
        const data = (await res.json()) as {
          status?: JoinUrlProbeStatus;
          httpStatus?: number | null;
          detail?: string;
        };
        if (!active) return;
        setProbe({
          checking: false,
          status: data.status || 'unreachable',
          httpStatus: data.httpStatus ?? null,
          detail: data.detail || '',
        });
      } catch {
        if (!active) return;
        setProbe({
          checking: false,
          status: 'unreachable',
          httpStatus: null,
          detail: 'Unable to run reachability check from console server.',
        });
      }
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [joinUrl, probeTrigger]);

  // Generate real scannable Show Join QR code (DataURL + SVG)
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(joinUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: Math.max(160, design.qrSizePx * 2),
      color: {
        dark: design.qrForeground || '#FFFFFF',
        light: design.qrBackground || '#0D1016',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {});

    QRCode.toString(joinUrl, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 2,
      color: {
        dark: design.qrForeground || '#FFFFFF',
        light: design.qrBackground || '#0D1016',
      },
    })
      .then((svg) => {
        if (active) setQrSvgString(svg);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [design.qrBackground, design.qrForeground, design.qrSizePx, joinUrl]);

  const updateDesign = (patch: Partial<PosterDesign>) => {
    onCommand('update_poster_design', {
      posterDesign: { ...design, ...patch },
    });
  };

  const updateElement = (id: PosterElementLayout['id'], patch: Partial<PosterElementLayout>) => {
    const next = design.elements.map((el) => (el.id === id ? { ...el, ...patch } : el));
    updateDesign({ elements: next });
  };

  const applyTemplate = (tplId: PosterTemplateId) => {
    const tpl = POSTER_TEMPLATES[tplId];
    updateDesign({ ...tpl });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        updateDesign({ logoDataUrl: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const downloadQrPng = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `${show.id}-qrcode.png`;
    a.click();
  };

  const downloadQrSvg = () => {
    if (!qrSvgString) return;
    const blob = new Blob([qrSvgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${show.id}-qrcode.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPosterPdf = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = 210;
    const pageH = 297;

    // Background
    doc.setFillColor(design.posterBackground || '#0D1016');
    doc.rect(0, 0, pageW, pageH, 'F');

    // Decorative border
    if (design.borderStyle !== 'none') {
      doc.setDrawColor(design.borderColor || '#334155');
      doc.setLineWidth(0.7);
      doc.rect(10, 10, pageW - 20, pageH - 20);
      if (design.borderStyle === 'double') {
        doc.rect(13, 13, pageW - 26, pageH - 26);
      }
    }

    const getEl = (id: PosterElementLayout['id']) => design.elements.find((e) => e.id === id);

    // Logo
    const logoEl = getEl('logo');
    if (design.logoDataUrl && logoEl?.visible) {
      try {
        const wMm = (logoEl.width / 100) * pageW;
        const xMm = (logoEl.x / 100) * pageW - wMm / 2;
        const yMm = (logoEl.y / 100) * pageH - 12;
        doc.addImage(design.logoDataUrl, 'PNG', xMm, yMm, wMm, 22);
      } catch {
        // Skip invalid image formats in PDF
      }
    }

    // Event Name
    const evEl = getEl('eventName');
    if (evEl?.visible) {
      doc.setTextColor(evEl.color || design.accentColor || '#F59E0B');
      doc.setFontSize(Math.min(36, (evEl.fontSize || 30) * 0.85));
      doc.text(design.eventName || show.name, (evEl.x / 100) * pageW, (evEl.y / 100) * pageH, {
        align: 'center',
        maxWidth: pageW - 30,
      });
    }

    // Heading
    const headEl = getEl('heading');
    if (headEl?.visible) {
      doc.setTextColor(headEl.color || '#F1F5F9');
      doc.setFontSize(Math.min(24, (headEl.fontSize || 18) * 0.8));
      doc.text(design.heading, (headEl.x / 100) * pageW, (headEl.y / 100) * pageH, {
        align: 'center',
        maxWidth: pageW - 36,
      });
    }

    // Scannable QR Code
    const qrEl = getEl('qr');
    if (qrDataUrl && qrEl?.visible) {
      const qrMm = Math.max(55, Math.min(125, (qrEl.width / 100) * pageW));
      const qx = (qrEl.x / 100) * pageW - qrMm / 2;
      const qy = (qrEl.y / 100) * pageH - qrMm / 2;
      doc.addImage(qrDataUrl, 'PNG', qx, qy, qrMm, qrMm);
    }

    // Instructions
    const instEl = getEl('instructions');
    if (instEl?.visible) {
      doc.setTextColor(instEl.color || '#CBD5E1');
      doc.setFontSize(12);
      doc.text(design.instructions, (instEl.x / 100) * pageW, (instEl.y / 100) * pageH, {
        align: 'center',
        maxWidth: pageW - 36,
      });
    }

    // Join URL
    const urlEl = getEl('joinUrl');
    if (urlEl?.visible) {
      doc.setTextColor(urlEl.color || '#94A3B8');
      doc.setFontSize(10);
      doc.text(
        `${joinUrl}  (Code: ${show.joinCode})`,
        (urlEl.x / 100) * pageW,
        (urlEl.y / 100) * pageH,
        { align: 'center', maxWidth: pageW - 30 },
      );
    }

    doc.save(`${show.id}-poster.pdf`);
  };

  const handlePosterPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingElem || !posterRef.current) return;
    const rect = posterRef.current.getBoundingClientRect();
    const x = Math.max(10, Math.min(90, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.max(6, Math.min(94, Math.round(((e.clientY - rect.top) / rect.height) * 100)));
    updateElement(draggingElem, { x, y });
  };

  const activeEl = design.elements.find((e) => e.id === selectedElem);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      {/* Left Column: Shared Public URL + Poster Customisation Controls */}
      <div className="xl:col-span-6 flex flex-col gap-4">
        {/* Shared Public URL & Separate Audience Join Link */}
        <div className="console-panel rounded-md p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-amber-400" />
              <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
                Shared Public Join Link &amp; QR
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onCommand('regenerate_join_code')}
                className="console-btn-amber flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold"
                title="Generate a fresh unique separate join link and QR code for audience phones"
              >
                <QrCode className="w-3 h-3" />
                <span>Generate New Join Link &amp; QR</span>
              </button>
              <button
                type="button"
                onClick={() => setProbeTrigger((n) => n + 1)}
                className="console-btn flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium text-slate-200"
              >
                <RefreshCw className={`w-3 h-3 ${probe.checking ? 'animate-spin text-amber-400' : ''}`} />
                <span>Re-Check Link</span>
              </button>
              <span className="font-mono-tabular text-amber-400 font-semibold console-well px-2 py-0.5 rounded">
                Code: {show.joinCode}
              </span>
            </div>
          </div>

          {/* Live Phone Reachability Diagnostic */}
          {probe.status === 'not_published' && (
            <div
              role="status"
              aria-label="Join URL Reachability Warning"
              className="bg-red-950/50 border border-red-500/60 rounded p-3 flex items-start gap-2.5 text-[11px] text-red-100"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold text-red-200">
                  Shared Public URL Not Published Yet (HTTP {probe.httpStatus ?? 404})
                </div>
                <p className="text-red-100/90 leading-relaxed">
                  The shared link <code className="font-mono-tabular">{effectivePublicBase}</code> currently returns HTTP 404 (blank page on phones) until this app is published/shared.
                </p>
                <p className="text-red-200/85 leading-relaxed">
                  Click <strong>Share / Deploy</strong> in the top-right to publish your Shared Public URL, then open your <strong>Host Console</strong> at that published URL—phones on the same Wi-Fi, different Wi-Fi, or mobile data can then scan the separate join link below and sync live.
                </p>
              </div>
            </div>
          )}

          {probe.status === 'auth_required' && (
            <div
              role="status"
              aria-label="Join URL Auth Warning"
              className="bg-amber-950/50 border border-amber-500/60 rounded p-3 flex items-start gap-2.5 text-[11px] text-amber-100"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold text-amber-200">
                  Private Sign-In Required (HTTP {probe.httpStatus ?? 302}) — Works on Your Device Only
                </div>
                <p className="text-amber-100/90 leading-relaxed">
                  This URL requires developer sign-in, so phones get permission errors. Use your published Shared Public URL (<code className="font-mono-tabular">ais-pre-...</code> or Cloud Run URL) for both the Host Console and the audience join link so any phone on any network works.
                </p>
              </div>
            </div>
          )}

          {probe.status === 'unreachable' && (
            <div
              role="status"
              aria-label="Join URL Unreachable Warning"
              className="bg-amber-950/40 border border-amber-500/50 rounded p-2.5 flex items-start gap-2 text-[11px] text-amber-100"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong>Link check could not reach audience page:</strong> {probe.detail || 'Verify your Shared Public URL above.'}
              </div>
            </div>
          )}

          {probe.status === 'live' && (
            <div
              role="status"
              aria-label="Join URL Live Confirmation"
              className="console-well border-emerald-500/45 rounded p-2.5 flex items-start gap-2.5 text-[11px] text-slate-200"
            >
              <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-semibold text-emerald-300">
                  LIVE (HTTP {probe.httpStatus ?? 200}) — Works on Any Wi-Fi or Mobile Data
                </div>
                <div className="text-slate-400">
                  Your Host Console opens at <code className="font-mono-tabular">/</code> while phones scanning this QR open the separate audience join link <code className="font-mono-tabular">/join/{show.joinCode}</code> from any network.
                </div>
              </div>
            </div>
          )}

          {!probe.status && (
            <div className="console-well border-slate-700/60 rounded p-2.5 flex items-start gap-2.5 text-[11px] text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong>Shared Public Cloud Sync:</strong> Checking live phone reachability for <code className="font-mono-tabular">{joinUrl}</code>...
              </div>
            </div>
          )}

          {isEnteringDevUrl && probe.status !== 'auth_required' && (
            <div className="bg-amber-950/40 border border-amber-500/50 rounded p-2.5 flex items-start gap-2 text-[11px] text-amber-100">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong>Private developer URL detected:</strong> <code className="font-mono-tabular">ais-dev-...</code> requires Google sign-in. Use the Shared Public URL (<code className="font-mono-tabular">ais-pre-...</code>) so phones on any Wi-Fi or mobile network open it cleanly.
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
              <span>Shared Public Base URL</span>
              {detectedPublicInfo.suggestedSharedUrl && (
                <button
                  type="button"
                  onClick={() => {
                    const val = detectedPublicInfo.suggestedSharedUrl || '';
                    setCustomRemoteBase(val);
                    try {
                      window.localStorage.setItem(CUSTOM_REMOTE_URL_KEY, val);
                    } catch {}
                  }}
                  className="console-btn px-2 py-0.5 rounded text-[11px] text-amber-300"
                >
                  Reset to Shared Public URL (ais-pre)
                </button>
              )}
            </div>
            <input
              type="text"
              aria-label="Public Network Server Base URL"
              placeholder="https://your-shared-app-url.run.app"
              value={effectivePublicBase}
              onChange={(e) => {
                const val = e.target.value;
                setCustomRemoteBase(val);
                try {
                  if (val && !isPrivateOrLocalBase(val)) {
                    window.localStorage.setItem(CUSTOM_REMOTE_URL_KEY, val);
                  } else {
                    window.localStorage.removeItem(CUSTOM_REMOTE_URL_KEY);
                  }
                } catch {}
              }}
              className="w-full console-well rounded px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-400"
            />
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 console-well rounded p-3">
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="Direct Join QR Code"
                className="w-24 h-24 rounded shrink-0 border border-[#2B3342]"
              />
            )}
            <div className="space-y-2 min-w-0 flex-1 w-full">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-amber-400">
                  Separate Audience Join Link (For Phones)
                </span>
                <span className="text-[10px] font-mono-tabular text-slate-400">
                  Host Console: / · Phones: /join/{show.joinCode}
                </span>
              </div>
              <div className="flex items-center gap-2 bg-[#12151B] border border-[#2A313E] rounded p-1.5">
                <input
                  type="text"
                  readOnly
                  aria-label="Audience Join URL"
                  value={joinUrl}
                  className="flex-1 bg-transparent font-mono-tabular text-slate-100 text-xs focus:outline-none min-w-0"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(joinUrl).catch(() => {});
                    setCopiedUrl(true);
                    setTimeout(() => setCopiedUrl(false), 1500);
                  }}
                  className="console-btn flex items-center gap-1 px-2.5 py-1.5 rounded text-slate-200"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedUrl ? 'Copied Link' : 'Copy Join Link'}</span>
                </button>
                <a
                  href={`/join/${show.joinCode}`}
                  target="_blank"
                  rel="noreferrer"
                  className="console-btn-amber flex items-center gap-1 px-2.5 py-1.5 rounded font-semibold whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Audience Page</span>
                </a>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                Works across the same Wi-Fi, different Wi-Fi networks, and 4G/5G mobile data using the Shared Public URL with real-time WebSocket + HTTPS cloud sync.
              </p>
            </div>
          </div>
        </div>

        {/* Poster Studio Controls */}
        <div className="console-panel rounded-md p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <QrCode className="w-4 h-4 text-amber-400" />
              <h3 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-100">
                Poster Designer &amp; Exports
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={downloadQrPng}
                className="console-btn flex items-center gap-1 px-2.5 py-1.5 rounded text-slate-200"
              >
                <Download className="w-3.5 h-3.5" />
                <span>QR PNG</span>
              </button>
              <button
                type="button"
                onClick={downloadQrSvg}
                className="console-btn flex items-center gap-1 px-2.5 py-1.5 rounded text-slate-200"
              >
                <Download className="w-3.5 h-3.5" />
                <span>QR SVG</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="console-btn flex items-center gap-1 px-2.5 py-1.5 rounded text-slate-200"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print</span>
              </button>
              <button
                type="button"
                onClick={exportPosterPdf}
                className="console-btn-amber flex items-center gap-1 px-3 py-1.5 rounded font-semibold"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Export PDF Poster</span>
              </button>
            </div>
          </div>

          {/* Templates */}
          <div className="space-y-1.5">
            <span className="text-slate-400">Poster Templates</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { id: 'arena_dark', label: 'Arena Dark' },
                  { id: 'editorial_light', label: 'Editorial Light' },
                  { id: 'festival_amber', label: 'Festival Amber' },
                  { id: 'minimal_mono', label: 'Minimal Mono' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t.id)}
                  className={`py-1.5 px-2 rounded font-medium ${
                    design.templateId === t.id
                      ? 'console-btn-amber font-semibold'
                      : 'console-btn text-slate-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Copy Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-slate-300">
              <span>Event Name</span>
              <input
                type="text"
                value={design.eventName}
                onChange={(e) => updateDesign({ eventName: e.target.value })}
                className="console-well rounded px-2.5 py-1.5 text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-slate-300">
              <span>Heading</span>
              <input
                type="text"
                value={design.heading}
                onChange={(e) => updateDesign({ heading: e.target.value })}
                className="console-well rounded px-2.5 py-1.5 text-slate-100"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-slate-300">
            <span>Instructions</span>
            <input
              type="text"
              value={design.instructions}
              onChange={(e) => updateDesign({ instructions: e.target.value })}
              className="console-well rounded px-2.5 py-1.5 text-slate-100"
            />
          </label>

          {/* Colors & Typography */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label className="flex flex-col gap-1 text-slate-300">
              <span>QR Colour</span>
              <input
                type="color"
                value={design.qrForeground}
                onChange={(e) => updateDesign({ qrForeground: e.target.value })}
                className="w-full h-8 rounded bg-transparent border border-[#2A313E]"
              />
            </label>
            <label className="flex flex-col gap-1 text-slate-300">
              <span>QR Background</span>
              <input
                type="color"
                value={design.qrBackground}
                onChange={(e) => updateDesign({ qrBackground: e.target.value })}
                className="w-full h-8 rounded bg-transparent border border-[#2A313E]"
              />
            </label>
            <label className="flex flex-col gap-1 text-slate-300">
              <span>Poster Bg</span>
              <input
                type="color"
                value={design.posterBackground}
                onChange={(e) => updateDesign({ posterBackground: e.target.value })}
                className="w-full h-8 rounded bg-transparent border border-[#2A313E]"
              />
            </label>
            <label className="flex flex-col gap-1 text-slate-300">
              <span>Border Colour</span>
              <input
                type="color"
                value={design.borderColor}
                onChange={(e) => updateDesign({ borderColor: e.target.value })}
                className="w-full h-8 rounded bg-transparent border border-[#2A313E]"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-slate-300">
              <span>Border Style</span>
              <select
                value={design.borderStyle}
                onChange={(e) =>
                  updateDesign({ borderStyle: e.target.value as PosterDesign['borderStyle'] })
                }
                className="console-well rounded px-2 py-1.5 text-slate-100"
              >
                <option value="corner_brackets">Corner Brackets</option>
                <option value="hairline">Hairline</option>
                <option value="double">Double Frame</option>
                <option value="none">None</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-slate-300">
              <span>Font Family</span>
              <select
                value={design.fontFamily}
                onChange={(e) =>
                  updateDesign({ fontFamily: e.target.value as PosterDesign['fontFamily'] })
                }
                className="console-well rounded px-2 py-1.5 text-slate-100"
              >
                <option value="Barlow Condensed">Barlow Condensed</option>
                <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                <option value="JetBrains Mono">JetBrains Mono</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-slate-300">
              <span>QR Size (px)</span>
              <input
                type="number"
                min={140}
                max={420}
                step={10}
                value={design.qrSizePx}
                onChange={(e) => updateDesign({ qrSizePx: Number(e.target.value) })}
                className="console-well rounded px-2 py-1.5 font-mono-tabular text-slate-100"
              />
            </label>
          </div>

          {/* Logo upload & position */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="console-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded text-slate-200 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>{design.logoDataUrl ? 'Replace Logo' : 'Upload Logo'}</span>
              <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
            </label>
            {design.logoDataUrl && (
              <button
                type="button"
                onClick={() => updateDesign({ logoDataUrl: null })}
                className="text-red-400 hover:underline"
              >
                Remove Logo
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const nextPos = design.logoPosition === 'above' ? 'below' : 'above';
                const nextElements = design.elements.map((el) =>
                  el.id === 'logo' ? { ...el, y: nextPos === 'above' ? 9 : 74 } : el,
                );
                updateDesign({ logoPosition: nextPos, elements: nextElements });
              }}
              className="console-btn px-2.5 py-1.5 rounded text-slate-200"
            >
              Logo Position: {design.logoPosition === 'above' ? 'Above QR' : 'Below QR'}
            </button>
          </div>

          {/* Selected Element Size/Color/Visibility */}
          {activeEl && (
            <div className="border-t border-[#222833] pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-amber-400">
                  Selected Element: {activeEl.label}
                </span>
                <label className="flex items-center gap-1.5 text-slate-300">
                  <input
                    type="checkbox"
                    checked={activeEl.visible}
                    onChange={(e) => updateElement(activeEl.id, { visible: e.target.checked })}
                  />
                  <span>Visible</span>
                </label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1 text-slate-300">
                  <span>Width ({activeEl.width}%)</span>
                  <input
                    type="range"
                    min={15}
                    max={92}
                    value={activeEl.width}
                    style={{
                      '--slider-track-bg': `linear-gradient(90deg, #F59E0B 0%, #F59E0B ${((activeEl.width - 15) / 77) * 100}%, #07090D ${((activeEl.width - 15) / 77) * 100}%, #07090D 100%)`,
                    } as React.CSSProperties}
                    onChange={(e) => updateElement(activeEl.id, { width: Number(e.target.value) })}
                  />
                </label>
                {activeEl.fontSize !== undefined && (
                  <label className="flex flex-col gap-1 text-slate-300">
                    <span>Font Size</span>
                    <input
                      type="number"
                      min={10}
                      max={54}
                      value={activeEl.fontSize}
                      onChange={(e) =>
                        updateElement(activeEl.id, { fontSize: Number(e.target.value) })
                      }
                      className="console-well rounded px-2 py-1 font-mono-tabular text-slate-100"
                    />
                  </label>
                )}
                {activeEl.color !== undefined && (
                  <label className="flex flex-col gap-1 text-slate-300">
                    <span>Text Colour</span>
                    <input
                      type="color"
                      value={activeEl.color}
                      onChange={(e) => updateElement(activeEl.id, { color: e.target.value })}
                      className="w-full h-8 rounded bg-transparent border border-[#2A313E]"
                    />
                  </label>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Live Draggable Printable Poster Preview */}
      <div className="xl:col-span-6 console-panel rounded-md p-4 flex flex-col items-center justify-start">
        <div className="w-full flex items-center justify-between mb-2 text-xs text-slate-400">
          <span>Interactive Poster Preview (drag elements to reposition)</span>
          <span className="font-mono-tabular">A4 Ratio · Error Correction H</span>
        </div>

        <div
          id="qr-poster-printable"
          ref={posterRef}
          onPointerMove={handlePosterPointerMove}
          onPointerUp={() => setDraggingElem(null)}
          onPointerLeave={() => setDraggingElem(null)}
          style={{
            backgroundColor: design.posterBackground,
            fontFamily: design.fontFamily,
          }}
          className="relative w-full max-w-[440px] aspect-[210/297] rounded shadow-xl overflow-hidden select-none"
        >
          {/* Borders */}
          {design.borderStyle === 'hairline' && (
            <div
              className="absolute inset-4 border pointer-events-none"
              style={{ borderColor: design.borderColor }}
            />
          )}
          {design.borderStyle === 'double' && (
            <>
              <div
                className="absolute inset-3 border pointer-events-none"
                style={{ borderColor: design.borderColor }}
              />
              <div
                className="absolute inset-5 border pointer-events-none"
                style={{ borderColor: design.borderColor }}
              />
            </>
          )}
          {design.borderStyle === 'corner_brackets' && (
            <div
              className="absolute inset-4 border border-dashed pointer-events-none"
              style={{ borderColor: design.borderColor }}
            />
          )}

          {/* Draggable Poster Elements */}
          {design.elements
            .filter((el) => el.visible)
            .map((el) => {
              const isSelected = selectedElem === el.id;
              return (
                <div
                  key={el.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    setSelectedElem(el.id);
                    setDraggingElem(el.id);
                  }}
                  style={{
                    left: `${el.x}%`,
                    top: `${el.y}%`,
                    width: `${el.width}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  className={`absolute text-center cursor-move px-1 py-0.5 rounded ${
                    isSelected ? 'outline-1 outline-dashed outline-amber-400/80' : ''
                  }`}
                >
                  {el.id === 'logo' && design.logoDataUrl && (
                    <img
                      src={design.logoDataUrl}
                      alt="Event Logo"
                      className="max-h-14 mx-auto object-contain pointer-events-none"
                    />
                  )}
                  {el.id === 'eventName' && (
                    <div
                      className="font-bold tracking-wide uppercase leading-tight"
                      style={{ fontSize: `${el.fontSize || 30}px`, color: el.color || design.accentColor }}
                    >
                      {design.eventName || show.name}
                    </div>
                  )}
                  {el.id === 'heading' && (
                    <div
                      className="font-semibold leading-snug"
                      style={{ fontSize: `${el.fontSize || 18}px`, color: el.color || '#F1F5F9' }}
                    >
                      {design.heading}
                    </div>
                  )}
                  {el.id === 'qr' && qrDataUrl && (
                    <div className="inline-block p-2 rounded" style={{ backgroundColor: design.qrBackground }}>
                      <img
                        src={qrDataUrl}
                        alt={`QR code to join ${show.name}`}
                        className="w-full h-auto mx-auto pointer-events-none"
                      />
                    </div>
                  )}
                  {el.id === 'instructions' && (
                    <div
                      className="leading-relaxed"
                      style={{ fontSize: `${el.fontSize || 13}px`, color: el.color || '#CBD5E1' }}
                    >
                      {design.instructions}
                    </div>
                  )}
                  {el.id === 'joinUrl' && (
                    <div
                      className="font-mono-tabular break-all"
                      style={{ fontSize: `${el.fontSize || 12}px`, color: el.color || '#94A3B8' }}
                    >
                      {joinUrl} · CODE: {show.joinCode}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};
