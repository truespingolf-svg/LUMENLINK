import { PosterDesign, PosterTemplateId, ShowFile } from '../shared/types';
import { createDefaultEffectParams } from './effects';

export const POSTER_TEMPLATES: Record<PosterTemplateId, Partial<PosterDesign>> = {
  arena_dark: {
    templateId: 'arena_dark',
    posterBackground: '#0D1016',
    accentColor: '#F59E0B',
    qrForeground: '#FFFFFF',
    qrBackground: '#0D1016',
    borderStyle: 'corner_brackets',
    borderColor: '#334155',
    fontFamily: 'Barlow Condensed',
  },
  editorial_light: {
    templateId: 'editorial_light',
    posterBackground: '#F8FAFC',
    accentColor: '#0F172A',
    qrForeground: '#0F172A',
    qrBackground: '#FFFFFF',
    borderStyle: 'hairline',
    borderColor: '#CBD5E1',
    fontFamily: 'Plus Jakarta Sans',
  },
  festival_amber: {
    templateId: 'festival_amber',
    posterBackground: '#181108',
    accentColor: '#FB923C',
    qrForeground: '#FFF7ED',
    qrBackground: '#181108',
    borderStyle: 'double',
    borderColor: '#9A3412',
    fontFamily: 'Barlow Condensed',
  },
  minimal_mono: {
    templateId: 'minimal_mono',
    posterBackground: '#09090B',
    accentColor: '#E4E4E7',
    qrForeground: '#09090B',
    qrBackground: '#FFFFFF',
    borderStyle: 'hairline',
    borderColor: '#3F3F46',
    fontFamily: 'JetBrains Mono',
  },
};

export function createDefaultPosterDesign(eventName: string): PosterDesign {
  return {
    templateId: 'arena_dark',
    eventName,
    heading: 'SCAN TO BECOME PART OF THE LIGHT SHOW',
    instructions: '1. Stay on public/venue Wi-Fi or mobile data  2. Scan QR code with Camera or Google  3. Tap JOIN SHOW',
    description: 'Your screen will synchronise live with the stage lighting console. No app download required.',
    qrSizePx: 260,
    qrForeground: '#FFFFFF',
    qrBackground: '#0D1016',
    posterBackground: '#0D1016',
    accentColor: '#F59E0B',
    borderStyle: 'corner_brackets',
    borderColor: '#334155',
    fontFamily: 'Barlow Condensed',
    logoDataUrl: null,
    logoPosition: 'above',
    includeWifiQr: false,
    wifiSsid: 'LUMENLINK-STAGE',
    wifiPassword: '',
    wifiNoPassword: true,
    elements: [
      { id: 'logo', label: 'Event Logo', x: 50, y: 8, width: 28, visible: true },
      { id: 'eventName', label: 'Event Name', x: 50, y: 15, width: 86, fontSize: 24, color: '#F59E0B', visible: true },
      { id: 'heading', label: 'Main Heading', x: 50, y: 27, width: 84, fontSize: 15, color: '#F1F5F9', visible: true },
      { id: 'qr', label: 'QR Code', x: 50, y: 54, width: 50, visible: true },
      { id: 'instructions', label: 'Instructions', x: 50, y: 81, width: 84, fontSize: 12, color: '#CBD5E1', visible: true },
      { id: 'joinUrl', label: 'Join URL', x: 50, y: 92, width: 86, fontSize: 11, color: '#94A3B8', visible: true },
    ],
  };
}

