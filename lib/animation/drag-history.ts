import { useImageStore } from '@/lib/store';
import { useMotionSelection } from './editor';
import { applyAnimationFrame } from './playback';

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
    useImageStore.setState({ ...before, selectedOverlayId: after.selectedOverlayId, isMainImageSelected: after.isMainImageSelected, canvasDimensions: after.canvasDimensions, timeline: { ...before.timeline, playhead: after.timeline.playhead, isPlaying: false } });
    history.resume();
    useImageStore.setState(after);
  };
}

let undonePose: { draft: NonNullable<ReturnType<typeof useMotionSelection.getState>['draft']>; state: ReturnType<typeof useImageStore.getState> } | null = null;

function travelHistory(direction: 'undo' | 'redo') {
  const { playhead, zoom, isLooping } = useImageStore.getState().timeline;
  const history = useImageStore.temporal.getState();
  history[direction]();
  const tracking = history.isTracking;
  if (tracking) history.pause();
  try {
    useImageStore.setState(s => ({ timeline: { ...s.timeline, playhead: Math.min(playhead, s.timeline.duration), zoom, isLooping, isPlaying: false } }));
  } finally { if (tracking) history.resume(); }
}

export function undoEditor() {
  const draft = useMotionSelection.getState().draft;
  useImageStore.getState().stopPlayback();
  if (draft) {
    useMotionSelection.getState().discardPose();
    applyAnimationFrame(useImageStore.getState().timeline.playhead);
    undonePose = { draft, state: useImageStore.getState() };
    return;
  }
  undonePose = null;
  travelHistory('undo');
  applyAnimationFrame(useImageStore.getState().timeline.playhead);
}

export function redoEditor() {
  if (undonePose && undonePose.state === useImageStore.getState()) {
    const { draft } = undonePose;
    useMotionSelection.getState().stagePose(draft.clipId, draft.time, draft.properties);
    undonePose = null;
  } else {
    undonePose = null;
    useImageStore.getState().stopPlayback();
    travelHistory('redo');
  }
  applyAnimationFrame(useImageStore.getState().timeline.playhead);
}
