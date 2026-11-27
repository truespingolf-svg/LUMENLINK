import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Info, Maximize2, Minimize2, Wifi, WifiOff, X } from 'lucide-react';
import { useAudienceSocket } from '../../hooks/useAudienceSocket';
import { lerpRgb, rgbToHex } from '../../engine/colors';
import { renderFixtureOutput } from '../../engine/effects';
import { RenderedFixtureOutput } from '../../shared/types';

interface AudienceAppProps {
  showIdParam?: string;
}

export const AudienceApp: React.FC<AudienceAppProps> = ({ showIdParam }) => {
  const audience = useAudienceSocket(showIdParam);
  const [deviceNameInput, setDeviceNameInput] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControlsHint, setShowControlsHint] = useState(true);
  const [showConfirmationToast, setShowConfirmationToast] = useState(false);
  const [showMobileGuide, setShowMobileGuide] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const [rendered, setRendered] = useState<RenderedFixtureOutput>({
    colorHex: '#0B0D10',
    rgb: [11, 13, 16],
    intensity: 1,
    flashActive: false,
    identifying: false,
    mediaUrl: null,
    mediaKind: null,
    mediaFitMode: 'cover',
    mediaOpacity: 0,
    mediaPlaybackStartServerMs: 0,
    mediaIsPlaying: false,
    mediaScale: 1,
    mediaCropX: 50,
    mediaCropY: 50,
  });

  // Auto-join when ?autostart=1 is provided (e.g., automated multi-device test clients)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (
      params.get('autostart') === '1' &&
      !audience.joined &&
      !audience.joining &&
      !audience.joinError &&
      !audience.loadingInfo
    ) {
      const customName = params.get('name') || '';
      audience.joinShow(customName || undefined);
    }
  }, [audience.joined, audience.joining, audience.joinError, audience.loadingInfo, audience]);

  // Brief connection confirmation banner on join
  useEffect(() => {
    if (audience.joined && audience.connected) {
      setShowConfirmationToast(true);
      const t = window.setTimeout(() => setShowConfirmationToast(false), 3000);
      return () => window.clearTimeout(t);
    }
  }, [audience.joined, audience.connected]);

  // Auto-hide subtle floating fullscreen toggle during performance
  useEffect(() => {
    if (!audience.joined) return;
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (isFullscreen) setShowControlsHint(false);
    }, 3500);
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [audience.joined, isFullscreen, showControlsHint]);

  // Track fullscreen API state
  useEffect(() => {
    const onFsChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (!fs) setShowControlsHint(true);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const requestWakeLock = async () => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
      };
      if (nav.wakeLock) {
        wakeLockRef.current = await nav.wakeLock.request('screen');
        setWakeLockActive(true);
      }
    } catch {
      setWakeLockActive(false);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        const el = stageRef.current || document.documentElement;
        if (el.requestFullscreen) {
          await el.requestFullscreen();
          setIsFullscreen(true);
          setShowControlsHint(false);
        }
        await requestWakeLock();
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // Fallback visual fullscreen mode when browser blocks Fullscreen API (e.g., iOS Safari)
      setIsFullscreen((prev) => !prev);
      setShowMobileGuide(true);
    }
  };

  // Real-time 60fps deterministic effect & colour render loop (updates DOM color directly without 60Hz React re-renders)
  const lastMediaSigRef = useRef<string>('');
  const renderStateRef = useRef({
    joined: audience.joined,
    show: audience.show,
    device: audience.device,
    allDevices: audience.allDevices,
    serverOffsetMs: audience.serverOffsetMs,
  });
  renderStateRef.current = {
    joined: audience.joined,
    show: audience.show,
    device: audience.device,
    allDevices: audience.allDevices,
    serverOffsetMs: audience.serverOffsetMs,
  };

  const smoothedRgbRef = useRef<{ r: number; g: number; b: number } | null>(null);
  const lastFrameTsRef = useRef<number>(0);

  useEffect(() => {
    if (!audience.joined) return;
    let rafId = 0;

    const frame = (ts: number) => {
      const { show, device, allDevices, serverOffsetMs } = renderStateRef.current;
      if (show && device) {
        const nowServerMs = Date.now() + serverOffsetMs;
        const out = renderFixtureOutput(
          device,
          allDevices.length > 0 ? allDevices : [device],
          show.groups,
          show.lighting,
          nowServerMs,
        );

        const activeTypes = show.lighting.layers.filter((l) => l.enabled).map((l) => l.type);
        const hasSharpStrobe =
          out.flashActive ||
          out.identifying ||
          show.lighting.blackout ||
          activeTypes.some(
            (t) =>
              t === 'colour_strobe' ||
              t === 'digital_rainbow' ||
              t === 'flash_single' ||
              t === 'flash_double' ||
              t === 'flash_triple' ||
              t === 'flash_random' ||
              t === 'flash_group' ||
              t === 'flash_alternating' ||
              t === 'flash_staggered' ||
              t === 'beat_flash',
          );

        const dtSec = lastFrameTsRef.current ? Math.min(0.1, (ts - lastFrameTsRef.current) / 1000) : 0.016;
        lastFrameTsRef.current = ts;

        const targetRgb = { r: out.rgb[0], g: out.rgb[1], b: out.rgb[2] };
        let displayRgb = targetRgb;
        if (!hasSharpStrobe && smoothedRgbRef.current) {
          const blendAlpha = 1 - Math.exp(-dtSec / 0.05);
          displayRgb = lerpRgb(smoothedRgbRef.current, targetRgb, blendAlpha);
        }
        smoothedRgbRef.current = displayRgb;
        const displayHex = rgbToHex(displayRgb.r, displayRgb.g, displayRgb.b);

        if (stageRef.current) {
          stageRef.current.style.backgroundColor = displayHex;
          stageRef.current.setAttribute('data-color', displayHex);
          stageRef.current.setAttribute('data-target-color', out.colorHex);
          stageRef.current.setAttribute('data-effect', activeTypes.join(',') || 'solid');
        }
        const mediaSig = `${out.mediaUrl || ''}|${out.mediaKind || ''}|${out.mediaFitMode}|${out.mediaOpacity.toFixed(2)}|${out.mediaIsPlaying}|${out.mediaScale}|${out.mediaCropX}|${out.mediaCropY}|${out.identifying}`;
        if (mediaSig !== lastMediaSigRef.current) {
          lastMediaSigRef.current = mediaSig;
          setRendered(out);
        }
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [audience.joined]);

  // Synchronize video element clock against server playbackStartServerMs
  useEffect(() => {
    const video = videoRef.current;
    if (!video || rendered.mediaKind !== 'video' || !rendered.mediaUrl) return;
    if (rendered.mediaIsPlaying) {
      const nowServerMs = Date.now() + audience.serverOffsetMs;
      const targetSec = Math.max(0, (nowServerMs - rendered.mediaPlaybackStartServerMs) / 1000);
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const modSec = targetSec % video.duration;
        if (Math.abs(video.currentTime - modSec) > 0.4) {
          video.currentTime = modSec;
        }
      }
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [
    rendered.mediaKind,
    rendered.mediaUrl,
    rendered.mediaIsPlaying,
    rendered.mediaPlaybackStartServerMs,
    audience.serverOffsetMs,
  ]);

  // Pre-Join Audience Welcome Experience
  if (!audience.joined) {
    const info = audience.publicInfo;
    const settings = info?.audienceSettings;
    const brandColor = settings?.brandColor || '#F59E0B';

    return (
      <div className="min-h-screen min-h-[100dvh] bg-[#07090D] text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md console-panel rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2 text-center">
            <div
              className="font-display text-xs font-bold tracking-[0.25em] uppercase"
              style={{ color: brandColor }}
            >
              LUMENLINK LIVE SHOW
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-white">
              {audience.loadingInfo ? 'Loading Show...' : settings?.eventTitle || info?.name || 'Live Lighting Event'}
            </h1>
          </div>

          <div className="console-well rounded-lg p-4 text-sm text-slate-200 leading-relaxed text-center">
            {settings?.welcomeMessage ||
              'Welcome to the synchronised wireless light show. Join below to turn your screen into a live stage lighting pixel.'}
          </div>

          {settings?.instructions && (
            <p className="text-xs text-slate-400 text-center leading-relaxed">
              {settings.instructions}
            </p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              audience.joinShow(deviceNameInput.trim() || undefined);
              requestWakeLock();
            }}
            className="space-y-3"
          >
            <label className="block text-xs text-slate-400">
              <span>Optional Name / Seat Label</span>
              <input
                type="text"
                placeholder="e.g., Row A Seat 12"
                value={deviceNameInput}
                onChange={(e) => setDeviceNameInput(e.target.value)}
                className="mt-1.5 w-full console-well rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-400"
              />
            </label>

            {audience.joinError && (
              <div
                role="alert"
                className="bg-red-950/60 border border-red-500/60 rounded-lg px-3 py-2 text-xs text-red-200 text-center"
              >
                {audience.joinError}
              </div>
            )}

            <button
              type="submit"
              disabled={audience.joining}
              style={{ backgroundColor: brandColor }}
              className="w-full min-h-[48px] rounded-lg font-display text-lg font-bold tracking-wider uppercase text-slate-950 hover:opacity-95 active:scale-[0.99] transition-transform disabled:opacity-70 cursor-pointer"
            >
              {audience.joining ? 'JOINING SHOW...' : 'JOIN SHOW'}
            </button>
          </form>

          <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <Wifi className="w-3.5 h-3.5" />
            <span>No app installation required · Real-time WebSocket sync</span>
          </div>
        </div>
      </div>
    );
  }

  const fitClass =
    rendered.mediaFitMode === 'contain'
      ? 'object-contain'
      : rendered.mediaFitMode === 'fill'
        ? 'object-fill'
        : 'object-cover';

  const initialColorHex =
    audience.show && audience.device
      ? renderFixtureOutput(
          audience.device,
          audience.allDevices.length > 0 ? audience.allDevices : [audience.device],
          audience.show.groups,
          audience.show.lighting,
          Date.now() + audience.serverOffsetMs,
        ).colorHex
      : rendered.colorHex;

  return (
    <div
      ref={stageRef}
      data-testid="audience-light-surface"
      data-color={initialColorHex}
      data-connected={String(audience.connected)}
      data-fullscreen={String(isFullscreen)}
      style={{ backgroundColor: initialColorHex }}
      onClick={() => setShowControlsHint(true)}
      className={`fixed inset-0 w-screen h-screen bg-[#0B0D10] overflow-hidden select-none touch-none ${
        isFullscreen && !showControlsHint ? 'cursor-none' : ''
      }`}
    >
      {/* Projected Media Layer */}
      {rendered.mediaUrl && rendered.mediaOpacity > 0 && (
        <div
          className="absolute inset-0 w-full h-full overflow-hidden flex items-center justify-center pointer-events-none"
          style={{ opacity: rendered.mediaOpacity }}
        >
          {rendered.mediaKind === 'video' ? (
            <video
              ref={videoRef}
              src={rendered.mediaUrl}
              loop
              muted
              playsInline
              className={`w-full h-full ${fitClass}`}
              style={{
                transform: `scale(${rendered.mediaScale})`,
                objectPosition: `${rendered.mediaCropX}% ${rendered.mediaCropY}%`,
              }}
            />
          ) : (
            <img
              src={rendered.mediaUrl}
              alt="Projected Show Media"
              referrerPolicy="no-referrer"
              className={`w-full h-full ${fitClass}`}
              style={{
                transform: `scale(${rendered.mediaScale})`,
                objectPosition: `${rendered.mediaCropX}% ${rendered.mediaCropY}%`,
              }}
            />
          )}
        </div>
      )}

      {/* Brief Connection Confirmation Toast */}
      {showConfirmationToast && audience.device && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 py-2 rounded-lg bg-black/80 border border-white/20 text-white text-xs font-medium backdrop-blur-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>
            Connected · Fixture {String(audience.device.fixtureNumber).padStart(3, '0')} ({audience.device.name})
          </span>
        </div>
      )}

      {/* Reconnecting / Disconnected Banner */}
      {(!audience.connected || audience.disconnectedByHost) && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 rounded-lg bg-black/85 border border-red-500/60 text-white text-xs">
          <WifiOff className="w-4 h-4 text-red-400" />
          <span>
            {audience.disconnectedByHost
              ? 'Session ended by host console.'
              : 'Connection lost. Reconnecting automatically...'}
          </span>
        </div>
      )}

      {/* Minimal Fullscreen Controls (hidden automatically during fullscreen performance) */}
      {(showControlsHint || !isFullscreen) && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed bottom-4 right-4 z-30 flex items-center gap-2"
        >
          <button
            type="button"
            onClick={() => setShowMobileGuide(true)}
            aria-label="Fullscreen Instructions"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-black/65 border border-white/20 text-white hover:bg-black/85 backdrop-blur-sm"
          >
            <Info className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="min-h-[44px] flex items-center gap-2 px-4 py-2 rounded-lg bg-black/75 border border-white/25 text-white text-xs font-semibold hover:bg-black/90 backdrop-blur-sm"
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-4 h-4" />
                <span>Exit Fullscreen</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-4 h-4" />
                <span>Fullscreen</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* iOS / Android Fullscreen & Wake Lock Guide Modal */}
      {showMobileGuide && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-sm bg-[#12151B] border border-[#2A313E] rounded-xl p-5 space-y-3 text-xs text-slate-200">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold uppercase text-white">
                Mobile Fullscreen &amp; Screen Awake Guide
              </h2>
              <button
                type="button"
                aria-label="Close Guide"
                onClick={() => setShowMobileGuide(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p>
              <strong>Android (Chrome / Edge):</strong> Tap <em>Fullscreen</em> to hide browser toolbars and keep the screen awake ({wakeLockActive ? 'Wake Lock Active' : 'Wake Lock Requested'}).
            </p>
            <p>
              <strong>iOS (Safari):</strong> Apple Safari restricts programmatic fullscreen on iPhones. For true edge-to-edge fullscreen, tap Safari&apos;s <strong>Share</strong> icon and select <strong>Add to Home Screen</strong>, or tap the <strong>aA</strong> address bar menu and choose <strong>Hide Toolbar</strong>.
            </p>
            <button
              type="button"
              onClick={() => setShowMobileGuide(false)}
              className="w-full py-2 rounded-lg bg-amber-500 text-slate-950 font-semibold"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
