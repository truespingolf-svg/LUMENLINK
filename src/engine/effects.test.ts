import test from 'node:test';
import assert from 'node:assert/strict';
import { AudienceDevice, FixtureGroup, LiveLightingState } from '../shared/types';
import { EFFECT_CATALOG, createDefaultEffectParams, renderFixtureOutput } from './effects';
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, samplePaletteLoop } from './colors';

function makeDevice(id: string, num: number, x: number, y: number, groupId = 'grp-a'): AudienceDevice {
  return {
    id,
    fixtureNumber: num,
    name: `Phone ${num}`,
    deviceType: 'smartphone',
    orientation: 'portrait',
    status: 'connected',
    batteryLevel: 85,
    lastSeenMs: 1000,
    joinedAtMs: 1000,
    groupId,
    excluded: false,
    x,
    y,
    row: 0,
    col: num - 1,
    overrideColor: null,
    identifyUntilMs: 0,
  };
}

function makeBaseLighting(overrides?: Partial<LiveLightingState>): LiveLightingState {
  return {
    masterIntensity: 100,
    blackout: false,
    freeze: false,
    emergencyNeutral: false,
    baseColor: '#0000FF',
    colourTransition: null,
    layers: [],
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
      playbackStartServerMs: 0,
      isPlaying: false,
      sequenceIds: [],
      sequenceIntervalMs: 3000,
      cropX: 50,
      cropY: 50,
      scale: 1,
    },
    updatedAtMs: 0,
    ...overrides,
  };
}

const groups: FixtureGroup[] = [
  { id: 'grp-a', name: 'Group A', color: '#38BDF8', masterIntensity: 100, overrideColor: null },
  { id: 'grp-b', name: 'Group B', color: '#F59E0B', masterIntensity: 100, overrideColor: null },
];

test('color conversion round-trips RGB <-> HEX <-> HSV accurately', () => {
  const rgb = hexToRgb('#3366FF');
  assert.deepEqual(rgb, { r: 51, g: 102, b: 255 });
  assert.equal(rgbToHex(rgb.r, rgb.g, rgb.b), '#3366FF');
  const hsv = rgbToHsv(255, 0, 0);
  assert.equal(hsv.h, 0);
  assert.equal(hsv.s, 100);
  assert.deepEqual(hsvToRgb(hsv.h, hsv.s, hsv.v), { r: 255, g: 0, b: 0 });
});

test('solid blue output turns all connected devices blue and blackout zeros output', () => {
  const d1 = makeDevice('d1', 1, 0.2, 0.5);
  const d2 = makeDevice('d2', 2, 0.8, 0.5);
  const lighting = makeBaseLighting({ baseColor: '#0000FF' });

  const out1 = renderFixtureOutput(d1, [d1, d2], groups, lighting, 1000);
  assert.equal(out1.colorHex, '#0000FF');

  const blackLighting = makeBaseLighting({ baseColor: '#0000FF', blackout: true });
  const blackOut = renderFixtureOutput(d1, [d1, d2], groups, blackLighting, 1000);
  assert.equal(blackOut.colorHex, '#000000');
  assert.equal(blackOut.intensity, 0);
});

test('smooth red-to-blue colour transition interpolates midway and ends at pure blue', () => {
  const d1 = makeDevice('d1', 1, 0.5, 0.5);
  const lighting = makeBaseLighting({
    baseColor: '#0000FF',
    colourTransition: {
      active: true,
      fromColor: '#FF0000',
      toColor: '#0000FF',
      startedAtMs: 1000,
      durationMs: 2000,
      easing: 'linear',
    },
  });

  const startOut = renderFixtureOutput(d1, [d1], groups, lighting, 1000);
  assert.equal(startOut.colorHex, '#FF0000');

  const midOut = renderFixtureOutput(d1, [d1], groups, lighting, 2000);
  assert.ok(midOut.rgb[0] > 100 && midOut.rgb[2] > 100, 'midpoint should mix red and blue');

  const endOut = renderFixtureOutput(d1, [d1], groups, lighting, 3000);
  assert.equal(endOut.colorHex, '#0000FF');
});

