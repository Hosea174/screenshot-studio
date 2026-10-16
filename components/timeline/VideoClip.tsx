'use client';

import * as React from 'react';
import { Gauge, Scissors, Trash2, Image as ImageIcon } from 'lucide-react';
import { type ImageOverlay } from '@/lib/store';
import { useMotionSelection } from '@/lib/animation/editor';
import { beginMotionDrag } from '@/lib/animation/drag-history';
import { videoClipDuration, videoClipEnd, videoSourceRange } from '@/lib/export/video-timing';
import { deleteVideoClip, fitImageClipToTimeline, fitVideoClipToTimeline, MAX_VIDEO_SPEED, MIN_VIDEO_SPEED, selectTimelineAsset, setVideoSpeed, splitVideoAt, trimImageAt, trimVideoAt, updateImageClip, updateVideoClip, videoEdgeUpdates } from '@/lib/video-editing';
import { NumberField } from './NumberField';

const button = 'inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ring';
const field = 'h-8 w-20 rounded border border-border bg-background px-2 text-right text-xs tabular-nums focus-visible:ring-2 focus-visible:ring-ring';

export function VideoClipBar({ overlay, index, pps, gutter, snap, onDragScale }: {
  overlay: ImageOverlay; index: number; pps: number; gutter: number;
  snap: (time: number) => number; onDragScale: (pps: number | null) => void;
}) {
  const selected = useMotionSelection(s => s.mediaId === overlay.id);
  const drag = React.useRef<{ pointerId: number; x: number; overlay: ImageOverlay; mode: 'move' | 'speed' | 'trim'; side: 'left' | 'right'; pps: number; finish: () => void } | null>(null);
  const finish = () => { if (drag.current) { drag.current.finish(); drag.current = null; onDragScale(null); } };
  React.useEffect(() => () => drag.current?.finish(), []);
  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    selectTimelineAsset(overlay.id);
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-video-edge]');
    drag.current = { pointerId: event.pointerId, x: event.clientX, overlay: structuredClone(overlay), mode: handle?.dataset.mode as 'speed' | 'trim' ?? 'move', side: handle?.dataset.videoEdge as 'left' | 'right' ?? 'right', pps, finish: beginMotionDrag() };
    onDragScale(pps);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const delta = (event.clientX - d.x) / d.pps * 1000;
    const at = (time: number) => event.altKey ? time : snap(time);
    if (d.mode === 'move') updateVideoClip(overlay.id, { startTime: Math.max(0, at((d.overlay.startTime ?? 0) + delta)) });
    else updateVideoClip(overlay.id, videoEdgeUpdates(d.overlay, d.side, d.mode, at((d.side === 'left' ? d.overlay.startTime ?? 0 : videoClipEnd(d.overlay)) + delta)));
  };
  return <div role="button" tabIndex={0} data-video-clip={overlay.id} aria-label={`Select video clip ${index + 1}`} aria-pressed={selected}
    className={`absolute inset-y-1 touch-none cursor-grab rounded-md border text-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary bg-primary/15 ring-1 ring-primary' : 'border-foreground/25 bg-muted hover:bg-accent'}`}
    style={{ left: gutter + (overlay.startTime ?? 0) / 1000 * pps, width: Math.max(4, videoClipDuration(overlay) / 1000 * pps) }}
    onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); selectTimelineAsset(overlay.id); } }}>
    <div className="pointer-events-none absolute inset-x-2 inset-y-0 flex items-center gap-2 overflow-hidden px-1 text-[10px]">
      <span className="truncate">Video {index + 1}</span><span className="ml-auto shrink-0 tabular-nums">{(overlay.playbackRate ?? 1).toFixed(2).replace(/\.?0+$/, '')}× / {(videoClipDuration(overlay) / 1000).toFixed(2)}s</span>
    </div>
    {(['left', 'right'] as const).map(side => <React.Fragment key={side}>
      <div role="slider" tabIndex={0} data-video-edge={side} data-mode="speed" aria-label={`${side === 'left' ? 'Left' : 'Right'} video speed handle ${index + 1}`} aria-valuemin={MIN_VIDEO_SPEED} aria-valuemax={MAX_VIDEO_SPEED} aria-valuenow={overlay.playbackRate ?? 1}
        title="Drag to change speed. Double-click to fit timeline."
        className={`absolute top-0 z-20 h-1/4 min-h-2 w-3 cursor-ew-resize bg-primary/70 hover:bg-primary ${side === 'left' ? '-left-px rounded-tl-md' : '-right-px rounded-tr-md'}`}
        onPointerDown={e => { e.stopPropagation(); begin(e); }}
        onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); fitVideoClipToTimeline(overlay.id, 'speed'); }}
        onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setVideoSpeed(overlay.id, (overlay.playbackRate ?? 1) + (e.key === 'ArrowRight' ? .1 : -.1)); } }} />
      <div role="slider" tabIndex={0} data-video-edge={side} data-mode="trim" aria-label={`${side === 'left' ? 'Left' : 'Right'} video trim handle ${index + 1}`} aria-valuemin={0} aria-valuemax={overlay.mediaDuration ?? 0} aria-valuenow={side === 'left' ? videoSourceRange(overlay).start : videoSourceRange(overlay).end}
        title="Drag to trim. Double-click to fit timeline."
        className={`absolute bottom-0 top-1/4 z-10 flex w-3 cursor-ew-resize items-center justify-center bg-foreground/15 hover:bg-foreground/30 ${side === 'left' ? '-left-px rounded-bl-md' : '-right-px rounded-br-md'}`}
        onPointerDown={e => { e.stopPropagation(); begin(e); }}
        onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); fitVideoClipToTimeline(overlay.id, 'trim'); }}
        onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); const finish = beginMotionDrag(); try { updateVideoClip(overlay.id, videoEdgeUpdates(overlay, side, 'trim', (side === 'left' ? overlay.startTime ?? 0 : videoClipEnd(overlay)) + (e.key === 'ArrowRight' ? 1 : -1) * 1000 / 60)); } finally { finish(); } } }}><span className="h-3 w-px bg-foreground/60" /></div>
    </React.Fragment>)}
  </div>;
}

