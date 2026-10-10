'use client';

import * as React from 'react';
import {
  RotateSquareIcon,
  VideoReplayIcon,
} from 'hugeicons-react';
import {
  TransformsGallery,
  SectionWrapper,
} from './sections';
import { cn } from '@/lib/utils';
import { useImageStore, useEditorStore } from '@/lib/store';
import { AnimationPresetGallery } from '@/components/timeline/AnimationPresetGallery';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { getBackgroundCSS } from '@/lib/constants/backgrounds';
import { useDrag } from '@use-gesture/react';
import { aspectRatios } from '@/lib/constants/aspect-ratios';

function useCanvasAspectRatio(): string {
  const { selectedAspectRatio } = useImageStore();
  const ar = aspectRatios.find((a) => a.id === selectedAspectRatio);
  if (!ar) return '4 / 3';
  return `${ar.width} / ${ar.height}`;
}

type RightTabType = 'transforms' | 'animate';

const rightTabs: { id: RightTabType; icon: React.ReactNode; label: string }[] = [
  { id: 'transforms', icon: <RotateSquareIcon size={14} />, label: '3D' },
  { id: 'animate', icon: <VideoReplayIcon size={14} />, label: 'Motion' },
];

type ControlMode = 'zoom' | 'tilt';

// Snap grid: 3x3 positions mapped to translateX/Y ranges
const SNAP_POINTS = [
  { x: -15, y: -15 }, { x: 0, y: -15 }, { x: 15, y: -15 },
  { x: -15, y: 0 },   { x: 0, y: 0 },   { x: 15, y: 0 },
  { x: -15, y: 15 },  { x: 0, y: 15 },  { x: 15, y: 15 },
];

