'use client';
import * as React from 'react';
import { Diamond, Plus, Save, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useImageStore } from '@/lib/store';
import { useMotionSelection, useMotionLibrary, PROPERTY_CONTROLS, EASE_LABELS } from '@/lib/animation/editor';
import { getInterpolatedProperties, applyEasing, getClipMaskAtTime } from '@/lib/animation/interpolation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';
import type { AnimatableProperties, EasingFunction, AnimationTrack, AnimationClip } from '@/types/animation';
import { beginMotionDrag } from '@/lib/animation/drag-history';

export function addCustomAnimation() {
  const state = useImageStore.getState();
  const start = state.animationClips.reduce((end, c) => Math.max(end, c.startTime + c.duration), 0);
  state.addAnimationClip('custom-asset', start, state.selectedOverlayId ?? 'asset');
  state.stopPlayback(); state.setPlayhead(start); state.setActiveRightPanelTab('animate');
}

export function deleteSelectedMotion() {
  const selection = useMotionSelection.getState();
  const state = useImageStore.getState();
  if (selection.keyframe) {
    const { trackId, keyframeId, property } = selection.keyframe;
    const track = state.timeline.tracks.find(t => t.id === trackId);
    if (!track || track.isLocked) return;
    const key = track.keyframes.find(k => k.id === keyframeId);
    if (!key) return;
    const properties = { ...key.properties };
    const clipMask = property === 'clipMask' ? undefined : key.clipMask;
    if (property !== 'clipMask') delete properties[property];
    state.updateTrack(trackId, { keyframes: track.keyframes.flatMap(k => k.id !== keyframeId ? [k] : Object.keys(properties).length || clipMask !== undefined ? [{ ...k, properties, clipMask }] : []) });
    selection.selectKeyframe(null);
  } else if (selection.clipId) state.removeAnimationClip(selection.clipId);
}

export const CLIP_MASK_PRESETS = [
  { name: 'None', value: '' },
  { name: 'Inset', value: 'inset(12% 12% 12% 12% round 8px)' },
  { name: 'Circle', value: 'circle(50% at 50% 50%)' },
  { name: 'Diamond', value: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' },
  { name: 'Wipe left', value: 'inset(0 0 0 50%)' },
  { name: 'Wipe right', value: 'inset(0 50% 0 0)' },
] as const;

export function setClipMaskKey(clip: AnimationClip, time: number, value: string) {
  const state = useImageStore.getState();
  const at = Math.round(Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, time)));
  let track = state.timeline.tracks.find(t => t.clipId === clip.id && (t.name === 'Clip mask' || t.keyframes.some(k => k.clipMask !== undefined)));
  if (!track) {
    state.addTrack({ name: 'Clip mask', type: 'transform', clipId: clip.id, isLocked: false, isVisible: true, keyframes: [] });
    track = useImageStore.getState().timeline.tracks.find(t => t.clipId === clip.id && t.name === 'Clip mask');
  }
  if (!track || track.isLocked) return;
  const existing = track.keyframes.find(k => Math.abs(k.time - at) < 1);
  if (existing) state.updateTrack(track.id, { keyframes: track.keyframes.map(k => k.id === existing.id ? { ...k, clipMask: value } : k) });
  else state.addKeyframe(track.id, { time: at, properties: {}, clipMask: value, easing: 'ease-in-out-cubic' });
  state.stopPlayback();
  state.setPlayhead(at);
}

function easeForGraph(x1: number, y1: number, x2: number, y2: number): EasingFunction {
  return `cubic-bezier(${Number(x1.toFixed(2))},${Number(y1.toFixed(2))},${Number(x2.toFixed(2))},${Number(y2.toFixed(2))})`;
}

export function insertPropertyKey(clip: AnimationClip, property: keyof AnimatableProperties, value: number, time: number, easing: EasingFunction = 'ease-in-out-cubic') {
  const state = useImageStore.getState();
  const at = Math.round(Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, time)));
  const track = state.timeline.tracks.find(t => t.clipId === clip.id && t.keyframes.some(k => property in k.properties));
  if (track?.isLocked) return;
  if (track) {
    const key = track.keyframes.find(k => Math.abs(k.time - at) < 1);
    if (key) state.updateKeyframe(track.id, key.id, { properties: { [property]: value } });
    else state.addKeyframe(track.id, { time: at, properties: { [property]: value }, easing });
  } else {
    const control = PROPERTY_CONTROLS.find(p => p.key === property)!;
    const base = (clip.target && clip.target !== 'asset' ? DEFAULT_ANIMATABLE_PROPERTIES : state.animationBase)[property];
    const keys = [{ id: crypto.randomUUID(), time: clip.startTime, properties: { [property]: base }, easing }, { id: crypto.randomUUID(), time: clip.startTime + clip.duration, properties: { [property]: base }, easing }];
    const existing = keys.find(k => k.time === at);
    if (existing) existing.properties = { [property]: value };
    else keys.push({ id: crypto.randomUUID(), time: at, properties: { [property]: value }, easing });
    state.addTrack({ name: control.label, type: control.group === 'camera' ? 'camera' : 'transform', clipId: clip.id, isLocked: false, isVisible: true, keyframes: keys });
  }
  state.stopPlayback(); state.setPlayhead(at);
}

