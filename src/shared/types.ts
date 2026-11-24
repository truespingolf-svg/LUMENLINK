export type ConnectivityMode = 'local' | 'remote';

export type ScreenOrientationType = 'portrait' | 'landscape';

export type DeviceConnectionStatus = 'connected' | 'disconnected';

export type EffectCategory = 'colour' | 'movement' | 'flash' | 'advanced';

export type EffectType =
  // Colour Effects
  | 'solid'
  | 'colour_fade'
  | 'rainbow_cycle'
  | 'rainbow_wave'
  | 'two_colour_gradient'
  | 'multi_colour_gradient'
  | 'random_colour'
  | 'colour_chase'
  | 'colour_strobe'
  | 'colour_pulse'
  | 'colour_breathing'
  | 'colour_wipe'
  | 'colour_transition'
  // Movement Effects
  | 'wave_left_to_right'
  | 'wave_right_to_left'
  | 'wave_top_to_bottom'
  | 'wave_bottom_to_top'
  | 'wave_circular'
  | 'wave_centre_out'
  | 'wave_outside_in'
  | 'wave_diagonal'
  | 'alternating_rows'
  | 'alternating_columns'
  | 'random_device_chase'
  | 'sequential_device_chase'
  // Flash Effects
  | 'flash_single'
  | 'flash_double'
  | 'flash_triple'
  | 'flash_random'
  | 'flash_group'
  | 'flash_alternating'
  | 'flash_bouncing'
  | 'flash_left_to_right'
  | 'flash_right_to_left'
  | 'flash_centre_out'
  | 'flash_staggered'
  | 'beat_flash'
  // Advanced Effects
  | 'fire_simulation'
  | 'water_flow'
  | 'aurora'
  | 'electric_pulse'
  | 'digital_rainbow'
  | 'matrix_rain'
  | 'gradient_movement'
  | 'multi_layer'
  | 'sound_reactive'
  | 'custom_script';

export type SyncMode = 'global_clock' | 'phase_locked' | 'free_run';

export type TransitionType = 'cut' | 'linear' | 'ease_in_out' | 'crossfade';

export type MediaFitMode = 'contain' | 'cover' | 'fill';

export interface EffectParameters {
  speed: number; // 0.1 to 10
  intensity: number; // 0 to 100
  fadeTimeMs: number; // 0 to 10000
  transitionTimeMs: number; // 0 to 10000
  direction: 'forward' | 'reverse' | 'pingpong';
  size: number; // 5 to 100 (% of spatial width)
  width: number; // 5 to 100
  spread: number; // 0 to 100
  density: number; // 5 to 100
  frequency: number; // 0.2 to 20 Hz
  palette: string[]; // array of HEX colors
  repetitions: number; // 0 = infinite, >= 1
  delayMs: number; // 0 to 5000
  phaseDeg: number; // 0 to 360
  fixtureRangeStart: number; // 1-based fixture number
  fixtureRangeEnd: number; // 1-based fixture number (0 = all)
  targetGroupId: string | 'all';
  syncMode: SyncMode;
  audioLevel?: number; // 0..1 when sound_reactive
  customHueShift?: number;
  customPulseShape?: 'sine' | 'square' | 'triangle' | 'sawtooth';
  bpm?: number; // 40..240 BPM for beat-synced effects
  beatSteps?: number; // 2..16 steps per bar
  beatStepPattern?: boolean[]; // active flash steps within bar
  beatFlashEvery?: number; // quick interval: flash every Nth step
  beatSpreadMode?: 'all' | 'chase' | 'alternate' | 'random';
}

export interface ActiveEffectLayer {
  id: string;
  name: string;
  type: EffectType;
  enabled: boolean;
  blendMode: 'normal' | 'add' | 'multiply' | 'screen';
  opacity: number; // 0 to 1
  params: EffectParameters;
  startedAtMs: number;
}

export interface FixtureGroup {
  id: string;
  name: string;
  color: string;
  masterIntensity: number; // 0 to 100
  overrideColor: string | null;
  sectionLabel?: string;
}

export interface AudienceDevice {
  id: string;
  fixtureNumber: number; // 1, 2, 3 -> formatted 001, 002, 003
  name: string;
  deviceType: 'smartphone' | 'tablet' | 'desktop' | 'unknown';
  orientation: ScreenOrientationType;
  status: DeviceConnectionStatus;
  batteryLevel: number | null; // 0..100 or null
  lastSeenMs: number;
  joinedAtMs: number;
  groupId: string;
  excluded: boolean;
  /** Normalized virtual stage/audience position 0..1 */
  x: number;
  y: number;
  row: number;
  col: number;
  overrideColor: string | null;
  identifyUntilMs: number;
  screenWidth?: number;
  screenHeight?: number;
  isFullscreen?: boolean;
  mediaOverrideId?: string | null;
}

export interface MediaAsset {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  kind: 'image' | 'gif' | 'video';
  url: string;
  sizeBytes: number;
  uploadedAtMs: number;
}

export interface ActiveMediaProjection {
  enabled: boolean;
  mediaId: string | null;
  url: string | null;
  kind: 'image' | 'gif' | 'video' | null;
  fitMode: MediaFitMode;
  opacity: number; // 0 to 1
  fadeTimeMs: number;
  targetGroupId: string | 'all';
  targetDeviceIds: string[]; // empty = use targetGroupId
  playbackStartServerMs: number;
  isPlaying: boolean;
  sequenceIds: string[];
  sequenceIntervalMs: number;
  cropX: number; // 0..100 (%)
  cropY: number; // 0..100 (%)
  scale: number; // 0.5..3
}