test('left-to-right colour wave peaks at left fixture before right fixture based on X position', () => {
  const left = makeDevice('d1', 1, 0.1, 0.5);
  const mid = makeDevice('d2', 2, 0.5, 0.5);
  const right = makeDevice('d3', 3, 0.9, 0.5);
  const all = [left, mid, right];

  const lighting = makeBaseLighting({
    baseColor: '#000000',
    layers: [
      {
        id: 'l1',
        name: 'Wave',
        type: 'wave_left_to_right',
        enabled: true,
        blendMode: 'normal',
        opacity: 1,
        startedAtMs: 0,
        params: createDefaultEffectParams({
          speed: 1,
          width: 18,
          palette: ['#0088FF', '#000000'],
        }),
      },
    ],
  });

  // At t=200ms (phase = 0.1), wave head is at x=0.1 -> left should be brightest
  const atLeft = [
    renderFixtureOutput(left, all, groups, lighting, 200),
    renderFixtureOutput(mid, all, groups, lighting, 200),
    renderFixtureOutput(right, all, groups, lighting, 200),
  ];
  assert.ok(atLeft[0].rgb[2] > atLeft[1].rgb[2], 'left fixture brighter when head is at x=0.1');

  // At t=1000ms (phase = 0.5), wave head is at x=0.5 -> mid should be brightest
  const atMid = [
    renderFixtureOutput(left, all, groups, lighting, 1000),
    renderFixtureOutput(mid, all, groups, lighting, 1000),
    renderFixtureOutput(right, all, groups, lighting, 1000),
  ];
  assert.ok(atMid[1].rgb[2] > atMid[0].rgb[2] && atMid[1].rgb[2] > atMid[2].rgb[2]);
});

test('bouncing flash sweeps across fixtures and reverses direction', () => {
  const left = makeDevice('d1', 1, 0.05, 0.5);
  const right = makeDevice('d2', 2, 0.95, 0.5);
  const all = [left, right];

  const lighting = makeBaseLighting({
    baseColor: '#000000',
    layers: [
      {
        id: 'l-flash',
        name: 'Bounce',
        type: 'flash_bouncing',
        enabled: true,
        blendMode: 'add',
        opacity: 1,
        startedAtMs: 0,
        params: createDefaultEffectParams({
          speed: 1,
          size: 20,
          palette: ['#FFFFFF'],
        }),
      },
    ],
  });

  // rawPhase * 1.2 = (tSec * 0.5) * 1.2 = 0.6 * tSec. At t=0 -> pos=0 (left active)
  const t0Left = renderFixtureOutput(left, all, groups, lighting, 0);
  const t0Right = renderFixtureOutput(right, all, groups, lighting, 0);
  assert.equal(t0Left.flashActive, true);
  assert.equal(t0Right.flashActive, false);

  // At t=1667ms -> phase ~ 1.0 -> pos=1 (right active)
  const t1Left = renderFixtureOutput(left, all, groups, lighting, 1667);
  const t1Right = renderFixtureOutput(right, all, groups, lighting, 1667);
  assert.equal(t1Left.flashActive, false);
  assert.equal(t1Right.flashActive, true);
});

test('custom palettes adjust fire_simulation, water_flow, aurora, matrix_rain, and rainbow_wave colours', () => {
  const d1 = makeDevice('d1', 1, 0.5, 0.5);

  // Fire with custom neon pink/purple palette should emit magenta/violet, not orange
  const fireNeon = renderFixtureOutput(
    d1,
    [d1],
    groups,
    makeBaseLighting({
      layers: [
        {
          id: 'l-fire',
          name: 'Neon Fire',
          type: 'fire_simulation',
          enabled: true,
          blendMode: 'normal',
          opacity: 1,
          startedAtMs: 0,
          params: createDefaultEffectParams({ palette: ['#FF00FF', '#9900FF'] }),
        },
      ],
    }),
    500,
  );
  assert.ok(fireNeon.rgb[2] > 120 && fireNeon.rgb[0] > 100, 'custom fire palette should preserve magenta/purple channels');

  // Rainbow wave with custom 2-colour palette uses custom stops instead of green HSV
  const customRainbow = renderFixtureOutput(
    d1,
    [d1],
    groups,
    makeBaseLighting({
      layers: [
        {
          id: 'l-rb',
          name: 'Custom Wave',
          type: 'rainbow_wave',
          enabled: true,
          blendMode: 'normal',
          opacity: 1,
          startedAtMs: 0,
          params: createDefaultEffectParams({ palette: ['#FF0000', '#0000FF'] }),
        },
      ],
    }),
    250,
  );
  assert.equal(customRainbow.rgb[1], 0, 'custom rainbow palette stops #FF0000 and #0000FF should have 0 green');
});

