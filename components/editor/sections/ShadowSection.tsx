'use client';

import { ShadowAdjustments } from '@/components/controls/ShadowAdjustments';
import * as React from 'react';
import { useImageStore, type ShadowPreset } from '@/lib/store';
import { SectionWrapper } from './SectionWrapper';
import { DEFAULT_OVERLAY_SHADOW } from '@/lib/overlay-style';
import { SHADOW_PRESET_SETTINGS } from '@/lib/drop-shadow';
import { cn } from '@/lib/utils';

const shadowPresets: { value: ShadowPreset; label: string; shadow: string }[] = [
  { value: 'none', label: 'None', shadow: 'none' },
  { value: 'hug', label: 'Hug', shadow: 'rgba(0,0,0,0.2) 0px 2px 12px 0px, rgba(0,0,0,0.14) 0px 1px 4px 0px' },
  { value: 'soft', label: 'Soft', shadow: 'rgba(0,0,0,0.28) 0px 12px 48px 0px, rgba(0,0,0,0.18) 0px 4px 12px 0px' },
  { value: 'strong', label: 'Strong', shadow: 'rgba(0,0,0,0.45) 0px 24px 80px 0px, rgba(0,0,0,0.3) 0px 8px 24px 0px' },
];

function ShadowPreview({ shadow }: { shadow: string }) {
  return (
    <div
      className="relative w-full aspect-square rounded-md overflow-hidden"
      style={{ backgroundColor: 'rgb(210, 210, 214)' }}
    >
      <div
        className="absolute bg-primary rounded-[10px]"
        style={{
          top: '26%',
          left: '26%',
          width: '95%',
          height: '95%',
          boxShadow: shadow,
        }}
      />
    </div>
  );
}

export function ShadowSection() {
  const state = useImageStore();
  const overlay = state.imageOverlays.find(o => o.id === state.selectedOverlayId)
    ?? (!state.uploadedImageUrl && state.editorMode !== 'device' && state.imageOverlays.length === 1 ? state.imageOverlays[0] : undefined);
  const shadow = overlay ? overlay.shadow ?? DEFAULT_OVERLAY_SHADOW : state.imageShadow;
  const onChange = (updates: Partial<typeof shadow>) => overlay
    ? state.updateImageOverlay(overlay.id, { shadow: { ...shadow, ...updates } })
    : state.setImageShadow(updates);
  const needsTarget = !overlay && !state.uploadedImageUrl && state.editorMode !== 'device' && state.imageOverlays.length > 1;

  return (
    <SectionWrapper title="Shadow" defaultOpen={true}>
      <p className="pb-2 text-xs text-muted-foreground">{needsTarget ? 'Select a layer on the canvas to edit its shadow.' : overlay ? `${overlay.mediaType === 'video' ? 'Video' : 'Image'} layer shadow` : 'Main asset shadow'}</p>
      {!needsTarget && <><div className="grid grid-cols-2 gap-2 p-1">
        {shadowPresets.map(({ value, label, shadow: preview }) => {
          const preset = SHADOW_PRESET_SETTINGS[value];
          const isSelected = !shadow.enabled ? value === 'none' : shadow.enabled === preset.enabled && shadow.blur === preset.blur && shadow.opacity === preset.opacity && shadow.spread === preset.spread;
          return (
            <button
              key={value}
              type="button"
              onClick={() => overlay ? onChange(SHADOW_PRESET_SETTINGS[value]) : state.setShadowPreset(value)}
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
                <ShadowPreview shadow={preview} />
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
      <ShadowAdjustments shadow={shadow} onChange={onChange} /></>}
    </SectionWrapper>
  );
}
