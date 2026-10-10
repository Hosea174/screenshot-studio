'use client';
import { Slider } from '@/components/ui/slider';
import type { ImageShadow } from '@/lib/store';

export const DEFAULT_MEDIA_SHADOW: ImageShadow = { enabled: true, blur: 32, spread: 0, opacity: 0.35, color: '#000000', offsetX: 0, offsetY: 16 };

export function ShadowAdjustments({ shadow, onChange }: { shadow: ImageShadow; onChange: (updates: Partial<ImageShadow>) => void }) {
  const distance = Math.hypot(shadow.offsetX ?? 0, shadow.offsetY ?? 0);
  const angle = distance ? Math.atan2(shadow.offsetY, shadow.offsetX) * 180 / Math.PI : 90;
  const direction = (degrees: number, length = distance) => onChange({ offsetX: Math.round(Math.cos(degrees * Math.PI / 180) * length), offsetY: Math.round(Math.sin(degrees * Math.PI / 180) * length) });
  return <div className="space-y-3 pt-3">
    <label className="flex items-center justify-between text-xs text-muted-foreground">Custom shadow<input type="checkbox" checked={shadow.enabled} onChange={e => onChange({ enabled: e.target.checked })} className="accent-primary" /></label>
    {shadow.enabled && <>
      <Slider label="Direction" min={-180} max={180} step={1} value={[angle]} valueDisplay={`${Math.round(angle)}°`} onValueChange={([v]) => direction(v, Math.max(1, distance))} />
      <Slider label="Distance" min={0} max={200} step={1} value={[distance]} valueDisplay={`${Math.round(distance)}px`} onValueChange={([v]) => direction(angle, v)} />
      <Slider label="Opacity" min={0} max={1} step={0.01} value={[shadow.opacity]} valueDisplay={`${Math.round(shadow.opacity * 100)}%`} onValueChange={([opacity]) => onChange({ opacity })} />
      <Slider label="Softness" min={0} max={150} step={1} value={[shadow.blur]} valueDisplay={`${shadow.blur}px`} onValueChange={([blur]) => onChange({ blur })} />
      <Slider label="Spread" min={0} max={80} step={1} value={[shadow.spread ?? 0]} valueDisplay={`${shadow.spread ?? 0}px`} onValueChange={([spread]) => onChange({ spread })} />
      <label className="flex items-center justify-between text-xs text-muted-foreground">Shadow color<input aria-label="Shadow color" type="color" value={shadow.color.startsWith('#') ? shadow.color : '#000000'} onChange={e => onChange({ color: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-border" /></label>
    </>}
  </div>;
}
