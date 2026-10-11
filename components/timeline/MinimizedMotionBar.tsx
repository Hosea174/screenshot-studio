'use client';

import * as React from 'react';
import { useImageStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  PlayIcon,
  PauseIcon,
  RepeatIcon,
  RepeatOffIcon,
  VideoReplayIcon,
} from 'hugeicons-react';
import { ChevronUp } from 'lucide-react';

export function MinimizedMotionBar() {
  const {
    timeline,
    togglePlayback,
    stopPlayback,
    setPlayhead,
    setTimeline,
    toggleTimeline,
  } = useImageStore();

  const { isPlaying, isLooping, playhead, duration } = timeline;
  const scrubRef = React.useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = React.useState(false);

  const durationSec = duration / 1000;
  const playheadSec = playhead / 1000;
  const progressPercent = Math.min(100, Math.max(0, (playhead / (duration || 1)) * 100));

  const updateScrubFromPointer = (e: React.PointerEvent<HTMLDivElement> | PointerEvent) => {
    const rect = scrubRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = Math.round(ratio * duration);
    setPlayhead(targetTime);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsScrubbing(true);
    stopPlayback();
    updateScrubFromPointer(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    updateScrubFromPointer(e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsScrubbing(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  return (
    <div
      data-export-exclude="true"
      className={cn(
        'absolute bottom-3 left-1/2 z-20 -translate-x-1/2 select-none touch-none',
        'inline-flex h-10 items-center gap-2 rounded-xl px-3',
        'border border-foreground/15 bg-card/95 shadow-xl backdrop-blur-md',
        'transition-all duration-150 ease-out'
      )}
      onClick={e => e.stopPropagation()}
    >
      {/* Play / Pause button */}
      <button
        type="button"
        onClick={togglePlayback}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-lg',
          'bg-primary text-primary-foreground shadow-sm',
          'hover:opacity-90 active:scale-95 transition-all'
        )}
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
      >
        {isPlaying ? <PauseIcon size={14} /> : <PlayIcon size={14} className="ml-0.5" />}
      </button>

      {/* Loop toggle */}
      <button
        type="button"
        onClick={() => setTimeline({ isLooping: !isLooping })}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
          isLooping
            ? 'bg-foreground/[0.08] text-foreground'
            : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
        )}
        title={isLooping ? 'Looping enabled' : 'Looping disabled'}
        aria-label={isLooping ? 'Turn looping off' : 'Turn looping on'}
      >
        {isLooping ? <RepeatIcon size={14} /> : <RepeatOffIcon size={14} />}
      </button>

      {/* Time Readout */}
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground shrink-0 min-w-[70px]">
        {playheadSec.toFixed(2)}s / {durationSec.toFixed(1)}s
      </span>

      {/* Interactive Scrubber Seek Bar */}
      <div
        ref={scrubRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative flex h-5 w-32 sm:w-44 items-center cursor-ew-resize px-1 group"
        title="Scrub playhead"
      >
        <div className="h-1.5 w-full rounded-full bg-foreground/15 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-75"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full bg-primary border-2 border-background shadow-md transition-transform group-hover:scale-110"
          style={{ left: `${progressPercent}%` }}
        />
      </div>

      <div className="h-4 w-px bg-foreground/10 mx-0.5" />

      {/* Expand Timeline Button */}
      <button
        type="button"
        onClick={toggleTimeline}
        className={cn(
          'flex items-center gap-1.5 h-7 rounded-md px-2 text-xs font-medium text-foreground',
          'hover:bg-foreground/[0.08] transition-colors active:scale-95'
        )}
        title="Expand full timeline (Ctrl + `)"
      >
        <VideoReplayIcon size={13} className="text-primary" />
        <span className="hidden sm:inline">Timeline</span>
        <ChevronUp size={12} className="text-muted-foreground" />
        <kbd className="rounded border border-foreground/10 bg-foreground/[0.04] px-1 py-0.2 text-[9px] font-normal text-muted-foreground">Ctrl+`</kbd>
      </button>
    </div>
  );
}
