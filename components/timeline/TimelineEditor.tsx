'use client';
import * as React from 'react';
import { Diamond, ChevronDown, ChevronRight, Eye, EyeOff, Lock, Unlock, Magnet, Plus, Camera } from 'lucide-react';
import { useImageStore } from '@/lib/store';
import { TimelineControls } from './TimelineControls';
import { useTimelinePlayback } from './hooks/useTimelinePlayback';
import { useMotionSelection, PROPERTY_CONTROLS } from '@/lib/animation/editor';
import { getInterpolatedProperties } from '@/lib/animation/interpolation';
import { shouldIgnoreEditorShortcut } from '@/lib/editor-shortcuts';
import { addCustomAnimation, deleteSelectedMotion, insertPropertyKey } from './MotionInspector';
import { beginMotionDrag } from '@/lib/animation/drag-history';
import { TIMELINE_HEIGHT } from '@/lib/constants/editor-layout';
import type { AnimationClip, AnimationTrack, Keyframe, AnimatableProperties } from '@/types/animation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';

const LABEL_WIDTH = 210;
const frameTime = 1000 / 60;
const timeLabel = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const toolbarButton = 'inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function snapTime(time: number, clip?: AnimationClip, exclude?: string) {
  const state = useImageStore.getState();
  if (!state.timeline.snapToKeyframes) return time;
  const candidates = [0, state.timeline.duration, state.timeline.playhead, ...state.animationClips.flatMap(c => [c.startTime, c.startTime + c.duration]), ...state.timeline.tracks.flatMap(t => t.keyframes.filter(k => k.id !== exclude).map(k => k.time))];
  const nearest = candidates.reduce((best, t) => Math.abs(t - time) < Math.abs(best - time) ? t : best, Infinity);
  return Math.abs(nearest - time) < 60 ? Math.max(clip?.startTime ?? 0, Math.min(clip ? clip.startTime + clip.duration : state.timeline.duration, nearest)) : Math.round(time / frameTime) * frameTime;
}

function ClipBar({ clip, pps }: { clip: AnimationClip; pps: number }) {
  const selected = useMotionSelection(s => s.clipId === clip.id);
  const drag = React.useRef<{ x: number; start: number; duration: number; mode: 'move' | 'left' | 'right'; finish: () => void } | null>(null);
  const begin = (e: React.PointerEvent<HTMLDivElement>, mode: 'move' | 'left' | 'right') => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    useMotionSelection.getState().selectClip(clip.id);
    const state = useImageStore.getState();
    state.stopPlayback(); state.setActiveRightPanelTab('animate');
    drag.current = { x: e.clientX, start: clip.startTime, duration: clip.duration, mode, finish: beginMotionDrag() };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    const state = useImageStore.getState();
    const delta = (e.clientX - d.x) / pps * 1000;
    if (d.mode === 'move') state.updateAnimationClip(clip.id, { startTime: Math.max(0, e.altKey ? d.start + delta : snapTime(d.start + delta)), duration: d.duration });
    else if (d.mode === 'left') {
      const start = Math.max(0, Math.min(d.start + d.duration - 200, e.altKey ? d.start + delta : snapTime(d.start + delta)));
      state.updateAnimationClip(clip.id, { startTime: start, duration: d.start + d.duration - start });
    } else state.updateAnimationClip(clip.id, { duration: Math.max(200, (e.altKey ? d.start + d.duration + delta : snapTime(d.start + d.duration + delta)) - d.start) });
  };
  return <div role="button" tabIndex={0} aria-label={`Select ${clip.name} animation`} aria-pressed={selected}
    className={`absolute inset-y-1 flex cursor-grab items-center gap-2 rounded border px-3 text-xs touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary bg-primary/15 text-foreground ring-1 ring-primary/40' : 'border-border bg-accent text-muted-foreground hover:border-foreground/30'}`}
    style={{ left: clip.startTime / 1000 * pps, width: Math.max(24, clip.duration / 1000 * pps) }}
    onPointerDown={e => begin(e, 'move')} onPointerMove={move} onPointerUp={() => { drag.current?.finish(); drag.current = null; }} onPointerCancel={() => { drag.current?.finish(); drag.current = null; }}
    onKeyDown={e => { if (e.key === 'Enter') { useMotionSelection.getState().selectClip(clip.id); useImageStore.getState().setActiveRightPanelTab('animate'); } }}>
    <div className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l hover:bg-primary/30" onPointerDown={e => begin(e, 'left')} onPointerMove={move} onPointerUp={() => { drag.current?.finish(); drag.current = null; }} onPointerCancel={() => { drag.current?.finish(); drag.current = null; }} />
    {clip.transition && <span className="absolute inset-y-0 left-0 rounded-l border-r border-primary/40 bg-primary/15" style={{ width: Math.min(clip.transition.duration, clip.duration) / clip.duration * 100 + '%' }} title={`${clip.transition.type} transition`} />}
    <span className="relative truncate">{clip.name}</span><span className="relative ml-auto text-[10px] tabular-nums">{timeLabel(clip.duration)}</span>
    <div className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r hover:bg-primary/30" onPointerDown={e => begin(e, 'right')} onPointerMove={move} onPointerUp={() => { drag.current?.finish(); drag.current = null; }} onPointerCancel={() => { drag.current?.finish(); drag.current = null; }} />
  </div>;
}

