'use client';

import * as React from 'react';
import { Diamond, ChevronDown, ChevronRight, ChevronLeft, Eye, EyeOff, Lock, Unlock, Plus, GripHorizontal, X, Trash2, Minus } from 'lucide-react';
import { useImageStore } from '@/lib/store';
import { TimelineControls } from './TimelineControls';
import { NumberField } from './NumberField';
import { VideoClipBar, VideoClipInspector } from './VideoClip';
import { deleteVideoClip, selectVideoClip, splitVideoAt, trimVideoAt } from '@/lib/video-editing';
import { videoClipEnd } from '@/lib/export/video-timing';
import { useMotionSelection, PROPERTY_CONTROLS, EASE_LABELS } from '@/lib/animation/editor';
import { capturePose, insertPropertyKey, motionPose, previewPose } from '@/lib/animation/authoring';
import { shouldIgnoreEditorShortcut } from '@/lib/editor-shortcuts';
import { addCustomAnimation, deleteSelectedMotion, EaseCurve, CLIP_MASK_PRESETS } from './MotionInspector';
import { beginMotionDrag } from '@/lib/animation/drag-history';
import type { AnimationClip, AnimationTrack, Keyframe, AnimatableProperties, EasingFunction } from '@/types/animation';

const LABEL_WIDTH = 280;
const GUTTER = 14;
const FRAME = 1000 / 60;
const timeLabel = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const button = 'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30';
const field = 'h-7 min-w-0 rounded border border-border bg-background px-2 text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';

function chooseClip(clip: AnimationClip) {
  const state = useImageStore.getState();
  state.stopPlayback();
  state.setPlayhead(Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, state.timeline.playhead)));
  useMotionSelection.getState().selectClip(clip.id);
  state.setSelectedOverlayId(clip.target && clip.target !== 'asset' ? clip.target : null);
  state.setIsMainImageSelected((clip.target ?? 'asset') === 'asset' && !!state.uploadedImageUrl);
  state.setActiveRightPanelTab('animate');
}

function snappedTime(time: number, pps: number, excludeKey?: string, movingClip?: string) {
  const state = useImageStore.getState();
  const candidates = [0, state.timeline.duration,
    ...state.animationClips.filter(c => c.id !== movingClip).flatMap(c => [c.startTime, c.startTime + c.duration]),
    ...state.imageOverlays.filter(o => o.mediaType === 'video' && o.id !== movingClip).flatMap(o => [o.startTime ?? 0, videoClipEnd(o)]),
    ...state.timeline.tracks.filter(t => t.clipId !== movingClip).flatMap(t => t.keyframes.filter(k => k.id !== excludeKey).map(k => k.time))];
  const nearest = candidates.reduce((best, t) => Math.abs(t - time) < Math.abs(best - time) ? t : best, Infinity);
  return Math.abs(nearest - time) * pps / 1000 < 7 ? nearest : Math.round(time / FRAME) * FRAME;
}

