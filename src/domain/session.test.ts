/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { initialSession, mergeReferences, sessionReducer } from './session.ts';
import type { Photo } from './session.ts';

const photo = (id: string): Photo => ({ id, uri: `file:///${id}.jpg`, width: 1080, height: 1440 });

test('accumulating batches deduplicates asset ids and URIs and respects 10-photo cap', () => {
  const existing = [photo('a'), photo('b')];
  const added = [photo('a'), { ...photo('c'), uri: existing[1].uri }, ...Array.from({ length: 20 }, (_, i) => photo(`new-${i}`))];
  const result = mergeReferences(existing, added);
  assert.equal(result.length, 10);
  assert.deepEqual(result.slice(0, 2), existing);
  assert.equal(new Set(result.map((item) => item.uri)).size, 10);
});

test('does not enter camera or accept capture without any references', () => {
  const state = initialSession;
  assert.equal(sessionReducer(state, { type: 'open-camera' }).stage, 'references');
  assert.equal(sessionReducer(state, { type: 'captured', photo: photo('scene') }).scene, null);
});

test('one reference supports capture, retake, and cancellation', () => {
  let state = sessionReducer(initialSession, { type: 'add', photos: [photo('a')] });
  state = sessionReducer(state, { type: 'open-camera' });
  assert.equal(state.stage, 'camera');
  state = sessionReducer(state, { type: 'captured', photo: photo('scene') });
  assert.equal(state.stage, 'review');
  assert.equal(state.scene?.id, 'scene');
  state = sessionReducer(state, { type: 'retake' });
  assert.equal(state.stage, 'camera');
  state = sessionReducer(state, { type: 'back' });
  assert.equal(state.stage, 'review');
  assert.equal(state.scene?.id, 'scene');
  assert.equal(state.references.length, 1);
});

test('retake cancellation keeps the prior shot and references', () => {
  let state = sessionReducer(initialSession, { type: 'add', photos: [photo('a'), photo('b')] });
  state = sessionReducer(state, { type: 'open-camera' });
  state = sessionReducer(state, { type: 'captured', photo: photo('scene') });
  state = sessionReducer(state, { type: 'retake' });
  state = sessionReducer(state, { type: 'back' });
  assert.equal(state.stage, 'review');
  assert.equal(state.scene?.id, 'scene');
  assert.equal(state.references.length, 2);
});

test('removing down to one reference keeps camera available, removing last returns to selection', () => {
  const state = { ...initialSession, stage: 'camera' as const, references: [photo('a'), photo('b')] };
  const oneLeft = sessionReducer(state, { type: 'remove', id: 'a' });
  assert.equal(oneLeft.stage, 'camera');
  const noneLeft = sessionReducer(oneLeft, { type: 'remove', id: 'b' });
  assert.equal(noneLeft.stage, 'references');
  assert.equal(sessionReducer(noneLeft, { type: 'open-camera' }).stage, 'references');
});

test('rejects malformed photos and can reset the full session', () => {
  assert.equal(mergeReferences([], [{ ...photo('bad'), width: 0 }]).length, 0);
  const state = { stage: 'review' as const, references: [photo('a'), photo('b')], scene: photo('scene') };
  assert.deepEqual(sessionReducer(state, { type: 'reset' }), initialSession);
});