function TransformPreview({ mode }: { mode: ControlMode }) {
  const {
    uploadedImageUrl,
    perspective3D,
    setPerspective3D,
    backgroundConfig,
    backgroundBorderRadius,
    borderRadius,
    imageShadow,
    imageScale,
    canvasDimensions,
  } = useImageStore();
  const { screenshot, setScreenshot } = useEditorStore();
  const cssAspectRatio = useCanvasAspectRatio();

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const previewImageUrl = uploadedImageUrl || screenshot?.src || null;

  // Max offset the image can travel from center (in canvas pixels)
  const maxOffsetX = canvasDimensions ? Math.max(1, canvasDimensions.canvasW / 2) : 1;
  const maxOffsetY = canvasDimensions ? Math.max(1, canvasDimensions.canvasH / 2) : 1;

  // Store initial values at drag start
  const startRef = React.useRef({ oX: 0, oY: 0, rX: 0, rY: 0 });

  // Snap threshold in canvas pixels — percentage of max offset
  const snapThresholdX = maxOffsetX * 0.08;
  const snapThresholdY = maxOffsetY * 0.08;

  const snapOffset = React.useCallback((rawX: number, rawY: number) => {
    // Check each grid point (mapped to canvas pixel offsets)
    for (const point of SNAP_POINTS) {
      const pointOffsetX = (point.x / 15) * maxOffsetX;
      const pointOffsetY = (point.y / 15) * maxOffsetY;
      if (
        Math.abs(rawX - pointOffsetX) < snapThresholdX &&
        Math.abs(rawY - pointOffsetY) < snapThresholdY
      ) {
        return { x: Math.round(pointOffsetX), y: Math.round(pointOffsetY) };
      }
    }
    return { x: Math.round(rawX), y: Math.round(rawY) };
  }, [maxOffsetX, maxOffsetY, snapThresholdX, snapThresholdY]);

  const bind = useDrag(
    ({ first, active, movement: [mx, my] }) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      if (first) {
        startRef.current = {
          oX: screenshot.offsetX,
          oY: screenshot.offsetY,
          rX: perspective3D.rotateX,
          rY: perspective3D.rotateY,
        };
      }

      setDragging(active);

      const dxNorm = mx / rect.width;
      const dyNorm = my / rect.height;

      if (mode === 'zoom') {
        // Map preview drag to 2D canvas offset with snap-to-grid
        const rawX = startRef.current.oX + dxNorm * maxOffsetX * 2;
        const rawY = startRef.current.oY + dyNorm * maxOffsetY * 2;
        const snapped = snapOffset(rawX, rawY);
        setScreenshot({ offsetX: snapped.x, offsetY: snapped.y });
      } else {
        setPerspective3D({
          rotateY: Math.max(-45, Math.min(45, startRef.current.rY + dxNorm * 90)),
          rotateX: Math.max(-45, Math.min(45, startRef.current.rX - dyNorm * 90)),
        });
      }
    },
    { pointer: { touch: true }, filterTaps: true }
  );

  const backgroundStyle = getBackgroundCSS(backgroundConfig, 384);

  // Convert pixel offset to percentage for the preview image transform
  const offsetXPct = canvasDimensions && canvasDimensions.canvasW > 0
    ? (screenshot.offsetX / canvasDimensions.canvasW) * 100
    : 0;
  const offsetYPct = canvasDimensions && canvasDimensions.canvasH > 0
    ? (screenshot.offsetY / canvasDimensions.canvasH) * 100
    : 0;

  const transformStyle: React.CSSProperties = {
    transform: `translate(${perspective3D.translateX + offsetXPct}%, ${perspective3D.translateY + offsetYPct}%) rotateX(${perspective3D.rotateX}deg) rotateY(${perspective3D.rotateY}deg) rotateZ(${perspective3D.rotateZ}deg) scale(${perspective3D.scale * (imageScale / 100)})`,
    transition: dragging ? 'none' : 'transform 150ms ease-out',
    transformOrigin: 'center center',
  };

  // Handle position: zoom mode shows 2D offset, tilt mode shows rotation
  const handleX =
    mode === 'zoom'
      ? 50 + (screenshot.offsetX / maxOffsetX) * 50
      : 50 + (perspective3D.rotateY / 45) * 50;
  const handleY =
    mode === 'zoom'
      ? 50 + (screenshot.offsetY / maxOffsetY) * 50
      : 50 - (perspective3D.rotateX / 45) * 50;

  const previewBorderRadius = Math.round(backgroundBorderRadius * 0.15);
  const previewImageRadius = Math.round(Math.min(borderRadius, 20) * 0.3);

  // Check if currently snapped to a grid point
  const getSnappedPoint = () => {
    for (const point of SNAP_POINTS) {
      const pointOffsetX = (point.x / 15) * maxOffsetX;
      const pointOffsetY = (point.y / 15) * maxOffsetY;
      if (
        Math.abs(screenshot.offsetX - pointOffsetX) < snapThresholdX &&
        Math.abs(screenshot.offsetY - pointOffsetY) < snapThresholdY
      ) {
        return point;
      }
    }
    return null;
  };
  const snappedPoint = getSnappedPoint();

  return (
    <div
      ref={containerRef}
      {...bind()}
      className={cn(
        'relative w-full rounded-xl overflow-hidden border border-border/20 touch-none select-none',
        dragging ? 'cursor-grabbing' : 'cursor-grab'
      )}
      style={{ aspectRatio: cssAspectRatio }}
    >
      <div
        className="absolute inset-0"
        style={{
          ...backgroundStyle,
          borderRadius: `${previewBorderRadius}px`,
        }}
      />

      {mode === 'zoom' && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute left-1/2 top-[12%] bottom-[12%] w-px bg-foreground/15" />
          <div className="absolute top-1/2 left-[12%] right-[12%] h-px bg-foreground/15" />

          <div className="absolute left-[12%] right-[12%] top-[25%] h-px bg-foreground/8" />
          <div className="absolute left-[12%] right-[12%] bottom-[25%] h-px bg-foreground/8" />
          <div className="absolute top-[12%] bottom-[12%] left-[25%] w-px bg-foreground/8" />
          <div className="absolute top-[12%] bottom-[12%] right-[25%] w-px bg-foreground/8" />

          {SNAP_POINTS.map((point, i) => {
            const left = 50 + (point.x / 15) * 50;
            const top = 50 + (point.y / 15) * 50;
            const isCenter = point.x === 0 && point.y === 0;
            const isSnapped = snappedPoint === point;
            return (
              <div
                key={i}
                className={cn(
                  'absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150',
                  isSnapped
                    ? 'w-2.5 h-2.5 bg-primary ring-2 ring-foreground/30'
                    : isCenter
                      ? 'w-2.5 h-2.5 bg-foreground/40 ring-1 ring-foreground/10'
                      : 'w-2 h-2 bg-foreground/30'
                )}
                style={{ left: `${left}%`, top: `${top}%` }}
              />
            );
          })}
        </div>
      )}

      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{ perspective: `${perspective3D.perspective}px` }}
      >
        {previewImageUrl ? (
          <div className="w-[85%] h-[85%]" style={transformStyle}>
            <img
              src={previewImageUrl}
              alt="Preview"
              className="w-full h-full object-contain"
              draggable={false}
              style={{
                borderRadius: `${previewImageRadius}px`,
                filter: imageShadow.enabled
                  ? `drop-shadow(${imageShadow.offsetX * 0.15}px ${imageShadow.offsetY * 0.15}px ${(imageShadow.blur + imageShadow.spread) * 0.15}px ${imageShadow.color})`
                  : undefined,
              }}
            />
          </div>
        ) : (
          <div
            className="w-[85%] h-[85%] bg-muted-foreground/20 rounded-md border border-border/20"
            style={transformStyle}
          />
        )}
      </div>

      <div
        className={cn(
          'absolute w-7 h-7 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none',
          'bg-foreground/70 backdrop-blur-sm border-2 border-background/50',
          'transition-all duration-150',
          dragging && 'scale-110',
          snappedPoint && 'ring-2 ring-foreground/50'
        )}
        style={{
          left: `${Math.max(8, Math.min(92, handleX))}%`,
          top: `${Math.max(8, Math.min(92, handleY))}%`,
        }}
      >
        <div className="absolute inset-1 rounded-full border border-background/30" />
      </div>

      <div className="absolute inset-0 rounded-xl border border-foreground/5 pointer-events-none" />
    </div>
  );
}

