import assert from 'node:assert/strict';
import test from 'node:test';
import { CINEMATIC_TEMPLATES, getCinematicImageScale } from '../lib/animation/cinematic-templates';
import { buildAnimatedTemplateTimeline } from '../lib/animation/templates';
import { splitPropertyTracks } from '../lib/animation/editor';
import { getClipInterpolatedProperties, getClipMaskAtTime } from '../lib/animation/interpolation';
import { calculateCanvasDimensions } from '../components/canvas/utils/canvas-dimensions';
import { useImageStore, useEditorStore } from '../lib/store';

test('detail shots are continuous, finite, editable, and between three and five seconds', () => {
  assert.equal(CINEMATIC_TEMPLATES.length, 10);
  for (const template of CINEMATIC_TEMPLATES) {
    const timeline = buildAnimatedTemplateTimeline(template, template.id)!;
    const tracks = splitPropertyTracks(timeline.tracks);
    assert.ok(template.duration >= 3000 && template.duration <= 5000);
    assert.equal(template.keyframes[0].time, 0);
    assert.equal(template.keyframes.at(-1)!.time, template.duration);
    assert.ok(template.keyframes.every((key, i, keys) => i === 0 || key.time > keys[i - 1].time));
    assert.ok(tracks.every(track => track.type !== 'camera'));
    assert.ok(tracks.every(track => track.keyframes.every(key => Object.keys(key.properties).every(p => !p.startsWith('camera')))));
    const sample = (time: number) => getClipInterpolatedProperties([timeline.clip], tracks, time);
    assert.equal(sample(template.posterTime!).imageOpacity, 1);
    const poses = template.keyframes.filter(frame => frame.properties.scale !== undefined);
    assert.ok(Math.max(...poses.map(frame => frame.properties.scale!)) >= 2, template.id);
    assert.ok(Math.max(...poses.map(frame => frame.properties.scale!)) - Math.min(...poses.map(frame => frame.properties.scale!)) >= 0.5, template.id);
    const depths = poses.map(frame => frame.properties.perspective!);
    assert.ok(Math.max(...depths) - Math.min(...depths) >= 900, template.id);
    // Opacity-only keys must not restart or flatten the spatial interpolation.
    const fadeKey = template.keyframes.find(frame => frame.time === 520)!;
    assert.deepEqual(Object.keys(fadeKey.properties), ['imageOpacity']);
    for (let time = 0; time <= template.duration; time += 25) {
      const p = sample(time);
      assert.ok(Object.values(p).every(Number.isFinite), template.id);
      assert.ok(p.scale > 0 && p.imageOpacity >= 0 && p.imageOpacity <= 1);
      assert.equal(getClipMaskAtTime([timeline.clip], tracks, time), undefined);
      if (time > 0 && time < template.duration) {
        const before = sample(time - 1);
        assert.ok(Math.abs(p.translateX - before.translateX) < 1);
        assert.ok(Math.abs(p.scale - before.scale) < 0.05);
      }
    }
    const middle = sample(template.duration / 2);
    const later = sample(template.duration / 2 + 500);
    assert.notDeepEqual(
      [middle.scale, middle.translateX, middle.translateY, middle.perspective],
      [later.scale, later.translateX, later.translateY, later.perspective],
      template.id + ' parks in the middle',
    );
  }
});
test('landscape reading shots fit portrait canvases without stretching or filling their height', () => {
  for (const aspect of [16 / 9, 16 / 10, 4 / 3]) {
    for (const width of [300, 1080]) {
      for (const frame of [
        { enabled: false, type: 'none', width: 0 },
        { enabled: true, type: 'windows-light', width: 8 },
        { enabled: true, type: 'glass-light', width: 8, padding: 1 },
        { enabled: true, type: 'photograph', width: 8 },
      ]) {
        const height = width * 16 / 9;
        const dimensions = calculateCanvasDimensions(
          { naturalWidth: aspect * 1000, naturalHeight: 1000 } as HTMLImageElement,
          width, height, { width: 1440, height: 900 }, { padding: 0 },
          { scale: getCinematicImageScale(frame, width) / 100, offsetX: 0, offsetY: 0, radius: 12 }, frame,
        );
        assert.ok(Math.abs(dimensions.framedW / width - 0.88) < 0.01);
        assert.ok(dimensions.framedH / height < 0.5);
        assert.ok(Math.abs(dimensions.imageScaledW / dimensions.imageScaledH - aspect) < 0.0001);
      }
    }
  }
});

test('applying cinematic motion preserves media and visual style and replaces prior motion', () => {
  const before = useImageStore.getState();
  const editorBefore = useEditorStore.getState();
  try {
    const backgroundConfig = { type: 'solid' as const, value: '#112233', opacity: 1 };
    useImageStore.setState({ uploadedImageUrl: 'data:image/png;base64,test', backgroundConfig,
      imageBorder: { ...before.imageBorder, enabled: false, type: 'none' },
      imageScale: 175, imageClipPath: 'circle(20%)', selectedAspectRatio: '16_9' });
    useEditorStore.setState({ screenshot: { ...editorBefore.screenshot, offsetX: 150, offsetY: -40, rotation: 30 } });
    useImageStore.getState().applyAnimatedTemplate('detail-current');
    let state = useImageStore.getState();
    assert.equal(state.uploadedImageUrl, 'data:image/png;base64,test');
    assert.deepEqual(state.backgroundConfig, backgroundConfig);
    assert.equal(state.selectedAspectRatio, '9_16');
    assert.equal(state.imageScale, 88);
    assert.equal(state.animationClips.length, 1);
    assert.equal(state.animationClips[0].name, 'Detail Current');
    assert.equal(useEditorStore.getState().canvas.padding, 0);
    assert.equal(useEditorStore.getState().screenshot.offsetX, 0);
    assert.equal(useEditorStore.getState().screenshot.offsetY, 0);
    assert.equal(useEditorStore.getState().screenshot.rotation, 0);
    useImageStore.getState().applyAnimatedTemplate('near-field');
    state = useImageStore.getState();
    assert.equal(state.imageClipPath, null);
    assert.equal(state.animationClips.length, 1);
    assert.equal(state.animationClips[0].name, 'Near Field');
  } finally {
    useImageStore.setState(before);
    useEditorStore.setState(editorBefore);
  }
});