function KeyDiamond({ clip, track, keyframe, property, pps }: { clip: AnimationClip; track: AnimationTrack; keyframe: Keyframe; property: keyof AnimatableProperties; pps: number }) {
  const selection = useMotionSelection();
  const selected = selection.keyframe?.keyframeId === keyframe.id && selection.keyframe.property === property;
  const drag = React.useRef<{ x: number; time: number; finish: () => void } | null>(null);
  return <button aria-label={`${PROPERTY_CONTROLS.find(p => p.key === property)?.label} keyframe at ${timeLabel(keyframe.time)}`} aria-pressed={selected} disabled={track.isLocked}
    className={`absolute top-1/2 z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'text-primary' : 'text-foreground'} disabled:opacity-40`}
    style={{ left: keyframe.time / 1000 * pps }} title={`${timeLabel(keyframe.time)} · ${keyframe.properties[property]} · ${keyframe.easing}`}
    onPointerDown={e => { e.preventDefault(); e.stopPropagation(); selection.selectClip(clip.id); selection.selectKeyframe({ trackId: track.id, keyframeId: keyframe.id, property }); const state = useImageStore.getState(); state.stopPlayback(); state.setPlayhead(keyframe.time); state.setActiveRightPanelTab('animate'); drag.current = { x: e.clientX, time: keyframe.time, finish: beginMotionDrag() }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={e => { if (!drag.current) return; const raw = drag.current.time + (e.clientX - drag.current.x) / pps * 1000; const time = Math.round(Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, e.altKey ? raw : snapTime(raw, clip, keyframe.id)))); const state = useImageStore.getState(); state.updateKeyframe(track.id, keyframe.id, { time }); state.setPlayhead(time); }}
    onPointerUp={() => { drag.current?.finish(); drag.current = null; }} onPointerCancel={() => { drag.current?.finish(); drag.current = null; }}
    onClick={e => { e.stopPropagation(); selection.selectClip(clip.id); selection.selectKeyframe({ trackId: track.id, keyframeId: keyframe.id, property }); useImageStore.getState().setPlayhead(keyframe.time); }}>
    <Diamond size={12} fill={selected ? 'currentColor' : 'none'} strokeWidth={2} />
  </button>;
}

