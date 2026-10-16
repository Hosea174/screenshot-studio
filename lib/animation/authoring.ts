import { useImageStore } from '@/lib/store';
import { useMotionSelection, PROPERTY_CONTROLS } from './editor';
import { getClipInterpolatedProperties } from './interpolation';
import { beginMotionDrag } from './drag-history';
import { DEFAULT_ANIMATABLE_PROPERTIES, type AnimatableProperties, type AnimationClip, type EasingFunction } from '@/types/animation';
import { roundToTwoDecimals } from '@/lib/number-format';

/** Whether a property has reached one of its own keys for this target. */
export function hasAnimatedPropertyAtTime(
  target: string,
  property: keyof AnimatableProperties,
  time = useImageStore.getState().timeline.playhead,
  state = useImageStore.getState(),
) {
  const motion = useMotionSelection.getState();
  const draftClip = motion.draft?.time === time
    ? state.animationClips.find(clip => clip.id === motion.draft?.clipId)
    : undefined;
  if ((draftClip?.target ?? 'asset') === target && motion.draft?.properties[property] !== undefined) return true;

  return state.timeline.tracks.some(track => {
    if (!track.isVisible) return false;
    if (track.clipId) {
      const clip = state.animationClips.find(item => item.id === track.clipId);
      if (!clip || (clip.target ?? 'asset') !== target || clip.startTime > time) return false;
    }
    if (!track.clipId && target !== 'asset') return false;
    return track.keyframes.some(key => key.time <= time && key.properties[property] !== undefined);
  });
}

export function editingClip(target?: string) {
  const state = useImageStore.getState();
  if (state.timeline.isPlaying) return undefined;
  const playhead = state.timeline.playhead;
  const matchesTarget = (clip: AnimationClip) => !target || (clip.target ?? 'asset') === target;
  // Keyframe times are stored in rounded milliseconds while clip durations can
  // be fractional. Include the end boundary with a tiny tolerance so editing a
  // final keyframe still targets its clip instead of falling through to base state.
  const isActive = (clip: AnimationClip) => playhead >= clip.startTime - 1 && playhead <= clip.startTime + clip.duration + 1;
  const selected = state.animationClips.find(c => c.id === useMotionSelection.getState().clipId);
  if (selected && matchesTarget(selected) && isActive(selected)) return selected;
  // Canvas and sidebar edits should still reach the active target clip when its
  // keyframe is under the playhead, even if focus has moved away from the clip.
  return state.animationClips
    .filter(clip => matchesTarget(clip) && isActive(clip))
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id))
    .at(-1);
}

export function motionPose(clip: AnimationClip, time = useImageStore.getState().timeline.playhead, draft = useMotionSelection.getState().draft, state = useImageStore.getState()): AnimatableProperties {
  const target = clip.target ?? 'asset';
  const pose = getClipInterpolatedProperties(state.animationClips, state.timeline.tracks, time, target === 'asset' ? state.animationBase : DEFAULT_ANIMATABLE_PROPERTIES, target);
  return draft?.clipId === clip.id && draft.time === time ? { ...pose, ...draft.properties } : pose;
}

/** Edit an existing pose in place; between key times, stage a new pose. */
export function previewPose(target: string, properties: Partial<AnimatableProperties>) {
  const clip = editingClip(target);
  if (!clip) return false;
  const state = useImageStore.getState();
  const editable = Object.fromEntries(Object.entries(properties).filter(([property]) => !state.timeline.tracks.some(t => t.clipId === clip.id && t.isLocked && t.keyframes.some(k => property in k.properties))));
  const atKey = state.timeline.tracks.some(t => t.clipId === clip.id && t.keyframes.some(k => Math.abs(k.time - state.timeline.playhead) < 1));
  if (atKey) {
    const finish = beginMotionDrag();
    try {
      for (const [property, value] of Object.entries(editable)) insertPropertyKey(clip, property as keyof AnimatableProperties, value, state.timeline.playhead);
    } finally { finish(); }
    return true;
  }
  useMotionSelection.getState().stagePose(clip.id, state.timeline.playhead, editable);
  return true;
}

export function selectMotionTarget(target: string) {
  const state = useImageStore.getState();
  if (!state.showTimeline) return;
  const selection = useMotionSelection.getState();
  const current = state.animationClips.find(c => c.id === selection.clipId);
  if ((current?.target ?? 'asset') === target && current) return;
  const clips = state.animationClips.filter(c => (c.target ?? 'asset') === target);
  const clip = clips.find(c => state.timeline.playhead >= c.startTime && state.timeline.playhead <= c.startTime + c.duration) ?? clips.at(-1);
  selection.selectClip(clip?.id ?? null);
}

export function insertPropertyKey(clip: AnimationClip, property: keyof AnimatableProperties, value: number, time: number, easing: EasingFunction = 'ease-in-out-cubic') {
  if (!Number.isFinite(value) || !Number.isFinite(time)) return;
  value = roundToTwoDecimals(value);
  const state = useImageStore.getState();
  const at = Math.round(Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, time)));
  const track = state.timeline.tracks.find(t => t.clipId === clip.id && t.keyframes.some(k => property in k.properties));
  if (track?.isLocked) return;
  if (track) {
    const key = track.keyframes.find(k => Math.abs(k.time - at) < 1);
    if (key) state.updateKeyframe(track.id, key.id, { properties: { [property]: value } });
    else state.addKeyframe(track.id, { time: at, properties: { [property]: value }, easing });
  } else {
    const control = PROPERTY_CONTROLS.find(p => p.key === property)!;
    const base = (clip.target && clip.target !== 'asset' ? DEFAULT_ANIMATABLE_PROPERTIES : state.animationBase)[property];
    const key = { id: crypto.randomUUID(), time: at, properties: { [property]: value }, easing };
    const keys = at > clip.startTime ? [{ ...key, id: crypto.randomUUID(), time: clip.startTime, properties: { [property]: base } }, key] : [key];
    state.addTrack({ name: control.label, type: control.group === 'camera' ? 'camera' : 'transform', clipId: clip.id, isLocked: false, isVisible: true, keyframes: keys });
  }
  const draft = useMotionSelection.getState().draft;
  if (draft?.clipId === clip.id && Math.abs(draft.time - at) < 1) {
    const properties = { ...draft.properties }; delete properties[property];
    useMotionSelection.setState({ draft: Object.keys(properties).length ? { ...draft, properties } : null });
  }
}

export function capturePose() {
  const clip = editingClip();
  if (!clip) return false;
  const state = useImageStore.getState();
  const pose = motionPose(clip);
  const finish = beginMotionDrag();
  try {
    for (const { key } of PROPERTY_CONTROLS.filter(p => p.group === 'asset')) insertPropertyKey(clip, key, pose[key], state.timeline.playhead);
  } finally { finish(); }
  useMotionSelection.getState().discardPose();
  return true;
}
