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
import { buildOverlayTiltTransform, DEFAULT_OVERLAY_TILT, fitOverlayImage } from '@/lib/overlay-style';
import { hasAnimatedPropertyAtTime, previewPose } from '@/lib/animation/authoring';
import { useMotionSelection } from '@/lib/animation/editor';
import { getClipInterpolatedProperties } from '@/lib/animation/interpolation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';
import { AnimationPresetGallery } from '@/components/timeline/AnimationPresetGallery';
import { Slider } from '@/components/ui/slider';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { getBackgroundCSS } from '@/lib/constants/backgrounds';
import { useDrag } from '@use-gesture/react';
import { aspectRatios } from '@/lib/constants/aspect-ratios';
import { formatNumber } from '@/lib/number-format';
import { beginMotionDrag } from '@/lib/animation/drag-history';
import { isTemplateDemoMedia, TEMPLATE_DEMO_IMAGE_URL } from '@/lib/templates/demo-media';

function useCanvasAspectRatio(): string {
  const { selectedAspectRatio } = useImageStore();
  const ar = aspectRatios.find((a) => a.id === selectedAspectRatio);
  if (!ar) return '4 / 3';
  return `${ar.width} / ${ar.height}`;
}

function useEditableMotionPose(target: string) {
  const selection = useMotionSelection();
  const clips = useImageStore((state) => state.animationClips);
  const tracks = useImageStore((state) => state.timeline.tracks);
  const animationBase = useImageStore((state) => state.animationBase);
  const playhead = useImageStore((state) => state.timeline.playhead);
  const hasTargetMotion = clips.some(item => (item.target ?? 'asset') === target && item.startTime <= playhead)
    || (target === 'asset' && tracks.some(track => !track.clipId && track.keyframes.some(key => key.time <= playhead)));
  const evaluatedPose = hasTargetMotion
    ? getClipInterpolatedProperties(clips, tracks, playhead, target === 'asset' ? animationBase ?? DEFAULT_ANIMATABLE_PROPERTIES : DEFAULT_ANIMATABLE_PROPERTIES, target)
    : null;
  const draftClip = selection.draft && selection.draft.time === playhead
    ? clips.find(item => item.id === selection.draft?.clipId)
    : undefined;
  const pose = evaluatedPose && draftClip && (draftClip.target ?? 'asset') === target
    ? { ...evaluatedPose, ...selection.draft?.properties }
    : evaluatedPose;
  return { pose };
}

