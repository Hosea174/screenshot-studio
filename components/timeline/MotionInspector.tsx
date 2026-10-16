'use client';
import * as React from 'react';
import { NumberField } from './NumberField';
import { formatNumber, roundToTwoDecimals } from '@/lib/number-format';
import { Diamond, Plus, Save, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useImageStore } from '@/lib/store';
import { useMotionSelection, useMotionLibrary, PROPERTY_CONTROLS, EASE_LABELS } from '@/lib/animation/editor';
import { applyEasing, getClipMaskAtTime } from '@/lib/animation/interpolation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';
import type { EasingFunction, AnimationTrack, AnimationClip } from '@/types/animation';
import { capturePose, motionPose, previewPose, insertPropertyKey } from '@/lib/animation/authoring';
import { beginMotionDrag } from '@/lib/animation/drag-history';

export function addCustomAnimation() {
  const state = useImageStore.getState();
  const target = state.selectedOverlayId ?? (state.uploadedImageUrl || state.mockups.length ? 'asset' : state.imageOverlays.find(o => o.isVisible)?.id ?? 'asset');
  const start = state.animationClips.filter(c => (c.target ?? 'asset') === target).reduce((end, c) => Math.max(end, c.startTime + c.duration), 0);
  state.addAnimationClip('custom-asset', start, target);
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

export { insertPropertyKey } from '@/lib/animation/authoring';

export function EaseCurve({ ease, onChange }: { ease: EasingFunction; onChange: (ease: EasingFunction) => void }) {
  const points = Array.from({ length: 51 }, (_, i) => `${i * 2},${46 - applyEasing(i / 50, ease) * 36}`).join(' ');
  const custom = ease.startsWith('cubic-bezier(');
  const [x1, y1, x2, y2] = custom ? ease.slice(13, -1).split(',').map(Number) : [.25, .1, .25, 1];
  const drag = React.useRef<{ point: 1 | 2; rect: DOMRect; finish: () => void } | null>(null);
  const setPoint = (point: 1 | 2, x: number, y: number) => onChange(point === 1 ? easeForGraph(x, y, x2, y2) : easeForGraph(x1, y1, x, y));
  const startDrag = (event: React.PointerEvent<SVGCircleElement>) => {
    const point = event.currentTarget.dataset.point === '1' ? 1 : 2;
    event.preventDefault();
    drag.current = { point, rect: event.currentTarget.ownerSVGElement!.getBoundingClientRect(), finish: beginMotionDrag() };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const changePoint = (event: React.PointerEvent<SVGCircleElement>) => {
    const d = drag.current; if (!d) return;
    const x = Math.max(0, Math.min(1, (event.clientX - d.rect.left) / d.rect.width));
    const y = Math.max(-1, Math.min(2, (46 - (event.clientY - d.rect.top) / d.rect.height * 56) / 36));
    setPoint(d.point, x, y);
  };
  const stopDrag = () => { drag.current?.finish(); drag.current = null; };
  return <svg viewBox="0 0 100 56" className="h-12 w-24 touch-none overflow-visible text-primary" aria-label={`${custom ? 'Custom' : EASE_LABELS[ease as keyof typeof EASE_LABELS]} easing curve`}>
    <path d="M0 46H100 M0 10H100 M25 46L25 10 M75 46L75 10" fill="none" stroke="currentColor" opacity="0.15" />
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
    {custom && ([1, 2] as const).map(point => {
      const x = point === 1 ? x1 : x2, y = point === 1 ? y1 : y2;
      return <g key={point}>
        <line x1={point === 1 ? 0 : 100} y1={point === 1 ? 46 : 10} x2={x * 100} y2={46 - y * 36} stroke="currentColor" opacity=".35" />
        <circle data-curve-control data-point={point} cx={x * 100} cy={46 - y * 36} r="12" fill="transparent" role="button" tabIndex={0} aria-label={`Curve control point ${point}. Arrow keys adjust`} className="cursor-grab focus-visible:outline-none focus-visible:stroke-current"
          onPointerDown={startDrag} onPointerMove={changePoint} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}
          onKeyDown={e => { if (!e.key.startsWith('Arrow')) return; e.preventDefault(); const step = e.shiftKey ? .1 : .01; setPoint(point, Math.max(0, Math.min(1, x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0))), Math.max(-1, Math.min(2, y + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0)))); }} />
        <circle cx={x * 100} cy={46 - y * 36} r="3.5" fill="currentColor" pointerEvents="none" />
      </g>;
    })}
  </svg>;
}

