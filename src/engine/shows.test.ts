import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankShow, createDemoShow, validateImportedShow } from './shows';

test('createDemoShow produces a valid show with cues, groups, timelines, and poster design', () => {
  const show = createDemoShow(1000);
  assert.equal(show.name, 'LUMENLINK Arena Showcase');
  assert.ok(show.cues.length >= 5);
  assert.ok(show.groups.length >= 4);
  assert.ok(show.timelines.length >= 1);
  assert.ok(show.posterDesign.elements.length >= 5);
  assert.equal(show.posterDesign.wifiPassword, '');
  assert.equal(show.posterDesign.wifiNoPassword, true);
});

test('createBlankShow generates unique ID and join code', () => {
  const show = createBlankShow('Summer Festival 2026', 2000);
  assert.equal(show.name, 'Summer Festival 2026');
  assert.equal(show.audienceSettings.eventTitle, 'Summer Festival 2026');
  assert.ok(show.joinCode.length >= 4);
});

test('validateImportedShow accepts exported show JSON and rejects malformed input', () => {
  const demo = createDemoShow(1000);
  const cloned = JSON.parse(JSON.stringify(demo));
  const imported = validateImportedShow(cloned);
  assert.ok(imported !== null);
  assert.equal(imported?.name, demo.name);
  assert.equal(validateImportedShow({ foo: 'bar' }), null);
  assert.equal(validateImportedShow(null), null);
});
