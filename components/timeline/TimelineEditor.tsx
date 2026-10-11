'use client';
import * as React from 'react';
import { Diamond, ChevronDown, ChevronRight, Eye, EyeOff, Lock, Unlock, Magnet, Plus, GripVertical, Trash2 } from 'lucide-react';
import { useImageStore } from '@/lib/store';
import { TimelineControls } from './TimelineControls';
import { useTimelinePlayback } from './hooks/useTimelinePlayback';
import { useMotionSelection, PROPERTY_CONTROLS, EASE_LABELS } from '@/lib/animation/editor';
import { getInterpolatedProperties } from '@/lib/animation/interpolation';
import { shouldIgnoreEditorShortcut } from '@/lib/editor-shortcuts';
import { addCustomAnimation, deleteSelectedMotion, insertPropertyKey, EaseCurve, CLIP_MASK_PRESETS } from './MotionInspector';
import { beginMotionDrag } from '@/lib/animation/drag-history';
import { TIMELINE_HEIGHT } from '@/lib/constants/editor-layout';
import type { AnimationClip, AnimationTrack, Keyframe, AnimatableProperties, EasingFunction } from '@/types/animation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';

const LABEL_WIDTH = 260;
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
  const control = PROPERTY_CONTROLS.find(p => p.key === property)!;
  const value = keyframe.properties[property] ?? 0;
  return <button aria-label={`${control.label} keyframe at ${timeLabel(keyframe.time)} · edit in property column`} aria-pressed={selected} disabled={track.isLocked}
        className={`absolute top-3.5 z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'text-primary' : 'text-foreground'} disabled:opacity-40`}
        style={{ left: keyframe.time / 1000 * pps }} title={`${timeLabel(keyframe.time)} · ${value} · ${keyframe.easing}`}
        onPointerDown={e => { e.preventDefault(); e.stopPropagation(); selection.selectClip(clip.id); selection.selectKeyframe({ trackId: track.id, keyframeId: keyframe.id, property }); const state = useImageStore.getState(); state.stopPlayback(); state.setPlayhead(keyframe.time); drag.current = { x: e.clientX, time: keyframe.time, finish: beginMotionDrag() }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (!drag.current) return; const raw = drag.current.time + (e.clientX - drag.current.x) / pps * 1000; const time = Math.round(Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, e.altKey ? raw : snapTime(raw, clip, keyframe.id)))); const state = useImageStore.getState(); state.updateKeyframe(track.id, keyframe.id, { time }); state.setPlayhead(time); }}
        onPointerUp={() => { drag.current?.finish(); drag.current = null; }} onPointerCancel={() => { drag.current?.finish(); drag.current = null; }}
        onClick={e => { e.stopPropagation(); selection.selectClip(clip.id); selection.selectKeyframe({ trackId: track.id, keyframeId: keyframe.id, property }); useImageStore.getState().setPlayhead(keyframe.time); }}>
        <Diamond size={12} fill={selected ? 'currentColor' : 'none'} strokeWidth={2} />
      </button>;
}

function ClipMaskDiamond({ clip, track, keyframe, pps }: { clip: AnimationClip; track: AnimationTrack; keyframe: Keyframe; pps: number }) {
  const selection = useMotionSelection();
  const selected = selection.keyframe?.keyframeId === keyframe.id && selection.keyframe.property === 'clipMask';
  const drag = React.useRef<{ x: number; time: number; finish: () => void } | null>(null);
  return <button aria-label={`Clip mask keyframe at ${timeLabel(keyframe.time)} · edit in property column`} aria-pressed={selected} disabled={track.isLocked}
        className={`absolute top-3.5 z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'text-primary' : 'text-foreground'} disabled:opacity-40`}
        style={{ left: keyframe.time / 1000 * pps }} title={`${timeLabel(keyframe.time)} · ${keyframe.clipMask || 'No mask'}`}
        onPointerDown={e => { e.preventDefault(); e.stopPropagation(); selection.selectClip(clip.id); selection.selectKeyframe({ trackId: track.id, keyframeId: keyframe.id, property: 'clipMask' }); const state = useImageStore.getState(); state.stopPlayback(); state.setPlayhead(keyframe.time); drag.current = { x: e.clientX, time: keyframe.time, finish: beginMotionDrag() }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (!drag.current) return; const time = Math.round(Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, drag.current.time + (e.clientX - drag.current.x) / pps * 1000))); useImageStore.getState().updateKeyframe(track.id, keyframe.id, { time }); useImageStore.getState().setPlayhead(time); }}
        onPointerUp={() => { drag.current?.finish(); drag.current = null; }} onPointerCancel={() => { drag.current?.finish(); drag.current = null; }}
        onClick={e => { e.stopPropagation(); selection.selectClip(clip.id); selection.selectKeyframe({ trackId: track.id, keyframeId: keyframe.id, property: 'clipMask' }); useImageStore.getState().setPlayhead(keyframe.time); }}>
        <Diamond size={12} fill={selected ? 'currentColor' : 'none'} strokeWidth={2} />
      </button>;
}

