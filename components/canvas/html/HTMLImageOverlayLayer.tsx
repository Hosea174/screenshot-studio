'use client';

import { useCallback, useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { beginMotionDrag } from '@/lib/animation/drag-history';
import { useMotionSelection } from '@/lib/animation/editor';
import { editingClip, hasAnimatedPropertyAtTime, motionPose, previewPose, selectMotionTarget } from '@/lib/animation/authoring';
import { ShadowDefinition } from './ShadowDefinition';
import { VideoLayerMedia } from './VideoLayerMedia';
import { videoVisibleAt } from '@/lib/export/video-timing';
import Moveable from 'react-moveable';
import { useImageStore, type ImageFilters, type ImageBorder } from '@/lib/store';
import { getClipInterpolatedProperties } from '@/lib/animation/interpolation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';
import type { ImageOverlay } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  buildOverlayShadowFilter,
  buildOverlayTiltTransform,
  fitOverlayImage,
} from '@/lib/overlay-style';

const NEUTRAL_IMAGE_FILTERS: ImageFilters = {
  brightness: 100,
  contrast: 100,
  grayscale: 0,
  blur: 0,
  hueRotate: 0,
  invert: 0,
  saturate: 100,
  sepia: 0,
};
import {
  Delete02Icon,
  Copy01Icon,
  LayerSendToBackIcon,
  LayerBringToFrontIcon,
} from 'hugeicons-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface HTMLImageOverlayLayerProps {
  imageOverlays: ImageOverlay[];
  loadedOverlayImages: Record<string, HTMLImageElement>;
  selectedOverlayId: string | null;
  setSelectedOverlayId: (id: string | null) => void;
  setIsMainImageSelected: (selected: boolean) => void;
  setSelectedTextId: (id: string | null) => void;
  updateImageOverlay: (id: string, updates: Partial<ImageOverlay>) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
  canvasW: number;
  canvasH: number;
  onDragStateChange?: (dragging: boolean) => void;
  onSnapOffsetsChange?: (offsets: { x: number; y: number } | null) => void;
  zIndex?: number;
}

const CENTER_SNAP_THRESHOLD = 8;

// ── Single overlay element ───────────────────────────────────────────────────