export function createDemoShow(nowMs: number = Date.now()): ShowFile {
  return {
    id: 'demo-arena-show',
    name: 'LUMENLINK Arena Showcase',
    joinCode: 'LUMEN1',
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    audienceSettings: {
      eventTitle: 'LUMENLINK Arena Showcase',
      welcomeMessage: 'Welcome to the live wireless light show. Tap Join Show and keep your screen raised when the countdown hits zero.',
      instructions: 'Turn screen brightness to 100% and enable fullscreen when prompted. No extra interaction needed during the performance.',
      brandColor: '#F59E0B',
      requireFullscreenPrompt: true,
      autoHideControls: true,
    },
    groups: [
      { id: 'grp-floor', name: 'Floor Pit', color: '#38BDF8', masterIntensity: 100, overrideColor: null, sectionLabel: 'Section A' },
      { id: 'grp-left', name: 'Left Wing', color: '#F59E0B', masterIntensity: 100, overrideColor: null, sectionLabel: 'Section B' },
      { id: 'grp-right', name: 'Right Wing', color: '#A855F7', masterIntensity: 100, overrideColor: null, sectionLabel: 'Section C' },
      { id: 'grp-balcony', name: 'Upper Balcony', color: '#10B981', masterIntensity: 100, overrideColor: null, sectionLabel: 'Section D' },
    ],
    cues: [
      {
        id: 'cue-1',
        cueNumber: 1,
        name: 'Pre-Show Deep Cobalt Wash',
        colour: '#0047FF',
        secondaryColour: '#001540',
        effectType: 'solid',
        effectParams: { speed: 1, intensity: 100 },
        intensity: 100,
        durationMs: 4000,
        fadeInMs: 800,
        fadeOutMs: 500,
        delayMs: 0,
        targetGroupId: 'all',
        mediaId: null,
        transitionType: 'ease_in_out',
        autoFollow: true,
      },
      {
        id: 'cue-2',
        cueNumber: 2,
        name: 'Crimson to Cobalt Transition',
        colour: '#FF1E42',
        secondaryColour: '#0055FF',
        effectType: 'colour_transition',
        effectParams: {
          palette: ['#FF1E42', '#0055FF'],
          transitionTimeMs: 3000,
          intensity: 100,
        },
        intensity: 100,
        durationMs: 4000,
        fadeInMs: 500,
        fadeOutMs: 500,
        delayMs: 0,
        targetGroupId: 'all',
        mediaId: null,
        transitionType: 'ease_in_out',
        autoFollow: true,
      },
      {
        id: 'cue-3',
        cueNumber: 3,
        name: 'Left-to-Right Cyan Wave',
        colour: '#00E5FF',
        secondaryColour: '#050C24',
        effectType: 'wave_left_to_right',
        effectParams: {
          speed: 1.8,
          width: 32,
          palette: ['#00E5FF', '#050C24'],
          intensity: 100,
        },
        intensity: 100,
        durationMs: 5000,
        fadeInMs: 400,
        fadeOutMs: 400,
        delayMs: 0,
        targetGroupId: 'all',
        mediaId: null,
        transitionType: 'crossfade',
        autoFollow: true,
      },
      {
        id: 'cue-4',
        cueNumber: 4,
        name: 'Bouncing Amber Flash',
        colour: '#FF9900',
        secondaryColour: '#000000',
        effectType: 'flash_bouncing',
        effectParams: {
          speed: 2.2,
          size: 26,
          palette: ['#FF9900', '#FFFFFF'],
          intensity: 100,
        },
        intensity: 100,
        durationMs: 4500,
        fadeInMs: 200,
        fadeOutMs: 400,
        delayMs: 0,
        targetGroupId: 'all',
        mediaId: null,
        transitionType: 'cut',
        autoFollow: true,
      },
      {
        id: 'cue-5',
        cueNumber: 5,
        name: 'Aurora Finale Sweep',
        colour: '#00E676',
        secondaryColour: '#7C4DFF',
        effectType: 'aurora',
        effectParams: {
          speed: 1.4,
          palette: ['#00E676', '#00BFA5', '#7C4DFF'],
          intensity: 100,
        },
        intensity: 100,
        durationMs: 0,
        fadeInMs: 1000,
        fadeOutMs: 1000,
        delayMs: 0,
        targetGroupId: 'all',
        mediaId: null,
        transitionType: 'ease_in_out',
        autoFollow: false,
      },
    ],
    timelines: [
      {
        id: 'tl-main',
        name: 'Main Show Sequence',
        loop: true,
        totalDurationMs: 16000,
        blocks: [
          {
            id: 'blk-1',
            track: 'colour',
            label: 'Cobalt Base Wash',
            startMs: 0,
            durationMs: 4000,
            colour: '#0055FF',
            effectType: 'solid',
          },
          {
            id: 'blk-2',
            track: 'movement',
            label: 'L2R Cyan Wave',
            startMs: 4000,
            durationMs: 6000,
            colour: '#00E5FF',
            effectType: 'wave_left_to_right',
            effectParams: { speed: 1.8, width: 32, palette: ['#00E5FF', '#050C24'] },
          },
          {
            id: 'blk-3',
            track: 'flash',
            label: 'Bouncing White Strobe',
            startMs: 7000,
            durationMs: 4000,
            colour: '#FFFFFF',
            effectType: 'flash_bouncing',
            effectParams: { speed: 2.4, size: 22, palette: ['#FFFFFF'] },
          },
          {
            id: 'blk-4',
            track: 'colour',
            label: 'Aurora Wash',
            startMs: 10000,
            durationMs: 6000,
            colour: '#00E676',
            effectType: 'aurora',
            effectParams: { speed: 1.3 },
          },
        ],
      },
    ],
    savedPalettes: [
      ['#0055FF', '#00E5FF', '#FFFFFF'],
      ['#FF1E42', '#FF8800', '#FFD166'],
      ['#00E676', '#00BFA5', '#7C4DFF'],
      ['#FFFFFF', '#CFE4FF', '#9FC8FF'],
      ['#FF007F', '#7928CA', '#0070F3'],
    ],
    savedColors: [
      '#0066FF',
      '#FF1E42',
      '#00E676',
      '#FF9900',
      '#00E5FF',
      '#A855F7',
      '#FFFFFF',
      '#FFD166',
    ],
    layoutPresets: [
      { id: 'preset-grid', name: 'Standard 6x4 Grid', rows: 4, cols: 6, positions: {} },
      { id: 'preset-wings', name: 'Arena Wings + Pit', rows: 4, cols: 8, positions: {} },
    ],
    posterDesign: createDefaultPosterDesign('LUMENLINK Arena Showcase'),
    lighting: {
      masterIntensity: 100,
      blackout: false,
      freeze: false,
      emergencyNeutral: false,
      baseColor: '#0047FF',
      colourTransition: null,
      layers: [
        {
          id: 'layer-primary',
          name: 'Primary Effect',
          type: 'solid',
          enabled: false,
          blendMode: 'normal',
          opacity: 1,
          params: createDefaultEffectParams({ palette: ['#00E5FF', '#050C24'] }),
          startedAtMs: nowMs,
        },
      ],
      media: {
        enabled: false,
        mediaId: null,
        url: null,
        kind: null,
        fitMode: 'cover',
        opacity: 1,
        fadeTimeMs: 400,
        targetGroupId: 'all',
        targetDeviceIds: [],
        playbackStartServerMs: nowMs,
        isPlaying: false,
        sequenceIds: [],
        sequenceIntervalMs: 3000,
        cropX: 50,
        cropY: 50,
        scale: 1,
      },
      updatedAtMs: nowMs,
    },
    playback: {
      status: 'stopped',
      activeCueId: null,
      activeCueIndex: -1,
      cueStartedAtMs: nowMs,
      timelinePlaying: false,
      timelineStartedAtMs: nowMs,
      timelinePositionMs: 0,
      activeTimelineId: 'tl-main',
    },
  };
}

