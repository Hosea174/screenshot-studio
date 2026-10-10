import assert from 'node:assert/strict';
import test from 'node:test';
import { getClipInterpolatedProperties, getInterpolatedProperty, applyEasing, easingFunctions } from '../lib/animation/interpolation';
import { clonePresetTracks, ANIMATION_PRESETS } from '../lib/animation/presets';
import { retimeClipTracks, clampClipDuration } from '../lib/animation/retiming';
import { DEFAULT_ANIMATABLE_PROPERTIES as defaults, type AnimationTrack, type AnimationClip, type Keyframe } from '../types/animation';
import { useImageStore } from '../lib/store';
import { useMotionLibrary } from '../lib/animation/editor';
import { applyAnimationFrame } from '../lib/animation/playback';
import { beginMotionDrag } from '../lib/animation/drag-history';
import { videoTimeAt } from '../lib/video-layers';

const key = (time: number, properties: Keyframe['properties'], easing: Keyframe['easing'] = 'linear'): Keyframe => ({ id: `${time}-${JSON.stringify(properties)}`, time, properties, easing });
const track = (id: string, keyframes: Keyframe[]): AnimationTrack => ({ id: `track-${id}`, name: id, clipId: id, type: 'transform', isVisible: true, isLocked: false, keyframes });
const clip = (id: string, startTime = 0, duration = 1000): AnimationClip => ({ id, startTime, duration, name: id, presetId: id, color: '#ffffff' });
const close = (a: number, b: number) => assert.ok(Math.abs(a-b) < 1e-6, `${a} !== ${b}`);

test('sparse properties interpolate between their own keys instead of resetting at other properties', () => {
  const t = track('sparse', [key(0, { translateX: 0 }), key(500, { rotateY: 30 }), key(1000, { translateX: 100 })]);
  close(getInterpolatedProperty(t, 750, 'translateX', 0), 75);
  close(getInterpolatedProperty(t, 500, 'translateX', 0), 50);
  close(getInterpolatedProperty(t, 750, 'rotateY', 0), 30);
});

test('offset and stretched clip keys use absolute timeline time exactly once', () => {
  const before = clip('move', 1000, 1000);
  const original = track('move', [key(1000, { scale: 1 }), key(2000, { scale: 2 })]);
  const after = { ...before, startTime: 2000, duration: 2000 };
  const tracks = retimeClipTracks([original], before, after);
  close(getClipInterpolatedProperties([after], tracks, 3000).scale, 1.5);
  assert.deepEqual(tracks[0].keyframes.map(k => k.time), [2000, 4000]);
  assert.deepEqual(original.keyframes.map(k => k.time), [1000, 2000]);
});

test('unordered clips hold their final property values through gaps and after the timeline', () => {
  const a=clip('a'); const b=clip('b', 2000);
  const tracks=[track('a',[key(0,{scale:1}),key(1000,{scale:2})]),track('b',[key(2000,{rotateY:0}),key(3000,{rotateY:40})])];
  close(getClipInterpolatedProperties([b,a],tracks,1500).scale,2);
  close(getClipInterpolatedProperties([b,a],tracks,4000).scale,2);
  close(getClipInterpolatedProperties([b,a],tracks,4000).rotateY,40);
  close(getClipInterpolatedProperties([b,a],tracks,-1).scale,1);
});

test('later clips override only their authored properties and hidden tracks do not override', () => {
  const a=clip('a'); const b=clip('b',500);
  const ta=track('a',[key(0,{scale:1,rotateY:0}),key(1000,{scale:2,rotateY:60})]);
  const tb=track('b',[key(500,{scale:3}),key(1500,{scale:4})]);
  close(getClipInterpolatedProperties([a,b],[ta,tb],750).scale,3.25);
  close(getClipInterpolatedProperties([a,b],[ta,tb],750).rotateY,45);
  close(getClipInterpolatedProperties([a,b],[ta,{...tb,isVisible:false}],750).scale,1.75);
});

test('transitions blend continuously at both boundaries', () => {
  const a=clip('a'); const b={...clip('b',1000),transition:{type:'blend' as const,duration:400,easing:'linear' as const}};
  const tracks=[track('a',[key(0,{scale:1}),key(1000,{scale:2})]),track('b',[key(1000,{scale:4}),key(2000,{scale:4})])];
  close(getClipInterpolatedProperties([a,b],tracks,1000).scale,2);
  close(getClipInterpolatedProperties([a,b],tracks,1200).scale,3);
  close(getClipInterpolatedProperties([a,b],tracks,1400).scale,4);
});

test('all eases preserve exact endpoints and hold keeps the before state until the after key', () => {
  for (const ease of Object.keys(easingFunctions) as Keyframe['easing'][]) {
    close(applyEasing(0,ease),0); close(applyEasing(1,ease),1);
    assert.ok(Number.isFinite(applyEasing(0.4,ease)));
  }
  close(getInterpolatedProperty(track('hold',[key(0,{scale:1}),key(1000,{scale:2},'hold')]),999,'scale',1),1);
  close(getInterpolatedProperty(track('hold',[key(0,{scale:1}),key(1000,{scale:2},'hold')]),1000,'scale',1),2);
});

