import test from 'node:test';
import assert from 'node:assert/strict';
import { videoOutputDimensions, videoTimeAt } from '../lib/export/video-timing';
import { cachedSceneFallback } from '../lib/export/cached-scene';
import type { ImageOverlay, ImageState } from '../lib/store';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '../types/animation';

const video: ImageOverlay = { id: 'video', src: 'blob:test', mediaType: 'video', mediaDuration: 10, position: { x: 200, y: 200 }, size: 200, rotation: 0, opacity: 1, flipX: false, flipY: false, isVisible: true };
test('video export resolution preserves aspect, caps pixels, and never upscales', () => {
  assert.deepEqual(videoOutputDimensions(3840, 2160), { width: 1920, height: 1080 });
  assert.deepEqual(videoOutputDimensions(2160, 3840, 1280), { width: 720, height: 1280 });
  assert.deepEqual(videoOutputDimensions(641, 361, 'original'), { width: 640, height: 360 });
  assert.deepEqual(videoOutputDimensions(640, 360), { width: 640, height: 360 });
});
test('source time respects trim, delayed start, rate, looping and frozen end frames', () => {
  const overlay = { ...video, trimStart: 2, startTime: 1000, playbackRate: 2 };
  assert.equal(videoTimeAt(overlay, 0), 2);
  assert.equal(videoTimeAt(overlay, 2000), 4);
  assert.equal(videoTimeAt(overlay, 10000), 9.999);
  assert.equal(videoTimeAt({ ...overlay, loop: true }, 6000), 4);
});
test('cached renderer keeps complex effects on the full renderer', () => {
  const state = { slides: [], blurRegions: [], camera: DEFAULT_ANIMATABLE_PROPERTIES, timeline: { tracks: [] }, animationClips: [], imageOverlays: [video] } as unknown as ImageState;
  assert.equal(cachedSceneFallback(state), null);
  assert.match(cachedSceneFallback({ ...state, imageOverlays: [{ ...video, tilt: { perspective: 200, rotateX: 20, rotateY: 0 } }] })!, /tilt/);
  assert.match(cachedSceneFallback({ ...state, blurRegions: [{ isVisible: true }] as ImageState['blurRegions'] })!, /Blur/);
  assert.match(cachedSceneFallback({ ...state, camera: { ...state.camera, cameraZoom: 2 } })!, /Scene/);
});
