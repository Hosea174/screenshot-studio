import assert from 'node:assert/strict';
import test from 'node:test';
import { SMOOTH_TEMPLATES } from '../lib/animation/smooth-templates';
import { buildAnimatedTemplateTimeline } from '../lib/animation/templates';
import { splitPropertyTracks } from '../lib/animation/editor';

test('Smooth Cascade is the only retained Smooth template', () => {
  assert.deepEqual(SMOOTH_TEMPLATES.map(template => template.id), ['smooth-cascade']);
});

test('Smooth Cascade faithfully retains the original project animation values and timing', () => {
  const template = SMOOTH_TEMPLATES.find(template => template.id === 'smooth-cascade')!;
  const start = template.keyframes[0].properties;
  const fade = template.keyframes.find(keyframe => keyframe.time === 1483)!;
  const finish = template.keyframes.find(keyframe => keyframe.time === 2817)!.properties;
  assert.equal(template.duration, 2978);
  assert.deepEqual({
    translateX: start.translateX,
    translateY: start.translateY,
    scale: start.scale,
    rotateX: start.rotateX,
    rotateY: start.rotateY,
    rotateZ: start.rotateZ,
    perspective: start.perspective,
    imageOpacity: start.imageOpacity,
  }, { translateX: -30.2, translateY: 39.9, scale: 1.64, rotateX: 23.263, rotateY: 26.937, rotateZ: -15, perspective: 2400, imageOpacity: 0 });
  assert.deepEqual(fade.properties, { imageOpacity: 1 });
  assert.deepEqual({
    translateX: finish.translateX,
    translateY: finish.translateY,
    scale: finish.scale,
    rotateX: finish.rotateX,
    rotateY: finish.rotateY,
    rotateZ: finish.rotateZ,
    perspective: finish.perspective,
  }, { translateX: -8.5, translateY: -4.8, scale: 1.26, rotateX: 11.186, rotateY: -12.597, rotateZ: 20, perspective: 300 });

  const timeline = buildAnimatedTemplateTimeline(template, 'legacy')!;
  const tracks = splitPropertyTracks(timeline.tracks);
  assert.deepEqual(tracks.find(track => track.name === 'Position X (%)')?.keyframes.map(key => key.time), [0, 2817, 2978]);
  assert.deepEqual(tracks.find(track => track.name === 'Opacity')?.keyframes.map(key => key.time), [0, 1483, 2817, 2978]);
});
