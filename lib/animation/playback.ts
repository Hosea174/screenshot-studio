import { useImageStore } from '@/lib/store';
import { getClipInterpolatedProperties, getClipMaskAtTime } from './interpolation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';

/** One frame evaluator for preview, scrubbing, and export. Frame ticks aren't edits. */
export function applyAnimationFrame(time: number, reset = false) {
  const state = useImageStore.getState();
  if (!reset && !state.animationClips.length && !state.timeline.tracks.length) {
    if (state.imageClipPath) useImageStore.setState({ imageClipPath: null });
    return { ...DEFAULT_ANIMATABLE_PROPERTIES, ...state.perspective3D, ...state.camera, imageOpacity: state.imageOpacity };
  }
  const frame = getClipInterpolatedProperties(state.animationClips, state.timeline.tracks, time, state.animationBase ?? DEFAULT_ANIMATABLE_PROPERTIES);
  const history = useImageStore.temporal.getState();
  const tracking = history.isTracking;
  if (tracking) history.pause();
  try {
    useImageStore.setState({
      perspective3D: { perspective: frame.perspective, rotateX: frame.rotateX, rotateY: frame.rotateY, rotateZ: frame.rotateZ, translateX: frame.translateX, translateY: frame.translateY, scale: frame.scale },
      imageOpacity: frame.imageOpacity,
      imageClipPath: getClipMaskAtTime(state.animationClips, state.timeline.tracks, time) ?? null,
      camera: { cameraX: frame.cameraX, cameraY: frame.cameraY, cameraZoom: frame.cameraZoom, cameraRotateX: frame.cameraRotateX, cameraRotateY: frame.cameraRotateY, cameraRotateZ: frame.cameraRotateZ },
    });
  } finally { if (tracking) history.resume(); }
  return frame;
}
