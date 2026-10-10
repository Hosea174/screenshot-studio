import type { ImageShadow } from '@/lib/store';
import { parseShadowRgb } from '@/lib/drop-shadow';

/** Morphology expands the alpha silhouette; spread is separate from blur. */
export function ShadowDefinition({ id, shadow }: { id: string; shadow: ImageShadow }) {
  const [r, g, b] = parseShadowRgb(shadow.color);
  return <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none' }}><defs>
    <filter id={id} x="-100%" y="-100%" width="300%" height="300%" colorInterpolationFilters="sRGB">
      <feMorphology in="SourceAlpha" operator="dilate" radius={Math.max(0, shadow.spread ?? 0)} result="spread" />
      <feGaussianBlur in="spread" stdDeviation={Math.max(0, shadow.blur / 2)} result="blur" />
      <feOffset in="blur" dx={shadow.offsetX} dy={shadow.offsetY} result="offset" />
      <feFlood floodColor={`rgb(${r},${g},${b})`} floodOpacity={Math.max(0, Math.min(1, shadow.opacity))} result="color" />
      <feComposite in="color" in2="offset" operator="in" result="shadow" />
      <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
  </defs></svg>;
}