function ClipBar({ clip, pps, onDragScale }: { clip: AnimationClip; pps: number; onDragScale: (pps: number | null) => void }) {
  const selected = useMotionSelection(s => s.clipId === clip.id);
  const drag = React.useRef<{ x: number; start: number; duration: number; mode: 'move' | 'left' | 'right'; pps: number; finish: () => void } | null>(null);
  const finish = () => { if (drag.current) { drag.current.finish(); drag.current = null; onDragScale(null); } };
  React.useEffect(() => () => drag.current?.finish(), []);
  const begin = (e: React.PointerEvent<HTMLDivElement>, mode: 'move' | 'left' | 'right') => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); chooseClip(clip);
    drag.current = { x: e.clientX, start: clip.startTime, duration: clip.duration, mode, pps, finish: beginMotionDrag() };
    onDragScale(pps);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const delta = (e.clientX - d.x) / d.pps * 1000;
    const snap = (t: number) => e.altKey ? t : snappedTime(t, pps, undefined, clip.id);
    const state = useImageStore.getState();
    if (d.mode === 'move') state.updateAnimationClip(clip.id, { startTime: Math.max(0, snap(d.start + delta)), duration: d.duration });
    else if (d.mode === 'left') { const start = Math.max(0, Math.min(d.start + d.duration - 200, snap(d.start + delta))); state.updateAnimationClip(clip.id, { startTime: start, duration: d.start + d.duration - start }); }
    else state.updateAnimationClip(clip.id, { duration: Math.max(200, snap(d.start + d.duration + delta) - d.start) });
  };
  return <div role="button" tabIndex={0} aria-label={`Select ${clip.name} animation`} aria-pressed={selected}
    className={`absolute inset-y-1 flex touch-none cursor-grab items-center gap-2 overflow-hidden rounded-md border px-3 text-xs active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-foreground/40 bg-foreground/10 text-foreground' : 'border-border bg-muted text-muted-foreground hover:bg-accent'}`}
    style={{ left: GUTTER + clip.startTime / 1000 * pps, width: Math.max(24, clip.duration / 1000 * pps) }}
    onPointerDown={e => begin(e, 'move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseClip(clip); } }}>
    <div aria-hidden className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize border-r border-foreground/10 hover:bg-foreground/20" onPointerDown={e => begin(e, 'left')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} />
    <span className="truncate font-medium">{clip.name}</span><span className="ml-auto shrink-0 text-[10px] tabular-nums">{timeLabel(clip.duration)}</span>
    <div aria-hidden className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize border-l border-foreground/10 hover:bg-foreground/20" onPointerDown={e => begin(e, 'right')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} />
  </div>;
}

function KeyMarker({ clip, track, keyframe, property, pps }: { clip: AnimationClip; track: AnimationTrack; keyframe: Keyframe; property: keyof AnimatableProperties | 'clipMask'; pps: number }) {
  const selected = useMotionSelection(s => s.keyframe?.keyframeId === keyframe.id && s.keyframe.property === property);
  const drag = React.useRef<{ x: number; time: number; moved: boolean; finish: () => void } | null>(null);
  const finish = () => { drag.current?.finish(); drag.current = null; };
  React.useEffect(() => () => drag.current?.finish(), []);
  const select = () => { const state = useImageStore.getState(); state.stopPlayback(); state.setPlayhead(keyframe.time); const selection = useMotionSelection.getState(); selection.selectClip(clip.id); selection.selectKeyframe({ trackId: track.id, keyframeId: keyframe.id, property }); };
  const retime = (time: number) => { const state = useImageStore.getState(); const next = Math.round(Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, time))); state.updateKeyframe(track.id, keyframe.id, { time: next }); state.setPlayhead(next); };
  return <button data-motion-key type="button" aria-label={`${track.name} keyframe at ${timeLabel(keyframe.time)}`} aria-pressed={selected} disabled={track.isLocked} title={`${timeLabel(keyframe.time)}  /  ${property === 'clipMask' ? keyframe.clipMask || 'No mask' : keyframe.properties[property]}  /  Drag to move; arrows to nudge`}
    className={`absolute top-1/2 z-20 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded cursor-ew-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-accent'}`}
    style={{ left: GUTTER + keyframe.time / 1000 * pps }}
    onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); select(); drag.current = { x: e.clientX, time: keyframe.time, moved: false, finish: beginMotionDrag() }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={e => { const d = drag.current; if (!d || !e.currentTarget.hasPointerCapture(e.pointerId) ) return; if (!d.moved && Math.abs(e.clientX - d.x) < 2) return; d.moved = true; const raw = d.time + (e.clientX - d.x) / pps * 1000; retime(e.altKey ? raw : snappedTime(raw, pps, keyframe.id)); }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onClick={e => e.stopPropagation()}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); retime(keyframe.time + (e.key === 'ArrowRight' ? 1 : -1) * FRAME * (e.shiftKey ? 10 : 1)); } }}>
    <Diamond size={13} fill={selected ? 'currentColor' : 'var(--background)'} strokeWidth={selected ? 2 : 1.5} />
  </button>;
}

