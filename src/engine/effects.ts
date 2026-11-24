import {
  ActiveEffectLayer,
  AudienceDevice,
  EffectCategory,
  EffectParameters,
  EffectType,
  FixtureGroup,
  LiveLightingState,
  RenderedFixtureOutput,
  TransitionType,
} from '../shared/types';
import {
  blendRgb,
  clamp,
  hexToRgb,
  hsvToRgb,
  lerpRgb,
  RGB,
  rgbToHex,
  rgbToHsv,
  samplePalette,
  samplePaletteLoop,
  scaleRgb,
} from './colors';

export interface EffectCatalogEntry {
  type: EffectType;
  label: string;
  category: EffectCategory;
  description: string;
  defaultPalette?: string[];
}

export const DEFAULT_RAINBOW_PALETTE = ['#FF0055', '#FF9900', '#00E676', '#00E5FF', '#8B5CF6'];

function isDefaultRainbowPalette(palette: string[]): boolean {
  if (palette.length !== DEFAULT_RAINBOW_PALETTE.length) return false;
  return DEFAULT_RAINBOW_PALETTE.every(
    (c, i) => palette[i]?.toUpperCase() === c.toUpperCase(),
  );
}

export const EFFECT_CATALOG: EffectCatalogEntry[] = [
  // Colour Effects
  { type: 'solid', label: 'Solid Colour', category: 'colour', description: 'Steady uniform colour output.', defaultPalette: ['#0066FF', '#00E5FF'] },
  { type: 'colour_fade', label: 'Colour Fade', category: 'colour', description: 'Smoothly cycles through palette colours.', defaultPalette: ['#0066FF', '#A855F7', '#FF1E42'] },
  { type: 'rainbow_cycle', label: 'Rainbow Cycle', category: 'colour', description: 'Synchronised full-spectrum colour cycle.', defaultPalette: [...DEFAULT_RAINBOW_PALETTE] },
  { type: 'rainbow_wave', label: 'Smooth Rainbow Wave', category: 'colour', description: 'Spatial rainbow wave across stage width.', defaultPalette: [...DEFAULT_RAINBOW_PALETTE] },
  { type: 'two_colour_gradient', label: 'Two-Colour Gradient', category: 'colour', description: 'Spatial blend between primary and secondary colours.', defaultPalette: ['#0066FF', '#FF1E42'] },
  { type: 'multi_colour_gradient', label: 'Multi-Colour Gradient', category: 'colour', description: 'Multi-stop spatial gradient across audience.', defaultPalette: ['#0066FF', '#00E5FF', '#A855F7', '#FF1E42'] },
  { type: 'random_colour', label: 'Random Colour Generator', category: 'colour', description: 'Deterministic per-fixture stepped random colours.', defaultPalette: ['#0066FF', '#00E676', '#FF9900', '#FF1E42'] },
  { type: 'colour_chase', label: 'Colour Chase', category: 'colour', description: 'Stepped colour blocks chasing across fixtures.', defaultPalette: ['#00E5FF', '#A855F7', '#FF9900'] },
  { type: 'colour_strobe', label: 'Colour Strobe', category: 'colour', description: 'High-contrast rapid colour strobe bursts.', defaultPalette: ['#FFFFFF', '#000000'] },
  { type: 'colour_pulse', label: 'Colour Pulse', category: 'colour', description: 'Rhythmic intensity pulse on chosen palette.', defaultPalette: ['#0066FF', '#00E5FF', '#FFFFFF'] },
  { type: 'colour_breathing', label: 'Colour Breathing', category: 'colour', description: 'Organic inhale/exhale brightness curve.', defaultPalette: ['#00E5FF', '#041024'] },
  { type: 'colour_wipe', label: 'Colour Wipe', category: 'colour', description: 'Sweeping curtain wipe across fixture positions.', defaultPalette: ['#0066FF', '#FF9900'] },
  { type: 'colour_transition', label: 'Colour Transition', category: 'colour', description: 'Timed transition between two colours.', defaultPalette: ['#FF1E42', '#0055FF'] },

  // Movement Effects
  { type: 'wave_left_to_right', label: 'Left-to-Right Wave', category: 'movement', description: 'Travels left to right using fixture X coordinates.', defaultPalette: ['#00E5FF', '#050C24'] },
  { type: 'wave_right_to_left', label: 'Right-to-Left Wave', category: 'movement', description: 'Travels right to left using fixture X coordinates.', defaultPalette: ['#FF9900', '#140800'] },
  { type: 'wave_top_to_bottom', label: 'Top-to-Bottom Wave', category: 'movement', description: 'Travels front to back using fixture Y coordinates.', defaultPalette: ['#A855F7', '#09051A'] },
  { type: 'wave_bottom_to_top', label: 'Bottom-to-Top Wave', category: 'movement', description: 'Travels back to front using fixture Y coordinates.', defaultPalette: ['#00E676', '#041A0F'] },
  { type: 'wave_circular', label: 'Circular Wave', category: 'movement', description: 'Rotating angular beam sweeping around audience centre.', defaultPalette: ['#00E5FF', '#081226'] },
  { type: 'wave_centre_out', label: 'Centre-Out Wave', category: 'movement', description: 'Radial pulse expanding from centre outward.', defaultPalette: ['#FF1E42', '#120409'] },
  { type: 'wave_outside_in', label: 'Outside-In Wave', category: 'movement', description: 'Radial pulse converging toward the centre.', defaultPalette: ['#0088FF', '#040B1A'] },
  { type: 'wave_diagonal', label: 'Diagonal Wave', category: 'movement', description: '45-degree diagonal sweep across pixel map.', defaultPalette: ['#00E5FF', '#7C4DFF'] },
  { type: 'alternating_rows', label: 'Alternating Rows', category: 'movement', description: 'Alternates odd and even audience rows.', defaultPalette: ['#0088FF', '#FF9900'] },
  { type: 'alternating_columns', label: 'Alternating Columns', category: 'movement', description: 'Alternates odd and even audience columns.', defaultPalette: ['#00E676', '#7C4DFF'] },
  { type: 'random_device_chase', label: 'Random Device Chase', category: 'movement', description: 'Sparkling pseudo-random fixture highlights.', defaultPalette: ['#FFFFFF', '#0088FF'] },
  { type: 'sequential_device_chase', label: 'Sequential Device Chase', category: 'movement', description: 'Steps in order through fixture numbers 001..N.', defaultPalette: ['#FF9900', '#090D16'] },

  // Flash Effects
  { type: 'flash_single', label: 'Single Flash', category: 'flash', description: 'Sharp single strobe hit per cycle.', defaultPalette: ['#FFFFFF', '#000000'] },
  { type: 'flash_double', label: 'Double Flash', category: 'flash', description: 'Rapid twin-tap camera flash hit.', defaultPalette: ['#FFFFFF', '#000000'] },
  { type: 'flash_triple', label: 'Triple Flash', category: 'flash', description: 'Three-beat burst flash pattern.', defaultPalette: ['#FFFFFF', '#000000'] },
  { type: 'flash_random', label: 'Random Flash', category: 'flash', description: 'Randomised sparkle strobe across audience.', defaultPalette: ['#FFFFFF', '#00E5FF'] },
  { type: 'flash_group', label: 'Group Flash', category: 'flash', description: 'Flashes alternating fixture groups.', defaultPalette: ['#FF9900', '#000000'] },
  { type: 'flash_alternating', label: 'Alternating Flash', category: 'flash', description: 'Odd/even fixture alternating flash.', defaultPalette: ['#00E5FF', '#000000'] },
  { type: 'flash_bouncing', label: 'Bouncing Flash', category: 'flash', description: 'Flash ping-ponging back and forth across X positions.', defaultPalette: ['#FFFFFF', '#0066FF'] },
  { type: 'flash_left_to_right', label: 'Left-to-Right Flash', category: 'flash', description: 'Sweeping strobe bar from left to right.', defaultPalette: ['#FFFFFF', '#000000'] },
  { type: 'flash_right_to_left', label: 'Right-to-Left Flash', category: 'flash', description: 'Sweeping strobe bar from right to left.', defaultPalette: ['#FFFFFF', '#000000'] },
  { type: 'flash_centre_out', label: 'Centre-Out Flash', category: 'flash', description: 'Shockwave flash expanding from stage centre.', defaultPalette: ['#FF9900', '#000000'] },
  { type: 'flash_staggered', label: 'Staggered Flash', category: 'flash', description: 'Phase-offset staggered rhythmic hits.', defaultPalette: ['#00E5FF', '#000000'] },

  // Advanced Effects (Primary = Hero Colour, Secondary = Dark Base / Trough)
  { type: 'fire_simulation', label: 'Fire Simulation', category: 'advanced', description: 'Warm flickering embers rising from bottom to top.', defaultPalette: ['#FF6B00', '#2B0400', '#FFD166'] },
  { type: 'water_flow', label: 'Water Flow', category: 'advanced', description: 'Liquid caustic ripples across custom fluid tones.', defaultPalette: ['#00B4D8', '#022C54', '#CAF0F8'] },
  { type: 'aurora', label: 'Aurora Effect', category: 'advanced', description: 'Slow drifting emerald & violet northern lights.', defaultPalette: ['#00E676', '#081C24', '#7C4DFF'] },
  { type: 'electric_pulse', label: 'Electric Pulse', category: 'advanced', description: 'High-energy arcing discharges across chosen tones.', defaultPalette: ['#00E5FF', '#041B4D', '#FFFFFF'] },
  { type: 'digital_rainbow', label: 'Digital Rainbow', category: 'advanced', description: 'Quantised crisp digital spectrum steps.', defaultPalette: [...DEFAULT_RAINBOW_PALETTE] },
  { type: 'matrix_rain', label: 'Matrix Animation', category: 'advanced', description: 'Vertical cascading digital light drops.', defaultPalette: ['#00FF66', '#001A08', '#D8FFE2'] },
  { type: 'gradient_movement', label: 'Gradient Movement', category: 'advanced', description: 'Continuously sliding multi-stop colour gradient.', defaultPalette: ['#0066FF', '#00E5FF', '#A855F7', '#FF1E42'] },
  { type: 'multi_layer', label: 'Multi-Layer Blend', category: 'advanced', description: 'Interfering dual-wave harmonic colour field.', defaultPalette: ['#0066FF', '#FF1E42'] },
  { type: 'sound_reactive', label: 'Sound-Reactive Pulse', category: 'advanced', description: 'Responds to live audio level & beat transients.', defaultPalette: ['#00E5FF', '#A855F7', '#FF1E42'] },
  { type: 'custom_script', label: 'Custom Wave Shape', category: 'advanced', description: 'User-configurable waveform, hue shift & phase.', defaultPalette: ['#00E5FF', '#A855F7'] },
];

