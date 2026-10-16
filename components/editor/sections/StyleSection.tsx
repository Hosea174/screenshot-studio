'use client';

import * as React from 'react';
import { useImageStore, type ImageStylePreset, type ImageBorder } from '@/lib/store';
import { Slider } from '@/components/ui/slider';
import { SectionWrapper } from './SectionWrapper';
import { cn } from '@/lib/utils';

const stylePresets: { value: ImageStylePreset; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'glass-light', label: 'Glass Light' },
  { value: 'glass-dark', label: 'Glass Dark' },
  { value: 'outline', label: 'Outline' },
  { value: 'border-light', label: 'Border' },
  { value: 'border-dark', label: 'Border Dark' },
];

function StylePreview({ preset }: { preset: ImageStylePreset }) {
  const isDark = preset === 'glass-dark' || preset === 'border-dark';
  const outerBg = isDark ? 'rgb(160, 160, 165)' : 'rgb(210, 210, 214)';

  const getWrapperStyle = (): React.CSSProperties => {
    switch (preset) {
      case 'default':
        return {};
      case 'glass-light':
        return {
          background: 'rgba(255, 255, 255, 0.3)',
          padding: '3px',
          borderRadius: '7px',
        };
      case 'glass-dark':
        return {
          background: 'rgba(0, 0, 0, 0.35)',
          padding: '3px',
          borderRadius: '7px',
        };
      case 'outline':
        return {
          background: 'rgba(255, 255, 255, 0.4)',
          padding: '2px',
          borderRadius: '7px',
        };
      case 'border-light':
        return {
          background: 'rgb(255, 255, 255)',
          padding: '4px',
          borderRadius: '8px',
        };
      case 'border-dark':
        return {
          background: 'rgb(30, 30, 30)',
          padding: '4px',
          borderRadius: '8px',
        };
    }
  };

  const hasWrapper = preset !== 'default';

  return (
    <div
      className="relative w-full aspect-square rounded-md overflow-hidden"
      style={{ backgroundColor: outerBg }}
    >
      <div
        className="absolute"
        style={{ top: '19.5%', left: '19.5%', width: '95.5%', height: '95.5%' }}
      >
        {hasWrapper ? (
          <div className="w-full h-full" style={getWrapperStyle()}>
            <div className="w-full h-full bg-primary rounded-[5px]" />
          </div>
        ) : (
          <div className="w-full h-full bg-primary rounded-[8px]" />
        )}
      </div>
    </div>
  );
}

export function StyleSection() {
  const state = useImageStore();
  const batchIds = state.selectedOverlayIds;
  const overlay = state.imageOverlays.find((item) => item.id === state.selectedOverlayId)
    ?? (!state.uploadedImageUrl && state.editorMode !== 'device' && state.imageOverlays.length === 1 ? state.imageOverlays[0] : undefined);
  const isPrimaryOverlay = Boolean(overlay && (overlay.inheritMainStyle || (!state.uploadedImageUrl && state.editorMode !== 'device' && state.imageOverlays.length === 1)));
  const defaultFrame: ImageBorder = { enabled: false, type: 'none', width: 1, color: '#ffffff', padding: 0.5, title: '', opacity: 1 };
  const frame = overlay?.frame ?? (isPrimaryOverlay ? state.imageBorder : defaultFrame);
  const imageStylePreset: ImageStylePreset = overlay?.frame
    ? (overlay.frame.type === 'outline-light' ? 'outline' : overlay.frame.type === 'none' ? 'default' : overlay.frame.type as ImageStylePreset)
    : isPrimaryOverlay ? state.imageStylePreset : overlay ? 'default' : state.imageStylePreset;
  const needsTarget = batchIds.length < 2 && !overlay && !state.isMainImageSelected && !state.uploadedImageUrl && state.editorMode !== 'device' && state.imageOverlays.length > 1;

  const isNonDefault = imageStylePreset !== 'default';
  const currentOpacity = frame.opacity ?? 0.3;
  const currentPadding = frame.padding ?? 0.5;
  const setFrame = (changes: Partial<ImageBorder>) => batchIds.length > 1
    ? batchIds.forEach(id => {
      const current = state.imageOverlays.find(item => item.id === id)?.frame ?? { ...defaultFrame };
      state.updateImageOverlay(id, { frame: { ...current, ...changes } });
    })
    : overlay
      ? state.updateImageOverlay(overlay.id, { frame: { ...frame, ...changes } })
      : state.setImageBorder(changes);
  const applyStyle = (preset: ImageStylePreset) => {
    if (batchIds.length > 1) {
      const presetFrames: Record<ImageStylePreset, Partial<ImageBorder>> = {
        default: { enabled: false, type: 'none' },
        'glass-light': { enabled: true, type: 'glass-light', opacity: 0.25, padding: 1 },
        'glass-dark': { enabled: true, type: 'glass-dark', opacity: 0.7, padding: 1 },
        outline: { enabled: true, type: 'outline-light', opacity: 0.35, padding: 0.5 },
        'border-light': { enabled: true, type: 'border-light', padding: 0.5 },
        'border-dark': { enabled: true, type: 'border-dark', padding: 0.5 },
      };
      batchIds.forEach(id => {
        const current = state.imageOverlays.find(item => item.id === id)?.frame ?? defaultFrame;
        state.updateImageOverlay(id, { frame: { ...current, ...presetFrames[preset], color: preset === 'border-dark' ? '#1e1e1e' : '#ffffff' } });
      });
      return;
    }
    if (!overlay) {
      state.setImageStylePreset(preset);
      return;
    }
    const presetFrames: Record<ImageStylePreset, Partial<ImageBorder>> = {
      default: { enabled: false, type: 'none' },
      'glass-light': { enabled: true, type: 'glass-light', opacity: 0.25, padding: 1 },
      'glass-dark': { enabled: true, type: 'glass-dark', opacity: 0.7, padding: 1 },
      outline: { enabled: true, type: 'outline-light', opacity: 0.35, padding: 0.5 },
      'border-light': { enabled: true, type: 'border-light', padding: 0.5 },
      'border-dark': { enabled: true, type: 'border-dark', padding: 0.5 },
    };
    setFrame({ ...presetFrames[preset], color: preset === 'border-dark' ? '#1e1e1e' : '#ffffff' });
  };

  return (
    <SectionWrapper title="Style" defaultOpen={true}>
      {batchIds.length > 1 ? <p className="pb-2 text-xs text-muted-foreground">Applying style to {batchIds.length} selected assets.</p> : needsTarget ? <p className="pb-2 text-xs text-muted-foreground">Select a layer on the canvas to edit its style.</p> : overlay ? <p className="pb-2 text-xs text-muted-foreground">Image layer style</p> : null}
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 p-1">
          {stylePresets.map(({ value, label }) => {
            const isSelected = imageStylePreset === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => applyStyle(value)}
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
                  <StylePreview preset={value} />
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

        {isNonDefault && (
          <>
            <Slider
              value={[currentPadding]}
              onValueChange={(value) => setFrame({ padding: value[0] })}
              min={0}
              max={8}
              step={0.5}
              label="Padding"
              valueDisplay={currentPadding.toFixed(1)}
              disabled={needsTarget}
            />
            <Slider
              value={[Math.round(currentOpacity * 100)]}
              onValueChange={(value) => setFrame({ opacity: value[0] / 100 })}
              min={5}
              max={100}
              step={1}
              label="Opacity"
              valueDisplay={`${Math.round(currentOpacity * 100)}%`}
              disabled={needsTarget}
            />
          </>
        )}
      </div>
    </SectionWrapper>
  );
}
