'use client';
import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useImageStore } from '@/lib/store';
import { ANIMATION_PRESETS, CATEGORY_LABELS } from '@/lib/animation/presets';
import { getInterpolatedProperties } from '@/lib/animation/interpolation';
import { useMotionLibrary } from '@/lib/animation/editor';
import { DEFAULT_ANIMATABLE_PROPERTIES, type AnimationPreset } from '@/types/animation';
import { getBackgroundCSS } from '@/lib/constants/backgrounds';
import { MotionInspector } from './MotionInspector';

export function MotionPresetPreview({ preset, image }: { preset: AnimationPreset; image: string | null }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const raf = React.useRef(0);
  const [active, setActive] = React.useState(false);
  React.useEffect(() => {
    const draw = (time: number) => {
      const el = ref.current; if (!el) return;
      const p = getInterpolatedProperties(preset.tracks, time, DEFAULT_ANIMATABLE_PROPERTIES);
      el.style.transform = `perspective(${p.perspective / 8}px) translate(${p.translateX}%, ${p.translateY}%) translate(${-p.cameraX / 8}px, ${-p.cameraY / 8}px) rotateX(${p.rotateX - p.cameraRotateX}deg) rotateY(${p.rotateY - p.cameraRotateY}deg) rotateZ(${p.rotateZ - p.cameraRotateZ}deg) scale(${Math.max(0.01, p.scale * p.cameraZoom)})`;
      el.style.opacity = String(Math.max(0, Math.min(1, p.imageOpacity)));
    };
    draw(0);
    if (!active) return;
    const start = performance.now();
    const tick = (now: number) => { draw((now - start) % (preset.duration + 500)); raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [active, preset]);
  return <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded" onPointerEnter={() => setActive(true)} onPointerLeave={() => setActive(false)} onFocusCapture={() => setActive(true)} onBlurCapture={() => setActive(false)}>
    <div ref={ref} className="h-3/4 w-3/4">{image ? <img src={image} alt="" draggable={false} className="h-full w-full rounded object-contain" /> : <div className="flex h-full w-full items-center justify-center rounded border border-foreground/20 bg-background text-xs text-muted-foreground">Preview</div>}</div>
  </div>;
}

export function AnimationPresetGallery() {
  const state = useImageStore();
  const library = useMotionLibrary();
  const groups = ANIMATION_PRESETS.reduce((acc, preset) => { (acc[preset.category] ??= []).push(preset); return acc; }, {} as Record<string, AnimationPreset[]>);
  const add = (preset: AnimationPreset) => {
    const end = state.animationClips.reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0);
    state.addAnimationClip(preset.id, end, state.selectedOverlayId ?? 'asset'); state.stopPlayback(); state.setPlayhead(end);
  };
  const card = (preset: AnimationPreset, saved = false) => <div key={preset.id} className="group relative">
    <button type="button" onClick={() => add(preset)} className="w-full rounded-md border border-border p-1 text-left hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={`${preset.description}. Hover to preview; click to add.`}>
      <div style={getBackgroundCSS(state.backgroundConfig, 200)}><MotionPresetPreview preset={preset} image={state.imageOverlays.find(o => o.id === state.selectedOverlayId)?.poster ?? state.imageOverlays.find(o => o.id === state.selectedOverlayId)?.src ?? state.uploadedImageUrl} /></div>
      <div className="flex items-center justify-between gap-1 px-1 py-2"><span className="truncate text-xs font-medium">{preset.name}</span><span className="text-[10px] tabular-nums text-muted-foreground">{preset.duration / 1000}s</span></div>
    </button>
    {saved && <button aria-label={`Delete ${preset.name} saved preset`} onClick={() => library.remove(preset.id)} className="absolute right-2 top-2 rounded bg-background p-1 text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button>}
  </div>;
  return <div className="space-y-5">
    <MotionInspector />
    {library.presets.length > 0 && <div className="space-y-2"><h3 className="text-xs font-medium">My presets</h3><div className="grid grid-cols-2 gap-2">{library.presets.map(p => card(p, true))}</div></div>}
    <div className="flex items-center justify-between"><h3 className="text-sm font-medium">Motion presets</h3><span className="text-[10px] text-muted-foreground">Hover to preview</span></div>
    {Object.entries(groups).map(([category, presets]) => <details key={category} open={category === 'reveal'} className="border-b border-border pb-3"><summary className="cursor-pointer text-xs font-medium text-muted-foreground">{CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]}</summary><div className="mt-3 grid grid-cols-2 gap-2">{presets.map(p => card(p))}</div></details>)}
    <button type="button" className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent" onClick={() => state.setShowTimeline(true)}><Plus size={13} />Open timeline</button>
  </div>;
}
