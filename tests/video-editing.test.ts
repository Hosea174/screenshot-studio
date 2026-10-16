import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useImageStore, type ImageOverlay } from '../lib/store';
import { useMotionSelection } from '../lib/animation/editor';
import { undoEditor, redoEditor, beginMotionDrag } from '../lib/animation/drag-history';
import { deleteVideoClip, selectVideoClip, setVideoSpeed, splitVideoAt, trimVideoAt, updateVideoClip, videoEdgeUpdates } from '../lib/video-editing';
import { videoClipDuration, videoClipEnd, videoSourceRange, videoTimeAt, videoVisibleAt } from '../lib/export/video-timing';

const video: ImageOverlay = { id: 'video', src: 'blob:test', mediaType: 'video', mediaDuration: 12, startTime: 1000, trimStart: 2, trimEnd: 10, playbackRate: 2, position: { x: 100, y: 100 }, size: 200, rotation: 0, opacity: 1, isVisible: true, flipX: false, flipY: false };
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < .001, `${actual} != ${expected}`);
beforeEach(() => {
  useImageStore.setState(useImageStore.getInitialState(), true);
  useMotionSelection.setState({ videoId: null, clipId: null, keyframe: null, draft: null });
  useImageStore.setState(s => ({ imageOverlays: [structuredClone(video)], showTimeline: true, timeline: { ...s.timeline, duration: 5000, playhead: 3000 } }));
  useImageStore.temporal.getState().resume();
  useImageStore.temporal.getState().clear();
});

test('split keeps contiguous source time, visual animation, exclusive visibility and one-step undo', () => {
  useImageStore.getState().addAnimationClip('custom-asset', 0, video.id);
  useImageStore.temporal.getState().clear();
  const originalClips = useImageStore.getState().animationClips;
  const rightId = splitVideoAt(video.id)!;
  assert.ok(rightId);
  const [left, right] = useImageStore.getState().imageOverlays;
  assert.deepEqual(videoSourceRange(left), { start: 2, end: 6 });
  assert.deepEqual(videoSourceRange(right), { start: 6, end: 10 });
  assert.equal(videoClipEnd(left), right.startTime);
  assert.equal(videoVisibleAt(left, 3000), false);
  assert.equal(videoVisibleAt(right, 3000), true);
  assert.equal(videoTimeAt(right, 3500), 7);
  assert.equal(left.videoTrackId, right.videoTrackId);
  assert.equal(left.inheritMainStyle, true);
  assert.equal(right.inheritMainStyle, true);
  const copied = useImageStore.getState().animationClips.filter(c => c.target === rightId);
  assert.equal(copied.length, originalClips.length);
  assert.notEqual(copied[0].id, originalClips[0].id);
  const copiedTracks = useImageStore.getState().timeline.tracks.filter(t => t.clipId === copied[0].id);
  assert.ok(copiedTracks.length);
  assert.equal(useImageStore.temporal.getState().pastStates.length, 1);
  undoEditor(); assert.equal(useImageStore.getState().imageOverlays.length, 1);
  assert.equal(useImageStore.getState().imageOverlays[0].trimEnd, 10);
  redoEditor(); assert.equal(useImageStore.getState().imageOverlays.length, 2);
});

test('left and right trims respect source trim and speed, and never author empty segments', () => {
  assert.equal(trimVideoAt(video.id, 'left'), true);
  let clip = useImageStore.getState().imageOverlays[0];
  assert.equal(clip.startTime, 3000); assert.equal(clip.trimStart, 6); assert.equal(clip.playbackRate, 2);
  assert.equal(videoClipEnd(clip), 5000);
  assert.equal(trimVideoAt(video.id, 'right'), false);
  undoEditor();
  assert.equal(trimVideoAt(video.id, 'right'), true);
  clip = useImageStore.getState().imageOverlays[0];
  assert.equal(clip.trimEnd, 6); assert.equal(clip.startTime, 1000); assert.equal(videoClipEnd(clip), 3000);
  assert.equal(videoTimeAt(clip, 9000), 5.999);
  assert.equal(videoVisibleAt(clip, 3500), false);
  useImageStore.getState().setPlayhead(1000);
  assert.equal(splitVideoAt(video.id), null);
});

test('speed edge handles preserve source endpoints and anchor the opposite edge', () => {
  const right = { ...video, ...videoEdgeUpdates(video, 'right', 'speed', 9000) };
  assert.equal(right.playbackRate, 1); assert.deepEqual(videoSourceRange(right), videoSourceRange(video));
  assert.equal(videoClipEnd(right), 9000);
  const left = { ...video, ...videoEdgeUpdates(video, 'left', 'speed', 3000) };
  assert.equal(left.playbackRate, 4); assert.equal(left.startTime, 3000);
  assert.equal(videoClipEnd(left), videoClipEnd(video));
  const trimmed = { ...video, ...videoEdgeUpdates(video, 'right', 'trim', 3000) };
  assert.equal(trimmed.playbackRate, 2); assert.equal(trimmed.trimEnd, 6);
  const extended = { ...video, ...videoEdgeUpdates(video, 'left', 'trim', 0) };
  assert.equal(extended.startTime, 0); assert.equal(extended.trimStart, 0); assert.equal(videoClipEnd(extended), 5000);
  assert.ok(videoClipDuration({ ...video, ...videoEdgeUpdates(video, 'right', 'trim', -100) }) > 0);
});

test('speed changes, grouped edge drags and deletion are undoable and extend the timeline', () => {
  selectVideoClip(video.id);
  setVideoSpeed(video.id, .5);
  assert.equal(videoClipEnd(useImageStore.getState().imageOverlays[0]), 17000);
  assert.equal(useImageStore.getState().timeline.duration, 17000);
  undoEditor(); assert.equal(useImageStore.getState().timeline.duration, 5000);
  const finish = beginMotionDrag();
  updateVideoClip(video.id, videoEdgeUpdates(video, 'right', 'trim', 4000));
  updateVideoClip(video.id, videoEdgeUpdates(video, 'right', 'trim', 3500));
  finish();
  near(videoClipEnd(useImageStore.getState().imageOverlays[0]), 3500);
  undoEditor(); near(videoClipEnd(useImageStore.getState().imageOverlays[0]), 5000);
  deleteVideoClip(video.id); assert.equal(useImageStore.getState().imageOverlays.length, 0);
  undoEditor(); assert.equal(useImageStore.getState().imageOverlays[0].id, video.id);
});