test('every built-in preset is independently cloned with editable keyframes', () => {
  for(const preset of ANIMATION_PRESETS){
    const tracks=clonePresetTracks(preset,{clipId:'test',startTime:2500});
    assert.ok(tracks.length); assert.equal(tracks[0].clipId,'test');
    assert.notEqual(tracks[0].keyframes[0].id,preset.tracks[0].keyframes[0].id);
    close(tracks[0].keyframes[0].time,preset.tracks[0].keyframes[0].time+2500);
    const result=getClipInterpolatedProperties([clip('test',2500,preset.duration)],tracks,2500+preset.duration/2);
    assert.ok(Object.values(result).every(Number.isFinite));
  }
});

test('layer targets do not overwrite the main asset or other layers', () => {
  const c={...clip('v'),target:'video-id'};
  const t=track('v',[key(0,{scale:1}),key(1000,{scale:2})]);
  close(getClipInterpolatedProperties([c],[t],500).scale,1);
  close(getClipInterpolatedProperties([c],[t],500,defaults,'video-id').scale,1.5);
  close(getClipInterpolatedProperties([c],[t],500,defaults,'other').scale,1);
});

test('camera keys animate independently from asset scale', () => {
  const c=clip('camera'); const t=track('camera',[key(0,{cameraZoom:1,cameraX:0}),key(1000,{cameraZoom:2,cameraX:200})]);
  const result=getClipInterpolatedProperties([c],[t],500);
  close(result.cameraZoom,1.5);close(result.cameraX,100);close(result.scale,1);
});

test('shortening a timeline retimes every affected keyframe to the new clip range', () => {
  const old=clip('trim',1000,3000); const next=clampClipDuration(old,2000);
  const t=retimeClipTracks([track('trim',[key(1000,{scale:1}),key(4000,{scale:2})])],old,next);
  assert.deepEqual(t[0].keyframes.map(k=>k.time),[1000,2000]);
});

test('video timing respects start, trim, speed, loop and holds the final decodable frame', () => {
  const overlay={id:'v',src:'test',position:{x:0,y:0},size:100,rotation:0,opacity:1,flipX:false,flipY:false,isVisible:true,mediaDuration:4,startTime:1000,trimStart:1,playbackRate:2};
  close(videoTimeAt(overlay,500),1);close(videoTimeAt(overlay,2000),3);close(videoTimeAt(overlay,4000),3.999);
  close(videoTimeAt({...overlay,loop:true},3000),2);
});

test('store edits merge keyframe properties, honor locks, and keep playback out of history', () => {
  const state=useImageStore.getState();state.clearAnimationClips();state.addAnimationClip('custom-asset',0);
  const t=useImageStore.getState().timeline.tracks.find(t=>t.keyframes.some(k=>'scale' in k.properties))!;const k=t.keyframes[0];
  state.updateKeyframe(t.id,k.id,{properties:{rotateX:0}});
  state.updateKeyframe(t.id,k.id,{properties:{scale:2}});
  assert.equal(useImageStore.getState().timeline.tracks.find(x=>x.id===t.id)!.keyframes[0].properties.rotateX,0);
  state.updateTrack(t.id,{isLocked:true});state.updateKeyframe(t.id,k.id,{properties:{scale:3}});
  assert.equal(useImageStore.getState().timeline.tracks.find(x=>x.id===t.id)!.keyframes[0].properties.scale,2);
  useImageStore.temporal.getState().clear();state.setPlayhead(100);state.setPlayhead(200);applyAnimationFrame(200);
  assert.equal(useImageStore.temporal.getState().pastStates.length,0);
});

test('a clip drag is a single undoable transaction and saved preset instances stay editable', () => {
  const state=useImageStore.getState();state.clearAnimationClips();state.addAnimationClip('custom-camera',0);
  const c=useImageStore.getState().animationClips[0];useImageStore.temporal.getState().clear();
  const finish=beginMotionDrag();state.updateAnimationClip(c.id,{startTime:200});state.updateAnimationClip(c.id,{startTime:400});finish();
  assert.equal(useImageStore.temporal.getState().pastStates.length,1);
  useImageStore.temporal.getState().undo();assert.equal(useImageStore.getState().animationClips[0].startTime,0);
  const tracks=useImageStore.getState().timeline.tracks;
  useMotionLibrary.getState().save({id:'saved-test',name:'My move',description:'test',category:'effects',duration:2000,tracks});
  state.addAnimationClip('saved-test',2000,'video-layer');assert.equal(useImageStore.getState().animationClips.at(-1)?.name,'My move');
  assert.equal(useImageStore.getState().animationClips.at(-1)?.target,'asset');
  assert.equal(useImageStore.getState().timeline.tracks.at(-1)?.keyframes[0].time,2000);
  useMotionLibrary.getState().remove('saved-test');
});
