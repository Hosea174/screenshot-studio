'use client';

import * as React from 'react';
import { Diamond, ChevronDown, ChevronRight, ChevronLeft, Eye, EyeOff, Lock, Unlock, Plus, GripHorizontal, X, Trash2, Minus } from 'lucide-react';
import { useImageStore } from '@/lib/store';
import { TimelineControls } from './TimelineControls';
import { NumberField } from './NumberField';
import { ImageClipBar, ImageClipInspector, VideoClipBar, VideoClipInspector } from './VideoClip';
import { deleteVideoClip, MAIN_IMAGE_TRACK_ID, selectTimelineAsset, splitVideoAt, trimImageAt, trimVideoAt } from '@/lib/video-editing';
import { imageClipDuration, mediaClipEnd } from '@/lib/export/video-timing';
import { useMotionSelection, PROPERTY_CONTROLS, EASE_LABELS } from '@/lib/animation/editor';
import { capturePose, insertPropertyKey, motionPose, previewPose } from '@/lib/animation/authoring';
import { shouldIgnoreEditorShortcut } from '@/lib/editor-shortcuts';
import { addCustomAnimation, deleteSelectedMotion, EaseCurve, CLIP_MASK_PRESETS } from './MotionInspector';
import { beginMotionDrag } from '@/lib/animation/drag-history';
import type { AnimationClip, AnimationTrack, Keyframe, AnimatableProperties, EasingFunction } from '@/types/animation';

const LABEL_WIDTH = 280;
const GUTTER = 14;
const FRAME = 1000 / 60;
const TARGET_COLORS = ['#60a5fa', '#c084fc', '#34d399', '#fbbf24', '#fb7185', '#22d3ee', '#a3e635', '#f97316'];
const timeLabel = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const button = 'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30';
const field = 'h-7 min-w-0 rounded border border-border bg-background px-2 text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';

function animationTargetColor(target: string, overlayIds: string[]) {
  if (target === 'asset') return TARGET_COLORS[0];
  const index = overlayIds.indexOf(target);
  return TARGET_COLORS[(Math.max(0, index) + 1) % TARGET_COLORS.length];
}

function chooseClip(clip: AnimationClip) {
  const state = useImageStore.getState();
  state.stopPlayback();
  state.setPlayhead(Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, state.timeline.playhead)));
  useMotionSelection.getState().selectClip(clip.id);
  state.setSelectedOverlayId(clip.target && clip.target !== 'asset' ? clip.target : null);
  state.setIsMainImageSelected((clip.target ?? 'asset') === 'asset' && !!state.uploadedImageUrl);
  state.setActiveRightPanelTab('animate');
}

function snappedTime(time: number, pps: number, excludeKey?: string, movingClip?: string, excludeKeys?: Set<string>) {
  const state = useImageStore.getState();
  const candidates = [0, state.timeline.duration,
    ...state.animationClips.filter(c => c.id !== movingClip).flatMap(c => [c.startTime, c.startTime + c.duration]),
    ...state.imageOverlays.filter(o => o.id !== movingClip).flatMap(o => [o.startTime ?? 0, mediaClipEnd(o, state.timeline.duration)]),
    ...(state.uploadedImageUrl && movingClip !== MAIN_IMAGE_TRACK_ID ? [state.mainImageStartTime ?? 0, (state.mainImageStartTime ?? 0) + (state.mainImageDuration ?? state.timeline.duration)] : []),
    ...state.timeline.tracks.filter(t => t.clipId !== movingClip).flatMap(t => t.keyframes.filter(k => k.id !== excludeKey && !excludeKeys?.has(keyRefId({ trackId: t.id, keyframeId: k.id }))).map(k => k.time))];
  const nearest = candidates.reduce((best, t) => Math.abs(t - time) < Math.abs(best - time) ? t : best, Infinity);
  return Math.abs(nearest - time) * pps / 1000 < 7 ? nearest : Math.round(time / FRAME) * FRAME;
}

