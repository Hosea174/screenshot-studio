import { useImageStore, type ImageOverlay } from '@/lib/store';
import { useMotionSelection } from './animation/editor';
import { beginMotionDrag } from './animation/drag-history';
import { imageClipDuration, mediaTimelineDuration, videoClipEnd, videoSourceRange } from './export/video-timing';

const FRAME = 1000 / 60;
export const MIN_VIDEO_SPEED = 0.1;
export const MAX_VIDEO_SPEED = 16;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const MAIN_IMAGE_TRACK_ID = '__main_image__';

export function selectTimelineAsset(id: string) {
  const state = useImageStore.getState();
  state.stopPlayback();
  if (id === MAIN_IMAGE_TRACK_ID) {
    state.setSelectedOverlayId(null);
    state.setIsMainImageSelected(true);
  } else {
    state.setSelectedOverlayId(id);
    state.setIsMainImageSelected(false);
  }
  useMotionSelection.getState().selectMedia(id);
}

export const selectVideoClip = selectTimelineAsset;

/** Source endpoints stay fixed for speed handles; trim handles keep the rate. */
export function videoEdgeUpdates(overlay: ImageOverlay, side: 'left' | 'right', mode: 'speed' | 'trim', time: number): Partial<ImageOverlay> {
  const source = videoSourceRange(overlay);
  const rate = overlay.playbackRate ?? 1;
  const start = overlay.startTime ?? 0;
  const end = videoClipEnd(overlay);
  const minSource = Math.min(FRAME / 1000 * rate, source.end - source.start);
  if (mode === 'speed') {
    const duration = Math.max(FRAME, side === 'left' ? end - Math.max(0, time) : time - start);
    const playbackRate = clamp((source.end - source.start) * 1000 / duration, MIN_VIDEO_SPEED, MAX_VIDEO_SPEED);
    return { playbackRate, startTime: side === 'left' ? Math.max(0, end - (source.end - source.start) / playbackRate * 1000) : start, loop: false };
  }
  if (side === 'right') return { trimEnd: clamp(source.start + (time - start) / 1000 * rate, source.start + minSource, overlay.mediaDuration ?? source.end), loop: false };
  const trimStart = clamp(source.start + (Math.max(0, time) - start) / 1000 * rate, 0, source.end - minSource);
  return { trimStart, trimEnd: source.end, startTime: start + (trimStart - source.start) / rate * 1000, loop: false };
}

/** Keep automatic duration following the media, preserving a manually longer timeline. */
function timelineFor(overlays: ImageOverlay[], clips = useImageStore.getState().animationClips) {
  const state = useImageStore.getState();
  const extent = (media: ImageOverlay[], animations = state.animationClips) => Math.max(mediaTimelineDuration(media), ...animations.map(c => c.startTime + c.duration));
  const end = extent(overlays, clips);
  const duration = state.timeline.durationLocked
    ? state.timeline.duration
    : state.timeline.duration <= extent(state.imageOverlays) + 1 ? end : Math.max(state.timeline.duration, end);
  return { ...state.timeline, duration, playhead: Math.min(state.timeline.playhead, duration), isPlaying: false };
}

export function updateVideoClip(id: string, updates: Partial<ImageOverlay>) {
  const state = useImageStore.getState();
  const imageOverlays = state.imageOverlays.map(o => o.id === id ? { ...o, ...updates } : o);
  useImageStore.setState({ imageOverlays, timeline: timelineFor(imageOverlays) });
}

export function updateImageClip(id: string, updates: { startTime?: number; clipDuration?: number }) {
  if (id === MAIN_IMAGE_TRACK_ID) {
    const state = useImageStore.getState();
    const startTime = Math.max(0, updates.startTime ?? state.mainImageStartTime ?? 0);
    const clipDuration = Math.max(FRAME, updates.clipDuration ?? state.mainImageDuration ?? state.timeline.duration);
    const end = startTime + clipDuration;
    useImageStore.setState({
      mainImageStartTime: startTime,
      mainImageDuration: clipDuration,
      ...(end > state.timeline.duration && !state.timeline.durationLocked ? { timeline: { ...state.timeline, duration: end } } : {}),
    });
    return;
  }
  const state = useImageStore.getState();
  const imageOverlays = state.imageOverlays.map(overlay => {
    if (overlay.id !== id || overlay.mediaType === 'video') return overlay;
    return {
      ...overlay,
      startTime: Math.max(0, updates.startTime ?? overlay.startTime ?? 0),
      clipDuration: Math.max(FRAME, updates.clipDuration ?? imageClipDuration(overlay, state.timeline.duration)),
    };
  });
  useImageStore.setState({ imageOverlays, timeline: timelineFor(imageOverlays) });
}

export function trimImageAt(id: string, side: 'left' | 'right') {
  const state = useImageStore.getState();
  const overlay = state.imageOverlays.find(item => item.id === id && item.mediaType !== 'video');
  const isMain = id === MAIN_IMAGE_TRACK_ID;
  if ((!overlay && !isMain) || (isMain && !state.uploadedImageUrl)) return false;
  const start = isMain ? state.mainImageStartTime ?? 0 : overlay!.startTime ?? 0;
  const duration = isMain ? state.mainImageDuration ?? state.timeline.duration : imageClipDuration(overlay!, state.timeline.duration);
  const end = start + duration;
  const time = state.timeline.playhead;
  if (time - start < FRAME || end - time < FRAME) return false;
  const finish = beginMotionDrag();
  try {
    updateImageClip(id, side === 'left'
      ? { startTime: time, clipDuration: end - time }
      : { clipDuration: time - start });
  } finally { finish(); }
  return true;
}