function useTransformOverlay() {
  const overlays = useImageStore(state => state.imageOverlays);
  const selectedOverlayId = useImageStore(state => state.selectedOverlayId);
  const isMainImageSelected = useImageStore(state => state.isMainImageSelected);
  const lastSelectedAssetId = useImageStore(state => state.lastSelectedAssetId);
  const uploadedImageUrl = useImageStore(state => state.uploadedImageUrl);
  const imageName = useImageStore(state => state.imageName);
  const screenshotSrc = useEditorStore(state => state.screenshot.src);
  const selected = overlays.find(overlay => overlay.id === selectedOverlayId);
  const assetOverlays = overlays.filter(overlay => !overlay.src.includes('overlay-shadow'));
  const visibleOverlays = assetOverlays.filter(overlay => overlay.isVisible);
  const hasMainAsset = [uploadedImageUrl, screenshotSrc].some(src =>
    Boolean(src && src !== TEMPLATE_DEMO_IMAGE_URL && !isTemplateDemoMedia(src, imageName))
  );
  const lastSelectedOverlay = lastSelectedAssetId && lastSelectedAssetId !== 'asset'
    ? assetOverlays.find(overlay => overlay.id === lastSelectedAssetId)
    : null;
  const overlay = selected
    ?? (isMainImageSelected ? null : lastSelectedOverlay)
    ?? (!hasMainAsset && visibleOverlays.length === 1 ? visibleOverlays[0] : null);
  const isPrimary = Boolean(overlay && (
    overlay.inheritMainStyle || (!hasMainAsset && assetOverlays.length === 1)
  ));
  return { overlay, isPrimary };
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
    imageOpacity,
    canvasDimensions,
    updateImageOverlay,
    showTimeline,
  } = useImageStore();
  const { screenshot, setScreenshot } = useEditorStore();
  const { overlay: selectedOverlay, isPrimary: selectedIsPrimary } = useTransformOverlay();
  const cssAspectRatio = useCanvasAspectRatio();

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [previewHeight, setPreviewHeight] = React.useState(320);
  const finishDragHistory = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => {
    finishDragHistory.current?.();
    finishDragHistory.current = null;
  }, []);

  React.useEffect(() => {
    const updatePreviewSize = () => {
      const preview = containerRef.current;
      if (!preview) return;
      const timeline = document.querySelector<HTMLElement>('[data-animation-timeline]');
      const availableBottom = timeline?.getBoundingClientRect().top ?? window.innerHeight;
      const room = availableBottom - preview.getBoundingClientRect().top - 64;
      setPreviewHeight(Math.max(120, Math.min(320, room)));
    };

    updatePreviewSize();
    const observer = new ResizeObserver(updatePreviewSize);
    observer.observe(document.documentElement);
    const timeline = document.querySelector<HTMLElement>('[data-animation-timeline]');
    if (timeline) observer.observe(timeline);
    window.addEventListener('resize', updatePreviewSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePreviewSize);
    };
  }, [showTimeline]);

  const overlayMotion = useEditableMotionPose(selectedOverlay?.id ?? '__no-overlay__');
  const mainMotion = useEditableMotionPose('asset');
  const previewImageUrl = selectedOverlay
    ? selectedOverlay.mediaType === 'video' ? selectedOverlay.poster ?? null : selectedOverlay.src
    : uploadedImageUrl || screenshot?.src || null;
  const canvasW = canvasDimensions?.canvasW ?? 1;
  const canvasH = canvasDimensions?.canvasH ?? 1;
  const overlayTilt = selectedOverlay?.tilt ?? DEFAULT_OVERLAY_TILT;
  const overlayOffsetX = selectedOverlay ? (selectedOverlay.position.x - canvasW / 2) / canvasW * 100 : 0;
  const overlayOffsetY = selectedOverlay ? (selectedOverlay.position.y - canvasH / 2) / canvasH * 100 : 0;
  const overlayPose = overlayMotion.pose;
  const mainPose = mainMotion.pose;
  const mainPerspective = hasAnimatedPropertyAtTime('asset', 'perspective')
    ? mainPose?.perspective ?? perspective3D.perspective
    : perspective3D.perspective;
  const overlayPerspective = selectedOverlay && hasAnimatedPropertyAtTime(selectedOverlay.id, 'perspective')
    ? overlayPose?.perspective ?? overlayTilt.perspective
    : overlayTilt.perspective;
  const overlayTransformPerspective = selectedOverlay && hasAnimatedPropertyAtTime(selectedOverlay.id, 'perspective')
    ? overlayPose?.perspective ?? overlayTilt.perspective
    : selectedIsPrimary ? mainPerspective : overlayTilt.perspective;
  const overlayTransformX = (overlayPose?.translateX ?? 0) + (selectedIsPrimary ? mainPose?.translateX ?? perspective3D.translateX : 0);
  const overlayTransformY = (overlayPose?.translateY ?? 0) + (selectedIsPrimary ? mainPose?.translateY ?? perspective3D.translateY : 0);
  const overlayOuterRotateX = (overlayPose?.rotateX ?? 0) + (selectedIsPrimary ? mainPose?.rotateX ?? perspective3D.rotateX : 0);
  const overlayOuterRotateY = (overlayPose?.rotateY ?? 0) + (selectedIsPrimary ? mainPose?.rotateY ?? perspective3D.rotateY : 0);
  const overlayOuterRotateZ = (selectedOverlay?.rotation ?? 0) + (overlayPose?.rotateZ ?? 0) + (selectedIsPrimary ? mainPose?.rotateZ ?? perspective3D.rotateZ : 0);
  const overlayOuterScale = (overlayPose?.scale ?? 1) * (selectedOverlay?.scale ?? (selectedIsPrimary ? mainPose?.scale ?? perspective3D.scale : 1));
  const overlayContentTransform = selectedOverlay ? [
    buildOverlayTiltTransform(overlayTilt),
    selectedOverlay.flipX ? 'scaleX(-1)' : '',
    selectedOverlay.flipY ? 'scaleY(-1)' : '',
  ].filter(Boolean).join(' ') : undefined;
  const overlayRotateX = overlayTilt.rotateX + overlayOuterRotateX;
  const overlayRotateY = overlayTilt.rotateY + overlayOuterRotateY;
  const overlayFit = selectedOverlay
    ? fitOverlayImage(selectedOverlay.mediaWidth ?? 1, selectedOverlay.mediaHeight ?? 1)
    : { width: 100, height: 100 };
  const overlayFrameWidth = selectedOverlay ? selectedOverlay.size * overlayFit.width / 100 : 0;
  const overlayFrameHeight = selectedOverlay ? selectedOverlay.size * overlayFit.height / 100 : 0;
  const overlayPreviewWidth = selectedOverlay ? overlayFrameWidth / canvasW * 100 : 85;
  const overlayPreviewHeight = selectedOverlay ? overlayFrameHeight / canvasH * 100 : 85;
  const previewPerspective = selectedOverlay
    ? overlayPerspective * previewHeight / Math.max(1, canvasH)
    : mainPerspective * previewHeight / 800;

  // Max offset the image can travel from center (in canvas pixels)
  const maxOffsetX = canvasDimensions ? Math.max(1, canvasDimensions.canvasW / 2) : 1;
  const maxOffsetY = canvasDimensions ? Math.max(1, canvasDimensions.canvasH / 2) : 1;

  // Store initial values at drag start
  const startRef = React.useRef({ oX: 0, oY: 0, rX: 0, rY: 0, x: 0, y: 0, tx: 0, ty: 0 });

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
      if (first && !finishDragHistory.current) finishDragHistory.current = beginMotionDrag();
      if (!containerRef.current) {
        if (!active) {
          finishDragHistory.current?.();
          finishDragHistory.current = null;
        }
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();

      if (first) {
        startRef.current = {
          oX: screenshot.offsetX,
          oY: screenshot.offsetY,
          rX: selectedOverlay ? overlayRotateX : mainPose?.rotateX ?? perspective3D.rotateX,
          rY: selectedOverlay ? overlayRotateY : mainPose?.rotateY ?? perspective3D.rotateY,
          x: selectedOverlay ? selectedOverlay.position.x + overlayTransformX * overlayFrameWidth / 100 : 0,
          y: selectedOverlay ? selectedOverlay.position.y + overlayTransformY * overlayFrameHeight / 100 : 0,
          tx: selectedOverlay ? overlayPose?.translateX ?? 0 : mainPose?.translateX ?? perspective3D.translateX,
          ty: selectedOverlay ? overlayPose?.translateY ?? 0 : mainPose?.translateY ?? perspective3D.translateY,
        };
      }

      setDragging(active);

      const dxNorm = mx / rect.width;
      const dyNorm = my / rect.height;

      if (selectedOverlay) {
        if (mode === 'zoom') {
          const desiredX = startRef.current.x + dxNorm * canvasW;
          const desiredY = startRef.current.y + dyNorm * canvasH;
          const globalX = selectedIsPrimary ? mainPose?.translateX ?? perspective3D.translateX : 0;
          const globalY = selectedIsPrimary ? mainPose?.translateY ?? perspective3D.translateY : 0;
          const nextTranslateX = (desiredX - selectedOverlay.position.x - globalX * overlayFrameWidth / 100) / Math.max(1, overlayFrameWidth) * 100;
          const nextTranslateY = (desiredY - selectedOverlay.position.y - globalY * overlayFrameHeight / 100) / Math.max(1, overlayFrameHeight) * 100;
          if (!previewPose(selectedOverlay.id, { translateX: nextTranslateX, translateY: nextTranslateY })) {
            const currentX = (overlayPose?.translateX ?? 0) + globalX;
            const currentY = (overlayPose?.translateY ?? 0) + globalY;
            updateImageOverlay(selectedOverlay.id, { position: { x: desiredX - currentX * overlayFrameWidth / 100, y: desiredY - currentY * overlayFrameHeight / 100 } });
          }
        } else {
          const rotateY = Math.max(-45, Math.min(45, startRef.current.rY + dxNorm * 90));
          const rotateX = Math.max(-45, Math.min(45, startRef.current.rX - dyNorm * 90));
          const globalRotateX = selectedIsPrimary ? mainPose?.rotateX ?? perspective3D.rotateX : 0;
          const globalRotateY = selectedIsPrimary ? mainPose?.rotateY ?? perspective3D.rotateY : 0;
          if (!previewPose(selectedOverlay.id, { rotateY: rotateY - overlayTilt.rotateY - globalRotateY, rotateX: rotateX - overlayTilt.rotateX - globalRotateX })) {
            updateImageOverlay(selectedOverlay.id, { tilt: { ...overlayTilt, rotateY: rotateY - globalRotateY - (overlayPose?.rotateY ?? 0), rotateX: rotateX - globalRotateX - (overlayPose?.rotateX ?? 0) } });
          }
        }
      } else if (mode === 'zoom') {
        const rawX = startRef.current.oX + startRef.current.tx * canvasW / 100 + dxNorm * canvasW;
        const rawY = startRef.current.oY + startRef.current.ty * canvasH / 100 + dyNorm * canvasH;
        const snapped = snapOffset(rawX, rawY);
        const animatedX = snapped.x / canvasW * 100 - startRef.current.oX / canvasW * 100;
        const animatedY = snapped.y / canvasH * 100 - startRef.current.oY / canvasH * 100;
        if (!previewPose('asset', { translateX: animatedX, translateY: animatedY })) {
          setScreenshot({
            offsetX: snapped.x - perspective3D.translateX * canvasW / 100,
            offsetY: snapped.y - perspective3D.translateY * canvasH / 100,
          });
        }
      } else {
        const rotateY = Math.max(-45, Math.min(45, startRef.current.rY + dxNorm * 90));
        const rotateX = Math.max(-45, Math.min(45, startRef.current.rX - dyNorm * 90));
        if (!previewPose('asset', { rotateY, rotateX })) setPerspective3D({ rotateY, rotateX });
      }

      if (!active) {
        finishDragHistory.current?.();
        finishDragHistory.current = null;
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
    transform: `translate(${((mainPose?.translateX ?? perspective3D.translateX) + offsetXPct) / 0.85}%, ${((mainPose?.translateY ?? perspective3D.translateY) + offsetYPct) / 0.85}%) rotateX(${mainPose?.rotateX ?? perspective3D.rotateX}deg) rotateY(${mainPose?.rotateY ?? perspective3D.rotateY}deg) rotateZ(${(mainPose?.rotateZ ?? perspective3D.rotateZ) + screenshot.rotation}deg) scale(${(mainPose?.scale ?? perspective3D.scale) * (imageScale / 100)})`,
    transition: dragging ? 'none' : 'transform 150ms ease-out',
    transformOrigin: 'center center',
  };

  // Handle position: zoom mode shows 2D offset, tilt mode shows rotation
  const handleX = selectedOverlay
    ? mode === 'zoom' ? 50 + (overlayOffsetX + overlayTransformX * overlayFrameWidth / canvasW) * 2 : 50 + (overlayRotateY / 45) * 50
    : mode === 'zoom' ? 50 + screenshot.offsetX / maxOffsetX * 50 + (mainPose?.translateX ?? perspective3D.translateX) : 50 + ((mainPose?.rotateY ?? perspective3D.rotateY) / 45) * 50;
  const handleY = selectedOverlay
    ? mode === 'zoom' ? 50 + (overlayOffsetY + overlayTransformY * overlayFrameHeight / canvasH) * 2 : 50 - (overlayRotateX / 45) * 50
    : mode === 'zoom' ? 50 + screenshot.offsetY / maxOffsetY * 50 + (mainPose?.translateY ?? perspective3D.translateY) : 50 - ((mainPose?.rotateX ?? perspective3D.rotateX) / 45) * 50;

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
        'relative max-w-full rounded-xl overflow-hidden border border-border/20 touch-none select-none',
        dragging ? 'cursor-grabbing' : 'cursor-grab'
      )}
      style={{ height: `${previewHeight}px`, width: 'auto', aspectRatio: cssAspectRatio }}
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
        style={{ perspective: `${previewPerspective}px`, perspectiveOrigin: `${handleX}% ${handleY}%` }}
      >
        <div
          className="absolute flex h-[85%] w-[85%] items-center justify-center"
          style={selectedOverlay ? {
            left: `${selectedOverlay.position.x / canvasW * 100}%`,
            top: `${selectedOverlay.position.y / canvasH * 100}%`,
            width: `${overlayPreviewWidth}%`,
            height: `${overlayPreviewHeight}%`,
            transform: `translate(-50%, -50%) perspective(${overlayTransformPerspective * previewHeight / Math.max(1, canvasH)}px) translate(${overlayTransformX}%, ${overlayTransformY}%) rotateX(${overlayOuterRotateX}deg) rotateY(${overlayOuterRotateY}deg) rotateZ(${overlayOuterRotateZ}deg) scale(${overlayOuterScale})`,
            transformOrigin: 'center center',
          } : {
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          {selectedOverlay?.mediaType === 'video' ? (
            <video
              src={selectedOverlay.src}
              poster={selectedOverlay.poster}
              muted
              playsInline
              autoPlay
              loop
              aria-label="Selected video layer preview"
              className="h-full w-full object-contain"
              style={{ transform: overlayContentTransform, opacity: selectedOverlay.opacity * (overlayPose?.imageOpacity ?? 1) * (selectedIsPrimary ? imageOpacity : 1), borderRadius: `${selectedOverlay.radius ?? 0}px` }}
            />
          ) : previewImageUrl ? (
            <img
              src={previewImageUrl}
              alt={selectedOverlay ? 'Selected layer preview' : 'Transform preview'}
              draggable={false}
              className="h-full w-full object-contain"
              style={{ ...(!selectedOverlay ? transformStyle : { transform: overlayContentTransform }), opacity: selectedOverlay ? selectedOverlay.opacity * (overlayPose?.imageOpacity ?? 1) * (selectedIsPrimary ? imageOpacity : 1) : (mainPose?.imageOpacity ?? 1), borderRadius: `${selectedOverlay?.radius ?? previewImageRadius}px`, filter: imageShadow.enabled ? `drop-shadow(${imageShadow.offsetX * 0.15}px ${imageShadow.offsetY * 0.15}px ${(imageShadow.blur + imageShadow.spread) * 0.15}px ${imageShadow.color})` : undefined }}
            />
          ) : (
            <div
              aria-label={selectedOverlay ? 'Selected layer preview' : 'Image transform preview'}
              className="h-full w-full rounded-md border border-border/20 bg-muted-foreground/20"
              style={selectedOverlay ? { transform: `perspective(${overlayTransformPerspective * previewHeight / Math.max(1, canvasH)}px) ${buildOverlayTiltTransform(overlayTilt) ?? ''}` } : transformStyle}
            />
          )}
        </div>
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
  const { perspective3D, setPerspective3D, updateImageOverlay } = useImageStore();
  const { overlay: selectedOverlay, isPrimary: selectedIsPrimary } = useTransformOverlay();
  const overlayMotion = useEditableMotionPose(selectedOverlay?.id ?? '__no-overlay__');
  const mainMotion = useEditableMotionPose('asset');
  const tilt = selectedOverlay?.tilt ?? DEFAULT_OVERLAY_TILT;
  const pose = selectedOverlay ? overlayMotion.pose : mainMotion.pose;
  const overlayBaseScale = selectedOverlay?.scale ?? (selectedIsPrimary ? perspective3D.scale : 1);
  const overlayMotionScale = selectedOverlay && hasAnimatedPropertyAtTime(selectedOverlay.id, 'scale') ? pose?.scale ?? 1 : 1;
  const propertyValue = (property: 'perspective' | 'rotateX' | 'rotateY' | 'rotateZ' | 'scale') => {
    if (selectedOverlay) {
      if (property === 'perspective') return hasAnimatedPropertyAtTime(selectedOverlay.id, property) ? pose?.[property] ?? tilt.perspective : tilt.perspective;
      if (property === 'rotateX' || property === 'rotateY') return tilt[property] + (hasAnimatedPropertyAtTime(selectedOverlay.id, property) ? pose?.[property] ?? 0 : 0);
      if (property === 'rotateZ') return selectedOverlay.rotation + (hasAnimatedPropertyAtTime(selectedOverlay.id, property) ? pose?.[property] ?? 0 : 0);
      return overlayBaseScale * (hasAnimatedPropertyAtTime(selectedOverlay.id, property) ? pose?.[property] ?? 1 : 1);
    }
    return hasAnimatedPropertyAtTime('asset', property) ? pose?.[property] ?? perspective3D[property] : perspective3D[property];
  };
  const apply = (values: Partial<typeof perspective3D>) => {
    if (!selectedOverlay) {
      if (!previewPose('asset', values)) setPerspective3D(values);
      return;
    }
    const motionValues = { ...values };
    if (motionValues.rotateX !== undefined) motionValues.rotateX -= tilt.rotateX;
    if (motionValues.rotateY !== undefined) motionValues.rotateY -= tilt.rotateY;
    if (motionValues.rotateZ !== undefined) motionValues.rotateZ -= selectedOverlay.rotation;
    if (motionValues.scale !== undefined) motionValues.scale /= overlayBaseScale;
    if (previewPose(selectedOverlay.id, motionValues)) return;
    const update: Partial<typeof selectedOverlay> = {};
    if ('perspective' in values || 'rotateX' in values || 'rotateY' in values) update.tilt = { ...tilt, ...(values.perspective !== undefined ? { perspective: values.perspective } : {}), ...(values.rotateX !== undefined ? { rotateX: values.rotateX } : {}), ...(values.rotateY !== undefined ? { rotateY: values.rotateY } : {}) };
    if (values.rotateZ !== undefined) update.rotation = values.rotateZ;
    if (values.scale !== undefined) update.scale = values.scale / Math.max(0.01, overlayMotionScale);
    updateImageOverlay(selectedOverlay.id, update);
  };

  return (
    <SectionWrapper title="Fine Tune" defaultOpen={false}>
      <div className="space-y-2">
        <Slider
          value={[propertyValue('perspective')]}
          onValueChange={(value) => apply({ perspective: value[0] })}
          min={100}
          max={8000}
          step={25}
          label="Depth"
          valueDisplay={`${propertyValue('perspective')}px`}
        />
        <Slider
          value={[propertyValue('rotateX')]}
          onValueChange={(value) => apply({ rotateX: value[0] })}
          min={-60}
          max={60}
          step={1}
          label="Rotate X"
          valueDisplay={`${propertyValue('rotateX')}°`}
        />
        <Slider
          value={[propertyValue('rotateY')]}
          onValueChange={(value) => apply({ rotateY: value[0] })}
          min={-60}
          max={60}
          step={1}
          label="Rotate Y"
          valueDisplay={`${propertyValue('rotateY')}°`}
        />
        <Slider
          value={[propertyValue('rotateZ')]}
          onValueChange={(value) => apply({ rotateZ: value[0] })}
          min={-45}
          max={45}
          step={1}
          label="Rotate Z"
          valueDisplay={`${propertyValue('rotateZ')}°`}
        />
        <Slider
          value={[propertyValue('scale')]}
          onValueChange={(value) => apply({ scale: value[0] })}
          min={0.5}
          max={1.5}
          step={0.01}
          label="Scale"
          valueDisplay={propertyValue('scale').toFixed(2)}
        />
      </div>
    </SectionWrapper>
  );
}

function ZoomSlider() {
  const { overlay: selectedOverlay } = useTransformOverlay();
  const overlayMotion = useEditableMotionPose(selectedOverlay?.id ?? '__no-overlay__');
  const mainMotion = useEditableMotionPose('asset');
  const {
    imageScale,
    setImageScale,
    updateImageOverlay,
  } = useImageStore();
  const overlayScaleMotion = selectedOverlay && hasAnimatedPropertyAtTime(selectedOverlay.id, 'scale')
    ? overlayMotion.pose?.scale ?? 1
    : 1;
  const mainScaleMotion = hasAnimatedPropertyAtTime('asset', 'scale')
    ? mainMotion.pose?.scale ?? 1
    : 1;
  // If a second image / overlay is selected, zoom/scale its size:
  if (selectedOverlay) {
    return (
      <Slider
        value={[selectedOverlay.size * overlayScaleMotion]}
        onValueChange={(value) => { if (!previewPose(selectedOverlay.id, { scale: value[0] / selectedOverlay.size })) updateImageOverlay(selectedOverlay.id, { size: value[0] }); }}
        min={20}
        max={1200}
        step={5}
        label="Size / Zoom (Selected Overlay)"
        valueDisplay={`${Math.round(selectedOverlay.size * overlayScaleMotion)}px`}
      />
    );
  }
  // Otherwise, scale the main base image:
  return (
    <Slider
      value={[imageScale / 100 * mainScaleMotion]}
      onValueChange={(value) => {
        if (previewPose('asset', { scale: value[0] / (imageScale / 100) })) return;
        setImageScale(Math.round(value[0] * 100));
      }}
      min={0.1}
      max={2}
      step={0.01}
      label="Zoom"
      valueDisplay={`${Math.round(imageScale * mainScaleMotion)}%`}
    />
  );
}

function DepthSlider() {
  const {
    perspective3D,
    setPerspective3D,
    updateImageOverlay,
  } = useImageStore();
  const { overlay: selectedOverlay } = useTransformOverlay();
  const overlayMotion = useEditableMotionPose(selectedOverlay?.id ?? '__no-overlay__');
  const mainMotion = useEditableMotionPose('asset');

  const currentDepth = selectedOverlay
    ? (hasAnimatedPropertyAtTime(selectedOverlay.id, 'perspective') ? overlayMotion.pose?.perspective ?? selectedOverlay.tilt?.perspective ?? 2400 : selectedOverlay.tilt?.perspective ?? 2400)
    : (hasAnimatedPropertyAtTime('asset', 'perspective') ? mainMotion.pose?.perspective ?? perspective3D.perspective : perspective3D.perspective);

  const handleDepthChange = (val: number) => {
    if (selectedOverlay) {
      if (!previewPose(selectedOverlay.id, { perspective: val })) updateImageOverlay(selectedOverlay.id, {
        tilt: { ...(selectedOverlay.tilt ?? DEFAULT_OVERLAY_TILT), perspective: val },
      });
    } else {
      if (!previewPose('asset', { perspective: val })) setPerspective3D({ perspective: val });
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between select-none">
        <span className="text-xs text-muted-foreground">Depth</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground tabular-nums">{formatNumber(currentDepth)}px</span>
          {currentDepth !== 2400 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDepthChange(2400);
              }}
              className="text-[10px] text-muted-foreground/70 hover:text-foreground px-1 py-0.5 rounded hover:bg-foreground/5 transition-colors cursor-pointer"
              title="Reset depth to default (2400px)"
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <Slider
        value={[currentDepth]}
        onValueChange={(val) => handleDepthChange(val[0])}
        min={100}
        max={8000}
        step={25}
      />
    </div>
  );
}

function TiltRotationSlider() {
  const {
    perspective3D,
    setPerspective3D,
    updateImageOverlay,
  } = useImageStore();
  const { overlay: selectedOverlay } = useTransformOverlay();
  const overlayMotion = useEditableMotionPose(selectedOverlay?.id ?? '__no-overlay__');
  const mainMotion = useEditableMotionPose('asset');

  if (selectedOverlay) {
    const animatedRotation = hasAnimatedPropertyAtTime(selectedOverlay.id, 'rotateZ');
    const rotation = selectedOverlay.rotation + (animatedRotation ? overlayMotion.pose?.rotateZ ?? 0 : 0);
    return (
      <Slider
        value={[rotation]}
        onValueChange={(value) => {
          if (!previewPose(selectedOverlay.id, { rotateZ: value[0] - selectedOverlay.rotation })) updateImageOverlay(selectedOverlay.id, { rotation: value[0] });
        }}
        min={-180}
        max={180}
        step={1}
        label="Rotation"
        valueDisplay={`${rotation}°`}
      />
    );
  }

  const mainRotation = hasAnimatedPropertyAtTime('asset', 'rotateZ')
    ? mainMotion.pose?.rotateZ ?? perspective3D.rotateZ
    : perspective3D.rotateZ;
  return (
    <Slider
      value={[mainRotation]}
      onValueChange={(value) => { if (!previewPose('asset', { rotateZ: value[0] })) setPerspective3D({ rotateZ: value[0] }); }}
      min={-45}
      max={45}
      step={1}
      label="Rotation"
      valueDisplay={`${mainRotation}°`}
    />
  );
}

function TransformControls() {
  const [controlMode, setControlMode] = React.useState<ControlMode>('tilt');

  return (
    <div className="space-y-3">
      <SegmentedControl
        options={[
          { id: 'tilt', label: 'Tilt' },
          { id: 'zoom', label: 'Zoom' },
        ]}
        value={controlMode}
        onChange={(v) => setControlMode(v as ControlMode)}
        size="sm"
      />

      <TransformPreview mode={controlMode} />

      {controlMode === 'zoom' ? (
        <ZoomSlider />
      ) : (
        <div className="space-y-3">
          <ZoomSlider />
          <DepthSlider />
          <TiltRotationSlider />
        </div>
      )}
    </div>
  );
}

// ─── Animation Tab (same pattern as 3D) ────────────────────────────────────

function AnimationControls() { return <AnimationPresetGallery />; }

// ─── Main Panel ─────────────────────────────────────────────────────────────

export function RightSettingsPanel() {
  const { activeRightPanelTab, setActiveRightPanelTab } = useImageStore();
  const activeTab: RightTabType = activeRightPanelTab === 'animate' ? 'animate' : 'transforms';

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
          onChange={(id) => setActiveRightPanelTab(id as RightTabType)}
          options={rightTabs.map((tab) => ({
            id: tab.id,
            label: tab.label,
            icon: tab.icon,
            ariaLabel: tab.label,
          }))}
        />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
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
