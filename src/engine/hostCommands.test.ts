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
});
