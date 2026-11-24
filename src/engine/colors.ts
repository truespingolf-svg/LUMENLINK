export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSV {
  h: number; // 0..360
  s: number; // 0..100
  v: number; // 0..100
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function hexToRgb(hex: string): RGB {
  const cleaned = (hex || '#000000').replace('#', '').trim();
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16) || 0;
    const g = parseInt(cleaned[1] + cleaned[1], 16) || 0;
    const b = parseInt(cleaned[2] + cleaned[2], 16) || 0;
    return { r, g, b };
  }
  const num = parseInt(cleaned.padEnd(6, '0').slice(0, 6), 16);
  if (Number.isNaN(num)) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const rr = clamp(Math.round(r), 0, 255).toString(16).padStart(2, '0');
  const gg = clamp(Math.round(g), 0, 255).toString(16).padStart(2, '0');
  const bb = clamp(Math.round(b), 0, 255).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`.toUpperCase();
}

export function hsvToRgb(h: number, s: number, v: number): RGB {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const vv = clamp(v, 0, 100) / 100;

  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (hh < 60) {
    rPrime = c;
    gPrime = x;
  } else if (hh < 120) {
    rPrime = x;
    gPrime = c;
  } else if (hh < 180) {
    gPrime = c;
    bPrime = x;
  } else if (hh < 240) {
    gPrime = x;
    bPrime = c;
  } else if (hh < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rr = clamp(r, 0, 255) / 255;
  const gg = clamp(g, 0, 255) / 255;
  const bb = clamp(b, 0, 255) / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;

  return {
    h: Math.round(h),
    s: Math.round(s),
    v: Math.round(v),
  };
}

export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  const k = clamp(t, 0, 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
  };
}

export function samplePalette(palette: string[], t: number): RGB {
  const colors = palette.length > 0 ? palette : ['#0088FF', '#FF2266'];
  if (colors.length === 1) return hexToRgb(colors[0]);
  const k = clamp(t, 0, 1);
  if (k >= 1) return hexToRgb(colors[colors.length - 1]);
  const scaled = k * (colors.length - 1);
  const idx = Math.floor(scaled);
  const frac = scaled - idx;
  const c1 = hexToRgb(colors[idx]);
  const c2 = hexToRgb(colors[Math.min(idx + 1, colors.length - 1)]);
  return lerpRgb(c1, c2, frac);
}

export function samplePaletteLoop(palette: string[], t: number): RGB {
  const colors = palette.length > 0 ? palette : ['#0088FF', '#FF2266'];
  if (colors.length === 1) return hexToRgb(colors[0]);
  const wrapped = ((t % 1) + 1) % 1;
  const scaled = wrapped * colors.length;
  const idx = Math.floor(scaled) % colors.length;
  const nextIdx = (idx + 1) % colors.length;
  const frac = scaled - Math.floor(scaled);
  return lerpRgb(hexToRgb(colors[idx]), hexToRgb(colors[nextIdx]), frac);
}

export function scaleRgb(rgb: RGB, intensity: number): RGB {
  const k = clamp(intensity, 0, 1);
  return {
    r: Math.round(rgb.r * k),
    g: Math.round(rgb.g * k),
    b: Math.round(rgb.b * k),
  };
}

export function blendRgb(base: RGB, top: RGB, opacity: number, mode: 'normal' | 'add' | 'multiply' | 'screen'): RGB {
  const alpha = clamp(opacity, 0, 1);
  let blended: RGB;
  if (mode === 'add') {
    blended = {
      r: clamp(base.r + top.r, 0, 255),
      g: clamp(base.g + top.g, 0, 255),
      b: clamp(base.b + top.b, 0, 255),
    };
  } else if (mode === 'multiply') {
    blended = {
      r: Math.round((base.r * top.r) / 255),
      g: Math.round((base.g * top.g) / 255),
      b: Math.round((base.b * top.b) / 255),
    };
  } else if (mode === 'screen') {
    blended = {
      r: Math.round(255 - ((255 - base.r) * (255 - top.r)) / 255),
      g: Math.round(255 - ((255 - base.g) * (255 - top.g)) / 255),
      b: Math.round(255 - ((255 - base.b) * (255 - top.b)) / 255),
    };
  } else {
    blended = top;
  }
  return lerpRgb(base, blended, alpha);
}

export const COLOUR_TEMPERATURE_PRESETS: Array<{ label: string; kelvin: string; hex: string }> = [
  { label: 'Candle', kelvin: '1900K', hex: '#FF8A2B' },
  { label: 'Tungsten', kelvin: '2700K', hex: '#FFB36B' },
  { label: 'Warm White', kelvin: '3200K', hex: '#FFD09B' },
  { label: 'Neutral', kelvin: '4500K', hex: '#FFF0DD' },
  { label: 'Daylight', kelvin: '5600K', hex: '#FFFFFF' },
  { label: 'Cool Sky', kelvin: '7500K', hex: '#CFE4FF' },
  { label: 'CTB Full', kelvin: '10000K', hex: '#9FC8FF' },
];
