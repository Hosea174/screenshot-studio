import type { AnimationTrack, AnimationClip } from '@/types/animation';

export function retimeClipTracks(tracks: AnimationTrack[], before: AnimationClip, after: AnimationClip) {
  const ratio = after.duration / Math.max(1, before.duration);
  return tracks.map(track => track.clipId !== before.id ? track : ({
    ...track,
    keyframes: track.keyframes.map(key => ({ ...key, time: after.startTime + (key.time - before.startTime) * ratio })),
  }));
}

export function clampClipDuration(clip: AnimationClip, duration: number): AnimationClip {
  const startTime = Math.min(clip.startTime, Math.max(0, duration - 200));
  return { ...clip, startTime, duration: Math.max(200, Math.min(clip.duration, duration - startTime)) };
}
