import test from 'node:test';
import assert from 'node:assert/strict';
import { drawVideoFrame, withVideoCanvasImages } from '../lib/video-layers';

test('video capture preserves decoded source resolution after a small preview', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  let drawn: unknown[] = [];
  const context = { imageSmoothingEnabled: false, imageSmoothingQuality: 'low', drawImage: (...args: unknown[]) => { drawn = args; } };
  const canvas = { width: 320, height: 180, getContext: () => context };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => canvas } });
  const video = { readyState: 2, videoWidth: 3840, videoHeight: 2160 } as HTMLVideoElement;

  drawVideoFrame(video, 'source');

  assert.equal(canvas.width, 3840);
  assert.equal(canvas.height, 2160);
  assert.deepEqual(drawn, [video, 0, 0, 3840, 2160]);
  assert.equal(context.imageSmoothingQuality, 'high');
});

test('hidden capture canvases become visible export images and restore after failure', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  let restored = false;
  const image = {
    style: { visibility: 'hidden' }, src: '',
    setAttribute: () => {}, decode: async () => {},
    replaceWith: (node: unknown) => { assert.equal(node, canvas); restored = true; },
  };
  const canvas = {
    dataset: { videoExport: 'true' }, attributes: [],
    toDataURL: () => 'data:image/png;base64,frame',
    replaceWith: (node: unknown) => assert.equal(node, image),
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelectorAll: () => [canvas], createElement: () => image } });

  await assert.rejects(withVideoCanvasImages(async () => {
    assert.equal(image.style.visibility, 'visible');
    assert.equal(image.src, 'data:image/png;base64,frame');
    throw new Error('capture failed');
  }), /capture failed/);
  assert.equal(restored, true);
});