export function fitImageClipToTimeline(id: string) {
  const state = useImageStore.getState();
  const finish = beginMotionDrag();
  try {
    updateImageClip(id, { startTime: 0, clipDuration: Math.max(FRAME, state.timeline.duration) });
    useImageStore.getState().setTimeline({ duration: state.timeline.duration, durationLocked: true });
  } finally { finish(); }
}

export function setVideoSpeed(id: string, speed: number) {
  if (!Number.isFinite(speed)) return;
  const finish = beginMotionDrag();
  try { updateVideoClip(id, { playbackRate: clamp(speed, MIN_VIDEO_SPEED, MAX_VIDEO_SPEED), loop: false }); }
  finally { finish(); }
}

/** Fit a video clip to the current timeline duration from its start. */
export function fitVideoClipToTimeline(id: string, mode: 'speed' | 'trim') {
  const state = useImageStore.getState();
  const video = state.imageOverlays.find(o => o.id === id && o.mediaType === 'video');
  if (!video) return;

  const duration = Math.max(FRAME, state.timeline.duration);
  const sourceDuration = videoSourceRange(video).end - videoSourceRange(video).start;
  const finish = beginMotionDrag();
  try {
    if (mode === 'speed') {
      const playbackRate = clamp(sourceDuration * 1000 / duration, MIN_VIDEO_SPEED, MAX_VIDEO_SPEED);
      updateVideoClip(id, { startTime: 0, playbackRate, loop: false });
    } else {
      const rate = Math.max(MIN_VIDEO_SPEED, video.playbackRate ?? 1);
      const mediaDuration = Math.max(0, video.mediaDuration ?? videoSourceRange(video).end);
      const minimumSource = Math.min(FRAME / 1000 * rate, mediaDuration);
      const trimEnd = Math.max(minimumSource, Math.min(mediaDuration, duration / 1000 * rate));
      updateVideoClip(id, { startTime: 0, trimStart: 0, trimEnd, loop: false });
    }
    useImageStore.getState().setTimeline({ duration, durationLocked: true });
  } finally { finish(); }
}

export function trimVideoAt(id: string, side: 'left' | 'right') {
  const state = useImageStore.getState();
  const video = state.imageOverlays.find(o => o.id === id && o.mediaType === 'video');
  const time = state.timeline.playhead;
  if (!video || time - (video.startTime ?? 0) < FRAME || videoClipEnd(video) - time < FRAME) return false;
  const finish = beginMotionDrag();
  try { updateVideoClip(id, videoEdgeUpdates(video, side, 'trim', time)); }
  finally { finish(); }
  return true;
}

export function splitVideoAt(id: string) {
  const state = useImageStore.getState();
  const video = state.imageOverlays.find(o => o.id === id && o.mediaType === 'video');
  const time = state.timeline.playhead;
  if (!video || time - (video.startTime ?? 0) < FRAME || videoClipEnd(video) - time < FRAME) return null;
  const finish = beginMotionDrag();
  try {
    const splitSource = videoSourceRange(video).start + (time - (video.startTime ?? 0)) / 1000 * (video.playbackRate ?? 1);
    const inheritMainStyle = video.inheritMainStyle || (!state.uploadedImageUrl && state.imageOverlays.length === 1);
    const videoTrackId = video.videoTrackId ?? video.id;
    const right = { ...structuredClone(video), id: crypto.randomUUID(), startTime: time, trimStart: splitSource, trimEnd: videoSourceRange(video).end, inheritMainStyle, videoTrackId, loop: false };
    const imageOverlays = state.imageOverlays.flatMap(o => o.id === id ? [{ ...o, trimEnd: splitSource, inheritMainStyle, videoTrackId, loop: false }, right] : [o]);
    // The second segment keeps its independently editable visual animation.
    const clipIds = new Map(state.animationClips.filter(c => c.target === id).map(c => [c.id, crypto.randomUUID()]));
    const animationClips = [...state.animationClips, ...state.animationClips.filter(c => clipIds.has(c.id)).map(c => ({ ...structuredClone(c), id: clipIds.get(c.id)!, target: right.id }))];
    const tracks = [...state.timeline.tracks, ...state.timeline.tracks.filter(t => t.clipId && clipIds.has(t.clipId)).map(t => ({ ...structuredClone(t), id: crypto.randomUUID(), clipId: clipIds.get(t.clipId!)!, keyframes: t.keyframes.map(k => ({ ...structuredClone(k), id: crypto.randomUUID() })) }))];
    useImageStore.setState({ imageOverlays, animationClips, timeline: { ...state.timeline, tracks, isPlaying: false } });
    selectVideoClip(right.id);
    return right.id;
  } finally { finish(); }
}

export function deleteVideoClip(id: string) {
  const state = useImageStore.getState();
  const finish = beginMotionDrag();
  try {
    const imageOverlays = state.imageOverlays.filter(o => o.id !== id);
    const removed = new Set(state.animationClips.filter(c => c.target === id).map(c => c.id));
    const animationClips = state.animationClips.filter(c => !removed.has(c.id));
    const tracks = state.timeline.tracks.filter(t => !t.clipId || !removed.has(t.clipId));
    useImageStore.setState({ imageOverlays, animationClips, selectedOverlayId: null, timeline: { ...timelineFor(imageOverlays, animationClips), tracks } });
    useMotionSelection.getState().selectMedia(null);
  } finally { finish(); }
}
