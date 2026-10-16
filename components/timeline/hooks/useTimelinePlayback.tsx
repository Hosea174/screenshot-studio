'use client';
import * as React from 'react';
import { useImageStore } from '@/lib/store';
import { useMotionSelection } from '@/lib/animation/editor';
import { applyAnimationFrame } from '@/lib/animation/playback';
function getActiveSlideAtTime(
  slides: { id: string; duration: number }[],
  timeMs: number,
  defaultDuration: number
): string | null {
  if (slides.length === 0) return null;
  if (slides.length === 1) return slides[0].id;

  let cumulativeTime = 0;

  for (const slide of slides) {
    const slideDurationMs = (slide.duration || defaultDuration) * 1000;
    if (timeMs < cumulativeTime + slideDurationMs) {
      return slide.id;
    }
    cumulativeTime += slideDurationMs;
  }

  // If past all slides, return the last one
  return slides[slides.length - 1].id;
}


export function useTimelinePlayback() {
  const draft = useMotionSelection(s => s.draft);
  const timeline = useImageStore(s => s.timeline);
  const clips = useImageStore(s => s.animationClips);
  const hadMotion = React.useRef(false);
  React.useEffect(() => {
    if (clips.length || timeline.tracks.length || hadMotion.current) applyAnimationFrame(timeline.playhead, hadMotion.current);
    hadMotion.current = clips.length > 0 || timeline.tracks.length > 0;
  }, [timeline.playhead, timeline.tracks, clips, draft]);
  React.useEffect(() => {
    if (!timeline.isPlaying) return;
    let raf = 0;
    let previous: number | null = null;
    const tick = (now: number) => {
      const state = useImageStore.getState();
      if (!state.timeline.isPlaying) return;
      const delta = previous === null ? 0 : now - previous;
      previous = now;
      const end = Math.max(1, state.timeline.duration);
      let next = state.timeline.playhead + delta;
      const finished = next >= end && !state.timeline.isLooping;
      if (next >= end) next = state.timeline.isLooping ? next % end : end;
      state.setPlayhead(next);
      if (state.slides.length > 1) {
        const id = getActiveSlideAtTime(state.slides, next, state.slideshow.defaultDuration);
        if (id && id !== state.activeSlideId) state.setActiveSlide(id);
      }
      if (finished) { state.stopPlayback(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [timeline.isPlaying]);
}
