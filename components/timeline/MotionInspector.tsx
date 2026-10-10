'use client';
import * as React from 'react';
import { Diamond, Plus, Camera, Save, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useImageStore } from '@/lib/store';
import { useMotionSelection, useMotionLibrary, PROPERTY_CONTROLS, EASE_LABELS } from '@/lib/animation/editor';
import { getInterpolatedProperties, applyEasing } from '@/lib/animation/interpolation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';
import type { AnimatableProperties, EasingFunction, AnimationTrack, AnimationClip } from '@/types/animation';

export function addCustomAnimation(group: 'asset' | 'camera') {
  const state = useImageStore.getState();
  const start = state.animationClips.reduce((end, c) => Math.max(end, c.startTime + c.duration), 0);
  state.addAnimationClip(`custom-${group}`, start, group === 'asset' ? state.selectedOverlayId ?? 'asset' : 'asset');
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
    const properties = { ...key.properties }; delete properties[property];
    state.updateTrack(trackId, { keyframes: track.keyframes.flatMap(k => k.id !== keyframeId ? [k] : Object.keys(properties).length ? [{ ...k, properties }] : []) });
    selection.selectKeyframe(null);
  } else if (selection.clipId) state.removeAnimationClip(selection.clipId);
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

function EaseCurve({ ease }: { ease: EasingFunction }) {
  const points = Array.from({ length: 51 }, (_, i) => `${i * 2},${46 - applyEasing(i / 50, ease) * 36}`).join(' ');
  return <svg viewBox="0 0 100 56" className="h-12 w-24 text-primary" aria-label={`${EASE_LABELS[ease]} easing curve`}><path d="M0 46H100 M0 10H100" fill="none" stroke="currentColor" opacity="0.15" /><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}

export function MotionInspector() {
  const state = useImageStore();
  const selection = useMotionSelection();
  const library = useMotionLibrary();
  const [group, setGroup] = React.useState<'asset' | 'camera'>('asset');
  const [name, setName] = React.useState('');
  const clip = state.animationClips.find(c => c.id === selection.clipId);
  const tracks = state.timeline.tracks.filter(t => t.clipId === clip?.id);
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
  return <div className="space-y-4 border-b border-border pb-4">
    <div className="grid grid-cols-2 gap-2">
      <button aria-label="Create custom animation" className={button} onClick={() => addCustomAnimation('asset')}><Plus size={14} />Custom</button>
      <button className={button} onClick={() => { setGroup('camera'); addCustomAnimation('camera'); }}><Camera size={14} />Camera</button>
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
      <div className="flex gap-1 rounded-md bg-muted p-1" role="group" aria-label="Animated target">{(['asset', 'camera'] as const).map(target => <button key={target} aria-pressed={group === target} className={`h-7 flex-1 rounded text-xs ${group === target ? 'bg-background text-foreground' : 'text-muted-foreground'}`} onClick={() => setGroup(target)}>{target === 'asset' ? 'Asset' : 'Camera'}</button>)}</div>
      <div className="space-y-2">
        {PROPERTY_CONTROLS.filter(p => p.group === group).map(p => {
          const track = tracks.find(t => t.keyframes.some(k => p.key in k.properties));
          const atKey = track?.keyframes.some(k => Math.abs(k.time - time) < 1 && p.key in k.properties);
          return <div key={p.key} className="grid grid-cols-[1fr_78px_30px] items-center gap-2">
            <label htmlFor={`motion-${p.key}`} className="text-xs text-muted-foreground">{p.label}</label>
            <input id={`motion-${p.key}`} aria-label={`${p.label} keyframe value`} type="number" min={p.min} max={p.max} step={p.step} disabled={track?.isLocked} className={input} value={Number(values[p.key].toFixed(3))} onChange={e => { if (e.target.value !== '' && Number.isFinite(+e.target.value)) insertPropertyKey(clip, p.key, Math.max(p.min, Math.min(p.max, +e.target.value)), time, ease); }} />
            <button className={`${button} px-0 ${atKey ? 'bg-primary/15 text-primary' : ''}`} disabled={track?.isLocked} title={`Set ${p.label} keyframe at playhead`} aria-label={`Set ${p.label} keyframe`} onClick={() => insertPropertyKey(clip, p.key, values[p.key], time, ease)}><Diamond size={12} fill={atKey ? 'currentColor' : 'none'} /></button>
          </div>;
        })}
      </div>
      <div className="flex items-center gap-2"><div className="min-w-0 flex-1"><label htmlFor="motion-easing" className="mb-1 block text-xs text-muted-foreground">{selectedKey ? 'Ease into selected keyframe' : 'Ease for all segments'}</label><select id="motion-easing" className={`${input} w-full`} value={ease} onChange={e => changeEase(e.target.value as EasingFunction)}>{Object.entries(EASE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div><EaseCurve ease={ease} /></div>
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
