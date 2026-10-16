'use client';

import { useImageStore } from '@/lib/store';
import { Slider } from '@/components/ui/slider';
import { SectionWrapper } from './SectionWrapper';
import { cn } from '@/lib/utils';
import { editingClip, motionPose, previewPose } from '@/lib/animation/authoring';
import { useMotionSelection } from '@/lib/animation/editor';

const borderPresets = [
  { value: 0, label: 'Sharp' },
  { value: 6, label: 'Curved' },
  { value: 20, label: 'Round' },
] as const;

function BorderPreview({ radius }: { radius: number }) {
  const previewRadius = `${radius / 2}px`;

  return (
    <div
      className="relative w-full aspect-square rounded-md overflow-hidden"
      style={{ backgroundColor: 'rgb(210, 210, 214)' }}
    >
      <div
        className="absolute"
        style={{ top: '19.5%', left: '19.5%', width: '95.5%', height: '95.5%' }}
      >
        <div
          className="w-full h-full bg-primary"
          style={{ borderRadius: previewRadius }}
        />
      </div>
    </div>
  );
}

function ScaleSlider({ value, onChange, disabled }: { value: number; onChange: (scale: number) => void; disabled?: boolean }) {
  return (
    <Slider
      value={[value]}
      onValueChange={(next) => onChange(next[0])}
      min={0.1}
      max={2}
      step={0.01}
      label="Scale"
      valueDisplay={value.toFixed(1)}
      disabled={disabled}
    />
  );
}

export function BorderSection() {
  useMotionSelection(s => s.draft);
  const state = useImageStore();
  const batchIds = state.selectedOverlayIds;
  const overlay = state.imageOverlays.find((item) => item.id === state.selectedOverlayId)
    ?? (!state.uploadedImageUrl && state.editorMode !== 'device' && state.imageOverlays.length === 1 ? state.imageOverlays[0] : undefined);
  const isPrimaryOverlay = Boolean(overlay && (overlay.inheritMainStyle || (!state.uploadedImageUrl && state.editorMode !== 'device' && state.imageOverlays.length === 1)));
  const mainImageSelected = Boolean(state.uploadedImageUrl && state.isMainImageSelected && !overlay);
  const borderRadius = overlay ? (overlay.radius ?? (isPrimaryOverlay ? state.borderRadius : 0)) : state.borderRadius;
  const needsTarget = batchIds.length < 2 && !overlay && !mainImageSelected;
  const setBorderRadius = (radius: number) => batchIds.length > 1
    ? batchIds.forEach(id => state.updateImageOverlay(id, { radius }))
    : overlay
      ? state.updateImageOverlay(overlay.id, { radius })
      : state.setBorderRadius(radius);
  const baseScale = overlay ? (overlay.scale ?? (isPrimaryOverlay ? state.imageScale / 100 : 1)) : state.imageScale / 100;
  const clip = editingClip(overlay?.id ?? 'asset');
  const imageScale = baseScale * (clip ? motionPose(clip).scale : 1);
  const setScale = (scale: number) => {
    if (previewPose(overlay?.id ?? 'asset', { scale: scale / baseScale })) return;
    if (overlay) state.updateImageOverlay(overlay.id, { scale });
    else state.setImageScale(Math.round(scale * 100));
  };

  return (
    <SectionWrapper title="Border" defaultOpen={true}>
      {batchIds.length > 1 ? <p className="pb-2 text-xs text-muted-foreground">Radius applies to {batchIds.length} selected assets.</p> : needsTarget ? <p className="pb-2 text-xs text-muted-foreground">Select a layer on the canvas to edit its corners and scale.</p> : overlay ? <p className="pb-2 text-xs text-muted-foreground">Image layer corners and scale</p> : null}
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 p-1">
          {borderPresets.map(({ value, label }) => {
            const isSelected = borderRadius === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setBorderRadius(value)}
                disabled={needsTarget}
                className="flex flex-col items-center gap-1.5 group"
              >
                <div
                  className={cn(
                    'w-full rounded-[10px] p-1 border transition-all',
                    isSelected
                      ? 'bg-foreground/[0.1] border-foreground/25'
                      : 'border-transparent hover:bg-foreground/[0.04]'
                  )}
                >
                  <BorderPreview radius={value} />
                </div>
                <span
                  className={cn(
                    'text-[10px] leading-tight transition-colors',
                    isSelected ? 'text-foreground font-medium' : 'text-muted-foreground group-hover:text-foreground/70',
                  )}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        <Slider
          value={[borderRadius]}
          onValueChange={(value) => setBorderRadius(value[0])}
          disabled={needsTarget}
          min={0}
          max={50}
          step={1}
          label="Radius"
          valueDisplay={borderRadius}
        />
        <ScaleSlider value={imageScale} onChange={setScale} disabled={needsTarget || batchIds.length > 1} />
      </div>
    </SectionWrapper>
  );
}