export function createBlankShow(name: string, nowMs: number = Date.now()): ShowFile {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  const id = `${slug || 'show'}-${Math.random().toString(36).slice(2, 6)}`;
  const joinCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  const base = createDemoShow(nowMs);
  return {
    ...base,
    id,
    name: name.trim() || 'Untitled Lighting Show',
    joinCode,
    audienceSettings: {
      ...base.audienceSettings,
      eventTitle: name.trim() || 'Untitled Lighting Show',
    },
    posterDesign: createDefaultPosterDesign(name.trim() || 'Untitled Lighting Show'),
  };
}

export function validateImportedShow(raw: unknown): ShowFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<ShowFile>;
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null;
  if (!Array.isArray(candidate.groups) || !Array.isArray(candidate.cues)) return null;
  if (!candidate.lighting || typeof candidate.lighting !== 'object') return null;
  const now = Date.now();
  const fallback = createDemoShow(now);
  return {
    ...fallback,
    ...candidate,
    id:
      typeof candidate.id === 'string' && candidate.id.trim()
        ? `${candidate.id.slice(0, 24)}-${Math.random().toString(36).slice(2, 5)}`
        : `imported-${Math.random().toString(36).slice(2, 6)}`,
    joinCode:
      typeof candidate.joinCode === 'string' && candidate.joinCode.trim()
        ? candidate.joinCode.toUpperCase().slice(0, 8)
        : Math.random().toString(36).slice(2, 8).toUpperCase(),
    updatedAtMs: now,
  };
}