export function EaseCurve({ ease, onChange }: { ease: EasingFunction; onChange: (ease: EasingFunction) => void }) {
  const points = Array.from({ length: 51 }, (_, i) => `${i * 2},${46 - applyEasing(i / 50, ease) * 36}`).join(' ');
  const custom = ease.startsWith('cubic-bezier(');
  const values = custom ? ease.slice(13, -1).split(',').map(Number) : [0.25, 0.1, 0.25, 1];
  const [x1, y1, x2, y2] = values;
  const drag = React.useRef<{ point: 1 | 2; rect: DOMRect; finish: () => void } | null>(null);
  const changePoint = (event: React.PointerEvent<SVGCircleElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = Math.max(0, Math.min(1, (event.clientX - d.rect.left) / d.rect.width));
    const y = Math.max(-1, Math.min(2, 1 - (event.clientY - d.rect.top) / d.rect.height));
    const next = d.point === 1 ? easeForGraph(x, y, x2, y2) : easeForGraph(x1, y1, x, y);
    onChange(next);
  };
  const stopDrag = () => { drag.current?.finish(); drag.current = null; };
  return <svg viewBox="0 0 100 56" className="h-12 w-24 touch-none overflow-visible text-primary" aria-label={`${custom ? 'Custom' : EASE_LABELS[ease as keyof typeof EASE_LABELS]} easing curve`}><path d="M0 46H100 M0 10H100 M25 46L25 10 M75 46L75 10" fill="none" stroke="currentColor" opacity="0.15" /><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />{custom && <><circle cx={x1 * 100} cy={46 - y1 * 36} r="3.5" fill="currentColor" className="cursor-grab" onPointerDown={e => { drag.current = { point: 1, rect: e.currentTarget.ownerSVGElement!.getBoundingClientRect(), finish: beginMotionDrag() }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={changePoint} onPointerUp={stopDrag} onPointerCancel={stopDrag} /><circle cx={x2 * 100} cy={46 - y2 * 36} r="3.5" fill="currentColor" className="cursor-grab" onPointerDown={e => { drag.current = { point: 2, rect: e.currentTarget.ownerSVGElement!.getBoundingClientRect(), finish: beginMotionDrag() }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={changePoint} onPointerUp={stopDrag} onPointerCancel={stopDrag} /></>}</svg>;
}

export function MotionInspector() {
  const state = useImageStore();
  const selection = useMotionSelection();
  const library = useMotionLibrary();
  const [name, setName] = React.useState('');
  const clip = state.animationClips.find(c => c.id === selection.clipId);
  const tracks = state.timeline.tracks.filter(t => t.clipId === clip?.id);
  const layerTarget = !!clip?.target && clip.target !== 'asset';
  const selectedTrack = tracks.find(t => t.id === selection.keyframe?.trackId);
  const selectedKey = selectedTrack?.keyframes.find(k => k.id === selection.keyframe?.keyframeId);
  const time = selectedKey?.time ?? Math.max(clip?.startTime ?? 0, Math.min((clip?.startTime ?? 0) + (clip?.duration ?? 0), state.timeline.playhead));
  const values = getInterpolatedProperties(tracks, time, clip?.target && clip.target !== 'asset' ? DEFAULT_ANIMATABLE_PROPERTIES : state.animationBase);
  const ease = selectedKey?.easing ?? tracks[0]?.keyframes[1]?.easing ?? 'ease-in-out-cubic';
  const button = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border px-2 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';
  const input = 'h-8 min-w-0 rounded-md border border-border bg-background px-2 text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const changeEase = (easing: EasingFunction) => {
    if (selectedKey && selectedTrack && !selectedTrack.isLocked) state.updateKeyframe(selectedTrack.id, selectedKey.id, { easing });
    else for (const track of tracks.filter(t => !t.isLocked)) state.updateTrack(track.id, { keyframes: track.keyframes.map(k => ({ ...k, easing })) });
  };
  const maskTrack = tracks.find(t => t.keyframes.some(k => k.clipMask !== undefined));
  const maskKey = selectedKey?.clipMask !== undefined ? selectedKey : maskTrack?.keyframes.filter(k => k.time <= time).sort((a, b) => b.time - a.time)[0];
  const mask = maskKey?.clipMask ?? getClipMaskAtTime(state.animationClips, state.timeline.tracks, time, clip?.target ?? 'asset') ?? '';
  const [maskDraft, setMaskDraft] = React.useState(mask);
  React.useEffect(() => setMaskDraft(mask), [mask]);
  const updateMask = (value: string) => {
    if (clip && value.length < 1000 && (typeof CSS === 'undefined' || CSS.supports('clip-path', value) || value === '')) setClipMaskKey(clip, time, value);
    else toast.error('Enter a valid CSS clip-path value');
  };
  return <div className="space-y-4 border-b border-border pb-4">
    <div className="grid grid-cols-2 gap-2">
      <button aria-label="Create custom animation" className={button} onClick={() => addCustomAnimation()}><Plus size={14} />Custom</button>
    </div>
    {!clip ? <p className="text-xs leading-relaxed text-muted-foreground">Create a motion or select a timeline clip to edit its keyframes. Presets are fully editable.</p> : <>
      <div className="flex items-center gap-2"><input aria-label="Animation name" className={`${input} flex-1 font-medium`} value={clip.name} onChange={e => state.updateAnimationClip(clip.id, { name: e.target.value })} /><button className={button} aria-label="Delete selected animation or keyframe" onClick={deleteSelectedMotion}><Trash2 size={14} /></button></div>
      <label className="block space-y-1 text-xs text-muted-foreground">Animation target<select aria-label="Animation target" className={`${input} w-full`} value={clip.target ?? 'asset'} onChange={e => state.updateAnimationClip(clip.id, { target: e.target.value })}><option value="asset">Main asset / mockup</option>{state.imageOverlays.filter(o => o.isCustom).map((o, index) => <option key={o.id} value={o.id}>{o.mediaType === 'video' ? 'Video' : 'Image'} layer {index + 1}</option>)}</select></label>
      <div className="flex items-center justify-between gap-1">
        <button className={button} onClick={() => { state.stopPlayback(); selection.selectKeyframe(null); state.setPlayhead(clip.startTime); }}><ChevronLeft size={12} />Before</button>
        <span className="text-xs tabular-nums">{((time - clip.startTime) / 1000).toFixed(2)}s</span>
        <button className={button} onClick={() => { state.stopPlayback(); selection.selectKeyframe(null); state.setPlayhead(clip.startTime + clip.duration); }}>After<ChevronRight size={12} /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">Start (s)<input aria-label="Clip start seconds" type="number" min="0" step="0.1" className={`${input} w-full`} value={Number((clip.startTime / 1000).toFixed(2))} onChange={e => { if (e.target.value) state.updateAnimationClip(clip.id, { startTime: +e.target.value * 1000 }); }} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Duration (s)<input aria-label="Clip duration seconds" type="number" min="0.2" step="0.1" className={`${input} w-full`} value={Number((clip.duration / 1000).toFixed(2))} onChange={e => { if (e.target.value) state.updateAnimationClip(clip.id, { duration: +e.target.value * 1000 }); }} /></label>
      </div>
      <div className="space-y-2">
        {PROPERTY_CONTROLS.filter(p => p.group === 'asset').map(p => {
          const track = tracks.find(t => t.keyframes.some(k => p.key in k.properties));
          const atKey = track?.keyframes.some(k => Math.abs(k.time - time) < 1 && p.key in k.properties);
          return <div key={p.key} className="grid grid-cols-[1fr_78px_30px] items-center gap-2">
            <label htmlFor={`motion-${p.key}`} className="text-xs text-muted-foreground">{p.label}</label>
            <input id={`motion-${p.key}`} aria-label={`${p.label} keyframe value`} type="number" min={p.min} max={p.max} step={p.step} disabled={track?.isLocked} className={input} value={Number(values[p.key].toFixed(3))} onChange={e => { if (e.target.value !== '' && Number.isFinite(+e.target.value)) insertPropertyKey(clip, p.key, Math.max(p.min, Math.min(p.max, +e.target.value)), time, ease); }} />
            <button className={`${button} px-0 ${atKey ? 'bg-primary/15 text-primary' : ''}`} disabled={track?.isLocked} title={`Set ${p.label} keyframe at playhead`} aria-label={`Set ${p.label} keyframe`} onClick={() => insertPropertyKey(clip, p.key, values[p.key], time, ease)}><Diamond size={12} fill={atKey ? 'currentColor' : 'none'} /></button>
          </div>;
        })}
      </div>
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between"><span className="text-xs font-medium">Clip mask</span><button className={button} onClick={() => updateMask(maskDraft)}><Diamond size={12} />Add keyframe</button></div>
        <label className="block space-y-1 text-xs text-muted-foreground">Preset<select aria-label="Clip mask preset" className={`${input} w-full`} value={CLIP_MASK_PRESETS.some(p => p.value === maskDraft) ? maskDraft : '__custom__'} onChange={e => { if (e.target.value !== '__custom__') { setMaskDraft(e.target.value); updateMask(e.target.value); } }}><option value="__custom__">Custom CSS clip-path</option>{CLIP_MASK_PRESETS.map(p => <option key={p.name} value={p.value}>{p.name}</option>)}</select></label>
        <label className="block space-y-1 text-xs text-muted-foreground">CSS clip-path<textarea aria-label="Custom clip mask code" spellCheck={false} className={`${input} h-16 w-full resize-y font-mono`} value={maskDraft} onChange={e => setMaskDraft(e.target.value)} onBlur={() => { if (maskDraft !== mask) updateMask(maskDraft); }} placeholder="polygon(0 0, 100% 0, 100% 100%, 0 100%)" /></label>
        <p className="text-[11px] text-muted-foreground">Matching shapes interpolate between keys. Use the same CSS clip-path shape for smooth motion.</p>
      </div>
      <div className="flex items-center gap-2"><div className="min-w-0 flex-1"><label htmlFor="motion-easing" className="mb-1 block text-xs text-muted-foreground">{selectedKey ? 'Ease into selected keyframe' : 'Ease for all segments'}</label><select id="motion-easing" className={`${input} w-full`} value={EASE_LABELS[ease as keyof typeof EASE_LABELS] ? ease : '__custom__'} onChange={e => changeEase(e.target.value === '__custom__' ? easeForGraph(0.25, 0.1, 0.25, 1) : e.target.value as EasingFunction)}>{Object.entries(EASE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}<option value="__custom__">Custom graph</option></select></div><EaseCurve ease={ease} onChange={changeEase} /></div>
      {selectedKey && <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">Keyframe time (s)<input aria-label="Selected keyframe time seconds" className={`${input} w-24`} type="number" min={clip.startTime / 1000} max={(clip.startTime + clip.duration) / 1000} step="0.01" value={Number((selectedKey.time / 1000).toFixed(3))} onChange={e => { if (!e.target.value || !selectedTrack || selectedTrack.isLocked) return; const t = Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, +e.target.value * 1000)); state.updateKeyframe(selectedTrack.id, selectedKey.id, { time: t }); state.setPlayhead(t); }} /></label>}
      <div className="space-y-2 border-t border-border pt-3">
        <label className="block text-xs text-muted-foreground" htmlFor="motion-transition">Transition from previous animation</label>
        <select id="motion-transition" className={`${input} w-full`} value={clip.transition?.type ?? 'none'} onChange={e => state.updateAnimationClip(clip.id, { transition: e.target.value === 'none' ? undefined : { type: e.target.value as NonNullable<AnimationClip['transition']>['type'], duration: Math.min(400, clip.duration), easing: 'ease-in-out-cubic' } })}><option value="none">Cut</option><option value="blend">Smooth blend</option><option value="fade">Fade through transparent</option><option value="slide">Slide</option><option value="zoom">Zoom</option></select>
        {clip.transition && <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">Transition (s)<input aria-label="Transition duration seconds" className={`${input} w-24`} type="number" min="0.05" max={clip.duration / 1000} step="0.05" value={clip.transition.duration / 1000} onChange={e => state.updateAnimationClip(clip.id, { transition: { ...clip.transition!, duration: Math.max(50, Math.min(clip.duration, +e.target.value * 1000)) } })} /></label>}
      </div>
      <div className="flex gap-2"><input aria-label="Custom preset name" placeholder="Preset name" className={`${input} flex-1`} value={name} onChange={e => setName(e.target.value)} /><button aria-label="Save custom preset" className={button} onClick={() => {
        const cloned: AnimationTrack[] = tracks.map(t => ({ ...t, clipId: undefined, originalDuration: clip.duration, isLocked: false, keyframes: t.keyframes.map(k => ({ ...k, properties: { ...k.properties }, time: k.time - clip.startTime })) }));
        library.save({ id: `saved-${crypto.randomUUID()}`, name: name.trim() || clip.name, description: 'Saved custom motion', category: 'effects', duration: clip.duration, tracks: cloned, transition: clip.transition ? { ...clip.transition } : undefined }); setName(''); toast.success('Animation saved to My presets');
      }}><Save size={14} />Save</button></div>
      <p className="text-xs leading-relaxed text-muted-foreground">Changing a value sets a keyframe at the playhead. Drag diamonds to retime. Space: play · K: capture state · arrows: step · Delete: remove selection.</p>
    </>}
  </div>;
}