function PerspectiveSliders() {
  const { perspective3D, setPerspective3D } = useImageStore();

  return (
    <SectionWrapper title="Fine Tune" defaultOpen={false}>
      <div className="space-y-2">
        <Slider
          value={[perspective3D.perspective]}
          onValueChange={(value) => setPerspective3D({ perspective: value[0] })}
          min={500}
          max={3000}
          step={50}
          label="Depth"
          valueDisplay={`${perspective3D.perspective}px`}
        />
        <Slider
          value={[perspective3D.rotateX]}
          onValueChange={(value) => setPerspective3D({ rotateX: value[0] })}
          min={-60}
          max={60}
          step={1}
          label="Rotate X"
          valueDisplay={`${perspective3D.rotateX}°`}
        />
        <Slider
          value={[perspective3D.rotateY]}
          onValueChange={(value) => setPerspective3D({ rotateY: value[0] })}
          min={-60}
          max={60}
          step={1}
          label="Rotate Y"
          valueDisplay={`${perspective3D.rotateY}°`}
        />
        <Slider
          value={[perspective3D.rotateZ]}
          onValueChange={(value) => setPerspective3D({ rotateZ: value[0] })}
          min={-45}
          max={45}
          step={1}
          label="Rotate Z"
          valueDisplay={`${perspective3D.rotateZ}°`}
        />
        <Slider
          value={[perspective3D.scale]}
          onValueChange={(value) => setPerspective3D({ scale: value[0] })}
          min={0.5}
          max={1.5}
          step={0.01}
          label="Scale"
          valueDisplay={perspective3D.scale.toFixed(2)}
        />
      </div>
    </SectionWrapper>
  );
}

