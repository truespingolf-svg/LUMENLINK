import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDemoShow } from '../engine/shows';
import { ShowStore } from './showStore';

test('ShowStore registers multiple audience devices with sequential 001..003 fixture numbers and reconnects preserving identity', () => {
  const store = new ShowStore(null);
  const show = store.getActiveShow();

  const d1 = store.registerAudienceDevice(show.id, { deviceId: 'dev-a', name: 'iPhone 15' }, 1000);
  const d2 = store.registerAudienceDevice(show.id, { deviceId: 'dev-b', name: 'Pixel 9' }, 1050);
  const d3 = store.registerAudienceDevice(show.id, { deviceId: 'dev-c', name: 'Galaxy S24' }, 1100);

  assert.equal(d1.fixtureNumber, 1);
  assert.equal(d2.fixtureNumber, 2);
  assert.equal(d3.fixtureNumber, 3);
  assert.equal(store.getDevices(show.id).length, 3);

  // Disconnect d2 and reconnect
  assert.equal(store.markDeviceDisconnected(show.id, 'dev-b'), true);
  assert.equal(store.getDevices(show.id).find((d) => d.id === 'dev-b')?.status, 'disconnected');

  const reconnected = store.registerAudienceDevice(show.id, { deviceId: 'dev-b' }, 5000);
  assert.equal(reconnected.fixtureNumber, 2);
  assert.equal(reconnected.name, 'Pixel 9');
  assert.equal(reconnected.status, 'connected');
});

test('ShowStore auto-follow cue playback advances through cues on tickPlayback', () => {
  const store = new ShowStore(null);
  const show = store.getActiveShow();

  store.applyHostCommand(show.id, 'cue_go', { cueIndex: 0 }, 1000);
  assert.equal(show.playback.activeCueIndex, 0);
  assert.equal(show.lighting.baseColor, show.cues[0].colour);

  // Before cue 1 duration (4000ms) elapses
  store.tickPlayback(3500);
  assert.equal(show.playback.activeCueIndex, 0);

  // After cue 1 duration elapses
  const ticked = store.tickPlayback(5200);
  assert.equal(ticked.playbackUpdated, true);
  assert.equal(show.playback.activeCueIndex, 1);
  assert.equal(show.lighting.baseColor, show.cues[1].colour);
});

test('ShowStore detects stale disconnected devices on heartbeat sweep', () => {
  const store = new ShowStore(null);
  const show = store.getActiveShow();
  store.registerAudienceDevice(show.id, { deviceId: 'dev-stale' }, 1000);
  const changed = store.sweepStaleDevices(10000, 15000);
  assert.deepEqual(changed, [show.id]);
  assert.equal(store.getDevices(show.id)[0].status, 'disconnected');
});

test('upsert_effect_layer clears freeze/blackout/timelinePlaying and stamps authoritative server clock', () => {
  const store = new ShowStore(null);
  const show = store.getActiveShow();
  store.applyHostCommand(show.id, 'set_freeze', { freeze: true }, 1000);
  store.applyHostCommand(show.id, 'set_blackout', { blackout: true }, 1100);
  store.applyHostCommand(show.id, 'timeline_play', { timelineId: show.timelines[0].id }, 1200);

  const layer = {
    ...show.lighting.layers[0],
    type: 'fire_simulation' as const,
    name: 'Fire Simulation',
    enabled: true,
    startedAtMs: 99999999,
  };
  const res = store.applyHostCommand(show.id, 'upsert_effect_layer', { layer }, 2500);
  assert.equal(res.lightingChanged, true);
  assert.equal(res.show.lighting.freeze, false);
  assert.equal(res.show.lighting.blackout, false);
  assert.equal(res.show.playback.timelinePlaying, false);
  assert.equal(res.show.lighting.layers[0].startedAtMs, 2500);
});

test('ShowStore migrates legacy default Lumen2025 password to passwordless open Wi-Fi on load', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenlink-test-'));
  const filePath = path.join(tmpDir, 'store.json');
  const legacyShow = createDemoShow(1000);
  legacyShow.posterDesign = {
    ...legacyShow.posterDesign,
    wifiPassword: 'Lumen2025',
  };
  delete legacyShow.posterDesign.wifiNoPassword;

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      activeShowId: legacyShow.id,
      connectivityMode: 'local',
      shows: [legacyShow],
      devicesByShow: {},
      mediaAssets: [],
    }),
    'utf-8',
  );

  const loaded = new ShowStore(filePath);
  const show = loaded.getActiveShow();
  assert.equal(show.posterDesign.wifiNoPassword, true);
  assert.equal(show.posterDesign.wifiPassword, '');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ShowStore set_base_color preserves mid-transition continuity and clears blocking normal layers when requested', () => {
  const store = new ShowStore(null);
  const show = store.getActiveShow();
  show.lighting.layers = [
    {
      ...show.lighting.layers[0],
      id: 'layer-primary',
      enabled: true,
      blendMode: 'normal',
      type: 'wave_left_to_right',
    },
  ];

  // Clear normal effects when setting solid colour
  store.applyHostCommand(
    show.id,
    'set_base_color',
    { color: '#FF0000', transitionMs: 1000, easing: 'linear', clearNormalEffects: true },
    1000,
  );
  assert.equal(show.lighting.layers[0].enabled, false);
  assert.equal(show.lighting.colourTransition?.fromColor, '#0047FF');

  // Interrupt fade halfway from #000000 -> #FF0000 at t=1500ms toward #00FF00
  show.lighting.colourTransition!.fromColor = '#000000';
  store.applyHostCommand(
    show.id,
    'set_base_color',
    { color: '#00FF00', transitionMs: 1000, easing: 'linear' },
    1500,
  );
  // Halfway between #000000 and #FF0000 should be ~#800000 (not #FF0000!)
  assert.equal(show.lighting.colourTransition?.fromColor, '#800000');
  assert.equal(show.lighting.colourTransition?.toColor, '#00FF00');
});