export function MotionInspector() {
  const state = useImageStore();
  const selection = useMotionSelection();
  const library = useMotionLibrary();
  const [name, setName] = React.useState('');
  const clip = state.animationClips.find(c => c.id === selection.clipId);
  const canEditPose = clip && state.showTimeline && !state.timeline.isPlaying && state.timeline.playhead >= clip.startTime && state.timeline.playhead <= clip.startTime + clip.duration;
  const tracks = state.timeline.tracks.filter(t => t.clipId === clip?.id);
  const selectedTrack = tracks.find(t => t.id === selection.keyframe?.trackId);
  const selectedKey = selectedTrack?.keyframes.find(k => k.id === selection.keyframe?.keyframeId);
  const time = selectedKey?.time ?? Math.max(clip?.startTime ?? 0, Math.min((clip?.startTime ?? 0) + (clip?.duration ?? 0), state.timeline.playhead));
  const values = clip ? motionPose(clip, time, selection.draft, state) : DEFAULT_ANIMATABLE_PROPERTIES;
  const ease = selectedKey?.easing ?? tracks[0]?.keyframes[1]?.easing ?? 'ease-in-out-cubic';
  const button = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border px-2 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';
  const input = 'h-8 min-w-0 rounded-md border border-border bg-background px-2 text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const changeEase = (easing: EasingFunction) => {
    if (selectedKey && selectedTrack) { if (!selectedTrack.isLocked) state.updateKeyframe(selectedTrack.id, selectedKey.id, { easing }); return; }
    const finish = beginMotionDrag();
    try { for (const track of tracks.filter(t => !t.isLocked)) state.updateTrack(track.id, { keyframes: track.keyframes.map(k => ({ ...k, easing })) }); } finally { finish(); }
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
        <button className={button} onClick={() => { state.stopPlayback(); selection.selectKeyframe(null); state.setPlayhead(clip.startTime); }}><ChevronLeft size={12} />Start</button>
        <span className="text-xs tabular-nums">{((time - clip.startTime) / 1000).toFixed(2)}s</span>
        <button className={button} onClick={() => { state.stopPlayback(); selection.selectKeyframe(null); state.setPlayhead(clip.startTime + clip.duration); }}>End<ChevronRight size={12} /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">Start (s)<input aria-label="Clip start seconds" type="number" min="0" step="0.01" className={`${input} w-full`} value={Number((clip.startTime / 1000).toFixed(2))} onChange={e => { if (e.target.value) state.updateAnimationClip(clip.id, { startTime: roundToTwoDecimals(+e.target.value) * 1000 }); }} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Duration (s)<input aria-label="Clip duration seconds" type="number" min="0.2" step="0.01" className={`${input} w-full`} value={Number((clip.duration / 1000).toFixed(2))} onChange={e => { if (e.target.value) state.updateAnimationClip(clip.id, { duration: roundToTwoDecimals(+e.target.value) * 1000 }); }} /></label>
      </div>
      <div className="space-y-2 border-y border-border py-3"><button className={`${button} w-full bg-primary text-primary-foreground hover:bg-primary/90`} disabled={!canEditPose} onClick={capturePose}><Diamond size={14} />Set keyframe at {(state.timeline.playhead / 1000).toFixed(2)}s</button><p className="text-xs leading-relaxed text-muted-foreground">Move the playhead, adjust your layer on the canvas, then set a keyframe.</p></div>
      <div className="space-y-2">
        {PROPERTY_CONTROLS.filter(p => p.group === 'asset').map(p => {
          const track = tracks.find(t => t.keyframes.some(k => p.key in k.properties));
          const atKey = track?.keyframes.some(k => Math.abs(k.time - time) < 1 && p.key in k.properties);
          return <div key={p.key} className="grid grid-cols-[1fr_78px_30px] items-center gap-2">
            <label htmlFor={`motion-${p.key}`} className="text-xs text-muted-foreground">{p.label}</label>
            <NumberField id={`motion-${p.key}`} aria-label={`${p.label} keyframe value`} min={p.min} max={p.max} step={p.step} disabled={track?.isLocked || !canEditPose} className={input} value={values[p.key]} onValueChange={value => previewPose(clip.target ?? 'asset', { [p.key]: value })} />
            <button className={`${button} px-0 ${atKey ? 'bg-primary/15 text-primary' : ''}`} disabled={track?.isLocked} title={`Set ${p.label} keyframe at playhead`} aria-label={`Set ${p.label} keyframe`} onClick={() => insertPropertyKey(clip, p.key, values[p.key], time, ease)}><Diamond size={12} fill={atKey ? 'currentColor' : 'none'} /></button>
          </div>;
        })}
      </div>
      <details className="space-y-2 border-t border-border pt-3"><summary className="cursor-pointer text-xs font-medium">Clip mask</summary>
        <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Reveal shape</span><button className={button} onClick={() => updateMask(maskDraft)}><Diamond size={12} />Add keyframe</button></div>
        <label className="block space-y-1 text-xs text-muted-foreground">Preset<select aria-label="Clip mask preset" className={`${input} w-full`} value={CLIP_MASK_PRESETS.some(p => p.value === maskDraft) ? maskDraft : '__custom__'} onChange={e => { if (e.target.value !== '__custom__') { setMaskDraft(e.target.value); updateMask(e.target.value); } }}><option value="__custom__">Custom CSS clip-path</option>{CLIP_MASK_PRESETS.map(p => <option key={p.name} value={p.value}>{p.name}</option>)}</select></label>
        <label className="block space-y-1 text-xs text-muted-foreground">CSS clip-path<textarea aria-label="Custom clip mask code" spellCheck={false} className={`${input} h-16 w-full resize-y font-mono`} value={maskDraft} onChange={e => setMaskDraft(e.target.value)} onBlur={() => { if (maskDraft !== mask) updateMask(maskDraft); }} placeholder="polygon(0 0, 100% 0, 100% 100%, 0 100%)" /></label>
        <p className="text-[11px] text-muted-foreground">Matching shapes interpolate between keys. Use the same CSS clip-path shape for smooth motion.</p>
      </details>
      <div className="flex items-center gap-2"><div className="min-w-0 flex-1"><label htmlFor="motion-easing" className="mb-1 block text-xs text-muted-foreground">{selectedKey ? 'Ease into selected keyframe' : 'Ease for all segments'}</label><select id="motion-easing" className={`${input} w-full`} value={EASE_LABELS[ease as keyof typeof EASE_LABELS] ? ease : '__custom__'} onChange={e => changeEase(e.target.value === '__custom__' ? easeForGraph(0.25, 0.1, 0.25, 1) : e.target.value as EasingFunction)}>{Object.entries(EASE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}<option value="__custom__">Custom graph</option></select></div><EaseCurve ease={ease} onChange={changeEase} /></div>
      {selectedKey && <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">Keyframe time (s)<input aria-label="Selected keyframe time seconds" className={`${input} w-24`} type="number" min={clip.startTime / 1000} max={(clip.startTime + clip.duration) / 1000} step="0.01" value={Number((selectedKey.time / 1000).toFixed(2))} onChange={e => { if (!e.target.value || !selectedTrack || selectedTrack.isLocked) return; const seconds = roundToTwoDecimals(+e.target.value); const t = Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, seconds * 1000)); state.updateKeyframe(selectedTrack.id, selectedKey.id, { time: t }); state.setPlayhead(t); }} /></label>}
      <div className="space-y-2 border-t border-border pt-3">
        <label className="block text-xs text-muted-foreground" htmlFor="motion-transition">Transition from previous animation</label>
        <select id="motion-transition" className={`${input} w-full`} value={clip.transition?.type ?? 'none'} onChange={e => state.updateAnimationClip(clip.id, { transition: e.target.value === 'none' ? undefined : { type: e.target.value as NonNullable<AnimationClip['transition']>['type'], duration: Math.min(400, clip.duration), easing: 'ease-in-out-cubic' } })}><option value="none">Cut</option><option value="blend">Smooth blend</option><option value="fade">Fade through transparent</option><option value="slide">Slide</option><option value="zoom">Zoom</option></select>
        {clip.transition && <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">Transition (s)<input aria-label="Transition duration seconds" className={`${input} w-24`} type="number" min="0.05" max={clip.duration / 1000} step="0.01" value={formatNumber(clip.transition.duration / 1000)} onChange={e => state.updateAnimationClip(clip.id, { transition: { ...clip.transition!, duration: Math.max(50, Math.min(clip.duration, roundToTwoDecimals(+e.target.value) * 1000)) } })} /></label>}
      </div>
      <div className="flex gap-2"><input aria-label="Custom preset name" placeholder="Preset name" className={`${input} flex-1`} value={name} onChange={e => setName(e.target.value)} /><button aria-label="Save custom preset" className={button} onClick={() => {
        const cloned: AnimationTrack[] = tracks.map(t => ({ ...t, clipId: undefined, originalDuration: clip.duration, isLocked: false, keyframes: t.keyframes.map(k => ({ ...k, properties: { ...k.properties }, time: k.time - clip.startTime })) }));
        library.save({ id: `saved-${crypto.randomUUID()}`, name: name.trim() || clip.name, description: 'Saved custom motion', category: 'effects', duration: clip.duration, tracks: cloned, transition: clip.transition ? { ...clip.transition } : undefined }); setName(''); toast.success('Animation saved to My presets');
      }}><Save size={14} />Save</button></div>
      <p className="text-xs leading-relaxed text-muted-foreground">Values preview your pose. Set a keyframe to keep it. Space: play / K: set keyframe / arrows: step / Delete: remove selection.</p>
    </>}
  </div>;
}