export function getDefaultPaletteForEffect(type: EffectType): string[] {
  const found = EFFECT_CATALOG.find((e) => e.type === type);
  return found?.defaultPalette ? [...found.defaultPalette] : ['#0066FF', '#00E5FF', '#FFFFFF'];
}

export function createDefaultEffectParams(overrides?: Partial<EffectParameters>): EffectParameters {
  return {
    speed: 1.5,
    intensity: 100,
    fadeTimeMs: 400,
    transitionTimeMs: 1200,
    direction: 'forward',
    size: 28,
    width: 35,
    spread: 50,
    density: 40,
    frequency: 2.0,
    palette: ['#0066FF', '#00E5FF', '#FFFFFF'],
    repetitions: 0,
    delayMs: 0,
    phaseDeg: 0,
    fixtureRangeStart: 1,
    fixtureRangeEnd: 0,
    targetGroupId: 'all',
    syncMode: 'global_clock',
    audioLevel: 0.65,
    customHueShift: 210,
    customPulseShape: 'sine',
    ...overrides,
  };
}

function hashFloat(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function applyEasing(t: number, easing: TransitionType): number {
  const k = clamp(t, 0, 1);
  if (easing === 'cut') return k >= 1 ? 1 : 0;
  if (easing === 'ease_in_out' || easing === 'crossfade') {
    return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  }
  return k;
}

function gaussianBand(distance: number, widthNorm: number): number {
  const w = Math.max(0.04, widthNorm);
  return Math.exp(-(distance * distance) / (2 * w * w));
}

function applyDirectionPhase(phase: number, direction: EffectParameters['direction']): number {
  const p = ((phase % 1) + 1) % 1;
  if (direction === 'reverse') return 1 - p;
  if (direction === 'pingpong') {
    const twice = ((phase % 2) + 2) % 2;
    return twice <= 1 ? twice : 2 - twice;
  }
  return p;
}

function evaluateWaveform(phase: number, shape: EffectParameters['customPulseShape'] = 'sine'): number {
  const p = ((phase % 1) + 1) % 1;
  switch (shape) {
    case 'square':
      return p < 0.5 ? 1 : 0;
    case 'triangle':
      return p < 0.5 ? p * 2 : 2 - p * 2;
    case 'sawtooth':
      return p;
    case 'sine':
    default:
      return (Math.sin(p * Math.PI * 2 - Math.PI / 2) + 1) / 2;
  }
}

function computeSteppedFade(
  tSec: number,
  stepHz: number,
  fadeTimeMs: number,
): { step: number; prevStep: number; mix: number } {
  const rate = Math.max(0.25, stepHz);
  const phase = tSec * rate;
  const step = Math.floor(phase);
  const stepFrac = phase - step;
  const stepDurMs = 1000 / rate;
  const fadeRatio = fadeTimeMs > 0 ? clamp(fadeTimeMs / stepDurMs, 0, 0.95) : 0;
  const rawMix = fadeRatio > 0 ? clamp(stepFrac / fadeRatio, 0, 1) : 1;
  const mix = rawMix < 1 ? applyEasing(rawMix, 'ease_in_out') : 1;
  return { step, prevStep: Math.max(0, step - 1), mix };
}

function sampleWaveColor(palette: string[], primary: RGB, secondary: RGB, band: number): RGB {
  if (palette.length <= 1) {
    return lerpRgb({ r: 4, g: 8, b: 20 }, primary, band);
  }
  if (palette.length === 2) {
    return lerpRgb(secondary, primary, band);
  }
  const waveStops = [palette[1], ...palette.slice(2), palette[0]];
  return samplePalette(waveStops, band);
}

export function evaluateEffectLayer(
  layer: ActiveEffectLayer,
  device: AudienceDevice,
  allDevices: AudienceDevice[],
  timeMs: number,
): { rgb: RGB; alpha: number; flashActive: boolean } {
  const p = layer.params;
  if (device.excluded) {
    return { rgb: { r: 0, g: 0, b: 0 }, alpha: 0, flashActive: false };
  }
  if (p.targetGroupId !== 'all' && device.groupId !== p.targetGroupId) {
    return { rgb: { r: 0, g: 0, b: 0 }, alpha: 0, flashActive: false };
  }
  if (device.fixtureNumber < p.fixtureRangeStart) {
    return { rgb: { r: 0, g: 0, b: 0 }, alpha: 0, flashActive: false };
  }
  if (p.fixtureRangeEnd > 0 && device.fixtureNumber > p.fixtureRangeEnd) {
    return { rgb: { r: 0, g: 0, b: 0 }, alpha: 0, flashActive: false };
  }

  const delay = Math.max(0, p.delayMs || 0);
  if (delay > 0 && timeMs < layer.startedAtMs + delay) {
    return { rgb: { r: 0, g: 0, b: 0 }, alpha: 0, flashActive: false };
  }
  const elapsedMs = Math.max(0, timeMs - layer.startedAtMs - delay);

  const speed = Math.max(0.05, p.speed);
  const tSec = (elapsedMs / 1000) * speed;
  const phaseOffset = (p.phaseDeg || 0) / 360;
  const syncOffset =
    p.syncMode === 'free_run' ? hashFloat(device.fixtureNumber * 7.13) * 0.5 : 0;
  const rawPhase = tSec * 0.5 + phaseOffset + syncOffset;

  // Check repetitions limit if set > 0
  if (p.repetitions > 0 && rawPhase >= p.repetitions) {
    return { rgb: { r: 0, g: 0, b: 0 }, alpha: 0, flashActive: false };
  }

  const x = clamp(device.x, 0, 1);
  const y = clamp(device.y, 0, 1);
  const widthNorm = clamp((p.width || 30) / 100, 0.05, 1);
  const sizeNorm = clamp((p.size || 25) / 100, 0.05, 1);
  const spreadFactor = clamp((p.spread || 50) / 50, 0.1, 3);
  const densityFactor = clamp((p.density || 40) / 100, 0.05, 1);
  const palette = p.palette && p.palette.length > 0 ? p.palette : ['#0088FF', '#FF2266'];
  const primary = hexToRgb(palette[0]);
  const secondary = hexToRgb(palette[1] || palette[0]);
  const hasSecondary = palette.length > 1;
  const hasVisibleSecondary = hasSecondary && (palette[1] || '').toUpperCase() !== '#000000';
  const intensityScale = clamp(p.intensity / 100, 0, 1) * clamp(layer.opacity, 0, 1);

  const onlineDevices = allDevices.filter((d) => d.status === 'connected' && !d.excluded);
  const activePool =
    device.status === 'connected' && onlineDevices.length > 0
      ? onlineDevices
      : allDevices.filter((d) => !d.excluded);
  const pool = activePool.length > 0 ? activePool : allDevices;
  const activeCount = Math.max(1, pool.length);
  const foundIdx = pool.findIndex((d) => d.id === device.id);
  const orderedIdx = foundIdx >= 0 ? foundIdx : Math.max(0, allDevices.findIndex((d) => d.id === device.id));

  let outRgb: RGB = primary;
  let weight = 1;
  let flashActive = false;

  switch (layer.type) {
    case 'solid': {
      outRgb = primary;
      break;
    }
    case 'colour_fade': {
      if (p.direction === 'pingpong') {
        const k = applyDirectionPhase(rawPhase, 'pingpong');
        outRgb = samplePalette(palette, k);
      } else {
        const k = applyDirectionPhase(rawPhase, p.direction);
        outRgb = samplePaletteLoop(palette, k);
      }
      break;
    }
    case 'rainbow_cycle': {
      if (palette.length >= 2 && !isDefaultRainbowPalette(palette)) {
        if (p.direction === 'pingpong') {
          outRgb = samplePalette(palette, applyDirectionPhase(rawPhase, 'pingpong'));
        } else {
          outRgb = samplePaletteLoop(palette, applyDirectionPhase(rawPhase, p.direction));
        }
      } else if (palette.length === 1 && !isDefaultRainbowPalette(palette)) {
        const baseHsv = rgbToHsv(primary.r, primary.g, primary.b);
        const hue = ((baseHsv.h + applyDirectionPhase(rawPhase, p.direction) * 360) % 360 + 360) % 360;
        outRgb = hsvToRgb(hue, Math.max(40, baseHsv.s), Math.max(50, baseHsv.v));
      } else {
        const hue = ((applyDirectionPhase(rawPhase, p.direction) * 360) % 360 + 360) % 360;
        outRgb = hsvToRgb(hue, 100, 100);
      }
      break;
    }
    case 'rainbow_wave': {
      const wavePhase = applyDirectionPhase(rawPhase, p.direction);
      if (palette.length >= 2 && !isDefaultRainbowPalette(palette)) {
        const pos = (((x * spreadFactor - wavePhase) % 1) + 1) % 1;
        outRgb = samplePaletteLoop(palette, pos);
      } else {
        const hue = (((x * spreadFactor - wavePhase) * 360) % 360 + 360) % 360;
        outRgb = hsvToRgb(hue, 100, 100);
      }
      break;
    }
    case 'two_colour_gradient': {
      const pos =
        activeCount === 1 || p.direction === 'pingpong'
          ? applyDirectionPhase(x + rawPhase * 0.45, 'pingpong')
          : p.direction === 'reverse'
            ? 1 - x
            : x;
      outRgb = lerpRgb(primary, secondary, pos);
      break;
    }
    case 'multi_colour_gradient': {
      if (activeCount === 1) {
        const pos = applyDirectionPhase(x + rawPhase * 0.4, p.direction);
        outRgb = p.direction === 'pingpong' ? samplePalette(palette, pos) : samplePaletteLoop(palette, pos);
      } else {
        const rawPos = clamp(x * spreadFactor, 0, 1);
        const gradPos = p.direction === 'reverse' ? 1 - rawPos : rawPos;
        outRgb = samplePalette(palette, gradPos);
      }
      break;
    }
    case 'random_colour': {
      const { step, prevStep, mix } = computeSteppedFade(tSec, Math.max(0.5, p.frequency), p.fadeTimeMs);
      const evalStep = (s: number): RGB => {
        const h = hashFloat(device.fixtureNumber * 31 + s * 17);
        return palette.length > 1 ? samplePalette(palette, h) : hsvToRgb(h * 360, 95, 100);
      };
      outRgb = mix < 1 ? lerpRgb(evalStep(prevStep), evalStep(step), mix) : evalStep(step);
      break;
    }
    case 'colour_chase': {
      const { step, prevStep, mix } = computeSteppedFade(tSec, Math.max(0.5, p.frequency), p.fadeTimeMs);
      const evalStep = (s: number): RGB => {
        const idx = (orderedIdx + (p.direction === 'reverse' ? -s : s)) % palette.length;
        const safeIdx = ((idx % palette.length) + palette.length) % palette.length;
        return hexToRgb(palette[safeIdx]);
      };
      outRgb = mix < 1 ? lerpRgb(evalStep(prevStep), evalStep(step), mix) : evalStep(step);
      break;
    }
    case 'colour_strobe': {
      const cyc = (tSec * Math.max(1, p.frequency)) % 1;
      const duty = clamp(densityFactor * 0.45, 0.08, 0.5);
      flashActive = cyc < duty;
      outRgb = flashActive ? primary : hasVisibleSecondary ? secondary : { r: 0, g: 0, b: 0 };
      weight = flashActive ? 1 : hasVisibleSecondary ? 1 : 0;
      break;
    }
    case 'colour_pulse': {
      const cyc = (tSec * Math.max(0.25, p.frequency * 0.5)) % 1;
      const env = Math.pow(Math.sin(cyc * Math.PI), 2);
      outRgb = samplePaletteLoop(palette, rawPhase * 0.35);
      weight = 0.06 + 0.94 * env;
      break;
    }
    case 'colour_breathing': {
      const env = (Math.sin(rawPhase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
      if (hasSecondary) {
        outRgb = lerpRgb(secondary, primary, env);
        weight = 1;
      } else {
        outRgb = primary;
        weight = 0.08 + 0.92 * env;
      }
      break;
    }
    case 'colour_wipe': {
      const cycle = Math.floor(rawPhase);
      const frac = rawPhase - cycle;
      const fromColor = hexToRgb(palette[cycle % palette.length]);
      const toColor = hexToRgb(palette[(cycle + 1) % palette.length]);
      const isRev = p.direction === 'reverse' || (p.direction === 'pingpong' && cycle % 2 === 1);
      const head = isRev ? 1 - frac : frac;
      const feather = Math.max(0.06, widthNorm * 0.35);
      const dist = isRev ? head - x : x - head;
      if (dist <= 0) {
        outRgb = toColor;
      } else if (dist < feather) {
        outRgb = lerpRgb(toColor, fromColor, applyEasing(dist / feather, 'ease_in_out'));
      } else {
        outRgb = fromColor;
      }
      break;
    }
    case 'colour_transition': {
      const dur = Math.max(100, p.transitionTimeMs || 1500);
      let progress: number;
      if (p.repetitions === 0) {
        const cyclePos = (elapsedMs % (dur * 2)) / dur;
        progress = cyclePos <= 1 ? cyclePos : 2 - cyclePos;
      } else {
        progress = clamp(elapsedMs / dur, 0, 1);
      }
      outRgb = lerpRgb(primary, secondary, applyEasing(progress, 'ease_in_out'));
      break;
    }

    // Movement Effects
    case 'wave_left_to_right':
    case 'wave_right_to_left': {
      const dir =
        layer.type === 'wave_right_to_left'
          ? p.direction === 'reverse'
            ? 'forward'
            : p.direction === 'pingpong'
              ? 'pingpong'
              : 'reverse'
          : p.direction;
      const head = applyDirectionPhase(rawPhase, dir);
      const rawDist = Math.abs(x - head);
      const wrapDist = p.direction === 'pingpong' ? rawDist : Math.min(rawDist, 1 - rawDist);
      const band = gaussianBand(wrapDist, widthNorm * 0.45);
      outRgb = sampleWaveColor(palette, primary, secondary, band);
      weight = hasSecondary ? 1 : band;
      break;
    }
    case 'wave_top_to_bottom':
    case 'wave_bottom_to_top': {
      const dir =
        layer.type === 'wave_bottom_to_top'
          ? p.direction === 'reverse'
            ? 'forward'
            : p.direction === 'pingpong'
              ? 'pingpong'
              : 'reverse'
          : p.direction;
      const head = applyDirectionPhase(rawPhase, dir);
      const rawDist = Math.abs(y - head);
      const wrapDist = p.direction === 'pingpong' ? rawDist : Math.min(rawDist, 1 - rawDist);
      const band = gaussianBand(wrapDist, widthNorm * 0.45);
      outRgb = sampleWaveColor(palette, primary, secondary, band);
      weight = hasSecondary ? 1 : band;
      break;
    }
    case 'wave_circular': {
      const angle = Math.atan2(y - 0.5, x - 0.5) / (Math.PI * 2) + 0.5;
      const head = applyDirectionPhase(rawPhase, p.direction);
      const diff = Math.abs(angle - head);
      const wrap = Math.min(diff, 1 - diff);
      const band = gaussianBand(wrap, widthNorm * 0.4);
      outRgb = sampleWaveColor(palette, primary, secondary, band);
      weight = hasSecondary ? 1 : 0.2 + 0.8 * band;
      break;
    }
    case 'wave_centre_out':
    case 'wave_outside_in': {
      const distFromCentre = Math.hypot(x - 0.5, y - 0.5) / Math.SQRT1_2;
      const dir =
        layer.type === 'wave_outside_in'
          ? p.direction === 'reverse'
            ? 'forward'
            : p.direction === 'pingpong'
              ? 'pingpong'
              : 'reverse'
          : p.direction;
      const head = applyDirectionPhase(rawPhase, dir);
      const diff = Math.abs(distFromCentre - head);
      const wrap = p.direction === 'pingpong' ? diff : Math.min(diff, 1 - diff);
      const band = gaussianBand(wrap, widthNorm * 0.45);
      outRgb = sampleWaveColor(palette, primary, secondary, band);
      weight = hasSecondary ? 1 : 0.2 + 0.8 * band;
      break;
    }
    case 'wave_diagonal': {
      const diag = (x + y) / 2;
      const head = applyDirectionPhase(rawPhase, p.direction);
      const diff = Math.abs(diag - head);
      const wrap = p.direction === 'pingpong' ? diff : Math.min(diff, 1 - diff);
      const band = gaussianBand(wrap, widthNorm * 0.45);
      outRgb = sampleWaveColor(palette, primary, secondary, band);
      weight = hasSecondary ? 1 : 0.2 + 0.8 * band;
      break;
    }
    case 'alternating_rows': {
      const { step, prevStep, mix } = computeSteppedFade(tSec, Math.max(0.5, p.frequency), p.fadeTimeMs);
      const evalStep = (s: number) => {
        const flip = s % 2;
        const isActive = activeCount === 1 ? flip === 0 : device.row % 2 === flip;
        const rgb = isActive ? primary : hasSecondary ? secondary : scaleRgb(primary, 0.08);
        return rgb;
      };
      outRgb = mix < 1 ? lerpRgb(evalStep(prevStep), evalStep(step), mix) : evalStep(step);
      break;
    }
    case 'alternating_columns': {
      const { step, prevStep, mix } = computeSteppedFade(tSec, Math.max(0.5, p.frequency), p.fadeTimeMs);
      const evalStep = (s: number) => {
        const flip = s % 2;
        const isActive = activeCount === 1 ? flip === 0 : device.col % 2 === flip;
        const rgb = isActive ? primary : hasSecondary ? secondary : scaleRgb(primary, 0.08);
        return rgb;
      };
      outRgb = mix < 1 ? lerpRgb(evalStep(prevStep), evalStep(step), mix) : evalStep(step);
      break;
    }
    case 'random_device_chase': {
      const { step, prevStep, mix } = computeSteppedFade(tSec, Math.max(1, p.frequency * 2), p.fadeTimeMs);
      const bg = hasVisibleSecondary ? secondary : { r: 0, g: 0, b: 0 };
      const evalStep = (s: number) => {
        const picked = hashFloat(s * 97 + device.fixtureNumber * 13) < densityFactor;
        return picked ? primary : bg;
      };
      outRgb = mix < 1 ? lerpRgb(evalStep(prevStep), evalStep(step), mix) : evalStep(step);
      break;
    }
    case 'sequential_device_chase': {
      if (activeCount === 1) {
        const rate = Math.max(0.8, p.frequency);
        const cyc = (tSec * rate) % 1;
        const beat = (Math.sin(cyc * Math.PI * 2) + 1) / 2;
        const trough = hasSecondary ? secondary : scaleRgb(primary, 0.08);
        outRgb = lerpRgb(trough, primary, beat);
        break;
      }
      const { step, prevStep, mix } = computeSteppedFade(tSec, Math.max(1, p.frequency * 1.5), p.fadeTimeMs);
      const bg = hasSecondary ? secondary : { r: 0, g: 0, b: 0 };
      const evalStep = (s: number) => {
        const stepIdx = s % activeCount;
        const activeIndex = p.direction === 'reverse' ? activeCount - 1 - stepIdx : stepIdx;
        const span = Math.max(1, Math.round((sizeNorm * activeCount) / 2));
        const dist = Math.abs(orderedIdx - activeIndex);
        return dist < span ? primary : bg;
      };
      outRgb = mix < 1 ? lerpRgb(evalStep(prevStep), evalStep(step), mix) : evalStep(step);
      break;
    }

    // Flash Effects
    case 'flash_single': {
      const cyc = (tSec * Math.max(0.5, p.frequency)) % 1;
      flashActive = cyc < 0.14;
      outRgb = flashActive ? primary : hasVisibleSecondary ? secondary : { r: 0, g: 0, b: 0 };
      weight = flashActive ? 1 : hasVisibleSecondary ? 1 : 0;
      break;
    }
    case 'flash_double': {
      const cyc = (tSec * Math.max(0.5, p.frequency)) % 1;
      flashActive = (cyc >= 0 && cyc < 0.1) || (cyc >= 0.18 && cyc < 0.28);
      outRgb = flashActive ? primary : hasVisibleSecondary ? secondary : { r: 0, g: 0, b: 0 };
      weight = flashActive ? 1 : hasVisibleSecondary ? 1 : 0;
      break;
    }
    case 'flash_triple': {
      const cyc = (tSec * Math.max(0.5, p.frequency)) % 1;
      flashActive =
        (cyc >= 0 && cyc < 0.08) ||
        (cyc >= 0.14 && cyc < 0.22) ||
        (cyc >= 0.28 && cyc < 0.36);
      outRgb = flashActive ? primary : hasVisibleSecondary ? secondary : { r: 0, g: 0, b: 0 };
      weight = flashActive ? 1 : hasVisibleSecondary ? 1 : 0;
      break;
    }
    case 'flash_random': {
      const step = Math.floor(tSec * Math.max(2, p.frequency * 4));
      flashActive = hashFloat(step * 43 + device.fixtureNumber * 19) < densityFactor * 0.6;
      outRgb = flashActive ? primary : hasVisibleSecondary ? secondary : { r: 0, g: 0, b: 0 };
      weight = flashActive ? 1 : hasVisibleSecondary ? 1 : 0;
      break;
    }
    case 'flash_group': {
      const rate = Math.max(1, p.frequency);
      const step = Math.floor(tSec * rate);
      const distinctGroups = Array.from(new Set(pool.map((d) => d.groupId))).sort();
      const groupIdx = Math.max(0, distinctGroups.indexOf(device.groupId));
      const parityMatch =
        distinctGroups.length <= 1 ? step % 2 === 0 : step % distinctGroups.length === groupIdx;
      flashActive = parityMatch && (tSec * rate) % 1 < 0.4;
      outRgb = flashActive ? primary : hasVisibleSecondary ? secondary : { r: 0, g: 0, b: 0 };
      weight = flashActive ? 1 : hasVisibleSecondary ? 1 : 0;
      break;
    }
    case 'flash_alternating': {
      const cyc = (tSec * Math.max(1, p.frequency)) % 1;
      const parity = Math.floor(tSec * Math.max(1, p.frequency)) % 2;
      flashActive = (activeCount === 1 ? parity === 0 : orderedIdx % 2 === parity) && cyc < 0.45;
      outRgb = flashActive ? primary : hasVisibleSecondary ? secondary : { r: 0, g: 0, b: 0 };
      weight = flashActive ? 1 : hasVisibleSecondary ? 1 : 0;
      break;
    }
    case 'flash_bouncing': {
      const bouncePos = applyDirectionPhase(rawPhase * 1.2, 'pingpong');
      const dist = Math.abs(x - bouncePos);
      const band = gaussianBand(dist, Math.max(0.08, sizeNorm * 0.45));
      flashActive = band > 0.35;
      const smoothBand = band < 0.01 ? 0 : band;
      if (hasVisibleSecondary) {
        outRgb = lerpRgb(secondary, primary, smoothBand);
        weight = 1;
      } else {
        outRgb = primary;
        weight = smoothBand;
      }
      break;
    }
    case 'flash_left_to_right':
    case 'flash_right_to_left': {
      const pos = layer.type === 'flash_right_to_left' ? 1 - (rawPhase % 1) : rawPhase % 1;
      const dist = Math.abs(x - pos);
      const band = gaussianBand(dist, Math.max(0.08, sizeNorm * 0.4));
      flashActive = band > 0.35;
      const smoothBand = band < 0.01 ? 0 : band;
      if (hasVisibleSecondary) {
        outRgb = lerpRgb(secondary, primary, smoothBand);
        weight = 1;
      } else {
        outRgb = primary;
        weight = smoothBand;
      }
      break;
    }
    case 'flash_centre_out': {
      const distFromCentre = Math.hypot(x - 0.5, y - 0.5) / Math.SQRT1_2;
      const pos = rawPhase % 1;
      const band = gaussianBand(Math.abs(distFromCentre - pos), Math.max(0.08, sizeNorm * 0.4));
      flashActive = band > 0.35;
      const smoothBand = band < 0.01 ? 0 : band;
      if (hasVisibleSecondary) {
        outRgb = lerpRgb(secondary, primary, smoothBand);
        weight = 1;
      } else {
        outRgb = primary;
        weight = smoothBand;
      }
      break;
    }
    case 'flash_staggered': {
      const localPhase = (tSec * Math.max(0.5, p.frequency) + orderedIdx * 0.17) % 1;
      flashActive = localPhase < 0.22;
      outRgb = flashActive ? primary : hasVisibleSecondary ? secondary : { r: 0, g: 0, b: 0 };
      weight = flashActive ? 1 : hasVisibleSecondary ? 1 : 0;
      break;
    }

    // Advanced Effects (Primary = Hero Colour, Secondary = Dark Base / Trough)
    case 'fire_simulation': {
      const flicker =
        0.55 +
        0.45 *
          Math.sin(tSec * 9.3 + x * 11 + y * 5) *
          Math.cos(tSec * 5.7 + device.fixtureNumber);
      const heat = clamp((1 - y * 0.55) * flicker, 0, 1);
      const firePalette =
        palette.length >= 2
          ? [palette[1], palette[0], ...palette.slice(2)]
          : ['#1A0200', palette[0], rgbToHex(Math.min(255, primary.r + 75), Math.min(255, primary.g + 75), Math.min(255, primary.b + 40))];
      outRgb = samplePalette(firePalette, heat);
      weight = clamp(0.45 + 0.55 * heat, 0, 1);
      break;
    }
    case 'water_flow': {
      const ripple =
        (Math.sin(x * 8 - tSec * 3.2) + Math.cos(y * 6 + tSec * 2.1)) * 0.25 + 0.5;
      const waterPalette =
        palette.length >= 2
          ? [palette[1], palette[0], ...palette.slice(2)]
          : ['#021B36', palette[0], '#CAF0F8'];
      outRgb = samplePalette(waterPalette, clamp(ripple, 0, 1));
      break;
    }
    case 'aurora': {
      const drift =
        (Math.sin(x * 4.5 + tSec * 0.9) + Math.sin(y * 3.1 - tSec * 0.6) + 2) / 4;
      const auroraPalette =
        palette.length >= 2
          ? [palette[1], palette[0], ...palette.slice(2)]
          : ['#081C24', palette[0], '#7C4DFF'];
      outRgb = samplePalette(auroraPalette, clamp(drift, 0, 1));
      break;
    }
    case 'electric_pulse': {
      const pulse = Math.pow(Math.sin(tSec * 4 - x * 6), 8);
      const sparkStep = Math.floor(tSec * 8);
      const spark = hashFloat(sparkStep * 29 + device.fixtureNumber) > 0.82 ? 0.85 : 0;
      const energy = clamp(pulse + spark * 0.7, 0, 1);
      const baseElectric = hasSecondary ? secondary : hexToRgb('#041B4D');
      const peakElectric = palette.length >= 3 ? hexToRgb(palette[2]) : primary;
      outRgb =
        palette.length >= 3
          ? samplePalette([palette[1], palette[0], ...palette.slice(2)], energy)
          : lerpRgb(baseElectric, peakElectric, energy);
      flashActive = energy > 0.82;
      weight = hasSecondary ? 1 : 0.25 + 0.75 * energy;
      break;
    }
    case 'digital_rainbow': {
      if (palette.length >= 2 && !isDefaultRainbowPalette(palette)) {
        const steps = Math.max(4, palette.length * 2);
        const step = Math.floor((((x * spreadFactor + rawPhase) % 1) + 1) % 1 * steps);
        outRgb = hexToRgb(palette[step % palette.length]);
      } else {
        const step = Math.floor(((x * spreadFactor + rawPhase) * 8) % 8);
        const hue = ((step * 45) % 360 + 360) % 360;
        outRgb = hsvToRgb(hue, 100, 100);
      }
      break;
    }
    case 'matrix_rain': {
      const colSeed = hashFloat(Math.round(x * 20) * 19 + 3);
      const dropPos = (tSec * 0.7 + colSeed) % 1;
      const dist = (y - dropPos + 1) % 1;
      const tailSpan = activeCount === 1 ? 0.65 : 0.42;
      const tail = dist < tailSpan ? 1 - dist / tailSpan : 0;
      const headGlow = dist < 0.1 ? 1 - dist / 0.1 : 0;
      const tailRgb = primary;
      const bgRgb = hasSecondary ? secondary : { r: 0, g: 12, b: 4 };
      const headRgb =
        palette.length >= 3
          ? hexToRgb(palette[2])
          : lerpRgb(tailRgb, { r: 255, g: 255, b: 255 }, 0.75);
      const bodyRgb = lerpRgb(bgRgb, tailRgb, tail);
      outRgb = headGlow > 0 ? lerpRgb(bodyRgb, headRgb, headGlow) : bodyRgb;
      weight = hasSecondary ? 1 : clamp(0.14 + 0.86 * tail, 0, 1);
      break;
    }
    case 'gradient_movement': {
      const pos = (((x * spreadFactor + applyDirectionPhase(rawPhase, p.direction)) % 1) + 1) % 1;
      outRgb = samplePaletteLoop(palette, pos);
      break;
    }
    case 'multi_layer': {
      const w1 = (Math.sin((x + rawPhase) * Math.PI * 2) + 1) / 2;
      const w2 = (Math.cos((y - rawPhase * 0.7) * Math.PI * 2) + 1) / 2;
      outRgb = samplePalette(palette, (w1 + w2) / 2);
      break;
    }
    case 'sound_reactive': {
      const audio = clamp(p.audioLevel ?? 0.65, 0, 1);
      const pulse = Math.pow((Math.sin(tSec * 5) + 1) / 2, 2);
      const beat = clamp(0.18 + pulse * (0.45 + 0.55 * audio), 0, 1);
      const rawDist = Math.hypot(x - 0.5, y - 0.5) / Math.SQRT1_2;
      const effectiveDist = activeCount === 1 ? 0 : rawDist;
      const reach = clamp(1 - Math.max(0, effectiveDist - beat * 0.95) * 2.4, 0.12, 1);
      outRgb = samplePaletteLoop(palette, rawPhase * 0.65 + effectiveDist * 0.25);
      weight = clamp(reach * (0.25 + 0.75 * beat), 0.1, 1);
      break;
    }
    case 'custom_script': {
      const wave = evaluateWaveform(rawPhase + x * 0.5, p.customPulseShape);
      if (palette.length > 1) {
        outRgb = samplePalette(palette, wave);
        weight = 1;
      } else {
        const baseHsv = rgbToHsv(primary.r, primary.g, primary.b);
        const hue = ((baseHsv.h || p.customHueShift || 210) + wave * 60) % 360;
        outRgb = hsvToRgb(hue, Math.max(50, baseHsv.s), Math.max(60, baseHsv.v));
        weight = 0.2 + 0.8 * wave;
      }
      break;
    }
  }

  const finalWeight = clamp(weight, 0, 1);
  if (layer.blendMode === 'normal') {
    return {
      rgb: scaleRgb(outRgb, finalWeight),
      alpha: intensityScale,
      flashActive,
    };
  }

  return {
    rgb: outRgb,
    alpha: clamp(finalWeight * intensityScale, 0, 1),
    flashActive,
  };
}

export function renderFixtureOutput(
  device: AudienceDevice,
  allDevices: AudienceDevice[],
  groups: FixtureGroup[],
  lighting: LiveLightingState,
  timeMs: number,
): RenderedFixtureOutput {
  const effectiveTimeMs = lighting.freeze ? lighting.updatedAtMs : timeMs;
  const group = groups.find((g) => g.id === device.groupId);

  if (lighting.blackout) {
    return {
      colorHex: '#000000',
      rgb: [0, 0, 0],
      intensity: 0,
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
    };
  }

  if (lighting.emergencyNeutral) {
    return {
      colorHex: '#FFF3DF',
      rgb: [255, 243, 223],
      intensity: 0.7,
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
    };
  }

  // Identify strobe overrides everything briefly so tech can locate physical device
  if (device.identifyUntilMs > timeMs) {
    const blink = Math.floor((timeMs - (device.identifyUntilMs - 4000)) / 140) % 2 === 0;
    const rgb: RGB = blink ? { r: 255, g: 255, b: 255 } : { r: 255, g: 145, b: 0 };
    return {
      colorHex: rgbToHex(rgb.r, rgb.g, rgb.b),
      rgb: [rgb.r, rgb.g, rgb.b],
      intensity: 1,
      flashActive: blink,
      identifying: true,
      mediaUrl: null,
      mediaKind: null,
      mediaFitMode: 'cover',
      mediaOpacity: 0,
      mediaPlaybackStartServerMs: 0,
      mediaIsPlaying: false,
      mediaScale: 1,
      mediaCropX: 50,
      mediaCropY: 50,
    };
  }

  // Determine base color (with smooth timed transition if active)
  let baseHex = lighting.baseColor || '#000000';
  let currentRgb = hexToRgb(baseHex);

  if (lighting.colourTransition && lighting.colourTransition.active) {
    const tr = lighting.colourTransition;
    const progress = clamp((effectiveTimeMs - tr.startedAtMs) / Math.max(1, tr.durationMs), 0, 1);
    const eased = applyEasing(progress, tr.easing);
    currentRgb = lerpRgb(hexToRgb(tr.fromColor), hexToRgb(tr.toColor), eased);
  }

  if (group?.overrideColor) {
    currentRgb = hexToRgb(group.overrideColor);
  }

  if (device.overrideColor) {
    currentRgb = hexToRgb(device.overrideColor);
  }

  let flashActive = false;

  // Apply active effect layers in order
  for (const layer of lighting.layers) {
    if (!layer.enabled) continue;
    const res = evaluateEffectLayer(layer, device, allDevices, effectiveTimeMs);
    if (res.alpha > 0) {
      currentRgb = blendRgb(currentRgb, res.rgb, res.alpha, layer.blendMode);
      if (res.flashActive) flashActive = true;
    }
  }

  const masterFactor = clamp(lighting.masterIntensity / 100, 0, 1);
  const groupFactor = group ? clamp(group.masterIntensity / 100, 0, 1) : 1;
  const totalIntensity = masterFactor * groupFactor;
  const finalRgb = scaleRgb(currentRgb, totalIntensity);

  // Media projection resolution
  const m = lighting.media;
  const mediaMatchesDevice =
    m.enabled &&
    m.url &&
    (m.targetDeviceIds.length > 0
      ? m.targetDeviceIds.includes(device.id)
      : m.targetGroupId === 'all' || m.targetGroupId === device.groupId);

  return {
    colorHex: rgbToHex(finalRgb.r, finalRgb.g, finalRgb.b),
    rgb: [finalRgb.r, finalRgb.g, finalRgb.b],
    intensity: totalIntensity,
    flashActive,
    identifying: false,
    mediaUrl: mediaMatchesDevice ? m.url : null,
    mediaKind: mediaMatchesDevice ? m.kind : null,
    mediaFitMode: m.fitMode,
    mediaOpacity: mediaMatchesDevice ? clamp(m.opacity * totalIntensity, 0, 1) : 0,
    mediaPlaybackStartServerMs: m.playbackStartServerMs,
    mediaIsPlaying: m.isPlaying,
    mediaScale: m.scale || 1,
    mediaCropX: m.cropX ?? 50,
    mediaCropY: m.cropY ?? 50,
  };
}
