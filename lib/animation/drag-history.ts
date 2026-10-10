import { useImageStore } from '@/lib/store';

/** Save an entire drag as one undo step; frame updates remain transient. */
export function beginMotionDrag() {
  const history = useImageStore.temporal.getState();
  const tracking = history.isTracking;
  const before = useImageStore.getState();
  if (tracking) history.pause();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    if (!tracking) return;
    const after = useImageStore.getState();
    useImageStore.setState({ animationClips: before.animationClips, timeline: { ...before.timeline, playhead: after.timeline.playhead, isPlaying: false } });
    history.resume();
    useImageStore.setState({ animationClips: after.animationClips, timeline: after.timeline });
  };
}