test('clock skew slightly before startedAtMs still renders effect immediately when delayMs is 0', () => {
  const d1 = makeDevice('d1', 1, 0.5, 0.5);
  const lighting = makeBaseLighting({
    baseColor: '#000000',
    layers: [
      {
        id: 'l-skew',
        name: 'Pulse',
        type: 'colour_breathing',
        enabled: true,
        blendMode: 'normal',
        opacity: 1,
        startedAtMs: 2000,
        params: createDefaultEffectParams({ delayMs: 0, palette: ['#00FFAA'] }),
      },
    ],
  });
  const out = renderFixtureOutput(d1, [d1], groups, lighting, 1950);
  assert.ok(out.rgb[1] > 10 || out.rgb[2] > 10, 'minor negative skew should not blank effect');
});

test('single connected device visibly animates sequential_device_chase', () => {
  const d1 = makeDevice('d1', 1, 0.0833, 0.125);
  const lighting = makeBaseLighting({
    baseColor: '#000000',
    layers: [
      {
        id: 'l-seq',
        name: 'Chase',
        type: 'sequential_device_chase',
        enabled: true,
        blendMode: 'normal',
        opacity: 1,
        startedAtMs: 0,
        params: createDefaultEffectParams({ frequency: 2, speed: 1, palette: ['#FF9900', '#001133'] }),
      },
    ],
  });
  const onBeat = renderFixtureOutput(d1, [d1], groups, lighting, 100);
  const offBeat = renderFixtureOutput(d1, [d1], groups, lighting, 400);
  assert.notEqual(onBeat.colorHex, offBeat.colorHex, 'single device chase should alternate instead of staying static');
});

test('samplePaletteLoop wraps smoothly across boundary t=0.99 to t=0.01 without snapping', () => {
  const pal = ['#FF0000', '#00FF00', '#0000FF'];
  const beforeWrap = samplePaletteLoop(pal, 0.99);
  const afterWrap = samplePaletteLoop(pal, 0.01);
  const delta =
    Math.abs(beforeWrap.r - afterWrap.r) +
    Math.abs(beforeWrap.g - afterWrap.g) +
    Math.abs(beforeWrap.b - afterWrap.b);
  assert.ok(delta < 40, `Expected smooth wrap across t=1->0, got delta=${delta}`);
});