function ClipBar({ clip, pps, onDragScale, timelineDuration, color }: { clip: AnimationClip; pps: number; onDragScale: (pps: number | null) => void; timelineDuration: number; color: string }) {
  const selected = useMotionSelection(s => s.clipId === clip.id);
  const drag = React.useRef<{ pointerId: number; x: number; start: number; duration: number; mode: 'move' | 'left' | 'right'; pps: number; finish: () => void } | null>(null);
  const finish = () => { if (drag.current) { drag.current.finish(); drag.current = null; onDragScale(null); } };
  React.useEffect(() => () => drag.current?.finish(), []);
  const begin = (e: React.PointerEvent<HTMLDivElement>, mode: 'move' | 'left' | 'right') => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); chooseClip(clip);
    drag.current = { pointerId: e.pointerId, x: e.clientX, start: clip.startTime, duration: clip.duration, mode, pps, finish: beginMotionDrag() };
    onDragScale(pps);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || d.pointerId !== e.pointerId) return;
    const delta = (e.clientX - d.x) / d.pps * 1000;
    const snap = (t: number) => e.altKey ? t : snappedTime(t, pps, undefined, clip.id);
    const state = useImageStore.getState();
    if (d.mode === 'move') state.updateAnimationClip(clip.id, { startTime: Math.max(0, snap(d.start + delta)), duration: d.duration });
    else if (d.mode === 'left') { const start = Math.max(0, Math.min(d.start + d.duration - 200, snap(d.start + delta))); state.updateAnimationClip(clip.id, { startTime: start, duration: d.start + d.duration - start }); }
    else state.updateAnimationClip(clip.id, { duration: Math.max(200, snap(d.start + d.duration + delta) - d.start) });
  };
  const fitToTimeline = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    const finish = beginMotionDrag();
    try {
      const state = useImageStore.getState();
      const duration = Math.max(200, timelineDuration);
      state.updateAnimationClip(clip.id, { startTime: 0, duration });
      useImageStore.getState().setTimeline({ duration: timelineDuration, durationLocked: true });
    }
    finally { finish(); }
  };
  return <div role="button" tabIndex={0} aria-label={`Select ${clip.name} animation`} aria-pressed={selected}
    className={`absolute inset-y-1 flex touch-none cursor-grab items-center gap-2 overflow-hidden rounded-md border px-3 text-xs active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-foreground/40 bg-foreground/10 text-foreground' : 'border-border bg-muted text-muted-foreground hover:bg-accent'}`}
    style={{ left: GUTTER + clip.startTime / 1000 * pps, width: Math.max(24, clip.duration / 1000 * pps), borderColor: `${color}${selected ? '' : '88'}`, backgroundColor: `${color}${selected ? '2e' : '1a'}` }}
    onPointerDown={e => begin(e, 'move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseClip(clip); } }}>
    <div aria-hidden className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize border-r border-foreground/10 hover:bg-foreground/20" title="Drag to resize. Double-click to fit timeline" onDoubleClick={fitToTimeline} onPointerDown={e => { e.stopPropagation(); begin(e, 'left'); }} />
    <span className="truncate font-medium">{clip.name}</span><span className="ml-auto shrink-0 text-[10px] tabular-nums">{timeLabel(clip.duration)}</span>
    <div aria-hidden className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize border-l border-foreground/10 hover:bg-foreground/20" title="Drag to resize. Double-click to fit timeline" onDoubleClick={fitToTimeline} onPointerDown={e => { e.stopPropagation(); begin(e, 'right'); }} />
  </div>;
}

type KeyRef = { trackId: string; keyframeId: string };

function keyRefId(key: KeyRef) { return `${key.trackId}\u0000${key.keyframeId}`; }

function KeyMarker({ clip, track, keyframe, property, pps, groupSelected, groupKeys, onSelectGroup }: { clip: AnimationClip; track: AnimationTrack; keyframe: Keyframe; property: keyof AnimatableProperties | 'clipMask'; pps: number; groupSelected: boolean; groupKeys: KeyRef[]; onSelectGroup: (keys: KeyRef[]) => void }) {
  const selected = useMotionSelection(s => s.keyframe?.keyframeId === keyframe.id && s.keyframe.property === property);
  const drag = React.useRef<{ x: number; time: number; moved: boolean; keys: Array<KeyRef & { time: number }>; finish: () => void } | null>(null);
  const finish = () => { drag.current?.finish(); drag.current = null; };
  React.useEffect(() => () => drag.current?.finish(), []);
  const select = () => { const state = useImageStore.getState(); state.stopPlayback(); state.setPlayhead(keyframe.time); const selection = useMotionSelection.getState(); selection.selectClip(clip.id); selection.selectKeyframe({ trackId: track.id, keyframeId: keyframe.id, property }); };
  const retime = (time: number) => { const state = useImageStore.getState(); const next = Math.round(Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, time))); state.updateKeyframe(track.id, keyframe.id, { time: next }); state.setPlayhead(next); };
  const moveGroup = (d: NonNullable<typeof drag.current>, rawDelta: number, altKey: boolean) => {
    const state = useImageStore.getState();
    const moving = new Set(d.keys.map(keyRefId));
    const anchorRaw = d.time + rawDelta;
    let delta = (altKey ? anchorRaw : snappedTime(anchorRaw, pps, keyframe.id, undefined, moving)) - d.time;
    let minDelta = -Infinity;
    let maxDelta = Infinity;
    for (const key of d.keys) {
      const track = state.timeline.tracks.find(t => t.id === key.trackId);
      const clip = state.animationClips.find(c => c.id === track?.clipId);
      const current = track?.keyframes.find(k => k.id === key.keyframeId);
      if (!track || !clip || !current || track.isLocked) continue;
      minDelta = Math.max(minDelta, clip.startTime - key.time);
      maxDelta = Math.min(maxDelta, clip.startTime + clip.duration - key.time);
      const others = track.keyframes.filter(k => !moving.has(keyRefId({ trackId: track.id, keyframeId: k.id })));
      const previous = others.filter(k => k.time < key.time).at(-1);
      const next = others.find(k => k.time > key.time);
      if (previous) minDelta = Math.max(minDelta, previous.time + 1 - key.time);
      if (next) maxDelta = Math.min(maxDelta, next.time - 1 - key.time);
    }
    if (minDelta > maxDelta) return;
    delta = Math.max(minDelta, Math.min(maxDelta, delta));
    const nextTimes = new Map(d.keys.map(k => [keyRefId(k), Math.round(k.time + delta)]));
    useImageStore.setState(s => ({ timeline: { ...s.timeline, playhead: Math.max(0, Math.min(s.timeline.duration, d.time + delta)), tracks: s.timeline.tracks.map(t => ({ ...t, keyframes: t.keyframes.map(k => ({ ...k, time: nextTimes.get(keyRefId({ trackId: t.id, keyframeId: k.id })) ?? k.time })).sort((a, b) => a.time - b.time) })) } }));
  };
  return <button data-motion-key type="button" aria-label={`${track.name} keyframe at ${timeLabel(keyframe.time)}`} aria-pressed={selected || (groupSelected && groupKeys.some(k => k.trackId === track.id && k.keyframeId === keyframe.id))} disabled={track.isLocked} title={`${timeLabel(keyframe.time)}  /  ${property === 'clipMask' ? keyframe.clipMask || 'No mask' : keyframe.properties[property]}  /  Drag to move; arrows to nudge`}
    data-track-id={track.id} data-keyframe-id={keyframe.id}
    className={`absolute top-1/2 z-20 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded cursor-ew-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 ${selected || (groupSelected && groupKeys.some(k => k.trackId === track.id && k.keyframeId === keyframe.id)) ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-accent'}`}
    style={{ left: GUTTER + keyframe.time / 1000 * pps }}
    onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); const ref = { trackId: track.id, keyframeId: keyframe.id }; const inGroup = groupKeys.some(k => keyRefId(k) === keyRefId(ref)); const additive = e.shiftKey || e.ctrlKey || e.metaKey; const readKeys = (refs: KeyRef[]) => { const state = useImageStore.getState(); return state.timeline.tracks.flatMap(t => t.keyframes.filter(k => refs.some(item => item.trackId === t.id && item.keyframeId === k.id)).map(k => ({ trackId: t.id, keyframeId: k.id, time: k.time }))); }; let chosen: Array<KeyRef & { time: number }>; if (additive) { const next = inGroup ? groupKeys.filter(k => keyRefId(k) !== keyRefId(ref)) : [...groupKeys, ref]; onSelectGroup(next); chosen = inGroup ? [{ ...ref, time: keyframe.time }] : readKeys(next); } else if (inGroup) { chosen = readKeys(groupKeys); } else { onSelectGroup([ref]); chosen = [{ ...ref, time: keyframe.time }]; } select(); drag.current = { x: e.clientX, time: keyframe.time, moved: false, keys: chosen, finish: beginMotionDrag() }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={e => { const d = drag.current; if (!d || !e.currentTarget.hasPointerCapture(e.pointerId) ) return; if (!d.moved && Math.abs(e.clientX - d.x) < 2) return; d.moved = true; if (d.keys.length > 1) moveGroup(d, (e.clientX - d.x) / pps * 1000, e.altKey); else { const raw = d.time + (e.clientX - d.x) / pps * 1000; retime(e.altKey ? raw : snappedTime(raw, pps, keyframe.id)); } }}
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
  const [collapsedAssets, setCollapsedAssets] = React.useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = React.useState<KeyRef[]>([]);
  const [marquee, setMarquee] = React.useState<{ x: number; y: number; currentX: number; currentY: number; additive: boolean } | null>(null);
  const resize = React.useRef<{ y: number; height: number } | null>(null);
  const durationDrag = React.useRef<{ x: number; duration: number; pps: number; finish: () => void } | null>(null);
  const zoomAnchor = React.useRef<number | null>(null);
  const marqueeStart = React.useRef<{ x: number; y: number } | null>(null);
  const marqueePointer = React.useRef<{ x: number; y: number } | null>(null);
  const marqueeHits = React.useRef<Map<string, KeyRef>>(new Map());
  const isMarqueeActive = marquee !== null;
  const setKeyGroup = React.useCallback((keys: KeyRef[]) => setSelectedKeys([...new Map(keys.map(k => [keyRefId(k), k])).values()]), []);
  const collectMarqueeHits = React.useCallback(() => {
    const start = marqueeStart.current;
    const point = marqueePointer.current;
    const root = viewport.current;
    if (!start || !point || !root) return;
    const left = Math.min(start.x, point.x), right = Math.max(start.x, point.x);
    const top = Math.min(start.y, point.y), bottom = Math.max(start.y, point.y);
    for (const node of root.querySelectorAll<HTMLElement>('[data-motion-key][data-track-id][data-keyframe-id]:not(:disabled)')) {
      const bounds = node.getBoundingClientRect();
      if (bounds.right >= left && bounds.left <= right && bounds.bottom >= top && bounds.top <= bottom) {
        const key = { trackId: node.dataset.trackId!, keyframeId: node.dataset.keyframeId! };
        marqueeHits.current.set(keyRefId(key), key);
      }
    }
  }, []);
  const removeKeyGroup = React.useCallback(() => {
    if (!selectedKeys.length) return false;
    const finish = beginMotionDrag();
    try { for (const key of selectedKeys) useImageStore.getState().removeKeyframe(key.trackId, key.keyframeId); }
    finally { finish(); }
    setSelectedKeys([]);
    useMotionSelection.getState().selectKeyframe(null);
    return true;
  }, [selectedKeys]);
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
    if (!isMarqueeActive) return;
    let frame = 0;
    const edge = 48;
    const scrollAtEdges = () => {
      const el = viewport.current;
      const point = marqueePointer.current;
      if (el && point) {
        const bounds = el.getBoundingClientRect();
        const topDistance = point.y - bounds.top;
        const bottomDistance = bounds.bottom - point.y;
        if (topDistance < edge && el.scrollTop > 0) {
          const intensity = Math.max(0, (edge - topDistance) / edge);
          el.scrollTop -= Math.max(2, intensity * intensity * 18);
        } else if (bottomDistance < edge && el.scrollTop + el.clientHeight < el.scrollHeight) {
          const intensity = Math.max(0, (edge - bottomDistance) / edge);
          el.scrollTop += Math.max(2, intensity * intensity * 18);
        }
        collectMarqueeHits();
      }
      frame = requestAnimationFrame(scrollAtEdges);
    };
    frame = requestAnimationFrame(scrollAtEdges);
    return () => cancelAnimationFrame(frame);
  }, [collectMarqueeHits, isMarqueeActive]);
  React.useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const state = useImageStore.getState();
      if (!state.showTimeline || shouldIgnoreEditorShortcut(event)) return;
      if ((event.key === 'Backspace' || event.key === 'Delete') && selectedKeys.length > 0) { event.preventDefault(); event.stopImmediatePropagation(); removeKeyGroup(); return; }
      const mediaId = useMotionSelection.getState().mediaId;
      const media = state.imageOverlays.find(o => o.id === mediaId);
      if (mediaId && media) {
        if (media.mediaType === 'video' && event.ctrlKey && event.altKey && !event.metaKey && event.code === 'KeyB') { event.preventDefault(); event.stopImmediatePropagation(); splitVideoAt(mediaId); return; }
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
          if (event.code === 'KeyQ' || event.code === 'KeyW') { event.preventDefault(); event.stopImmediatePropagation(); (media.mediaType === 'video' ? trimVideoAt : trimImageAt)(mediaId, event.code === 'KeyQ' ? 'left' : 'right'); return; }
          if (media.mediaType === 'video' && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); deleteVideoClip(mediaId); return; }
        }
      }
      if (mediaId === MAIN_IMAGE_TRACK_ID && !event.ctrlKey && !event.metaKey && !event.altKey && (event.code === 'KeyQ' || event.code === 'KeyW')) {
        event.preventDefault(); event.stopImmediatePropagation(); trimImageAt(mediaId, event.code === 'KeyQ' ? 'left' : 'right'); return;
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
  }, [removeKeyGroup, selectedKeys.length]);
  const duration = state.timeline.duration;
  const pps = dragScale ?? Math.max(1, (availableWidth - LABEL_WIDTH - GUTTER * 2) / (duration / 1000)) * state.timeline.zoom;
  const trackWidth = duration / 1000 * pps + GUTTER * 2;
  const rowWidth = LABEL_WIDTH + trackWidth;
  const tickStep = [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000, 300000].find(t => t / 1000 * pps >= 65) ?? 600000;
  const selectedClip = state.animationClips.find(c => c.id === selection.clipId);
  const videos = state.imageOverlays.filter(o => o.mediaType === 'video');
  const images = state.imageOverlays.filter(o => o.mediaType !== 'video');
  const overlayIds = state.imageOverlays.map(o => o.id);
  const selectedMedia = state.imageOverlays.find(o => o.id === selection.mediaId);
  const selectedVideo = selectedMedia?.mediaType === 'video' ? selectedMedia : undefined;
  const selectedImage = selectedMedia && selectedMedia.mediaType !== 'video' ? selectedMedia : undefined;
  const selectedMainImage = selection.mediaId === MAIN_IMAGE_TRACK_ID && Boolean(state.uploadedImageUrl);
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
  const targetLabel = (clip: AnimationClip) => {
    const target = clip.target ?? 'asset';
    if (target === 'asset') return 'Main asset';
    const overlay = state.imageOverlays.find(o => o.id === target);
    if (!overlay) return 'Missing layer';
    const index = state.imageOverlays.indexOf(overlay) + 1;
    return `${overlay.mediaType === 'video' ? 'Video' : 'Image'} ${index}`;
  };
  const assetGroups = (() => {
    const groups: Array<{ id: string; label: string; targets: string[]; kind: 'main' | 'image' | 'video' | 'other'; overlay?: (typeof state.imageOverlays)[number]; segments?: typeof videos }> = [];
    if (state.uploadedImageUrl && !state.imageOverlays.some(overlay => overlay.id === 'asset')) groups.push({ id: 'asset', label: 'Main image', targets: ['asset'], kind: 'main' });
    images.forEach((overlay, index) => groups.push({ id: overlay.id, label: `Image ${index + 1}`, targets: [overlay.id], kind: 'image', overlay }));
    videoTracks.forEach((segments, index) => groups.push({ id: `video-track:${segments[0].videoTrackId ?? segments[0].id}`, label: `Video ${index + 1}`, targets: segments.map(segment => segment.id), kind: 'video', segments }));
    const representedTargets = new Set(groups.flatMap(group => group.targets));
    for (const clip of state.animationClips) {
      const target = clip.target ?? 'asset';
      if (representedTargets.has(target)) continue;
      representedTargets.add(target);
      groups.push({ id: `animation-target:${target}`, label: target === 'asset' ? 'Main asset' : targetLabel(clip), targets: [target], kind: 'other' });
    }
    return groups;
  })();
  const beginMarquee = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !(e.target instanceof Element) || !e.target.closest('[data-keyframe-lane]')) return;
    e.preventDefault();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) setSelectedKeys([]);
    marqueeStart.current = { x: e.clientX, y: e.clientY };
    marqueePointer.current = { x: e.clientX, y: e.clientY };
    marqueeHits.current = new Map();
    setMarquee({ x: e.clientX, y: e.clientY, currentX: e.clientX, currentY: e.clientY, additive });
    viewport.current?.setPointerCapture(e.pointerId);
  };
  const updateMarquee = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!marqueeStart.current) return;
    marqueePointer.current = { x: e.clientX, y: e.clientY };
    collectMarqueeHits();
    setMarquee(current => current ? { ...current, currentX: e.clientX, currentY: e.clientY } : null);
  };
  const finishMarquee = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = marqueeStart.current;
    if (!start) return;
    marqueePointer.current = { x: e.clientX, y: e.clientY };
    collectMarqueeHits();
    marqueeStart.current = null;
    marqueePointer.current = null;
    const found = [...marqueeHits.current.values()];
    marqueeHits.current.clear();
    const current = marquee?.additive ? selectedKeys : [];
    setKeyGroup([...current, ...found]);
    useMotionSelection.getState().selectKeyframe(null);
    setMarquee(null);
  };
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
      <div ref={viewport} className="relative min-w-0 flex-1 overflow-auto overscroll-contain" onPointerDown={beginMarquee} onPointerMove={updateMarquee} onPointerUp={finishMarquee} onPointerCancel={finishMarquee}>
        <div className="relative min-h-full" style={{ width: rowWidth }}>
          <div className="sticky top-0 z-40 flex h-8 border-b border-border bg-background" style={{ width: rowWidth }}><div className="sticky left-0 z-40 flex shrink-0 items-center justify-between border-r border-border bg-background px-3 text-xs text-muted-foreground" style={{ width: LABEL_WIDTH }}><span>Layers & properties</span><span>Value / key</span></div>
            <div ref={ruler} className="relative touch-none cursor-ew-resize" style={{ width: trackWidth }} onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e); }}>
              {Array.from({ length: Math.ceil(duration / tickStep) }, (_, i) => <span key={i} className="absolute top-1.5 h-4 border-l border-border pl-1 text-[10px] tabular-nums text-muted-foreground" style={{ left: GUTTER + i * tickStep / 1000 * pps }}>{Number((i * tickStep / 1000).toFixed(2))}s</span>)}
              <div role="slider" tabIndex={0} aria-label="Timeline duration" aria-valuemin={500} aria-valuemax={Math.max(60000, duration)} aria-valuenow={duration} className="absolute inset-y-0 z-20 w-3 cursor-ew-resize touch-none border-r-2 border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring" style={{ left: GUTTER + duration / 1000 * pps - 10 }} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); state.setTimelineDuration(Math.max(500, duration + (e.key === 'ArrowRight' ? 100 : -100))); } }} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); durationDrag.current = { x: e.clientX, duration, pps, finish: beginMotionDrag() }; setDragScale(pps); }} onPointerMove={e => { const d = durationDrag.current; if (d) state.setTimelineDuration(Math.max(500, d.duration + (e.clientX - d.x) / d.pps * 1000)); }} onPointerUp={() => { durationDrag.current?.finish(); durationDrag.current = null; setDragScale(null); }} onPointerCancel={() => { durationDrag.current?.finish(); durationDrag.current = null; setDragScale(null); }} />
              <div role="slider" tabIndex={0} aria-label="Playhead. Drag to seek" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={state.timeline.playhead} className="absolute inset-y-0 z-30 flex w-6 -translate-x-1/2 cursor-ew-resize touch-none justify-center focus-visible:ring-2 focus-visible:ring-ring" style={{ left: GUTTER + state.timeline.playhead / 1000 * pps }} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e); }} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(state.timeline.playhead + (e.key === 'ArrowRight' ? 1 : -1) * FRAME * (e.shiftKey ? 10 : 1)); } }}><div className="mt-0.5 h-5 w-2.5 rounded-b-sm bg-primary" /></div>
            </div>
          </div>
          {state.animationClips.length === 0 && assetGroups.length === 0 && <div className="sticky left-0 flex max-w-full flex-col items-center gap-3 p-8 text-center"><Diamond size={22} className="text-muted-foreground" /><p className="text-sm font-medium">Make your first move</p><p className="max-w-sm text-xs leading-relaxed text-muted-foreground">Select a layer, create an animation, then move the playhead and adjust the layer on the canvas. Set a keyframe to keep each pose.</p><button className={`${button} border border-border`} onClick={addCustomAnimation}><Plus size={14} />Create animation</button></div>}
          {assetGroups.map(group => {
            const groupClosed = collapsedAssets.includes(group.id);
            const groupColor = animationTargetColor(group.targets[0], overlayIds);
            const groupClips = state.animationClips.filter(clip => group.targets.includes(clip.target ?? 'asset'));
            const groupStart = group.kind === 'main' ? state.mainImageStartTime ?? 0 : group.overlay?.startTime ?? 0;
            const groupDuration = group.kind === 'main'
              ? state.mainImageDuration ?? duration
              : group.overlay && group.overlay.mediaType !== 'video'
                ? imageClipDuration(group.overlay, duration)
                : 0;
            return <React.Fragment key={group.id}>
              <div className="flex h-12 border-b border-border">
                <div className="sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-border bg-background px-2" style={{ width: LABEL_WIDTH }}>
                  <button className={`${button} px-1`} aria-label={`${groupClosed ? 'Expand' : 'Collapse'} ${group.label} asset group`} aria-expanded={!groupClosed} onClick={() => setCollapsedAssets(current => groupClosed ? current.filter(id => id !== group.id) : [...current, group.id])}>{groupClosed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
                  <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: groupColor }} />
                  {group.kind === 'video' ? <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">{group.label}<span className="ml-2 text-[10px]">Muted</span></span> : group.kind === 'other' ? <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">{group.label}</span> : <button className="min-w-0 flex-1 truncate text-left text-xs font-medium" onClick={() => selectTimelineAsset(group.kind === 'main' ? MAIN_IMAGE_TRACK_ID : group.overlay!.id)}>{group.label}</button>}
                </div>
                <div className="relative" style={{ width: trackWidth }}>
                  {group.kind === 'main' && state.uploadedImageUrl ? <ImageClipBar id={MAIN_IMAGE_TRACK_ID} name="Main image" startTime={groupStart} duration={groupDuration} pps={pps} gutter={GUTTER} snap={time => snappedTime(time, pps, undefined, MAIN_IMAGE_TRACK_ID)} onDragScale={setDragScale} color={groupColor} /> : null}
                  {group.kind === 'image' && group.overlay ? <ImageClipBar id={group.overlay.id} name={group.label} startTime={groupStart} duration={groupDuration} pps={pps} gutter={GUTTER} snap={time => snappedTime(time, pps, undefined, group.overlay!.id)} onDragScale={setDragScale} color={groupColor} /> : null}
                  {group.kind === 'video' && group.segments ? group.segments.map(segment => <VideoClipBar key={segment.id} overlay={segment} index={videos.indexOf(segment)} pps={pps} gutter={GUTTER} snap={time => snappedTime(time, pps, undefined, segment.id)} onDragScale={setDragScale} />) : null}
                </div>
              </div>
              {!groupClosed && groupClips.map(clip => {
            const tracks = state.timeline.tracks.filter(t => t.clipId === clip.id);
            const pose = motionPose(clip, state.timeline.playhead, selection.draft, state);
            const closed = collapsed.includes(clip.id);
            const selected = selection.clipId === clip.id;
            return <React.Fragment key={clip.id}>
              <div className="flex h-10 border-b border-border"><div className={`sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-border px-2 pl-7 ${selected ? 'bg-accent' : 'bg-background'}`} style={{ width: LABEL_WIDTH }}><button className={`${button} px-1`} aria-label={`${closed ? 'Expand' : 'Collapse'} ${clip.name} properties`} aria-expanded={!closed} onClick={() => setCollapsed(c => closed ? c.filter(id => id !== clip.id) : [...c, clip.id])}>{closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button><button className="min-w-0 flex-1 truncate text-left text-xs font-medium" onClick={() => chooseClip(clip)}>{clip.name}</button></div><div className="relative" style={{ width: trackWidth }}><ClipBar clip={clip} pps={pps} onDragScale={setDragScale} timelineDuration={duration} color={groupColor} /></div></div>
              {!closed && PROPERTY_CONTROLS.filter(p => p.group === 'asset').map(p => {
                const track = tracks.find(t => t.keyframes.some(k => p.key in k.properties));
                const keys = track?.keyframes.filter(k => p.key in k.properties).sort((a,b) => a.time-b.time) ?? [];
                const atKey = keys.find(k => Math.abs(k.time - state.timeline.playhead) < 1);
                const inRange = state.timeline.playhead >= clip.startTime && state.timeline.playhead <= clip.startTime + clip.duration;
                const disabled = track?.isLocked || !selected || !inRange || state.timeline.isPlaying;
                return <div key={p.key} className="flex h-9 border-b border-border/50"><div className="sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-border bg-background pl-7 pr-2" style={{ width: LABEL_WIDTH }}><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p.label}</span><NumberField aria-label={`${p.label} pose value`} className={`${field} w-14 border-transparent text-right hover:border-border`} disabled={disabled} value={pose[p.key]} min={p.min} max={p.max} step={p.step} onValueChange={v => previewPose(clip.target ?? 'asset', { [p.key]: v })} /><button aria-label={`Set ${p.label} keyframe`} title={atKey ? 'Update keyframe at playhead' : 'Add keyframe at playhead'} className={`${button} w-7 px-0 ${atKey ? 'text-primary' : ''}`} disabled={disabled} onClick={() => insertPropertyKey(clip, p.key, pose[p.key], state.timeline.playhead)}><Diamond size={11} fill={atKey ? 'currentColor' : 'none'} /></button>{track && <><button className={`${button} w-6 px-0`} aria-label={`${track.isVisible ? 'Hide' : 'Show'} ${track.name} track`} onClick={() => state.updateTrack(track.id, { isVisible: !track.isVisible })}>{track.isVisible ? <Eye size={11} /> : <EyeOff size={11} />}</button><button className={`${button} w-6 px-0`} aria-label={`${track.isLocked ? 'Unlock' : 'Lock'} ${track.name} track`} onClick={() => state.updateTrack(track.id, { isLocked: !track.isLocked })}>{track.isLocked ? <Lock size={11} /> : <Unlock size={11} />}</button></>}</div>
                  <div data-keyframe-lane className={`relative ${track?.isVisible === false ? 'opacity-35' : ''} ${marquee ? 'cursor-crosshair' : ''}`} style={{ width: trackWidth, backgroundImage: 'linear-gradient(to right, var(--border) 1px, transparent 1px)', backgroundSize: `${tickStep / 1000 * pps}px 100%`, backgroundPositionX: GUTTER }} onClick={e => { chooseClip(clip); seek((e.clientX - e.currentTarget.getBoundingClientRect().left - GUTTER) / pps * 1000); }} onDoubleClick={e => { if (track?.isLocked) return; const time = Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, (e.clientX - e.currentTarget.getBoundingClientRect().left - GUTTER) / pps * 1000)); insertPropertyKey(clip, p.key, motionPose(clip, time)[p.key], time); }}>
                    {keys.length > 1 && <div className="pointer-events-none absolute top-1/2 h-px bg-foreground/20" style={{ left: GUTTER + keys[0].time / 1000 * pps, width: (keys[keys.length - 1].time - keys[0].time) / 1000 * pps }} />}{track && keys.map(k => <KeyMarker key={k.id} clip={clip} track={track} keyframe={k} property={p.key} pps={pps} groupSelected={selectedKeys.some(ref => ref.trackId === track.id && ref.keyframeId === k.id)} groupKeys={selectedKeys} onSelectGroup={setKeyGroup} />)}
                  </div></div>;
              })}
              {!closed && tracks.filter(t => t.keyframes.some(k => k.clipMask !== undefined)).map(t => <div key={t.id} className="flex h-9 border-b border-border/50"><div className="sticky left-0 z-30 shrink-0 border-r border-border bg-background py-2 pl-7 text-xs text-muted-foreground" style={{ width: LABEL_WIDTH }}>Clip mask</div><div data-keyframe-lane className="relative" style={{ width: trackWidth }}>{t.keyframes.filter(k => k.clipMask !== undefined).map(k => <KeyMarker key={k.id} clip={clip} track={t} keyframe={k} property="clipMask" pps={pps} groupSelected={selectedKeys.some(ref => ref.trackId === t.id && ref.keyframeId === k.id)} groupKeys={selectedKeys} onSelectGroup={setKeyGroup} />)}</div></div>)}
            </React.Fragment>;
          })}
            </React.Fragment>;
          })}
          <div className="pointer-events-none absolute bottom-0 top-8 z-20 w-px bg-primary/70" style={{ left: LABEL_WIDTH + GUTTER + state.timeline.playhead / 1000 * pps }} />
        </div>
      </div>
      {marquee && <div aria-hidden className="pointer-events-none fixed z-[100] border border-primary bg-primary/15" style={{ left: Math.min(marquee.x, marquee.currentX), top: Math.min(marquee.y, marquee.currentY), width: Math.abs(marquee.currentX - marquee.x), height: Math.abs(marquee.currentY - marquee.y) }} />}
      <aside data-timeline-inspector className="w-60 shrink-0 overflow-y-auto border-l border-border bg-muted/15 p-4">
        {selectedVideo ? <VideoClipInspector overlay={selectedVideo} playhead={state.timeline.playhead} /> : selectedImage ? <ImageClipInspector id={selectedImage.id} name={selectedImage.id === 'asset' ? 'Main image' : 'Image asset'} startTime={selectedImage.startTime ?? 0} duration={imageClipDuration(selectedImage, duration)} timelineDuration={duration} playhead={state.timeline.playhead} /> : selectedMainImage ? <ImageClipInspector id={MAIN_IMAGE_TRACK_ID} name={state.imageName ?? 'Main image'} startTime={state.mainImageStartTime ?? 0} duration={state.mainImageDuration ?? duration} timelineDuration={duration} playhead={state.timeline.playhead} /> : selectedKey && selectedTrack && selection.keyframe ? <KeyframeInspector track={selectedTrack} keyframe={selectedKey} property={selection.keyframe.property} /> : <div className="space-y-3"><p className="text-sm font-medium">{selectedClip ? targetLabel(selectedClip) : 'Animate on canvas'}</p><p className="text-xs leading-relaxed text-muted-foreground">{selectedClip ? 'At an existing keyframe, canvas edits update it directly. At a new time, set a keyframe to save the pose.' : 'Select a layer on the canvas, then create an animation.'}</p>{pending && <div className="space-y-2 border-t border-border pt-3"><p role="status" className="text-xs font-medium">Pose preview  /  not saved</p><p className="text-xs leading-relaxed text-muted-foreground">Set a keyframe before seeking or playing to keep this pose.</p><button className={`${button} border border-border`} onClick={selection.discardPose}>Reset pose</button></div>}{selectedClip && <button className={button} onClick={() => { selection.selectKeyframe(null); deleteSelectedMotion(); }}><Trash2 size={13} />Delete animation</button>}</div>}
      </aside>
    </div>
  </section>;
}