function ZoomSlider() {
  const {
    imageScale,
    setImageScale,
    imageOverlays,
    updateImageOverlay,
    selectedOverlayId,
  } = useImageStore();

  const selectedOverlay = selectedOverlayId
    ? imageOverlays.find((o) => o.id === selectedOverlayId)
    : null;
  // If a second image / overlay is selected, zoom/scale its size:
  if (selectedOverlay) {
    return (
      <Slider
        value={[selectedOverlay.size]}
        onValueChange={(value) =>
          updateImageOverlay(selectedOverlay.id, { size: value[0] })
        }
        min={20}
        max={1200}
        step={5}
        label="Size / Zoom (Selected Overlay)"
        valueDisplay={`${selectedOverlay.size}px`}
      />
    );
  }
  // Otherwise, scale the main base image:
  return (
    <Slider
      value={[imageScale / 100]}
      onValueChange={(value) => setImageScale(Math.round(value[0] * 100))}
      min={0.1}
      max={2}
      step={0.01}
      label="Zoom"
      valueDisplay={`${Math.round(imageScale)}%`}
    />
  );
}

function TransformControls() {
  const perspective3D = useImageStore((s) => s.perspective3D);
  const setPerspective3D = useImageStore((s) => s.setPerspective3D);
  const [controlMode, setControlMode] = React.useState<ControlMode>('zoom');

  return (
    <div className="space-y-3">
      <SegmentedControl
        options={[
          { id: 'zoom', label: 'Zoom' },
          { id: 'tilt', label: 'Tilt' },
        ]}
        value={controlMode}
        onChange={(v) => setControlMode(v as ControlMode)}
        size="sm"
      />

      <TransformPreview mode={controlMode} />

      {controlMode === 'zoom' ? (
        <ZoomSlider />
      ) : (
        <Slider
          value={[perspective3D.rotateZ]}
          onValueChange={(value) => setPerspective3D({ rotateZ: value[0] })}
          min={-45}
          max={45}
          step={1}
          label="Rotation"
          valueDisplay={`${perspective3D.rotateZ}°`}
        />
      )}
    </div>
  );
}

// ─── Animation Tab (same pattern as 3D) ────────────────────────────────────

function AnimationControls() { return <AnimationPresetGallery />; }

// ─── Main Panel ─────────────────────────────────────────────────────────────

export function RightSettingsPanel() {
  const { activeRightPanelTab } = useImageStore();
  const [activeTab, setActiveTab] = React.useState<RightTabType>('transforms');

  // Sync with store — when timeline or other components set the right panel tab to animate/transforms
  React.useEffect(() => {
    if (activeRightPanelTab === 'animate' || activeRightPanelTab === 'transforms') {
      setActiveTab(activeRightPanelTab);
    }
  }, [activeRightPanelTab]);

  const [contentKey, setContentKey] = React.useState<RightTabType>(activeTab);
  const [transitioning, setTransitioning] = React.useState(false);

  React.useEffect(() => {
    if (activeTab !== contentKey) {
      setTransitioning(true);
      const timeout = setTimeout(() => {
        setContentKey(activeTab);
        setTransitioning(false);
      }, 150);
      return () => clearTimeout(timeout);
    }
  }, [activeTab, contentKey]);

  return (
    <div className="w-[260px] h-full bg-background flex flex-col overflow-hidden border-l border-foreground/10 shrink-0">
      <div className="px-3 py-2.5 border-b border-foreground/10 shrink-0">
        <SegmentedControl
          value={activeTab}
          onChange={(id) => setActiveTab(id as RightTabType)}
          options={rightTabs.map((tab) => ({
            id: tab.id,
            label: tab.label,
            icon: tab.icon,
            ariaLabel: tab.label,
          }))}
        />
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div
          className="p-4 transition-all duration-150 ease-out"
          style={{
            opacity: transitioning ? 0 : 1,
            transform: transitioning ? 'translateY(4px)' : 'translateY(0)',
          }}
        >
          {contentKey === 'transforms' && (
            <div className="space-y-1">
              <TransformControls />

              <div className="flex items-center gap-2 py-3 px-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Layout Presets
                </span>
              </div>

              <TransformsGallery />
              <PerspectiveSliders />
            </div>
          )}

          {contentKey === 'animate' && <AnimationControls />}
        </div>
      </div>
    </div>
  );
}