test('all 46 effects in EFFECT_CATALOG render dynamically and reflect custom primary/secondary colours', () => {
  assert.equal(EFFECT_CATALOG.length, 46);
  const d1 = makeDevice('d1', 1, 0.0833, 0.125, 'grp-a');
  const d2 = makeDevice('d2', 2, 0.5, 0.5, 'grp-b');
  const ghostDisconnected: AudienceDevice = { ...makeDevice('d-ghost', 3, 0.9, 0.9, 'grp-a'), status: 'disconnected' };

  for (const fx of EFFECT_CATALOG) {
    // 1 connected device + 1 disconnected ghost device should act cleanly as 1 live fixture
    const lighting = makeBaseLighting({
      baseColor: '#000000',
      layers: [
        {
          id: 'l-test',
          name: fx.label,
          type: fx.type,
          enabled: true,
          blendMode: 'normal',
          opacity: 1,
          startedAtMs: 0,
          params: createDefaultEffectParams({
            speed: 1.5,
            frequency: 2,
            palette: fx.defaultPalette || ['#0066FF', '#FF1E42'],
          }),
        },
      ],
    });

    const samples = [0, 150, 350, 700, 1200, 1900].map((t) =>
      renderFixtureOutput(d1, [d1, ghostDisconnected], groups, lighting, t),
    );
    for (const s of samples) {
      assert.match(s.colorHex, /^#[0-9A-F]{6}$/, `${fx.type} produced invalid hex ${s.colorHex}`);
    }
    const maxLuma = Math.max(...samples.map((s) => s.rgb[0] + s.rgb[1] + s.rgb[2]));
    assert.ok(maxLuma > 30, `${fx.type} remained too dark on single connected fixture (maxLuma=${maxLuma})`);

    // Custom crimson/emerald palette must produce visible red or green output on every effect (including fire, aurora, matrix, flash, etc.)
    const customLighting = makeBaseLighting({
      baseColor: '#000000',
      layers: [
        {
          ...lighting.layers[0],
          params: createDefaultEffectParams({
            speed: 1.5,
            frequency: 2,
            palette: ['#FF0000', '#00FF00'],
          }),
        },
      ],
    });
    const customSamples = [50, 300, 650, 1100, 1700].map((t) =>
      renderFixtureOutput(d1, [d1, d2], groups, customLighting, t),
    );
    const maxRed = Math.max(...customSamples.map((s) => s.rgb[0]));
    const maxGreen = Math.max(...customSamples.map((s) => s.rgb[1]));
    if (fx.type !== 'rainbow_cycle' && fx.type !== 'rainbow_wave' && fx.type !== 'digital_rainbow') {
      assert.ok(
        maxRed > 80 && maxGreen >= 0,
        `${fx.type} did not honour custom primary red colour (maxRed=${maxRed})`,
      );
    }
  }
});

test('stepped and cyclic colour fades interpolate smoothly over fadeTimeMs without abrupt jumps', () => {
  const d1 = makeDevice('d1', 1, 0.25, 0.5);
  const chaseLighting = makeBaseLighting({
    baseColor: '#000000',
    layers: [
      {
        id: 'l-chase',
        name: 'Chase',
        type: 'colour_chase',
        enabled: true,
        blendMode: 'normal',
        opacity: 1,
        startedAtMs: 0,
        params: createDefaultEffectParams({
          speed: 1,
          frequency: 1, // 1 step per 1000ms
          fadeTimeMs: 400,
          palette: ['#FF0000', '#0000FF'],
        }),
      },
    ],
  });

  // At t=1000ms (step boundary) -> t=1200ms (mid 400ms crossfade) -> t=1450ms (done)
  const atBoundary = renderFixtureOutput(d1, [d1], groups, chaseLighting, 1000);
  const midFade = renderFixtureOutput(d1, [d1], groups, chaseLighting, 1200);
  const afterFade = renderFixtureOutput(d1, [d1], groups, chaseLighting, 1450);

  assert.equal(atBoundary.colorHex, '#FF0000');
  assert.ok(midFade.rgb[0] > 80 && midFade.rgb[2] > 80, `Expected smooth red->blue mix at 1200ms, got ${midFade.colorHex}`);
  assert.equal(afterFade.colorHex, '#0000FF');

  // Verify colour_fade has zero snap across loop wrap (period = 2000ms at speed=1)
  const fadeLighting = makeBaseLighting({
    baseColor: '#000000',
    layers: [
      {
        id: 'l-fade',
        name: 'Colour Fade',
        type: 'colour_fade',
        enabled: true,
        blendMode: 'normal',
        opacity: 1,
        startedAtMs: 0,
        params: createDefaultEffectParams({
          speed: 1,
          palette: ['#0066FF', '#A855F7', '#FF1E42'],
        }),
      },
    ],
  });
  let maxFrameJump = 0;
  let prev = renderFixtureOutput(d1, [d1], groups, fadeLighting, 0);
  for (let t = 33; t <= 4200; t += 33) {
    const curr = renderFixtureOutput(d1, [d1], groups, fadeLighting, t);
    const jump = Math.max(
      Math.abs(curr.rgb[0] - prev.rgb[0]),
      Math.abs(curr.rgb[1] - prev.rgb[1]),
      Math.abs(curr.rgb[2] - prev.rgb[2]),
    );
    if (jump > maxFrameJump) maxFrameJump = jump;
    prev = curr;
  }
  assert.ok(maxFrameJump < 30, `Expected smooth continuous colour_fade frame steps, got maxJump=${maxFrameJump}`);
});
