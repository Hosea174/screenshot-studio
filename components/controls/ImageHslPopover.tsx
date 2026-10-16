'use client';

import * as React from 'react';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type ImageHsl = { hue: number; saturation: number; lightness: number };
export const NEUTRAL_IMAGE_HSL: ImageHsl = { hue: 0, saturation: 100, lightness: 100 };

function rangeBackground(kind: 'hue' | 'saturation' | 'lightness', hsl: ImageHsl) {
  if (kind === 'hue') return 'linear-gradient(90deg, #0ff 0%, #00f 17%, #f0f 33%, #f00 50%, #ff0 67%, #0f0 83%, #0ff 100%)';
  if (kind === 'saturation') return `linear-gradient(90deg, hsl(${hsl.hue} 0% 50%), hsl(${hsl.hue} 100% 50%))`;
  return `linear-gradient(90deg, #000, hsl(${hsl.hue} ${hsl.saturation}% 50%), #fff)`;
}

export function ImageHslPopover({
  value = NEUTRAL_IMAGE_HSL,
  onChange,
  onReset,
  label = 'Adjust image color',
  compact = false,
}: {
  value?: ImageHsl;
  onChange: (value: ImageHsl) => void;
  onReset: () => void;
  label?: string;
  compact?: boolean;
}) {
  const hsl = { ...NEUTRAL_IMAGE_HSL, ...value };
  const fields = [
    { key: 'hue' as const, label: 'Hue', min: -180, max: 180, suffix: '°' },
    { key: 'saturation' as const, label: 'Saturation', min: 0, max: 300, suffix: '%' },
    { key: 'lightness' as const, label: 'Lightness', min: 0, max: 200, suffix: '%' },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} title={label} onPointerDown={event => event.stopPropagation()} className={compact ? 'flex size-7 items-center justify-center rounded-md border border-white/20 bg-black/70 text-white shadow hover:bg-black' : 'flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-foreground hover:bg-accent'}>
          <SlidersHorizontal size={13} />{!compact && 'HSL'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-64 space-y-3" onPointerDownOutside={event => event.stopPropagation()}>
        <div className="flex items-center justify-between"><span className="text-xs font-medium">Image color</span><button type="button" onClick={onReset} className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"><RotateCcw size={11} />Reset</button></div>
        {fields.map(field => (
          <label key={field.key} className="block space-y-1.5">
            <span className="flex justify-between text-[10px] text-muted-foreground"><span>{field.label}</span><span className="tabular-nums">{hsl[field.key]}{field.suffix}</span></span>
            <input aria-label={field.label} type="range" min={field.min} max={field.max} step={1} value={hsl[field.key]} onChange={event => onChange({ ...hsl, [field.key]: Number(event.target.value) })} className="image-hsl-range w-full" style={{ background: rangeBackground(field.key, hsl) }} />
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
