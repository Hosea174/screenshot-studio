'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { useImageStore } from '@/lib/store';
import { getBackgroundCSS } from '@/lib/constants/backgrounds';
import { buildAnimatedTemplateTimeline, type AnimatedTemplate } from '@/lib/animation/templates';
import { getClipInterpolatedProperties, getClipMaskAtTime } from '@/lib/animation/interpolation';
import { TEMPLATE_DEMO_IMAGE_URL } from '@/lib/templates/demo-media';
import { getFrameImageStyle, TEMPLATE_PREVIEW_RENDER_SCALE } from '@/components/presets/PresetGallery';
import { cn } from '@/lib/utils';

/** Sample the editor evaluator directly so masks, cuts, and segment easing match export. */
export function CinematicTemplatePreview({ template, active = false, className, showBadges = true }: {
  template: AnimatedTemplate;
  active?: boolean;
  className?: string;
  showBadges?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const source = useImageStore((state) => state.uploadedImageUrl) ?? TEMPLATE_DEMO_IMAGE_URL;
  const background = useImageStore((state) => state.backgroundConfig);
  const border = useImageStore((state) => state.imageBorder);
  const radius = useImageStore((state) => state.borderRadius);
  const shadow = useImageStore((state) => state.imageShadow);
  const stageRef = useRef<HTMLDivElement>(null);
  const perspectiveRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef<HTMLDivElement>(null);
  const maskRef = useRef<HTMLDivElement>(null);
  const timeline = useMemo(() => buildAnimatedTemplateTimeline(template, `preview-${template.id}`), [template]);

  useEffect(() => {
    const stage = stageRef.current;
    const perspective = perspectiveRef.current;
    const layer = motionRef.current;
    const mask = maskRef.current;
    if (!timeline || !stage || !perspective || !layer || !mask) return;
    const clips = [timeline.clip];
    let width = stage.clientWidth;
    let height = stage.clientHeight;
    let currentTime = template.posterTime ?? 0;
    let request = 0;
    let started: number | undefined;
    const paint = (time: number) => {
      currentTime = time;
      const p = getClipInterpolatedProperties(clips, timeline.tracks, time);
      perspective.style.perspective = `${Math.max(100, p.perspective * height / 800)}px`;
      layer.style.transform = `translate(${p.translateX * width / 100}px, ${p.translateY * height / 100}px) scale(${p.scale}) rotateX(${p.rotateX}deg) rotateY(${p.rotateY}deg) rotateZ(${p.rotateZ}deg)`;
      layer.style.opacity = String(p.imageOpacity);
      mask.style.clipPath = getClipMaskAtTime(clips, timeline.tracks, time) ?? '';
    };
    const observer = new ResizeObserver(() => {
      width = stage.clientWidth;
      height = stage.clientHeight;
      paint(currentTime);
    });
    observer.observe(stage);
    paint(active && !reducedMotion ? 0 : currentTime);
    if (active && !reducedMotion) {
      const tick = (now: number) => {
        started ??= now;
        const elapsed = (now - started) % (template.duration + 350);
        paint(Math.min(elapsed, template.duration));
        request = requestAnimationFrame(tick);
      };
      request = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(request);
      observer.disconnect();
    };
  }, [timeline, template, active, reducedMotion]);

  return (
    <div ref={stageRef} data-animated-template-preview={template.id} className={cn('relative isolate aspect-[9/16] overflow-hidden bg-muted', className)}>
      <div className="absolute inset-0" style={getBackgroundCSS(background)} />
      <div ref={perspectiveRef} className="absolute left-[6%] top-1/2 w-[88%] -translate-y-1/2">
        <div ref={motionRef} style={{ transformStyle: 'preserve-3d', willChange: active && !reducedMotion ? 'transform, opacity' : undefined }}>
          <div ref={maskRef} className="overflow-hidden bg-background" style={{
            borderRadius: radius * TEMPLATE_PREVIEW_RENDER_SCALE,
            ...getFrameImageStyle(border, radius),
            boxShadow: shadow.enabled ? `${shadow.offsetX * TEMPLATE_PREVIEW_RENDER_SCALE}px ${shadow.offsetY * TEMPLATE_PREVIEW_RENDER_SCALE}px ${shadow.blur * TEMPLATE_PREVIEW_RENDER_SCALE}px ${(shadow.spread ?? 0) * TEMPLATE_PREVIEW_RENDER_SCALE}px ${shadow.color}` : undefined,
          }}>
            <img src={source} alt="" draggable={false} className="block h-auto w-full" />
          </div>
        </div>
      </div>
      {showBadges && <div className="absolute right-2 top-2 rounded-md border border-foreground/10 bg-background/60 px-1.5 py-1 text-[10px] font-medium tabular-nums text-muted-foreground backdrop-blur-md">9:16 · {(template.duration / 1000).toFixed(1)}s</div>}
    </div>
  );
}
