import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoShow } from './shows';
import { applyHostCommandToState } from './hostCommands';

test('applyHostCommandToState updates colour, safety modes, cue stack reorder/duplicate, and playback cleanly', () => {
  const show = createDemoShow();

  // 1. Solid colour change clears blocking normal effects and updates baseColor
  const colorOut = applyHostCommandToState({
    show,
    devices: [],
    mediaAssets: [],
    action: 'set_base_color',
    payload: { color: '#FF1E42', transitionMs: 600, clearNormalEffects: true },
    nowMs: 1000,
  });
  assert.equal(colorOut.show.lighting.baseColor, '#FF1E42');
  assert.equal(colorOut.show.lighting.blackout, false);
  assert.equal(colorOut.show.lighting.colourTransition?.toColor, '#FF1E42');
  assert.ok(colorOut.show.lighting.layers.every((l) => l.blendMode !== 'normal' || !l.enabled));

  // 2. Cue GO activates cue #2 and reflects cue colour + effect
  const cueGoOut = applyHostCommandToState({
    show: colorOut.show,
    devices: [],
    mediaAssets: [],
    action: 'cue_go',
    payload: { cueIndex: 1 },
    nowMs: 2000,
  });
  assert.equal(cueGoOut.show.playback.status, 'playing');
  assert.equal(cueGoOut.show.playback.activeCueIndex, 1);
  assert.equal(cueGoOut.show.lighting.baseColor, cueGoOut.show.cues[1].colour);

  // 3. Reorder cue moves cue down and renumbers 1..N
  const firstCueId = cueGoOut.show.cues[0].id;
  const reordered = applyHostCommandToState({
    show: cueGoOut.show,
    devices: [],
    mediaAssets: [],
    action: 'reorder_cue',
    payload: { cueId: firstCueId, direction: 'down' },
    nowMs: 2500,
  });
  assert.equal(reordered.show.cues[1].id, firstCueId);
  assert.equal(reordered.show.cues[0].cueNumber, 1);
  assert.equal(reordered.show.cues[1].cueNumber, 2);

  // 4. Duplicate cue appends clone with incremented cueNumber
  const duped = applyHostCommandToState({
    show: reordered.show,
    devices: [],
    mediaAssets: [],
    action: 'duplicate_cue',
    payload: { cueId: firstCueId },
    nowMs: 3000,
  });
  assert.equal(duped.show.cues.length, reordered.show.cues.length + 1);
  assert.match(duped.show.cues[duped.show.cues.length - 1].name, /\(Copy\)$/);

  // 5. Upsert beat_flash cue preserves full effectParams & cue_go activates them
  const upserted = applyHostCommandToState({
    show: duped.show,
    devices: [],
    mediaAssets: [],
    action: 'upsert_cue',
    payload: {
      cue: {
        id: 'cue-beat-custom',
        cueNumber: duped.show.cues.length + 1,
        name: 'Drop Beat Cue',
        colour: '#FF0066',
        effectType: 'beat_flash',
        effectParams: {
          bpm: 138,
          beatSteps: 8,
          beatStepPattern: [true, false, false, true, false, false, true, false],
          beatFlashEvery: 3,
          beatSpreadMode: 'chase',
          width: 64,
          spread: 72,
          palette: ['#FF0066', '#00FFFF'],
        },
        fadeInMs: 250,
        holdMs: 3000,
        fadeOutMs: 250,
        delayMs: 100,
        easing: 'easeInOut',
        targetGroupId: 'all',
        targetDeviceIds: [],
        intensity: 95,
        autoFollow: true,
        notes: 'Test beat cue',
      },
    },
    nowMs: 3500,
  });
  const beatCueIndex = upserted.show.cues.findIndex((c) => c.id === 'cue-beat-custom');
  assert.ok(beatCueIndex >= 0, 'Custom beat cue should be added to stack');
  assert.equal(upserted.show.cues[beatCueIndex].effectParams?.bpm, 138);
  assert.equal(upserted.show.cues[beatCueIndex].effectParams?.beatSpreadMode, 'chase');

  const beatGo = applyHostCommandToState({
    show: upserted.show,
    devices: [],
    mediaAssets: [],
    action: 'cue_go',
    payload: { cueIndex: beatCueIndex },
    nowMs: 4000,
  });
  assert.equal(beatGo.show.lighting.layers[0]?.type, 'beat_flash');
  assert.equal(beatGo.show.lighting.layers[0]?.params.bpm, 138);
  assert.equal(beatGo.show.lighting.layers[0]?.params.spread, 72);
  assert.equal(beatGo.show.lighting.layers[0]?.params.width, 64);

  // 6. Delete active cue removes it, renumbers 1..N, and resets active cue state cleanly
  const beforeLen = beatGo.show.cues.length;
  const deletedActive = applyHostCommandToState({
    show: beatGo.show,
    devices: [],
    mediaAssets: [],
    action: 'delete_cue',
    payload: { cueId: 'cue-beat-custom' },
    nowMs: 4500,
  });
  assert.equal(deletedActive.show.cues.length, beforeLen - 1);
  assert.ok(deletedActive.show.cues.every((c, idx) => c.cueNumber === idx + 1));
  assert.equal(deletedActive.show.cues.some((c) => c.id === 'cue-beat-custom'), false);
  assert.equal(deletedActive.show.playback.activeCueId, null);
  assert.equal(deletedActive.show.playback.activeCueIndex, -1);
});