function InlineKeyframeEditor({ track, keyframe, property }: { track: AnimationTrack; keyframe: Keyframe; property: keyof AnimatableProperties | 'clipMask' }) {
  const state = useImageStore();
  const control = PROPERTY_CONTROLS.find(p => p.key === property);
  const editorRef = React.useRef<HTMLFieldSetElement>(null);
  const customEase = keyframe.easing.startsWith('cubic-bezier(');
  React.useEffect(() => { editorRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [keyframe.id, customEase]);
  const [maskDraft, setMaskDraft] = React.useState(keyframe.clipMask ?? '');
  const [maskError, setMaskError] = React.useState(false);
  React.useEffect(() => { setMaskDraft(keyframe.clipMask ?? ''); setMaskError(false); }, [keyframe.id, keyframe.clipMask]);
  const inputClass = 'h-7 w-full min-w-0 rounded border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const setEase = (easing: EasingFunction) => state.updateKeyframe(track.id, keyframe.id, { easing });
  const setMask = (value: string) => {
    const valid = value.length < 1000 && (value === '' || CSS.supports('clip-path', value));
    setMaskError(!valid);
    if (valid) state.updateKeyframe(track.id, keyframe.id, { clipMask: value });
  };
  return <fieldset ref={editorRef} disabled={track.isLocked} data-inline-keyframe-editor className="space-y-2 border-t border-border/50 bg-muted/20 p-2.5 disabled:opacity-50">
    <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground"><span className="font-medium uppercase tracking-wide">Keyframe</span><span className="ml-auto font-mono">{timeLabel(keyframe.time)}</span><button type="button" aria-label="Remove selected keyframe" title="Remove keyframe" className="rounded p-1 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={deleteSelectedMotion}><Trash2 size={13} /></button></div>
    {control ? <label className="grid grid-cols-[42px_minmax(0,1fr)_24px] items-center gap-2 text-[11px] text-muted-foreground">Value <input aria-label={`${control.label} timeline value`} className={inputClass} type="number" min={control.min} max={control.max} step={control.step} value={keyframe.properties[control.key] ?? 0} onChange={e => { if (e.target.value !== '' && Number.isFinite(+e.target.value)) state.updateKeyframe(track.id, keyframe.id, { properties: { [control.key]: Math.max(control.min, Math.min(control.max, +e.target.value)) } }); }} /><span>{control.unit}</span></label> : <>
      <select aria-label="Timeline clip mask preset" className={inputClass} value={CLIP_MASK_PRESETS.some(p => p.value === maskDraft) ? maskDraft : '__custom__'} onChange={e => { if (e.target.value !== '__custom__') { setMaskDraft(e.target.value); setMask(e.target.value); } }}><option value="__custom__">Custom clip-path</option>{CLIP_MASK_PRESETS.map(p => <option key={p.name} value={p.value}>{p.name}</option>)}</select>
      <textarea aria-label="Timeline clip mask CSS" aria-invalid={maskError} spellCheck={false} className={inputClass + ' h-14 resize-y py-1 font-mono text-[10px]'} value={maskDraft} onChange={e => { setMaskDraft(e.target.value); setMask(e.target.value); }} placeholder="inset(0 0 0 50%)" />
      {maskError && <p className="text-[10px] text-destructive">Enter a valid CSS clip-path.</p>}
    </>}
    <label className="block space-y-1 text-[10px] text-muted-foreground">Ease into this keyframe
      <select aria-label="Timeline keyframe easing" className={inputClass} value={EASE_LABELS[keyframe.easing as keyof typeof EASE_LABELS] ? keyframe.easing : '__custom__'} onChange={e => setEase(e.target.value === '__custom__' ? 'cubic-bezier(0.25,0.1,0.25,1)' : e.target.value as EasingFunction)}>{Object.entries(EASE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}<option value="__custom__">Custom graph</option></select>
    </label>
    {keyframe.easing.startsWith('cubic-bezier(') && <div className="flex items-center justify-between rounded bg-muted/50 px-2 py-1"><span className="text-[10px] text-muted-foreground">Drag curve handles</span><EaseCurve ease={keyframe.easing} onChange={setEase} /></div>}
  </fieldset>;
}

export function TimelineEditor() {
  const state = useImageStore();
  const selection = useMotionSelection();
  const viewport = React.useRef<HTMLDivElement>(null);
  const ruler = React.useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = React.useState(900);
  const [collapsed, setCollapsed] = React.useState<string[]>([]);
  const [collapsedProperties, setCollapsedProperties] = React.useState<string[]>([]);
  const durationDrag = React.useRef<{ x: number; duration: number; pps: number; finish: () => void } | null>(null);
  const playheadDragging = React.useRef(false);
  const clipCount = React.useRef(0);
  React.useEffect(() => {
    if (state.animationClips.length > clipCount.current) {
      const selected = useMotionSelection.getState().clipId;
      setCollapsed(state.animationClips.filter(c => c.id !== selected).map(c => c.id));
    }
    clipCount.current = state.animationClips.length;
  }, [state.animationClips]);
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
    <TimelineControls onAddAnimation={() => addCustomAnimation()} onClose={state.toggleTimeline} />
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
      <button className={toolbarButton} aria-pressed={state.timeline.snapToKeyframes} onClick={() => state.setTimeline({ snapToKeyframes: !state.timeline.snapToKeyframes })}><Magnet size={13} />Snap {state.timeline.snapToKeyframes ? 'on' : 'off'}</button>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">Zoom<input aria-label="Timeline zoom" type="range" min="1" max="6" step="0.25" value={state.timeline.zoom} onChange={e => state.setTimeline({ zoom: +e.target.value })} className="w-20 accent-primary" /></label>
      <span className="ml-auto hidden text-xs text-muted-foreground md:block">Space play · K keyframe · Shift + arrows 10 frames · Alt drag bypass snap · Ctrl + ` timeline</span>
    </div>
    <div ref={viewport} className="relative flex-1 overflow-auto">
      <div className="relative" style={{ width: rowStyle.width, minHeight: '100%' }}>
        <div className="sticky top-0 z-40 flex h-7 border-b border-border bg-background" style={rowStyle}>
          <div className="sticky left-0 z-40 flex shrink-0 items-center border-r border-border bg-background px-3 text-xs text-muted-foreground" style={{ width: LABEL_WIDTH }}>Property / keyframes</div>
          <div ref={ruler} className="relative cursor-ew-resize touch-none" style={{ width: trackWidth }} onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e); }}>
            {Array.from({ length: Math.floor(duration / 1000) + 1 }, (_, i) => <span key={i} className="absolute top-1 border-l border-border pl-1 text-[10px] tabular-nums text-muted-foreground" style={{ left: i * pps }}>{i}s</span>)}
            <div role="slider" tabIndex={0} aria-label="Timeline duration" aria-valuemin={500} aria-valuenow={duration} aria-valuetext={`${(duration / 1000).toFixed(2)} seconds`} aria-valuemax={Math.max(duration, 60000)} className="absolute inset-y-0 z-20 w-3 cursor-ew-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" style={{ left: Math.max(0, trackWidth - 5) }} title="Drag to change full timeline duration" onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); state.setTimelineDuration(Math.max(500, duration + (e.key === 'ArrowRight' ? 500 : -500))); } }} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); durationDrag.current = { x: e.clientX, duration, pps, finish: beginMotionDrag() }; }} onPointerMove={e => { const drag = durationDrag.current; if (drag && e.currentTarget.hasPointerCapture(e.pointerId)) state.setTimelineDuration(Math.max(500, drag.duration + (e.clientX - drag.x) / drag.pps * 1000)); }} onPointerUp={() => { durationDrag.current?.finish(); durationDrag.current = null; }} onPointerCancel={() => { durationDrag.current?.finish(); durationDrag.current = null; }}>
              <div className="absolute inset-y-0 left-1 w-2 border-l-2 border-primary/40 bg-primary/10"><GripVertical className="absolute -top-0.5 left-0.5 h-3 w-3 -translate-x-1/2 text-primary/50" /></div>
            </div>
          </div>
        </div>
        {state.animationClips.length === 0 && <div className="flex h-16 items-center justify-center gap-2 text-xs text-muted-foreground"><button className={toolbarButton} onClick={() => addCustomAnimation()}><Plus size={14} />Create your first animation</button></div>}
        {state.animationClips.map(clip => {
          const tracks = state.timeline.tracks.filter(t => t.clipId === clip.id);
          const properties = PROPERTY_CONTROLS.filter(p => p.group === 'asset' && tracks.some(t => t.keyframes.some(k => p.key in k.properties)));
          const closed = collapsed.includes(clip.id);
          return <React.Fragment key={clip.id}>
            <div className="flex h-9 border-b border-border" style={rowStyle}>
              <div className={`sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-border px-2 ${selection.clipId === clip.id ? 'bg-accent' : 'bg-background'}`} style={{ width: LABEL_WIDTH }}>
                <button className={toolbarButton + ' px-1'} aria-label={`${closed ? 'Expand' : 'Collapse'} ${clip.name} properties`} aria-expanded={!closed} onClick={() => setCollapsed(c => closed ? c.filter(id => id !== clip.id) : [...c, clip.id])}>{closed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button>
                <button className="min-w-0 truncate text-xs font-medium" onClick={() => { selection.selectClip(clip.id); state.setActiveRightPanelTab('animate'); }}>{clip.name}</button>
              </div><div className="relative" style={{ width: trackWidth }}><ClipBar clip={clip} pps={pps} /></div>
            </div>
            {!closed && properties.map((p, propertyIndex) => {
              const track = tracks.find(t => t.keyframes.some(k => p.key in k.properties))!;
              const keys = track.keyframes.filter(k => p.key in k.properties).sort((a,b) => a.time-b.time);
              const selectedKey = selection.keyframe?.trackId === track.id && selection.keyframe.property === p.key ? keys.find(k => k.id === selection.keyframe?.keyframeId) : undefined;
              const propertyClosed = collapsedProperties.includes(`${clip.id}:${p.key}`);
              const section = p.key === 'translateX' || p.key === 'translateY' ? 'Position' : p.key === 'imageOpacity' ? 'Appearance' : 'Transform';
              const previous = properties[propertyIndex - 1]?.key;
              const previousSection = previous === undefined ? '' : previous === 'translateX' || previous === 'translateY' ? 'Position' : previous === 'imageOpacity' ? 'Appearance' : 'Transform';
              return <React.Fragment key={p.key}>{section !== previousSection && <div className="flex h-6 border-b border-border/50 bg-muted/30" style={rowStyle}><div className="sticky left-0 z-30 flex shrink-0 items-center border-r border-border bg-muted/30 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ width: LABEL_WIDTH }}>{section}</div><div style={{ width: trackWidth }} /></div>}<div className="flex min-h-8 border-b border-border/50" style={rowStyle}>
                <div className="sticky left-0 z-30 shrink-0 border-r border-border bg-background text-xs text-muted-foreground" style={{ width: LABEL_WIDTH }}>
                  <div className="flex h-8 items-center gap-1 px-2"><button className="rounded p-1 hover:bg-accent hover:text-foreground" aria-label={`${propertyClosed ? 'Show' : 'Hide'} ${p.label} keyframes`} aria-expanded={!propertyClosed} onClick={() => setCollapsedProperties(current => propertyClosed ? current.filter(key => key !== `${clip.id}:${p.key}`) : [...current, `${clip.id}:${p.key}`])}>{propertyClosed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button><span className="flex-1 truncate">{p.label}</span>
                  <button aria-label={`${track.isVisible ? 'Hide' : 'Show'} ${track.name} track`} className="p-1 hover:text-foreground" onClick={() => state.updateTrack(track.id, { isVisible: !track.isVisible })}>{track.isVisible ? <Eye size={11} /> : <EyeOff size={11} />}</button>
                  <button aria-label={`${track.isLocked ? 'Unlock' : 'Lock'} ${track.name} track`} className="p-1 hover:text-foreground" onClick={() => state.updateTrack(track.id, { isLocked: !track.isLocked })}>{track.isLocked ? <Lock size={11} /> : <Unlock size={11} />}</button></div>
                  {!propertyClosed && selectedKey && <InlineKeyframeEditor track={track} keyframe={selectedKey} property={p.key} />}
                </div>
                <div className={`relative ${!track.isVisible ? 'opacity-40' : ''}`} style={{ width: trackWidth, minHeight: 32 }} onDoubleClick={e => { if (propertyClosed) return; const time = Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, (e.clientX - e.currentTarget.getBoundingClientRect().left) / pps * 1000)); const values = getInterpolatedProperties(tracks, time, state.animationBase); insertPropertyKey(clip, p.key, values[p.key], time); }}>
                  {!propertyClosed && <>{keys.length > 1 && <div className="absolute top-4 h-px bg-foreground/20" style={{ left: keys[0].time / 1000 * pps, width: (keys[keys.length - 1].time - keys[0].time) / 1000 * pps }} />}
                  {keys.map(k => <KeyDiamond key={k.id} clip={clip} track={track} keyframe={k} property={p.key} pps={pps} />)}</>}
                </div>
              </div></React.Fragment>;
            })}
            {!closed && tracks.some(t => t.keyframes.some(k => k.clipMask !== undefined)) && (() => {
              const maskTrack = tracks.find(t => t.keyframes.some(k => k.clipMask !== undefined))!;
              const selectedKey = selection.keyframe?.trackId === maskTrack.id && selection.keyframe.property === 'clipMask' ? maskTrack.keyframes.find(k => k.id === selection.keyframe?.keyframeId) : undefined;
              const propertyClosed = collapsedProperties.includes(`${clip.id}:clipMask`);
              return <div className="flex min-h-8 border-b border-border/50" style={rowStyle}>
                <div className="sticky left-0 z-30 shrink-0 border-r border-border bg-background text-xs text-muted-foreground" style={{ width: LABEL_WIDTH }}><div className="flex h-8 items-center gap-1 px-2"><button className="rounded p-1 hover:bg-accent hover:text-foreground" aria-label={`${propertyClosed ? 'Show' : 'Hide'} clip mask keyframes`} aria-expanded={!propertyClosed} onClick={() => setCollapsedProperties(current => propertyClosed ? current.filter(key => key !== `${clip.id}:clipMask`) : [...current, `${clip.id}:clipMask`])}>{propertyClosed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button><span className="flex-1 truncate">Clip mask</span><span className="text-[10px]">CSS</span></div>{!propertyClosed && selectedKey && <InlineKeyframeEditor track={maskTrack} keyframe={selectedKey} property="clipMask" />}</div>
                <div className="relative" style={{ width: trackWidth, minHeight: 32 }}>{!propertyClosed && maskTrack.keyframes.filter(k => k.clipMask !== undefined).sort((a, b) => a.time - b.time).map(k => <ClipMaskDiamond key={k.id} clip={clip} track={maskTrack} keyframe={k} pps={pps} />)}</div>
              </div>;
            })()}
          </React.Fragment>;
        })}
        {state.imageOverlays.filter(o => o.mediaType === 'video').map(o => <div key={o.id} className="flex h-8 border-b border-border" style={rowStyle}><div className="sticky left-0 z-30 shrink-0 border-r border-border bg-background px-3 py-2 text-xs" style={{ width: LABEL_WIDTH }}>Video layer</div><div className="relative" style={{ width: trackWidth }}><div className="absolute inset-y-1 rounded border border-border bg-accent px-2 text-xs leading-6" style={{ left: (o.startTime ?? 0) / 1000 * pps, width: Math.min(duration, ((o.mediaDuration ?? 0) - (o.trimStart ?? 0)) / (o.playbackRate ?? 1) * 1000) / 1000 * pps }}>Muted video · {timeLabel((o.mediaDuration ?? 0) * 1000)}</div></div></div>)}
        <div className="pointer-events-none absolute inset-y-7 z-20 w-px bg-primary" style={{ left: LABEL_WIDTH + state.timeline.playhead / 1000 * pps }}><span className="absolute -top-7 -translate-x-1/2 rounded bg-primary px-1 py-1 text-[10px] tabular-nums text-primary-foreground">{timeLabel(state.timeline.playhead)}</span></div>
        <div role="slider" tabIndex={0} aria-label="Playhead. Drag to seek" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={state.timeline.playhead} aria-valuetext={`${(state.timeline.playhead / 1000).toFixed(2)} seconds`} className="absolute top-0 z-50 h-7 w-5 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" style={{ left: LABEL_WIDTH + state.timeline.playhead / 1000 * pps }} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); state.stopPlayback(); state.setPlayhead(state.timeline.playhead + (e.key === 'ArrowRight' ? 1 : -1) * frameTime * (e.shiftKey ? 10 : 1)); } }} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); playheadDragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); state.stopPlayback(); selection.selectKeyframe(null); }} onPointerMove={e => { if (playheadDragging.current && e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e); }} onPointerUp={() => { playheadDragging.current = false; }} onPointerCancel={() => { playheadDragging.current = false; }}>
          <div className="absolute left-1/2 top-0 h-7 w-px -translate-x-1/2 bg-primary/70" />
          <div className="absolute left-1/2 top-0 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-b bg-primary text-primary-foreground shadow-sm" aria-hidden="true"><GripVertical className="h-3 w-3" /></div>
        </div>
      </div>
    </div>
  </section>;
}