function OverlayElement({
  overlay,
  overlayImg,
  onSelect,
  elRef,
}: {
  overlay: ImageOverlay;
  overlayImg: HTMLImageElement;
  onSelect: () => void;
  elRef?: (el: HTMLDivElement | null) => void;
}) {
  const timeline = useImageStore(s => s.timeline);
  const clips = useImageStore(s => s.animationClips);
  const imageFilters = useImageStore(s => s.imageFilters);
  const imageBorder = useImageStore(s => s.imageBorder);
  const borderRadius = useImageStore(s => s.borderRadius);
  const imageOpacity = useImageStore(s => s.imageOpacity);
  const perspective3D = useImageStore(s => s.perspective3D);
  const uploadedImageUrl = useImageStore(s => s.uploadedImageUrl);
  const overlayCount = useImageStore(s => s.imageOverlays.length);
  const isPrimaryOverlay = overlay.inheritMainStyle || (!uploadedImageUrl && overlayCount === 1);
  const draft = useMotionSelection(s => s.draft);
  const motion = getClipInterpolatedProperties(clips, timeline.tracks, timeline.playhead, DEFAULT_ANIMATABLE_PROPERTIES, overlay.id);
  if (draft && draft.time === timeline.playhead && clips.some(c => c.id === draft.clipId && c.target === overlay.id)) Object.assign(motion, draft.properties);
  const hasAnimatedPerspective = hasAnimatedPropertyAtTime(overlay.id, 'perspective', timeline.playhead);
  const effectivePerspective = hasAnimatedPerspective
    ? motion.perspective
    : isPrimaryOverlay
      ? perspective3D.perspective
      : overlay.tilt?.perspective ?? DEFAULT_ANIMATABLE_PROPERTIES.perspective;
  const isShadow = useMemo(
    () => typeof overlay.src === 'string' && overlay.src.includes('overlay-shadow'),
    [overlay.src]
  );

  if (!overlay.isVisible) return null;

  if (isShadow) {
    return (
      <div
        ref={elRef}
        data-overlay-id={overlay.id}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: overlay.opacity * motion.imageOpacity * (overlay.mediaType === 'video' && !videoVisibleAt(overlay, timeline.playhead) ? 0 : 1),
          userSelect: 'none',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        <img
          src={overlayImg.src}
          alt="Shadow overlay"
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    );
  }

  const imageTransform = [
    buildOverlayTiltTransform(overlay.tilt),
    overlay.flipX ? 'scaleX(-1)' : '',
    overlay.flipY ? 'scaleY(-1)' : '',
  ].filter(Boolean).join(' ');
  const fitted = fitOverlayImage(overlay.mediaWidth ?? overlayImg.naturalWidth, overlay.mediaHeight ?? overlayImg.naturalHeight);
  const frameWidth = overlay.size * fitted.width / 100;
  const frameHeight = overlay.size * fitted.height / 100;
  const frame = overlay.frame ?? (isPrimaryOverlay ? imageBorder : undefined);
  const hasFrame = Boolean(frame?.enabled && frame.type !== 'none');
  const padding = hasFrame ? Math.max(0, Math.round(frameWidth * (frame?.padding ?? 0) / 100)) : 0;
  const imageFilter = buildOverlayImageFilter(isPrimaryOverlay ? imageFilters : NEUTRAL_IMAGE_FILTERS, overlay.shadow, overlay.id);
  const frameBackground = frame ? overlayFrameBackground(frame) : 'transparent';
  const radius = overlay.radius ?? (isPrimaryOverlay ? borderRadius : 0);
  const frameRadius = radius + padding;

  return (
    <div
      ref={elRef}
      data-overlay-id={overlay.id}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      style={{
        position: 'absolute',
        left: `${overlay.position.x - frameWidth / 2}px`,
        top: `${overlay.position.y - frameHeight / 2}px`,
        width: `${frameWidth}px`,
        height: `${frameHeight}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `perspective(${effectivePerspective}px) translate(${motion.translateX + (isPrimaryOverlay ? perspective3D.translateX : 0)}%, ${motion.translateY + (isPrimaryOverlay ? perspective3D.translateY : 0)}%) rotateX(${motion.rotateX + (isPrimaryOverlay ? perspective3D.rotateX : 0)}deg) rotateY(${motion.rotateY + (isPrimaryOverlay ? perspective3D.rotateY : 0)}deg) rotate(${overlay.rotation + motion.rotateZ + (isPrimaryOverlay ? perspective3D.rotateZ : 0)}deg) scale(${motion.scale * (overlay.scale ?? (isPrimaryOverlay ? perspective3D.scale : 1))})`,
        perspective: `${hasAnimatedPerspective ? motion.perspective : overlay.tilt?.perspective ?? DEFAULT_ANIMATABLE_PROPERTIES.perspective}px`,
        opacity: overlay.opacity * motion.imageOpacity * (isPrimaryOverlay ? imageOpacity : 1) * (overlay.mediaType === 'video' && !videoVisibleAt(overlay, timeline.playhead) ? 0 : 1),
        visibility: overlay.mediaType === 'video' && !videoVisibleAt(overlay, timeline.playhead) ? 'hidden' : undefined,
        filter: (overlay.blur ?? 0) > 0 ? `blur(${overlay.blur}px)` : undefined,
        cursor: 'grab',
        userSelect: 'none',
        pointerEvents: 'auto',
      }}
    >
      {overlay.shadow?.enabled && <ShadowDefinition id={`shadow-${overlay.id}`} shadow={overlay.shadow} />}
      <div style={hasFrame ? { width: '100%', height: '100%', boxSizing: 'border-box', padding: `${padding}px`, borderRadius: `${frameRadius}px`, background: frameBackground, border: frame?.type === 'border-light' || frame?.type === 'border-dark' ? `${Math.max(1, frame.width || 2)}px solid ${frame.color || (frame.type === 'border-dark' ? '#1e1e1e' : '#ffffff')}` : frame?.type === 'outline-light' ? `${Math.max(1, frame.width || 1)}px solid rgba(255,255,255,${frame.opacity ?? 0.35})` : undefined, overflow: 'hidden' } : { width: '100%', height: '100%' }}>
      {overlay.mediaType === 'video' ? <VideoLayerMedia overlay={overlay} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', borderRadius: radius ? `${radius}px` : undefined, filter: imageFilter, transform: imageTransform || undefined, pointerEvents: 'none' }} /> : (
      <img
        src={overlayImg.src}
        alt="Overlay"
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          borderRadius: radius ? `${radius}px` : undefined,
          filter: imageFilter,
          transform: imageTransform || undefined,
          pointerEvents: 'none',
        }}
      />
      )}
      </div>
    </div>
  );
}

function buildOverlayImageFilter(filters: ImageFilters, shadow: ImageOverlay['shadow'], id: string): string | undefined {
  const values: string[] = [];
  if (filters.brightness !== 100) values.push(`brightness(${filters.brightness / 100})`);
  if (filters.contrast !== 100) values.push(`contrast(${filters.contrast / 100})`);
  if (filters.saturate !== 100) values.push(`saturate(${filters.saturate / 100})`);
  if (filters.grayscale > 0) values.push(`grayscale(${filters.grayscale / 100})`);
  if (filters.sepia > 0) values.push(`sepia(${filters.sepia / 100})`);
  if (filters.hueRotate !== 0) values.push(`hue-rotate(${filters.hueRotate}deg)`);
  if (filters.blur > 0) values.push(`blur(${filters.blur}px)`);
  if (filters.invert > 0) values.push(`invert(${filters.invert / 100})`);
  if (shadow?.enabled && (shadow.spread ?? 0) > 0) values.push(`url(#shadow-${id})`);
  else {
    const shadowFilter = buildOverlayShadowFilter(shadow);
    if (shadowFilter) values.push(shadowFilter);
  }
  return values.length ? values.join(' ') : undefined;
}

function overlayFrameBackground(frame: ImageBorder): string {
  if (frame.type === 'glass-light') return `rgba(255,255,255,${frame.opacity ?? 0.25})`;
  if (frame.type === 'glass-dark') return `rgba(0,0,0,${frame.opacity ?? 0.3})`;
  if (frame.type === 'outline-light') return `rgba(255,255,255,${frame.opacity ?? 0.35})`;
  if (frame.type === 'border-dark') return frame.color || '#1e1e1e';
  if (frame.type === 'border-light') return frame.color || '#ffffff';
  return 'transparent';
}

// ── Context toolbar (minimal, bottom-anchored) ──────────────────────────────

function ContextToolbar({
  overlay,
  onUpdate,
  onDuplicate,
  onDelete,
}: {
  overlay: ImageOverlay;
  onUpdate: (updates: Partial<ImageOverlay>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const isFront = (overlay.layer || 'front') === 'front';

  return (
    <div
      className={cn(
        'absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-[calc(100%+8px)]',
        'z-[999] flex h-8 items-center gap-0.5 rounded-md px-1',
        'bg-card border border-foreground/10',
        'shadow-lg',
        'animate-in fade-in-0 zoom-in-95 duration-100'
      )}
      style={{ pointerEvents: 'auto' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUpdate({ layer: isFront ? 'back' : 'front' });
        }}
        className={cn(
          'flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-150',
          'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
        )}
        title={isFront ? 'Send behind image' : 'Bring to front'}
      >
        {isFront ? <LayerSendToBackIcon size={14} /> : <LayerBringToFrontIcon size={14} />}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground"
        title="Duplicate"
      >
        <Copy01Icon size={14} />
      </button>
      <div className="mx-0.5 h-3.5 w-px bg-foreground/10" aria-hidden />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-destructive/15 hover:text-destructive"
        title="Delete"
      >
        <Delete02Icon size={14} />
      </button>
    </div>
  );
}

// ── Main layer component ─────────────────────────────────────────────────────

export function HTMLImageOverlayLayer({
  imageOverlays,
  loadedOverlayImages,
  selectedOverlayId,
  setSelectedOverlayId,
  setIsMainImageSelected,
  setSelectedTextId,
  updateImageOverlay,
  onDuplicate,
  onDelete,
  canvasW,
  canvasH,
  onDragStateChange,
  onSnapOffsetsChange,
  zIndex = 200,
}: HTMLImageOverlayLayerProps) {
  const [selectedEl, setSelectedEl] = useState<HTMLDivElement | null>(null);
  const [interacting, setInteracting] = useState(false);
  const [recoveryAnchor, setRecoveryAnchor] = useState<{ left: number; top: number } | null>(null);
  const moveableRef = useRef<Moveable | null>(null);
  const draft = useMotionSelection(s => s.draft);
  const playhead = useImageStore(s => s.timeline.playhead);
  const gesturePose = useRef(DEFAULT_ANIMATABLE_PROPERTIES);
  const finishHistory = useRef<(() => void) | null>(null);
  const finishGesture = () => { finishHistory.current?.(); finishHistory.current = null; };
  useEffect(() => () => finishHistory.current?.(), []);
  const tracks = useImageStore(s => s.timeline.tracks);
  const startGesture = () => {
    finishGesture();
    finishHistory.current = beginMotionDrag();
    setInteracting(true);
    const clip = editingClip(selectedOverlayId ?? undefined);
    gesturePose.current = clip ? motionPose(clip) : DEFAULT_ANIMATABLE_PROPERTIES;
  };
  const startDragGesture = () => {
    startGesture();
    onDragStateChange?.(true);
  };
  const finishDragGesture = () => {
    setInteracting(false);
    onDragStateChange?.(false);
    onSnapOffsetsChange?.(null);
  };
  const resetElement = (target: HTMLElement | SVGElement, overlay: ImageOverlay) => {
    const fitted = fitOverlayImage(overlay.mediaWidth ?? selectedEl?.querySelector('img')?.naturalWidth ?? 1, overlay.mediaHeight ?? selectedEl?.querySelector('img')?.naturalHeight ?? 1);
    const width = overlay.size * fitted.width / 100;
    const height = overlay.size * fitted.height / 100;
    target.style.left = `${overlay.position.x - width / 2}px`;
    target.style.top = `${overlay.position.y - height / 2}px`;
    target.style.width = `${width}px`;
    target.style.height = `${height}px`;
  };

  const handleSelect = useCallback(
    (id: string) => {
      selectMotionTarget(id);
      setSelectedOverlayId(id);
      setIsMainImageSelected(false);
      setSelectedTextId(null);
    },
    [setSelectedOverlayId, setIsMainImageSelected, setSelectedTextId]
  );

  const selectedOverlay = selectedOverlayId
    ? imageOverlays.find((o) => o.id === selectedOverlayId)
    : null;

  const isShadow = selectedOverlay?.src.includes('overlay-shadow');
  const selectedImage = selectedOverlay ? loadedOverlayImages[selectedOverlay.id] : undefined;
  const selectedFit = selectedOverlay ? fitOverlayImage(selectedOverlay.mediaWidth ?? selectedImage?.naturalWidth ?? 1, selectedOverlay.mediaHeight ?? selectedImage?.naturalHeight ?? 1) : { width: 100, height: 100 };
  const frameWidth = selectedOverlay ? selectedOverlay.size * selectedFit.width / 100 : 0;
  const frameHeight = selectedOverlay ? selectedOverlay.size * selectedFit.height / 100 : 0;

  // Keep Moveable and the recovery action synchronized with transforms applied
  // inside OverlayElement. Its DOM updates can land after this component's
  // layout effect, so measure on the next frame and observe style changes too.
  const updateSelectedControls = useCallback(() => {
    // Moveable writes the target's inline geometry during a gesture. Updating
    // its rect in response to those same mutations can cancel or jump the drag.
    if (interacting) return;
    moveableRef.current?.updateRect();
    const rect = selectedEl?.getBoundingClientRect();
    const viewport = selectedEl?.closest('[data-canvas-viewport]')?.getBoundingClientRect();
    const anchor = rect && viewport && (
      rect.left < viewport.left || rect.top < viewport.top ||
      rect.right > viewport.right || rect.bottom > viewport.bottom
    ) ? { left: viewport.right - 110, top: viewport.top + 12 } : null;
    setRecoveryAnchor(old => old?.left === anchor?.left && old?.top === anchor?.top ? old : anchor);
  }, [interacting, selectedEl]);

  useLayoutEffect(() => {
    let frame = requestAnimationFrame(updateSelectedControls);
    const scheduleUpdate = () => {
      if (interacting) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateSelectedControls);
    };
    const viewport = selectedEl?.closest('[data-canvas-viewport]');
    const mutationObserver = selectedEl ? new MutationObserver(scheduleUpdate) : null;
    if (selectedEl) mutationObserver?.observe(selectedEl, { attributes: true, attributeFilter: ['style'] });
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleUpdate) : null;
    if (selectedEl) resizeObserver?.observe(selectedEl);
    if (viewport) resizeObserver?.observe(viewport);
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    return () => {
      cancelAnimationFrame(frame);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, [interacting, selectedEl, updateSelectedControls]);

  useLayoutEffect(() => {
    updateSelectedControls();
  }, [
    updateSelectedControls,
    draft, playhead, tracks, selectedEl, interacting, canvasW, canvasH,
    selectedOverlay?.size,
    selectedOverlay?.scale,
    selectedOverlay?.radius,
    selectedOverlay?.frame,
    selectedOverlay?.position.x,
    selectedOverlay?.position.y,
    selectedOverlay?.rotation,
    selectedOverlay?.flipX,
    selectedOverlay?.flipY,
    selectedOverlay?.blur,
  ]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex,
        overflow: 'visible',
      }}
    >
      {imageOverlays.map((overlay) => {
        if (!overlay.isVisible) return null;
        const overlayImg = loadedOverlayImages[overlay.id];
        if (!overlayImg) return null;

        return (
          <OverlayElement
            key={overlay.id}
            overlay={overlay}
            overlayImg={overlayImg}
            onSelect={() => handleSelect(overlay.id)}
            elRef={overlay.id === selectedOverlayId ? setSelectedEl : undefined}
          />
        );
      })}

      {selectedOverlay && selectedEl && !isShadow && (
        <>
          {createPortal(<Moveable
            ref={moveableRef}
            container={document.body}
            target={selectedEl}
            draggable={true}
            resizable={true}
            rotatable={true}
            keepRatio={true}
            throttleDrag={0}
            throttleResize={0}
            throttleRotate={0}
            renderDirections={['nw', 'ne', 'sw', 'se']}
            rotationPosition={'top'}
            origin={false}
            edge={false}
            onDragStart={startDragGesture}
            onDrag={({ target, left, top }) => {
              const width = parseFloat(target.style.width);
              const height = parseFloat(target.style.height);
              let snappedLeft = left;
              let snappedTop = top;
              const offsetX = left + width / 2 - canvasW / 2;
              const offsetY = top + height / 2 - canvasH / 2;
              if (Math.abs(offsetX) <= CENTER_SNAP_THRESHOLD) snappedLeft -= offsetX;
              if (Math.abs(offsetY) <= CENTER_SNAP_THRESHOLD) snappedTop -= offsetY;
              onSnapOffsetsChange?.({ x: offsetX, y: offsetY });
              target.style.left = `${snappedLeft}px`;
              target.style.top = `${snappedTop}px`;
            }}
            onDragEnd={({ target }) => {
              finishDragGesture();
              const left = parseFloat(target.style.left);
              const top = parseFloat(target.style.top);
              const w = parseFloat(target.style.width);
              const h = parseFloat(target.style.height);
              if (previewPose(selectedOverlay.id, { translateX: gesturePose.current.translateX + (left + w / 2 - selectedOverlay.position.x) / frameWidth * 100, translateY: gesturePose.current.translateY + (top + h / 2 - selectedOverlay.position.y) / frameHeight * 100 })) resetElement(target, selectedOverlay);
              else updateImageOverlay(selectedOverlay.id, { position: { x: left + w / 2, y: top + h / 2 } });
              finishGesture();
            }}
            onResizeStart={startGesture}
            onBeforeResize={({ inputEvent, setFixedDirection, startFixedDirection }) => setFixedDirection(inputEvent?.shiftKey && inputEvent?.altKey ? [0, 0] : startFixedDirection)}
            onResize={({ target, width, height, drag }) => {
              target.style.width = `${width}px`;
              target.style.height = `${height}px`;
              target.style.left = `${drag.left}px`;
              target.style.top = `${drag.top}px`;
            }}
            onResizeEnd={({ target }) => {
              setInteracting(false);
              const w = parseFloat(target.style.width);
              const h = parseFloat(target.style.height);
              const left = parseFloat(target.style.left);
              const top = parseFloat(target.style.top);
              if (previewPose(selectedOverlay.id, { scale: Math.max(0.05, Math.min(5, gesturePose.current.scale * Math.max(w, h) / selectedOverlay.size)), translateX: gesturePose.current.translateX + (left + w / 2 - selectedOverlay.position.x) / frameWidth * 100, translateY: gesturePose.current.translateY + (top + h / 2 - selectedOverlay.position.y) / frameHeight * 100 })) { resetElement(target, selectedOverlay); finishGesture(); return; }
              updateImageOverlay(selectedOverlay.id, {
                size: Math.round(Math.max(w, h)),
                position: { x: left + w / 2, y: top + h / 2 },
              });
              finishGesture();
            }}
            onRotateStart={startGesture}
            onRotate={({ target, transform }) => {
              target.style.transform = transform;
            }}
            onRotateEnd={({ target }) => {
              setInteracting(false);
              const match = target.style.transform.match(/rotate\(([-\d.]+)deg\)/);
              if (match) {
                let deg = parseFloat(match[1]) % 360;
                if (deg > 180) deg -= 360;
                if (deg < -180) deg += 360;
                if (!previewPose(selectedOverlay.id, { rotateZ: Math.round(deg) - selectedOverlay.rotation })) updateImageOverlay(selectedOverlay.id, { rotation: Math.round(deg) });
              }
              finishGesture();
            }}
          />, document.body)}

          {recoveryAnchor && createPortal(<button type="button" data-resize-handle="true" aria-label="Fit selected layer to canvas" className="rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground shadow" style={{ position: 'fixed', ...recoveryAnchor, zIndex: 3001 }} onClick={() => {
            const finish = beginMotionDrag();
            const rect = selectedEl.getBoundingClientRect();
            const factor = Math.min(canvasW / rect.width, canvasH / rect.height) * 0.8;
            const clip = editingClip(selectedOverlay.id);
            if (clip) previewPose(selectedOverlay.id, { scale: Math.max(0.05, motionPose(clip).scale * factor), translateX: (canvasW / 2 - selectedOverlay.position.x) / frameWidth * 100, translateY: (canvasH / 2 - selectedOverlay.position.y) / frameHeight * 100 });
            else updateImageOverlay(selectedOverlay.id, { size: selectedOverlay.size * factor, position: { x: canvasW / 2, y: canvasH / 2 } });
            finish();
          }}>Fit layer</button>, document.body)}

          {!interacting && (
            <div
              data-export-exclude="true"
              style={{
                position: 'absolute',
                left: `${selectedOverlay.position.x - frameWidth / 2}px`,
                top: `${selectedOverlay.position.y - frameHeight / 2}px`,
                width: `${frameWidth}px`,
                height: `${frameHeight}px`,
                pointerEvents: 'none',
              }}
            >
              <ContextToolbar
                overlay={selectedOverlay}
                onUpdate={(updates) => updateImageOverlay(selectedOverlay.id, updates)}
                onDuplicate={() => onDuplicate?.(selectedOverlay.id)}
                onDelete={() => onDelete?.(selectedOverlay.id)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
