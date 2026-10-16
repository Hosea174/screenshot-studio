'use client';

import * as React from 'react';
import { Play, Pause, Repeat2, Plus, X, Diamond, SkipBack, SkipForward, Undo2, Redo2 } from 'lucide-react';
import { useStore } from 'zustand';
import { useImageStore } from '@/lib/store';
import { useMotionSelection } from '@/lib/animation/editor';
import { capturePose } from '@/lib/animation/authoring';
import { NumberField } from './NumberField';
import { undoEditor, redoEditor } from '@/lib/animation/drag-history';

const iconButton = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30';

export function TimelineControls({ onAddAnimation, onClose }: { onAddAnimation?: () => void; onClose?: () => void }) {
  const state = useImageStore();
  const selection = useMotionSelection();
  const canUndo = useStore(useImageStore.temporal, s => s.pastStates.length > 0);
  const canRedo = useStore(useImageStore.temporal, s => s.futureStates.length > 0);
  const { timeline } = state;
  const clip = state.animationClips.find(c => c.id === selection.clipId);
  const canCapture = clip && state.showTimeline && !timeline.isPlaying && timeline.playhead >= clip.startTime && timeline.playhead <= clip.startTime + clip.duration;
  const pending = selection.draft && Object.keys(selection.draft.properties).length > 0;
  const seek = (time: number) => { state.stopPlayback(); selection.selectKeyframe(null); state.setPlayhead(time); };
  return <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3">
    <div className="flex flex-1 items-center gap-1.5">
      <button type="button" aria-label="Add animation" onClick={onAddAnimation} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus size={14} />New animation</button>
      <div className="mx-1 h-4 w-px bg-border" />
      <button className={iconButton} aria-label="Undo animation edit" title="Undo (Ctrl+Z)" disabled={!canUndo && !selection.draft} onClick={undoEditor}><Undo2 size={14} /></button>
      <button className={iconButton} aria-label="Redo animation edit" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redoEditor}><Redo2 size={14} /></button>
    </div>
    <div className="flex items-center gap-1.5">
      <button className={iconButton} aria-label="Go to timeline start" onClick={() => seek(0)}><SkipBack size={14} /></button>
      <button className="inline-flex h-8 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={timeline.isPlaying ? 'Pause animation' : 'Play animation'} onClick={state.togglePlayback}>{timeline.isPlaying ? <Pause size={16} /> : <Play size={16} />}</button>
      <button className={iconButton} aria-label="Go to timeline end" onClick={() => seek(timeline.duration)}><SkipForward size={14} /></button>
      <NumberField aria-label="Playhead seconds" className="h-8 w-16 rounded-md border border-border bg-background px-2 text-center text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={timeline.playhead / 1000} min={0} max={timeline.duration / 1000} onValueChange={v => seek(v * 1000)} />
      <span className="text-xs tabular-nums text-muted-foreground">/ {(timeline.duration / 1000).toFixed(2)}s</span>
      <button className={`${iconButton} ${timeline.isLooping ? 'bg-accent text-foreground' : ''}`} aria-label={timeline.isLooping ? 'Turn looping off' : 'Turn looping on'} aria-pressed={timeline.isLooping} onClick={() => state.setTimeline({ isLooping: !timeline.isLooping })}><Repeat2 size={14} /></button>
    </div>
    <div className="flex flex-1 items-center justify-end gap-2">
      <button className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35" aria-label="Set pose keyframe" disabled={!canCapture} onClick={capturePose}><Diamond size={13} fill={pending ? 'currentColor' : 'none'} />Set keyframe<kbd className="hidden text-[10px] opacity-70 xl:inline">K</kbd></button>
      <button className={iconButton} aria-label="Close timeline" title="Close timeline (Ctrl+`)" onClick={onClose}><X size={16} /></button>
    </div>
  </div>;
}