export interface CueItem {
  id: string;
  cueNumber: number;
  name: string;
  colour: string;
  secondaryColour?: string;
  effectType: EffectType;
  effectParams: Partial<EffectParameters>;
  intensity: number; // 0 to 100
  durationMs: number; // 0 = manual hold until GO
  fadeInMs: number;
  fadeOutMs: number;
  delayMs: number;
  targetGroupId: string | 'all';
  mediaId: string | null;
  mediaFitMode?: MediaFitMode;
  transitionType: TransitionType;
  autoFollow: boolean;
}

export interface TimelineBlock {
  id: string;
  track: 'colour' | 'movement' | 'flash' | 'image' | 'intensity';
  label: string;
  startMs: number;
  durationMs: number;
  colour?: string;
  effectType?: EffectType;
  effectParams?: Partial<EffectParameters>;
  intensity?: number;
  mediaId?: string | null;
}

export interface TimelineSequence {
  id: string;
  name: string;
  loop: boolean;
  totalDurationMs: number;
  blocks: TimelineBlock[];
}

export interface PosterElementLayout {
  id: 'logo' | 'eventName' | 'heading' | 'qr' | 'instructions' | 'joinUrl' | 'badge';
  label: string;
  x: number; // percentage 0..100
  y: number; // percentage 0..100
  width: number; // percentage 10..100
  fontSize?: number;
  color?: string;
  visible: boolean;
}

export type PosterTemplateId = 'arena_dark' | 'editorial_light' | 'festival_amber' | 'minimal_mono';

export interface PosterDesign {
  templateId: PosterTemplateId;
  eventName: string;
  heading: string;
  instructions: string;
  description: string;
  qrSizePx: number;
  qrForeground: string;
  qrBackground: string;
  posterBackground: string;
  accentColor: string;
  borderStyle: 'none' | 'hairline' | 'double' | 'corner_brackets';
  borderColor: string;
  fontFamily: 'Barlow Condensed' | 'Plus Jakarta Sans' | 'JetBrains Mono';
  logoDataUrl: string | null;
  logoPosition: 'above' | 'below';
  includeWifiQr?: boolean;
  wifiSsid?: string;
  wifiPassword?: string;
  wifiNoPassword?: boolean;
  elements: PosterElementLayout[];
}

export interface SavedLayoutPreset {
  id: string;
  name: string;
  rows: number;
  cols: number;
  positions: Record<string, { x: number; y: number; row: number; col: number; groupId?: string }>;
}

export interface ShowAudienceSettings {
  eventTitle: string;
  welcomeMessage: string;
  instructions: string;
  brandColor: string;
  requireFullscreenPrompt: boolean;
  autoHideControls: boolean;
}

export interface ColourTransitionState {
  active: boolean;
  fromColor: string;
  toColor: string;
  startedAtMs: number;
  durationMs: number;
  easing: TransitionType;
}

export interface PlaybackState {
  status: 'stopped' | 'playing' | 'paused';
  activeCueId: string | null;
  activeCueIndex: number;
  cueStartedAtMs: number;
  timelinePlaying: boolean;
  timelineStartedAtMs: number;
  timelinePositionMs: number;
  activeTimelineId: string | null;
}

export interface LiveLightingState {
  masterIntensity: number; // 0..100
  blackout: boolean;
  freeze: boolean;
  emergencyNeutral: boolean;
  baseColor: string;
  colourTransition: ColourTransitionState | null;
  layers: ActiveEffectLayer[];
  media: ActiveMediaProjection;
  updatedAtMs: number;
}

export interface ShowFile {
  id: string;
  name: string;
  joinCode: string;
  createdAtMs: number;
  updatedAtMs: number;
  audienceSettings: ShowAudienceSettings;
  groups: FixtureGroup[];
  cues: CueItem[];
  timelines: TimelineSequence[];
  savedPalettes: string[][];
  savedColors: string[];
  layoutPresets: SavedLayoutPreset[];
  posterDesign: PosterDesign;
  lighting: LiveLightingState;
  playback: PlaybackState;
}

export interface NetworkInfo {
  port: number;
  lanAddresses: string[];
  hasRealLanAddress?: boolean;
  publicUrl: string;
  isAiStudioDevUrl?: boolean;
  suggestedSharedUrl?: string | null;
  connectivityMode: ConnectivityMode;
  internetReachableHint: boolean;
}

export interface RenderedFixtureOutput {
  colorHex: string;
  rgb: [number, number, number];
  intensity: number; // 0..1
  flashActive: boolean;
  identifying: boolean;
  mediaUrl: string | null;
  mediaKind: 'image' | 'gif' | 'video' | null;
  mediaFitMode: MediaFitMode;
  mediaOpacity: number;
  mediaPlaybackStartServerMs: number;
  mediaIsPlaying: boolean;
  mediaScale: number;
  mediaCropX: number;
  mediaCropY: number;
}

export interface WsMessageToServer {
  type:
    | 'register_host'
    | 'register_audience'
    | 'audience_heartbeat'
    | 'audience_update_meta'
    | 'host_command';
  showId?: string;
  hostToken?: string;
  deviceId?: string;
  payload?: Record<string, unknown>;
}

export interface WsMessageToClient {
  type:
    | 'welcome_sync'
    | 'state_update'
    | 'devices_update'
    | 'cue_playback_update'
    | 'identify_pulse'
    | 'ping_sync'
    | 'error';
  serverTimeMs: number;
  show?: ShowFile;
  lighting?: LiveLightingState;
  playback?: PlaybackState;
  devices?: AudienceDevice[];
  device?: AudienceDevice;
  mediaAssets?: MediaAsset[];
  message?: string;
  identifyUntilMs?: number;
}