export function ImageClipBar({ id, name, startTime, duration, pps, gutter, snap, onDragScale, color }: {
  id: string;
  name: string;
  startTime: number;
  duration: number;
  pps: number;
  gutter: number;
  snap: (time: number) => number;
  onDragScale: (pps: number | null) => void;
  color: string;
}) {
  const selected = useMotionSelection(s => s.mediaId === id);
  const drag = React.useRef<{ pointerId: number; x: number; start: number; duration: number; mode: 'move' | 'left' | 'right'; pps: number; finish: () => void } | null>(null);
  const finish = () => { if (drag.current) { drag.current.finish(); drag.current = null; onDragScale(null); } };
  React.useEffect(() => () => drag.current?.finish(), []);
  const begin = (event: React.PointerEvent<HTMLDivElement>, mode: 'move' | 'left' | 'right') => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); selectTimelineAsset(id);
    drag.current = { pointerId: event.pointerId, x: event.clientX, start: startTime, duration, mode, pps, finish: beginMotionDrag() };
    onDragScale(pps);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const delta = (event.clientX - d.x) / d.pps * 1000;
    const at = (time: number) => event.altKey ? time : snap(time);
    if (d.mode === 'move') updateImageClip(id, { startTime: Math.max(0, at(d.start + delta)) });
    else if (d.mode === 'left') {
      const end = d.start + d.duration;
      const nextStart = Math.max(0, Math.min(end - 1000 / 60, at(d.start + delta)));
      updateImageClip(id, { startTime: nextStart, clipDuration: end - nextStart });
    } else {
      const end = Math.max(d.start + 1000 / 60, at(d.start + d.duration + delta));
      updateImageClip(id, { clipDuration: end - d.start });
    }
  };
  const fit = (event: React.MouseEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); fitImageClipToTimeline(id); };
  return <div role="button" tabIndex={0} aria-label={`Select ${name} image clip`} aria-pressed={selected}
    className={`absolute inset-y-1 flex touch-none cursor-grab items-center overflow-hidden rounded-md border text-xs active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary bg-primary/15 text-foreground ring-1 ring-primary' : 'border-foreground/25 bg-muted text-muted-foreground hover:bg-accent'}`}
    style={{ left: gutter + startTime / 1000 * pps, width: Math.max(4, duration / 1000 * pps), borderColor: `${color}${selected ? '' : '88'}`, backgroundColor: `${color}${selected ? '2e' : '1a'}` }}
    onPointerDown={event => begin(event, 'move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); selectTimelineAsset(id); } }}>
    <div className="pointer-events-none absolute inset-x-2 inset-y-0 flex items-center gap-2 overflow-hidden px-1 text-[10px]"><ImageIcon size={12} className="shrink-0" /><span className="truncate">{name}</span><span className="ml-auto shrink-0 tabular-nums">{(duration / 1000).toFixed(2)}s</span></div>
    {(['left', 'right'] as const).map(side => <div key={side} aria-hidden data-image-edge={side} title="Drag to trim. Double-click to fit timeline."
      className={`absolute inset-y-0 z-20 w-2 cursor-ew-resize border-foreground/15 hover:bg-foreground/20 ${side === 'left' ? 'left-0 border-r' : 'right-0 border-l'}`}
      onPointerDown={event => { event.stopPropagation(); begin(event, side); }} onDoubleClick={fit} />)}
  </div>;
}

export function ImageClipInspector({ id, name, startTime, duration, timelineDuration, playhead }: {
  id: string; name: string; startTime: number; duration: number; timelineDuration: number; playhead: number;
}) {
  const canTrim = playhead - startTime >= 1000 / 60 && startTime + duration - playhead >= 1000 / 60;
  return <div className="space-y-4" data-image-inspector>
    <h3 className="flex items-center gap-2 text-sm font-medium"><ImageIcon size={15} />Image clip</h3>
    <p className="truncate text-xs text-muted-foreground">{name}</p>
    <dl className="space-y-2 text-xs tabular-nums text-muted-foreground"><div className="flex justify-between"><dt>Start</dt><dd>{(startTime / 1000).toFixed(2)}s</dd></div><div className="flex justify-between"><dt>Clip duration</dt><dd>{(duration / 1000).toFixed(2)}s</dd></div></dl>
    <div className="grid gap-2"><button className={button} disabled={!canTrim} onClick={() => trimImageAt(id, 'left')}>Trim left to playhead</button><button className={button} disabled={!canTrim} onClick={() => trimImageAt(id, 'right')}>Trim right to playhead</button><button className={button} onClick={() => fitImageClipToTimeline(id)}>Fit to timeline ({(timelineDuration / 1000).toFixed(2)}s)</button></div>
    <p className="text-xs leading-relaxed text-muted-foreground">Drag the bar to move it, or drag either edge to trim the image’s visible time.</p>
  </div>;
}

export function VideoClipInspector({ overlay, playhead }: { overlay: ImageOverlay; playhead: number }) {
  const source = videoSourceRange(overlay);
  const canCut = playhead - (overlay.startTime ?? 0) >= 1000 / 60 && videoClipEnd(overlay) - playhead >= 1000 / 60;
  return <div className="space-y-4" data-video-inspector>
    <h3 className="flex items-center gap-2 text-sm font-medium"><Scissors size={15} />Video clip</h3>
    <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-2"><Gauge size={14} />Speed</span><span className="flex items-center gap-1"><NumberField aria-label="Video playback speed" className={field} value={overlay.playbackRate ?? 1} min={MIN_VIDEO_SPEED} max={MAX_VIDEO_SPEED} step={.1} onValueChange={value => setVideoSpeed(overlay.id, value)} />×</span></label>
    <dl className="space-y-2 text-xs tabular-nums text-muted-foreground"><div className="flex justify-between"><dt>Source range</dt><dd>{source.start.toFixed(2)}–{source.end.toFixed(2)}s</dd></div><div className="flex justify-between"><dt>Clip duration</dt><dd>{(videoClipDuration(overlay) / 1000).toFixed(2)}s</dd></div></dl>
    <div className="grid gap-2"><button className={button} disabled={!canCut} onClick={() => trimVideoAt(overlay.id, 'left')}>Trim left to playhead <kbd className="ml-auto">Q</kbd></button><button className={button} disabled={!canCut} onClick={() => trimVideoAt(overlay.id, 'right')}>Trim right to playhead <kbd className="ml-auto">W</kbd></button><button className={button} disabled={!canCut} onClick={() => splitVideoAt(overlay.id)}><Scissors size={13} />Split <kbd className="ml-auto">Ctrl+Alt+B</kbd></button></div>
    <p className="text-xs leading-relaxed text-muted-foreground">At either clip edge, drag the top quarter to change speed or the lower three quarters to trim. Drag the clip body to move it.</p>
    <button className={`${button} w-full hover:text-destructive`} onClick={() => deleteVideoClip(overlay.id)}><Trash2 size={13} />Delete video clip</button>
  </div>;
}
