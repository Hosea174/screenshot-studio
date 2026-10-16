import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useImageStore, useEditorStore, type ImageOverlay } from '../lib/store';
import { useMotionSelection } from '../lib/animation/editor';
import { previewPose, insertPropertyKey } from '../lib/animation/authoring';
import { beginMotionDrag, undoEditor, redoEditor } from '../lib/animation/drag-history';

beforeEach(() => {
  useMotionSelection.setState({ clipId: null, keyframe: null, draft: null });
  useImageStore.setState(useImageStore.getInitialState(), true);
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useImageStore.temporal.getState().resume();
  useImageStore.temporal.getState().clear();
});

const overlay = (duration?: number): Omit<ImageOverlay, 'id'> => ({ src: 'blob:media', mediaType: duration === undefined ? undefined : 'video', mediaDuration: duration, position: { x: 100, y: 100 }, size: 200, rotation: 0, opacity: 1, isVisible: true, flipX: false, flipY: false });

test('canvas edits at a keyframe update its value, preserve easing and undo as one gesture', () => {
  const state = useImageStore.getState();
  state.addImageOverlay(overlay());
  const id = useImageStore.getState().imageOverlays[0].id;
  state.setShowTimeline(true); state.addAnimationClip('custom-asset', 0, id);
  const clip = useImageStore.getState().animationClips[0];
  useMotionSelection.getState().selectClip(clip.id);
  insertPropertyKey(clip, 'scale', 1.4, 1000, 'linear');
  state.setPlayhead(1000); state.setTimeline({ zoom: 2 });
  useImageStore.temporal.getState().clear();
  const finish = beginMotionDrag();
  previewPose(id, { scale: 1.6 }); previewPose(id, { scale: 2, translateX: 20, translateY: 10 }); finish();
  const scaleKey = () => useImageStore.getState().timeline.tracks.find(t => t.clipId === clip.id && t.keyframes.some(k => k.properties.scale !== undefined))!.keyframes.find(k => k.time === 1000)!;
  assert.equal(scaleKey().properties.scale, 2);
  assert.equal(scaleKey().easing, 'linear');
  assert.equal(useMotionSelection.getState().draft, null);
  assert.equal(useImageStore.temporal.getState().pastStates.length, 1);
  undoEditor();
  assert.equal(scaleKey().properties.scale, 1.4);
  assert.equal(useImageStore.getState().timeline.playhead, 1000);
  assert.equal(useImageStore.getState().timeline.zoom, 2);
  redoEditor(); assert.equal(scaleKey().properties.scale, 2);
});

test('main-image canvas placement is restored immediately by shared undo and redo', () => {
  useEditorStore.getState().setScreenshot({ offsetX: 10, offsetY: 20, rotation: 5 });
  useImageStore.temporal.getState().clear();
  const finish = beginMotionDrag();
  useEditorStore.getState().setScreenshot({ offsetX: 80 });
  useEditorStore.getState().setScreenshot({ offsetY: 90, rotation: 25 });
  finish();
  assert.equal(useImageStore.temporal.getState().pastStates.length, 1);
  undoEditor();
  assert.equal(useEditorStore.getState().screenshot.offsetX, 10);
  assert.equal(useEditorStore.getState().screenshot.offsetY, 20);
  assert.equal(useEditorStore.getState().screenshot.rotation, 5);
  redoEditor(); assert.equal(useEditorStore.getState().screenshot.offsetX, 80);
  assert.equal(useEditorStore.getState().screenshot.rotation, 25);
});

test('overlay dragging is one history step and panel/zoom changes do not consume undo', () => {
  const state = useImageStore.getState(); state.addImageOverlay(overlay());
  const id = useImageStore.getState().imageOverlays[0].id;
  useImageStore.temporal.getState().clear();
  const finish = beginMotionDrag();
  state.updateImageOverlay(id, { position: { x: 120, y: 130 } });
  state.updateImageOverlay(id, { position: { x: 140, y: 150 } }); finish();
  state.setShowTimeline(true); state.setTimeline({ zoom: 3 }); state.setPlayhead(500);
  assert.equal(useImageStore.temporal.getState().pastStates.length, 1);
  undoEditor(); assert.deepEqual(useImageStore.getState().imageOverlays[0].position, { x: 100, y: 100 });
  redoEditor(); assert.deepEqual(useImageStore.getState().imageOverlays[0].position, { x: 140, y: 150 });
});

test('video imports use the longest source even below five seconds; photos default to five', () => {
  const state = useImageStore.getState();
  assert.equal(state.timeline.duration, 5000);
  assert.equal(state.slideshow.defaultDuration, 5);
  state.addImageOverlay(overlay(1.2)); assert.equal(useImageStore.getState().timeline.duration, 1200);
  state.addImageOverlay(overlay(2.6)); assert.equal(useImageStore.getState().timeline.duration, 2600);
  state.addImageOverlay(overlay(0.8)); assert.equal(useImageStore.getState().timeline.duration, 2600);
  state.addImageOverlay(overlay()); assert.equal(useImageStore.getState().timeline.duration, 2600);
});