export function TimelineEditor() {
  const state = useImageStore();
  const selection = useMotionSelection();
  const viewport = React.useRef<HTMLDivElement>(null);
  const ruler = React.useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = React.useState(900);
  const [collapsed, setCollapsed] = React.useState<string[]>([]);
  const clipCount = React.useRef(0);
  React.useEffect(() => {
    if (state.animationClips.length > clipCount.current) {
      const selected = useMotionSelection.getState().clipId;
      setCollapsed(state.animationClips.filter(c => c.id !== selected).map(c => c.id));
    }
    clipCount.current = state.animationClips.length;
  }, [state.animationClips]);
  useTimelinePlayback();
  React.useEffect(() => {
    const el = viewport.current; if (!el) return;
    const observer = new ResizeObserver(() => setAvailableWidth(el.clientWidth)); observer.observe(el);
    return () => observer.disconnect();
  }, [state.showTimeline]);
  React.useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const state = useImageStore.getState();
      if (!state.showTimeline || shouldIgnoreEditorShortcut(event) || event.ctrlKey || event.metaKey || event.altKey) return;
      const selection = useMotionSelection.getState();
      if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) state.togglePlayback(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selection.clipId) { event.preventDefault(); deleteSelectedMotion(); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); state.stopPlayback(); selection.selectKeyframe(null); state.setPlayhead(state.timeline.playhead + (event.key === 'ArrowRight' ? 1 : -1) * frameTime * (event.shiftKey ? 10 : 1)); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); state.stopPlayback(); selection.selectKeyframe(null); state.setPlayhead(event.key === 'Home' ? 0 : state.timeline.duration); }
      else if (event.key.toLowerCase() === 'k' && selection.clipId) {
        event.preventDefault(); const clip = state.animationClips.find(c => c.id === selection.clipId); if (!clip) return;
        const tracks = state.timeline.tracks.filter(t => t.clipId === clip.id);
        const values = getInterpolatedProperties(tracks, state.timeline.playhead, clip.target && clip.target !== 'asset' ? DEFAULT_ANIMATABLE_PROPERTIES : state.animationBase);
        const props = new Set(tracks.flatMap(t => t.keyframes.flatMap(k => Object.keys(k.properties))));
        for (const prop of props) insertPropertyKey(clip, prop as keyof AnimatableProperties, values[prop as keyof AnimatableProperties], state.timeline.playhead);
      } else if (event.key === 'Escape') { event.preventDefault(); selection.selectClip(null); }
    };
    window.addEventListener('keydown', keys, true);
    return () => window.removeEventListener('keydown', keys, true);
  }, []);
  if (!state.showTimeline) return null;
  const duration = state.timeline.duration;
  const pps = Math.max(75, (availableWidth - LABEL_WIDTH - 32) / (duration / 1000)) * state.timeline.zoom;
  const trackWidth = duration / 1000 * pps;
  const rowStyle = { width: LABEL_WIDTH + trackWidth + 32 };
  const scrub = (e: React.PointerEvent) => {
    const rect = ruler.current?.getBoundingClientRect(); if (!rect) return;
    state.stopPlayback(); selection.selectKeyframe(null);
    state.setPlayhead(Math.max(0, Math.min(duration, (e.clientX - rect.left) / pps * 1000)));
  };
  return <section aria-label="Animation timeline" tabIndex={-1} data-animation-timeline className="flex shrink-0 select-none flex-col border-t border-border bg-background" style={{ height: TIMELINE_HEIGHT }}
    onPointerDownCapture={e => { if (!shouldIgnoreEditorShortcut(e)) e.currentTarget.focus({ preventScroll: true }); }}>
    <TimelineControls onAddAnimation={() => addCustomAnimation('asset')} onClose={state.toggleTimeline} />
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
      <button className={toolbarButton} onClick={() => addCustomAnimation('camera')}><Camera size={13} />Camera</button>
      <button className={toolbarButton} aria-pressed={state.timeline.snapToKeyframes} onClick={() => state.setTimeline({ snapToKeyframes: !state.timeline.snapToKeyframes })}><Magnet size={13} />Snap {state.timeline.snapToKeyframes ? 'on' : 'off'}</button>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">Zoom<input aria-label="Timeline zoom" type="range" min="1" max="6" step="0.25" value={state.timeline.zoom} onChange={e => state.setTimeline({ zoom: +e.target.value })} className="w-20 accent-primary" /></label>
      <span className="ml-auto hidden text-xs text-muted-foreground md:block">Space play · K keyframe · Shift + arrows 10 frames · Alt drag bypass snap</span>
    </div>
    <div ref={viewport} className="relative flex-1 overflow-auto">
      <div className="relative" style={{ width: rowStyle.width, minHeight: '100%' }}>
        <div className="sticky top-0 z-40 flex h-7 border-b border-border bg-background" style={rowStyle}>
          <div className="sticky left-0 z-40 flex shrink-0 items-center border-r border-border bg-background px-3 text-xs text-muted-foreground" style={{ width: LABEL_WIDTH }}>Property / keyframes</div>
          <div ref={ruler} className="relative cursor-ew-resize touch-none" style={{ width: trackWidth }} onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e); }}>
            {Array.from({ length: Math.floor(duration / 1000) + 1 }, (_, i) => <span key={i} className="absolute top-1 border-l border-border pl-1 text-[10px] tabular-nums text-muted-foreground" style={{ left: i * pps }}>{i}s</span>)}
          </div>
        </div>
        {state.animationClips.length === 0 && <div className="flex h-16 items-center justify-center gap-2 text-xs text-muted-foreground"><button className={toolbarButton} onClick={() => addCustomAnimation('asset')}><Plus size={14} />Create your first animation</button></div>}
        {state.animationClips.map(clip => {
          const tracks = state.timeline.tracks.filter(t => t.clipId === clip.id);
          const properties = PROPERTY_CONTROLS.filter(p => tracks.some(t => t.keyframes.some(k => p.key in k.properties)));
          const closed = collapsed.includes(clip.id);
          return <React.Fragment key={clip.id}>
            <div className="flex h-9 border-b border-border" style={rowStyle}>
              <div className={`sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-border px-2 ${selection.clipId === clip.id ? 'bg-accent' : 'bg-background'}`} style={{ width: LABEL_WIDTH }}>
                <button className={toolbarButton + ' px-1'} aria-label={`${closed ? 'Expand' : 'Collapse'} ${clip.name} properties`} aria-expanded={!closed} onClick={() => setCollapsed(c => closed ? c.filter(id => id !== clip.id) : [...c, clip.id])}>{closed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button>
                <button className="min-w-0 truncate text-xs font-medium" onClick={() => { selection.selectClip(clip.id); state.setActiveRightPanelTab('animate'); }}>{clip.name}</button>
              </div><div className="relative" style={{ width: trackWidth }}><ClipBar clip={clip} pps={pps} /></div>
            </div>
            {!closed && properties.map(p => {
              const track = tracks.find(t => t.keyframes.some(k => p.key in k.properties))!;
              const keys = track.keyframes.filter(k => p.key in k.properties).sort((a,b) => a.time-b.time);
              return <div key={p.key} className="flex h-7 border-b border-border/50" style={rowStyle}>
                <div className="sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-border bg-background pl-7 pr-2 text-xs text-muted-foreground" style={{ width: LABEL_WIDTH }}>
                  <span className="flex-1 truncate">{p.label}</span>
                  <button aria-label={`${track.isVisible ? 'Hide' : 'Show'} ${track.name} track`} className="p-1 hover:text-foreground" onClick={() => state.updateTrack(track.id, { isVisible: !track.isVisible })}>{track.isVisible ? <Eye size={11} /> : <EyeOff size={11} />}</button>
                  <button aria-label={`${track.isLocked ? 'Unlock' : 'Lock'} ${track.name} track`} className="p-1 hover:text-foreground" onClick={() => state.updateTrack(track.id, { isLocked: !track.isLocked })}>{track.isLocked ? <Lock size={11} /> : <Unlock size={11} />}</button>
                </div>
                <div className={`relative ${!track.isVisible ? 'opacity-40' : ''}`} style={{ width: trackWidth }} onDoubleClick={e => { const time = Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, (e.clientX - e.currentTarget.getBoundingClientRect().left) / pps * 1000)); const values = getInterpolatedProperties(tracks, time, state.animationBase); insertPropertyKey(clip, p.key, values[p.key], time); }}>
                  {keys.length > 1 && <div className="absolute top-1/2 h-px bg-foreground/20" style={{ left: keys[0].time / 1000 * pps, width: (keys[keys.length - 1].time - keys[0].time) / 1000 * pps }} />}
                  {keys.map(k => <KeyDiamond key={k.id} clip={clip} track={track} keyframe={k} property={p.key} pps={pps} />)}
                </div>
              </div>;
            })}
          </React.Fragment>;
        })}
        {state.imageOverlays.filter(o => o.mediaType === 'video').map(o => <div key={o.id} className="flex h-8 border-b border-border" style={rowStyle}><div className="sticky left-0 z-30 shrink-0 border-r border-border bg-background px-3 py-2 text-xs" style={{ width: LABEL_WIDTH }}>Video layer</div><div className="relative" style={{ width: trackWidth }}><div className="absolute inset-y-1 rounded border border-border bg-accent px-2 text-xs leading-6" style={{ left: (o.startTime ?? 0) / 1000 * pps, width: Math.min(duration, ((o.mediaDuration ?? 0) - (o.trimStart ?? 0)) / (o.playbackRate ?? 1) * 1000) / 1000 * pps }}>Muted video · {timeLabel((o.mediaDuration ?? 0) * 1000)}</div></div></div>)}
        <div className="pointer-events-none absolute inset-y-7 z-20 w-px bg-primary" style={{ left: LABEL_WIDTH + state.timeline.playhead / 1000 * pps }}><span className="absolute -top-7 -translate-x-1/2 rounded bg-primary px-1 py-1 text-[10px] tabular-nums text-primary-foreground">{timeLabel(state.timeline.playhead)}</span></div>
      </div>
    </div>
  </section>;
}