function KeyframeInspector({ track, keyframe, property }: { track: AnimationTrack; keyframe: Keyframe; property: keyof AnimatableProperties | 'clipMask' }) {
  const state = useImageStore();
  const clip = state.animationClips.find(c => c.id === track.clipId)!;
  const control = PROPERTY_CONTROLS.find(p => p.key === property);
  return <fieldset disabled={track.isLocked} className="space-y-4 disabled:opacity-50" data-inline-keyframe-editor>
    <div className="flex items-center justify-between"><span className="text-sm font-medium">{control?.label ?? 'Clip mask'}</span><button className={button} aria-label="Deselect keyframe" onClick={() => useMotionSelection.getState().selectKeyframe(null)}><X size={14} /></button></div>
    <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">Time (s)<NumberField aria-label="Selected keyframe time seconds" className={`${field} w-24`} value={keyframe.time / 1000} min={clip.startTime / 1000} max={(clip.startTime + clip.duration) / 1000} onValueChange={v => { state.updateKeyframe(track.id, keyframe.id, { time: v * 1000 }); state.setPlayhead(v * 1000); }} /></label>
    {control ? <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">Value {control.unit}<NumberField aria-label={`${control.label} timeline value`} className={`${field} w-24`} value={keyframe.properties[control.key] ?? 0} min={control.min} max={control.max} step={control.step} onValueChange={v => state.updateKeyframe(track.id, keyframe.id, { properties: { [control.key]: v } })} /></label> : <label className="block space-y-2 text-xs text-muted-foreground">Mask<select className={`${field} w-full`} aria-label="Timeline clip mask preset" value={keyframe.clipMask ?? ''} onChange={e => state.updateKeyframe(track.id, keyframe.id, { clipMask: e.target.value })}>{CLIP_MASK_PRESETS.map(p => <option key={p.name} value={p.value}>{p.name}</option>)}{!CLIP_MASK_PRESETS.some(p => p.value === keyframe.clipMask) && <option value={keyframe.clipMask}>Custom mask</option>}</select></label>}
    <label className="block space-y-2 text-xs text-muted-foreground">Ease into keyframe<select aria-label="Timeline keyframe easing" className={`${field} w-full`} value={keyframe.easing.startsWith('cubic-bezier') ? '__custom__' : keyframe.easing} onChange={e => state.updateKeyframe(track.id, keyframe.id, { easing: (e.target.value === '__custom__' ? 'cubic-bezier(0.25,0.1,0.25,1)' : e.target.value) as EasingFunction })}>{Object.entries(EASE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}<option value="__custom__">Custom curve</option></select></label>
    <EaseCurve ease={keyframe.easing} onChange={ease => state.updateKeyframe(track.id, keyframe.id, { easing: ease })} />
    <button className={`${button} w-full border border-border hover:text-destructive`} onClick={deleteSelectedMotion}><Trash2 size={13} />Delete keyframe</button>
  </fieldset>;
}

export function TimelineEditor() {
  const state = useImageStore();
  const selection = useMotionSelection();
  const timelineRoot = React.useRef<HTMLElement>(null);
  const viewport = React.useRef<HTMLDivElement>(null);
  const ruler = React.useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = React.useState(900);
  const [dragScale, setDragScale] = React.useState<number | null>(null);
  const [height, setHeight] = React.useState(340);
  const [collapsed, setCollapsed] = React.useState<string[]>([]);
  const resize = React.useRef<{ y: number; height: number } | null>(null);
  const durationDrag = React.useRef<{ x: number; duration: number; pps: number; finish: () => void } | null>(null);
  const zoomAnchor = React.useRef<number | null>(null);
  React.useEffect(() => {
    const root = timelineRoot.current;
    const el = viewport.current; if (!root || !el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      // Chromium and Firefox report touchpad pinch as Ctrl+wheel.
      if (event.ctrlKey) {
        const zoom = useImageStore.getState().timeline.zoom;
        const next = Math.max(1, Math.min(8, zoom * Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.04 : 0.006))));
        const pointer = Math.max(0, event.clientX - el.getBoundingClientRect().left - LABEL_WIDTH - GUTTER);
        zoomAnchor.current = (el.scrollLeft + pointer) * next / zoom - pointer;
        useImageStore.getState().setTimeline({ zoom: next });
        return;
      }

      const inspector = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-timeline-inspector]') : null;
      const scroller = inspector ?? el;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
      scroller.scrollBy({
        left: (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit,
        top: (event.shiftKey ? 0 : event.deltaY) * unit,
        behavior: 'instant',
      });
    };
    // Capture also covers the toolbar, numeric fields and zoom slider, where
    // native wheel defaults can otherwise consume the gesture or zoom the page.
    root.addEventListener('wheel', wheel, { passive: false, capture: true });
    return () => root.removeEventListener('wheel', wheel, true);
  }, []);
  React.useLayoutEffect(() => {
    if (viewport.current && zoomAnchor.current !== null) { viewport.current.scrollLeft = zoomAnchor.current; zoomAnchor.current = null; }
  }, [state.timeline.zoom]);
  React.useEffect(() => {
    const el = viewport.current; if (!el) return;
    const observer = new ResizeObserver(() => setAvailableWidth(el.clientWidth)); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (selection.clipId) setCollapsed(current => current.filter(id => id !== selection.clipId));
  }, [selection.clipId]);
  React.useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const state = useImageStore.getState();
      if (!state.showTimeline || shouldIgnoreEditorShortcut(event)) return;
      const videoId = useMotionSelection.getState().videoId;
      if (videoId && state.imageOverlays.some(o => o.id === videoId && o.mediaType === 'video')) {
        if (event.ctrlKey && event.altKey && !event.metaKey && event.code === 'KeyB') { event.preventDefault(); event.stopImmediatePropagation(); splitVideoAt(videoId); return; }
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
          if (event.code === 'KeyQ' || event.code === 'KeyW') { event.preventDefault(); event.stopImmediatePropagation(); trimVideoAt(videoId, event.code === 'KeyQ' ? 'left' : 'right'); return; }
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteVideoClip(videoId); return; }
        }
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.target as HTMLElement)?.closest('[data-motion-key], [data-curve-control], [role=slider], [role=separator]') && event.key.startsWith('Arrow')) return;
      const selection = useMotionSelection.getState();
      if ((event.key === 'Delete' || event.key === 'Backspace') && selection.clipId) { event.preventDefault(); deleteSelectedMotion(); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); state.stopPlayback(); selection.selectKeyframe(null); state.setPlayhead(state.timeline.playhead + (event.key === 'ArrowRight' ? 1 : -1) * FRAME * (event.shiftKey ? 10 : 1)); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); state.stopPlayback(); selection.selectKeyframe(null); state.setPlayhead(event.key === 'Home' ? 0 : state.timeline.duration); }
      else if (event.key.toLowerCase() === 'k') { event.preventDefault(); capturePose(); }
      else if (event.key === 'Escape') { event.preventDefault(); selection.discardPose(); selection.selectKeyframe(null); }
    };
    window.addEventListener('keydown', keys, true);
    return () => window.removeEventListener('keydown', keys, true);
  }, []);
  const duration = state.timeline.duration;
  const pps = dragScale ?? Math.max(1, (availableWidth - LABEL_WIDTH - GUTTER * 2) / (duration / 1000)) * state.timeline.zoom;
  const trackWidth = duration / 1000 * pps + GUTTER * 2;
  const rowWidth = LABEL_WIDTH + trackWidth;
  const tickStep = [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000, 300000].find(t => t / 1000 * pps >= 65) ?? 600000;
  const selectedClip = state.animationClips.find(c => c.id === selection.clipId);
  const videos = state.imageOverlays.filter(o => o.mediaType === 'video');
  const selectedVideo = videos.find(o => o.id === selection.videoId);
  const videoTracks = [...new Set(videos.map(o => o.videoTrackId ?? o.id))].map(id => videos.filter(o => (o.videoTrackId ?? o.id) === id));
  const selectedTrack = state.timeline.tracks.find(t => t.id === selection.keyframe?.trackId);
  const selectedKey = selectedTrack?.keyframes.find(k => k.id === selection.keyframe?.keyframeId);
  const keyTimes = [...new Set(state.timeline.tracks.filter(t => !selectedClip || t.clipId === selectedClip.id).flatMap(t => t.keyframes.map(k => k.time)))].sort((a,b) => a-b);
  const seek = (time: number) => { state.stopPlayback(); selection.selectKeyframe(null); state.setPlayhead(time); };
  const snapPlayheadToKeyframe = (time: number) => {
    const thresholdMs = 10 / pps * 1000;
    let nearest = time;
    let distance = thresholdMs;
    for (const track of state.timeline.tracks) {
      for (const keyframe of track.keyframes) {
        const candidateDistance = Math.abs(keyframe.time - time);
        if (candidateDistance <= distance) {
          nearest = keyframe.time;
          distance = candidateDistance;
        }
      }
    }
    return nearest;
  };
  const scrub = (e: React.PointerEvent) => { const rect = ruler.current?.getBoundingClientRect(); if (rect) seek(snapPlayheadToKeyframe((e.clientX - rect.left - GUTTER) / pps * 1000)); };
  const pending = selection.draft && Object.keys(selection.draft.properties).length > 0;
  const setPanelHeight = (h: number) => setHeight(Math.max(230, Math.min(window.innerHeight * 0.65, h)));
  const targetLabel = (clip: AnimationClip) => clip.target && clip.target !== 'asset' ? `${state.imageOverlays.find(o => o.id === clip.target)?.mediaType === 'video' ? 'Video' : 'Image'} layer` : 'Main asset';
  return <section ref={timelineRoot} aria-label="Animation timeline" tabIndex={-1} data-animation-timeline className="relative flex shrink-0 select-none flex-col border-t border-border bg-background" style={{ height, maxHeight: '65vh' }} onPointerDownCapture={e => { if (!shouldIgnoreEditorShortcut(e)) e.currentTarget.focus({ preventScroll: true }); }}>
    <div role="separator" tabIndex={0} aria-label="Resize animation timeline" aria-orientation="horizontal" aria-valuenow={height} className="absolute -top-1 left-0 right-0 z-50 flex h-2 cursor-ns-resize touch-none items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={e => { e.preventDefault(); resize.current = { y: e.clientY, height }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (resize.current) setPanelHeight(resize.current.height + resize.current.y - e.clientY); }} onPointerUp={() => { resize.current = null; }} onPointerCancel={() => { resize.current = null; }} onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setPanelHeight(height + (e.key === 'ArrowUp' ? 32 : -32)); } }}><GripHorizontal size={22} /></div>
    <TimelineControls onAddAnimation={addCustomAnimation} onClose={state.toggleTimeline} />
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <div className="flex items-center gap-0.5"><button aria-label="Zoom timeline out" className={button} disabled={state.timeline.zoom <= 1} onClick={() => state.setTimeline({ zoom: Math.max(1, state.timeline.zoom - .5) })}><Minus size={13} /></button><input aria-label="Timeline zoom" type="range" min={1} max={8} step={.25} value={state.timeline.zoom} onChange={e => state.setTimeline({ zoom: +e.target.value })} className="w-20 accent-primary" /><button aria-label="Zoom timeline in" className={button} disabled={state.timeline.zoom >= 8} onClick={() => state.setTimeline({ zoom: Math.min(8, state.timeline.zoom + .5) })}><Plus size={13} /></button><button className={button} onClick={() => { state.setTimeline({ zoom: 1 }); viewport.current?.scrollTo({ left: 0 }); }}>Fit</button></div>
      <span className="mx-1 h-4 w-px bg-border" />
      <button className={button} aria-label="Previous keyframe" disabled={!keyTimes.some(t => t < state.timeline.playhead - 1)} onClick={() => seek(keyTimes.filter(t => t < state.timeline.playhead - 1).at(-1) ?? 0)}><ChevronLeft size={13} /><Diamond size={11} /></button>
      <button className={button} aria-label="Next keyframe" disabled={!keyTimes.some(t => t > state.timeline.playhead + 1)} onClick={() => seek(keyTimes.find(t => t > state.timeline.playhead + 1) ?? duration)}><Diamond size={11} /><ChevronRight size={13} /></button>
      <div className="ml-auto flex items-center gap-2"><label className="flex items-center gap-2 text-xs text-muted-foreground">Duration<NumberField aria-label="Timeline duration seconds" className={`${field} w-16`} min={.5} step={.1} value={duration / 1000} onValueChange={v => state.setTimelineDuration(v * 1000)} />s</label></div>
    </div>
    <div className="flex min-h-0 flex-1">
      <div ref={viewport} className="relative min-w-0 flex-1 overflow-auto overscroll-contain">
        <div className="relative min-h-full" style={{ width: rowWidth }}>
          <div className="sticky top-0 z-40 flex h-8 border-b border-border bg-background" style={{ width: rowWidth }}><div className="sticky left-0 z-40 flex shrink-0 items-center justify-between border-r border-border bg-background px-3 text-xs text-muted-foreground" style={{ width: LABEL_WIDTH }}><span>Layers & properties</span><span>Value / key</span></div>
            <div ref={ruler} className="relative touch-none cursor-ew-resize" style={{ width: trackWidth }} onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e); }}>
              {Array.from({ length: Math.ceil(duration / tickStep) }, (_, i) => <span key={i} className="absolute top-1.5 h-4 border-l border-border pl-1 text-[10px] tabular-nums text-muted-foreground" style={{ left: GUTTER + i * tickStep / 1000 * pps }}>{Number((i * tickStep / 1000).toFixed(2))}s</span>)}
              <div role="slider" tabIndex={0} aria-label="Timeline duration" aria-valuemin={500} aria-valuemax={Math.max(60000, duration)} aria-valuenow={duration} className="absolute inset-y-0 z-20 w-3 cursor-ew-resize touch-none border-r-2 border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring" style={{ left: GUTTER + duration / 1000 * pps - 10 }} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); state.setTimelineDuration(Math.max(500, duration + (e.key === 'ArrowRight' ? 100 : -100))); } }} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); durationDrag.current = { x: e.clientX, duration, pps, finish: beginMotionDrag() }; setDragScale(pps); }} onPointerMove={e => { const d = durationDrag.current; if (d) state.setTimelineDuration(Math.max(500, d.duration + (e.clientX - d.x) / d.pps * 1000)); }} onPointerUp={() => { durationDrag.current?.finish(); durationDrag.current = null; setDragScale(null); }} onPointerCancel={() => { durationDrag.current?.finish(); durationDrag.current = null; setDragScale(null); }} />
              <div role="slider" tabIndex={0} aria-label="Playhead. Drag to seek" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={state.timeline.playhead} className="absolute inset-y-0 z-30 flex w-6 -translate-x-1/2 cursor-ew-resize touch-none justify-center focus-visible:ring-2 focus-visible:ring-ring" style={{ left: GUTTER + state.timeline.playhead / 1000 * pps }} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e); }} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(state.timeline.playhead + (e.key === 'ArrowRight' ? 1 : -1) * FRAME * (e.shiftKey ? 10 : 1)); } }}><div className="mt-0.5 h-5 w-2.5 rounded-b-sm bg-primary" /></div>
            </div>
          </div>
          {state.animationClips.length === 0 && <div className="sticky left-0 flex max-w-full flex-col items-center gap-3 p-8 text-center"><Diamond size={22} className="text-muted-foreground" /><p className="text-sm font-medium">Make your first move</p><p className="max-w-sm text-xs leading-relaxed text-muted-foreground">Select a layer, create an animation, then move the playhead and adjust the layer on the canvas. Set a keyframe to keep each pose.</p><button className={`${button} border border-border`} onClick={addCustomAnimation}><Plus size={14} />Create animation</button></div>}
          {state.animationClips.map(clip => {
            const tracks = state.timeline.tracks.filter(t => t.clipId === clip.id);
            const pose = motionPose(clip, state.timeline.playhead, selection.draft, state);
            const closed = collapsed.includes(clip.id);
            const selected = selection.clipId === clip.id;
            return <React.Fragment key={clip.id}>
              <div className="flex h-10 border-b border-border"><div className={`sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-border px-2 ${selected ? 'bg-accent' : 'bg-background'}`} style={{ width: LABEL_WIDTH }}><button className={`${button} px-1`} aria-label={`${closed ? 'Expand' : 'Collapse'} ${clip.name} properties`} aria-expanded={!closed} onClick={() => setCollapsed(c => closed ? c.filter(id => id !== clip.id) : [...c, clip.id])}>{closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button><button className="min-w-0 flex-1 truncate text-left text-xs font-medium" onClick={() => chooseClip(clip)}>{clip.name}</button><span className="shrink-0 text-[10px] text-muted-foreground">{targetLabel(clip)}</span></div><div className="relative" style={{ width: trackWidth }}><ClipBar clip={clip} pps={pps} onDragScale={setDragScale} /></div></div>
              {!closed && PROPERTY_CONTROLS.filter(p => p.group === 'asset').map(p => {
                const track = tracks.find(t => t.keyframes.some(k => p.key in k.properties));
                const keys = track?.keyframes.filter(k => p.key in k.properties).sort((a,b) => a.time-b.time) ?? [];
                const atKey = keys.find(k => Math.abs(k.time - state.timeline.playhead) < 1);
                const inRange = state.timeline.playhead >= clip.startTime && state.timeline.playhead <= clip.startTime + clip.duration;
                const disabled = track?.isLocked || !selected || !inRange || state.timeline.isPlaying;
                return <div key={p.key} className="flex h-9 border-b border-border/50"><div className="sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-border bg-background pl-7 pr-2" style={{ width: LABEL_WIDTH }}><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p.label}</span><NumberField aria-label={`${p.label} pose value`} className={`${field} w-14 border-transparent text-right hover:border-border`} disabled={disabled} value={pose[p.key]} min={p.min} max={p.max} step={p.step} onValueChange={v => previewPose(clip.target ?? 'asset', { [p.key]: v })} /><button aria-label={`Set ${p.label} keyframe`} title={atKey ? 'Update keyframe at playhead' : 'Add keyframe at playhead'} className={`${button} w-7 px-0 ${atKey ? 'text-primary' : ''}`} disabled={disabled} onClick={() => insertPropertyKey(clip, p.key, pose[p.key], state.timeline.playhead)}><Diamond size={11} fill={atKey ? 'currentColor' : 'none'} /></button>{track && <><button className={`${button} w-6 px-0`} aria-label={`${track.isVisible ? 'Hide' : 'Show'} ${track.name} track`} onClick={() => state.updateTrack(track.id, { isVisible: !track.isVisible })}>{track.isVisible ? <Eye size={11} /> : <EyeOff size={11} />}</button><button className={`${button} w-6 px-0`} aria-label={`${track.isLocked ? 'Unlock' : 'Lock'} ${track.name} track`} onClick={() => state.updateTrack(track.id, { isLocked: !track.isLocked })}>{track.isLocked ? <Lock size={11} /> : <Unlock size={11} />}</button></>}</div>
                  <div className={`relative ${track?.isVisible === false ? 'opacity-35' : ''}`} style={{ width: trackWidth, backgroundImage: 'linear-gradient(to right, var(--border) 1px, transparent 1px)', backgroundSize: `${tickStep / 1000 * pps}px 100%`, backgroundPositionX: GUTTER }} onClick={e => { chooseClip(clip); seek((e.clientX - e.currentTarget.getBoundingClientRect().left - GUTTER) / pps * 1000); }} onDoubleClick={e => { if (track?.isLocked) return; const time = Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, (e.clientX - e.currentTarget.getBoundingClientRect().left - GUTTER) / pps * 1000)); insertPropertyKey(clip, p.key, motionPose(clip, time)[p.key], time); }}>
                    {keys.length > 1 && <div className="pointer-events-none absolute top-1/2 h-px bg-foreground/20" style={{ left: GUTTER + keys[0].time / 1000 * pps, width: (keys[keys.length - 1].time - keys[0].time) / 1000 * pps }} />}{track && keys.map(k => <KeyMarker key={k.id} clip={clip} track={track} keyframe={k} property={p.key} pps={pps} />)}
                  </div></div>;
              })}
              {!closed && tracks.filter(t => t.keyframes.some(k => k.clipMask !== undefined)).map(t => <div key={t.id} className="flex h-9 border-b border-border/50"><div className="sticky left-0 z-30 shrink-0 border-r border-border bg-background py-2 pl-7 text-xs text-muted-foreground" style={{ width: LABEL_WIDTH }}>Clip mask</div><div className="relative" style={{ width: trackWidth }}>{t.keyframes.filter(k => k.clipMask !== undefined).map(k => <KeyMarker key={k.id} clip={clip} track={t} keyframe={k} property="clipMask" pps={pps} />)}</div></div>)}
            </React.Fragment>;
          })}
          {videoTracks.map((segments, i) => <div key={segments[0].videoTrackId ?? segments[0].id} className="flex h-14 border-b border-border">
            <button className="sticky left-0 z-30 shrink-0 border-r border-border bg-background px-3 text-left text-xs text-muted-foreground" style={{ width: LABEL_WIDTH }} onClick={() => selectVideoClip(segments.find(o => state.timeline.playhead >= (o.startTime ?? 0) && state.timeline.playhead < videoClipEnd(o))?.id ?? segments[0].id)}>Video {i + 1}<span className="ml-2 text-[10px]">Muted</span></button>
            <div className="relative" style={{ width: trackWidth }}>{segments.map(o => <VideoClipBar key={o.id} overlay={o} index={videos.indexOf(o)} pps={pps} gutter={GUTTER} snap={time => snappedTime(time, pps, undefined, o.id)} onDragScale={setDragScale} />)}</div>
          </div>)}
          <div className="pointer-events-none absolute bottom-0 top-8 z-20 w-px bg-primary/70" style={{ left: LABEL_WIDTH + GUTTER + state.timeline.playhead / 1000 * pps }} />
        </div>
      </div>
      <aside data-timeline-inspector className="w-60 shrink-0 overflow-y-auto border-l border-border bg-muted/15 p-4">
        {selectedVideo ? <VideoClipInspector overlay={selectedVideo} playhead={state.timeline.playhead} /> : selectedKey && selectedTrack && selection.keyframe ? <KeyframeInspector track={selectedTrack} keyframe={selectedKey} property={selection.keyframe.property} /> : <div className="space-y-3"><p className="text-sm font-medium">{selectedClip ? targetLabel(selectedClip) : 'Animate on canvas'}</p><p className="text-xs leading-relaxed text-muted-foreground">{selectedClip ? 'At an existing keyframe, canvas edits update it directly. At a new time, set a keyframe to save the pose.' : 'Select a layer on the canvas, then create an animation.'}</p>{pending && <div className="space-y-2 border-t border-border pt-3"><p role="status" className="text-xs font-medium">Pose preview  /  not saved</p><p className="text-xs leading-relaxed text-muted-foreground">Set a keyframe before seeking or playing to keep this pose.</p><button className={`${button} border border-border`} onClick={selection.discardPose}>Reset pose</button></div>}{selectedClip && <button className={button} onClick={() => { selection.selectKeyframe(null); deleteSelectedMotion(); }}><Trash2 size={13} />Delete animation</button>}</div>}
      </aside>
    </div>
  </section>;
}
