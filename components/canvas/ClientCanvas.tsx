"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useEditorStore, useImageStore, useEditorStoreSync } from "@/lib/store";
import { rebaseCanvasGeometry } from "@/lib/store/canvas-layout";
import { generatePattern } from "@/lib/patterns";
import { useResponsiveCanvasDimensions } from "@/hooks/useAspectRatioDimensions";
import { generateNoiseTexture } from "@/lib/export/export-utils";
import { MockupSceneRenderer } from "@/components/mockups/MockupRenderer";
import { useDeviceUIStore } from "@/lib/store/device-ui";
import { useEditorProjectSession } from "@/lib/editor-projects/session";
import { useMotionSelection } from '@/lib/animation/editor';
import { shouldIgnoreEditorShortcut } from "@/lib/editor-shortcuts";
import { calculateCanvasDimensions } from "./utils/canvas-dimensions";
import { CanvasStageShell } from "./CanvasStageShell";
import { useOverlayImages } from "./hooks/useImageLoading";
import {
  HTMLCanvasRenderer,
  HTMLBackgroundLayer,
  HTMLPatternLayer,
  HTMLNoiseLayer,
  HTMLMainImageLayer,
  HTMLTextOverlayLayer,
  HTMLImageOverlayLayer,
  SVGAnnotationLayer,
  HTMLBlurRegionLayer,
  SnapAlignmentGuides,
  HTMLGridLayer,
} from "./html";
import { CanvasRulers } from "./CanvasRulers";
import {
  hasVisibleMockups,
  shouldRenderSourceImage,
} from "@/lib/device-mockups/layouts";

// Reference to the HTML canvas container for export
let globalCanvasContainer: HTMLDivElement | null = null;

function CanvasRenderer({ image }: { image: HTMLImageElement }) {
  useEditorStoreSync();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const {
    screenshot,
    setScreenshot,
    shadow,
    pattern: patternStyle,
    frame: editorFrame,
    canvas,
    noise,
  } = useEditorStore();

  const {
    backgroundConfig,
    uploadedImageUrl,
    backgroundBorderRadius,
    backgroundBlur,
    backgroundNoise,
    perspective3D,
    imageOpacity,
    imageFilters,
    textOverlays,
    imageOverlays,
    mockups,
    editorMode,
    imageBorder,
    updateTextOverlay,
    updateImageOverlay,
    removeImageOverlay,
    removeMockup,
    // Annotations
    annotations,
    activeAnnotationTool,
    selectedAnnotationId,
    setSelectedAnnotationId,
    annotationDefaults,
    addAnnotation,
    updateAnnotation: updateAnnotationShape,
    removeAnnotation,
    setActiveAnnotationTool,
    // Blur
    blurRegions,
    addBlurRegion,
    updateBlurRegion,
    removeBlurRegion,
    browserHeaderSize,
    showRulers,
    showGrid,
    rulerInterval,
    selectedOverlayId,
    setSelectedOverlayId,
    isMainImageSelected,
    setIsMainImageSelected,
  } = useImageStore();

  // Split overlays into front (default) and back (behind main image)
  const backOverlays = imageOverlays.filter((o) => o.layer === 'back');
  const frontOverlays = imageOverlays.filter((o) => o.layer !== 'back');

  // Build frame from imageBorder directly (editorStore sync may be stale)
  const frame = {
    ...editorFrame,
    enabled: imageBorder.enabled,
    type: imageBorder.type,
    width: imageBorder.width,
    color: imageBorder.color,
    padding: imageBorder.padding,
    title: imageBorder.title,
    opacity: imageBorder.opacity,
  };

  const hasDeviceScene = editorMode === "device" && hasVisibleMockups(mockups);
  const hasSourceImage = !!uploadedImageUrl && !!screenshot.src && shouldRenderSourceImage(editorMode, mockups);
  const selectedDeviceId = useDeviceUIStore((state) => state.selectedDeviceId);
  const setSelectedDeviceId = useDeviceUIStore((state) => state.setSelectedDeviceId);
  const setEditingScreenDeviceId = useDeviceUIStore((state) => state.setEditingScreenDeviceId);
  const responsiveDimensions = useResponsiveCanvasDimensions();

  const [viewportSize, setViewportSize] = useState({
    width: 1920,
    height: 1080,
  });

  const [patternImage, setPatternImage] = useState<HTMLCanvasElement | null>(
    null
  );
  const [noiseImage, setNoiseImage] = useState<HTMLImageElement | null>(null);
  const [noiseTexture, setNoiseTexture] = useState<HTMLCanvasElement | null>(
    null
  );

  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [isDraggingMainImage, setIsDraggingMainImage] = useState(false);
  const [isDraggingOverlay, setIsDraggingOverlay] = useState(false);
  const [overlaySnapOffsets, setOverlaySnapOffsets] = useState<{ x: number; y: number } | null>(null);
  const [selectedBlurId, setSelectedBlurId] = useState<string | null>(null);


  const containerWidth = responsiveDimensions.width;
  const containerHeight = responsiveDimensions.height;

  const loadedOverlayImages = useOverlayImages(imageOverlays);

  // Update global reference for export
  useEffect(() => {
    if (canvasContainerRef.current) {
      globalCanvasContainer = canvasContainerRef.current;
    }
    return () => {
      globalCanvasContainer = null;
    };
  }, []);

  // Clear selection when clicking outside of canvas
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      const container = containerRef.current;
      if (!container) return;

      if (!container.contains(target)) {
        // Don't deselect when interacting with editor panel controls
        // (sliders, inputs, buttons, etc.) so users can tweak selected items
        const el = target as HTMLElement;
        if (el.closest?.('[data-slot="slider"], input, button, [role="button"], [data-radix-collection-item], .moveable-control-box, [data-resize-handle]')) return;

        setSelectedOverlayId(null);
        setIsMainImageSelected(false);
        setSelectedTextId(null);
        setSelectedBlurId(null);
        setSelectedAnnotationId(null);
        setSelectedDeviceId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [setSelectedAnnotationId, setSelectedDeviceId, setSelectedOverlayId, setIsMainImageSelected]);

  useEffect(() => {
    if (!selectedDeviceId) return;
    useMotionSelection.getState().selectClip(null);
    setSelectedOverlayId(null);
    setIsMainImageSelected(false);
    setSelectedTextId(null);
    setSelectedBlurId(null);
    setSelectedAnnotationId(null);
  }, [selectedDeviceId, setSelectedAnnotationId, setSelectedOverlayId, setIsMainImageSelected]);

  // Panel selection must clear the same competing selections as a canvas click.
  useEffect(() => {
    if (!selectedOverlayId && !isMainImageSelected) return;
    setSelectedTextId(null);
    setSelectedBlurId(null);
    setSelectedAnnotationId(null);
    setSelectedDeviceId(null);
  }, [selectedOverlayId, isMainImageSelected, setSelectedAnnotationId, setSelectedDeviceId]);

  // Selection shortcuts; history lives in the always-mounted editor header.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreEditorShortcut(e)) return;
      const sendToBack = e.key === '[' || (e.code === 'BracketLeft' && !e.shiftKey);
      const bringToFront = e.key === ']' || (e.code === 'BracketRight' && !e.shiftKey);
      if (selectedOverlayId && (sendToBack || bringToFront) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        updateImageOverlay(selectedOverlayId, { layer: sendToBack ? 'back' : 'front' });
        return;
      }

      if (useMotionSelection.getState().clipId && useImageStore.getState().showTimeline) return;

      // Delete selected overlay or main image (only when not typing)
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedDeviceId && editorMode === "device") {
          e.preventDefault();
          removeMockup(selectedDeviceId);
          setSelectedDeviceId(null);
        } else if (selectedOverlayId) {
          e.preventDefault();
          removeImageOverlay(selectedOverlayId);
          setSelectedOverlayId(null);
        } else if (selectedTextId) {
          e.preventDefault();
          useImageStore.getState().removeTextOverlay(selectedTextId);
          setSelectedTextId(null);
        } else if (isMainImageSelected) {
          e.preventDefault();
          useImageStore.getState().clearImage();
          setIsMainImageSelected(false);
        }
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedOverlayId(null);
        setIsMainImageSelected(false);
        setSelectedTextId(null);
        setSelectedBlurId(null);
        setSelectedAnnotationId(null);
        setSelectedDeviceId(null);
        setEditingScreenDeviceId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editorMode, isMainImageSelected, removeImageOverlay, removeMockup, selectedDeviceId, selectedOverlayId, selectedTextId, updateImageOverlay, setSelectedDeviceId, setSelectedOverlayId, setIsMainImageSelected, setSelectedAnnotationId, setEditingScreenDeviceId]);

  useEffect(() => {
    if (backgroundNoise > 0) {
      const intensity = backgroundNoise / 100;
      const noiseCanvas = generateNoiseTexture(200, 200, intensity);
      setNoiseTexture(noiseCanvas);
    } else {
      setNoiseTexture(null);
    }
  }, [backgroundNoise]);

  useEffect(() => {
    const updateViewportSize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateViewportSize();
    window.addEventListener("resize", updateViewportSize);
    return () => window.removeEventListener("resize", updateViewportSize);
  }, []);

  useEffect(() => {
    if (!patternStyle.enabled) {
      setPatternImage(null);
      return;
    }

    const newPattern = generatePattern(
      patternStyle.type,
      patternStyle.scale,
      patternStyle.spacing,
      patternStyle.color,
      patternStyle.rotation,
      patternStyle.blur
    );
    setPatternImage(newPattern);
  }, [
    patternStyle.enabled,
    patternStyle.type,
    patternStyle.scale,
    patternStyle.spacing,
    patternStyle.color,
    patternStyle.rotation,
    patternStyle.blur,
  ]);

  useEffect(() => {
    if (!noise.enabled || noise.type === "none") {
      setNoiseImage(null);
      return;
    }

    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setNoiseImage(img);
    img.onerror = () => setNoiseImage(null);
    img.src = `/${noise.type}.jpg`;
  }, [noise.enabled, noise.type]);

  const dimensions = calculateCanvasDimensions(
    image,
    containerWidth,
    containerHeight,
    viewportSize,
    canvas,
    screenshot,
    frame,
    browserHeaderSize
  );

  const {
    canvasW,
    canvasH,
    imageScaledW,
    imageScaledH,
    framedW,
    framedH,
    frameOffset,
    windowPadding,
    windowHeader,
    eclipseBorder,
    groupCenterX,
    groupCenterY,
  } = dimensions;

  const setCanvasDimensions = useImageStore((s) => s.setCanvasDimensions);
  const prevDimensionsRef = useRef(useImageStore.getState().canvasDimensions);
  const activeProjectId = useEditorProjectSession((s) => s.activeProjectId);
  const prevProjectIdRef = useRef(activeProjectId);
  useLayoutEffect(() => {
    if (prevProjectIdRef.current === activeProjectId) return;
    prevProjectIdRef.current = activeProjectId;
    // The newly restored project's saved canvas size is the geometry's source
    // coordinate space. Never scale it against the project we just left.
    prevDimensionsRef.current = useImageStore.getState().canvasDimensions;
  }, [activeProjectId]);
  useEffect(() => {
    if (!responsiveDimensions.measured) return;
    const prev = prevDimensionsRef.current;
    if (prev && prev.canvasW > 0 && prev.canvasH > 0 && (prev.canvasW !== canvasW || prev.canvasH !== canvasH)) {
      const sx = canvasW / prev.canvasW;
      const sy = canvasH / prev.canvasH;
      rebaseCanvasGeometry(sx, sy);
    }
    prevDimensionsRef.current = { canvasW, canvasH, framedW, framedH };
    setCanvasDimensions({ canvasW, canvasH, framedW, framedH });
  }, [activeProjectId, canvasW, canvasH, framedW, framedH, responsiveDimensions.measured, setCanvasDimensions, setScreenshot]);

  const showFrame = frame.enabled && frame.type !== "none";

  let selectedSelector: string | null = null;
  if (isMainImageSelected) {
    selectedSelector = '[data-main-image-layer="true"]';
  } else if (selectedOverlayId) {
    selectedSelector = `[data-overlay-id="${CSS.escape(selectedOverlayId)}"]`;
  }

  const has3DTransform =
    perspective3D.rotateX !== 0 ||
    perspective3D.rotateY !== 0 ||
    perspective3D.rotateZ !== 0 ||
    perspective3D.translateX !== 0 ||
    perspective3D.translateY !== 0 ||
    perspective3D.scale !== 1;

  // Deselect everything on mousedown on the canvas background.
  // Child elements (image, overlays) call e.stopPropagation() on mousedown,
  // so this only fires when clicking empty canvas area.
  const handleCanvasDeselect = (e: React.PointerEvent) => {
    // Don't deselect when interacting with resize/rotate handles
    const target = e.target as HTMLElement;
    if (target.closest?.('.moveable-control-box, [data-resize-handle]')) return;

    setSelectedOverlayId(null);
    setIsMainImageSelected(false);
    setSelectedTextId(null);
    setSelectedBlurId(null);
    setSelectedAnnotationId(null);
    setEditingScreenDeviceId(null);
    setSelectedDeviceId(null);
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        // Canvas objects prevent pointer defaults while dragging; move focus
        // out of a previously edited panel field before handling shortcuts.
        if (!shouldIgnoreEditorShortcut(event)) event.currentTarget.focus({ preventScroll: true });
      }}
      className="relative h-full w-full"
      style={{
        lineHeight: 0,
        ...(showRulers ? { marginTop: 20, marginLeft: 20 } : {}),
      }}
    >
      {showRulers && (
        <CanvasRulers
          canvasRef={canvasContainerRef}
          canvasW={canvasW}
          majorEvery={rulerInterval}
          selectedSelector={selectedSelector}
        />
      )}
      <HTMLCanvasRenderer
        ref={canvasContainerRef}
        width={canvasW}
        height={canvasH}
        borderRadius={backgroundBorderRadius}
        onPointerDown={handleCanvasDeselect}
        style={{
          isolation: "isolate",
        }}
      >
        <HTMLBackgroundLayer
          backgroundConfig={backgroundConfig}
          backgroundBlur={backgroundBlur}
          backgroundBorderRadius={backgroundBorderRadius}
          width={canvasW}
          height={canvasH}
          noiseTexture={noiseTexture}
          backgroundNoise={backgroundNoise}
        />

        <HTMLPatternLayer
          patternImage={patternImage}
          width={canvasW}
          height={canvasH}
          patternOpacity={patternStyle.opacity}
        />

        <HTMLNoiseLayer
          noiseImage={noiseImage}
          width={canvasW}
          height={canvasH}
          noiseOpacity={noise.opacity}
        />

        {backOverlays.length > 0 && (
          <HTMLImageOverlayLayer
            imageOverlays={backOverlays}
            loadedOverlayImages={loadedOverlayImages}
            selectedOverlayId={selectedOverlayId}
            setSelectedOverlayId={setSelectedOverlayId}
            setIsMainImageSelected={setIsMainImageSelected}
            setSelectedTextId={setSelectedTextId}
            updateImageOverlay={updateImageOverlay}
            canvasW={canvasW}
            canvasH={canvasH}
            onDragStateChange={setIsDraggingOverlay}
            onSnapOffsetsChange={setOverlaySnapOffsets}
            zIndex={10}
          />
        )}

        {hasSourceImage && (
          <>
            <SnapAlignmentGuides
              canvasW={canvasW}
              canvasH={canvasH}
              offsetX={screenshot.offsetX}
              offsetY={screenshot.offsetY}
              isDragging={isDraggingMainImage}
            />
            <HTMLMainImageLayer
              image={image}
              canvasW={canvasW}
              canvasH={canvasH}
              framedW={framedW}
              framedH={framedH}
              frameOffset={frameOffset}
              windowPadding={windowPadding}
              windowHeader={windowHeader}
              imageScaledW={imageScaledW}
              imageScaledH={imageScaledH}
              screenshot={screenshot}
              frame={frame}
              shadow={shadow}
              showFrame={showFrame}
              imageOpacity={imageOpacity}
              imageFilters={imageFilters}
              perspective3D={perspective3D}
              isMainImageSelected={isMainImageSelected}
              setIsMainImageSelected={setIsMainImageSelected}
              setSelectedOverlayId={setSelectedOverlayId}
              setSelectedTextId={setSelectedTextId}
              setScreenshot={setScreenshot}
              onDragStateChange={setIsDraggingMainImage}
            />
          </>
        )}

        {hasDeviceScene ? (
          <MockupSceneRenderer canvasWidth={canvasW} canvasHeight={canvasH} />
        ) : null}

        <HTMLTextOverlayLayer
          textOverlays={textOverlays}
          canvasW={canvasW}
          canvasH={canvasH}
          selectedTextId={selectedTextId}
          setSelectedTextId={setSelectedTextId}
          setSelectedOverlayId={setSelectedOverlayId}
          setIsMainImageSelected={setIsMainImageSelected}
          updateTextOverlay={updateTextOverlay}
        />

        <HTMLImageOverlayLayer
          imageOverlays={frontOverlays}
          loadedOverlayImages={loadedOverlayImages}
          selectedOverlayId={selectedOverlayId}
          setSelectedOverlayId={setSelectedOverlayId}
          setIsMainImageSelected={setIsMainImageSelected}
          setSelectedTextId={setSelectedTextId}
          updateImageOverlay={updateImageOverlay}
          canvasW={canvasW}
          canvasH={canvasH}
          onDragStateChange={setIsDraggingOverlay}
          onSnapOffsetsChange={setOverlaySnapOffsets}
        />

        <SnapAlignmentGuides
          canvasW={canvasW}
          canvasH={canvasH}
          offsetX={overlaySnapOffsets?.x ?? Number.POSITIVE_INFINITY}
          offsetY={overlaySnapOffsets?.y ?? Number.POSITIVE_INFINITY}
          isDragging={isDraggingOverlay}
        />

        <HTMLBlurRegionLayer
          blurRegions={blurRegions}
          selectedBlurId={selectedBlurId}
          setSelectedBlurId={setSelectedBlurId}
          updateBlurRegion={updateBlurRegion}
          removeBlurRegion={removeBlurRegion}
        />

        <SVGAnnotationLayer
          annotations={annotations}
          activeAnnotationTool={activeAnnotationTool}
          selectedAnnotationId={selectedAnnotationId}
          setSelectedAnnotationId={setSelectedAnnotationId}
          canvasW={canvasW}
          canvasH={canvasH}
          addAnnotation={addAnnotation}
          updateAnnotation={updateAnnotationShape}
          removeAnnotation={removeAnnotation}
          setActiveAnnotationTool={setActiveAnnotationTool}
          annotationDefaults={annotationDefaults}
          onDrawBlurRegion={(rect) => {
            addBlurRegion({
              position: { x: rect.x, y: rect.y },
              size: { width: rect.w, height: rect.h },
              blurAmount: 10,
              isVisible: true,
              style: 'mosaic',
            });
          }}
        />


        {showGrid && <HTMLGridLayer canvasW={canvasW} canvasH={canvasH} />}
      </HTMLCanvasRenderer>

    </div>
  );
}

export function getCanvasContainer(): HTMLDivElement | null {
  return globalCanvasContainer;
}

type ClientCanvasProps = {
  embedded?: boolean;
  onReady?: () => void;
};

export default function ClientCanvas({
  embedded = false,
  onReady,
}: ClientCanvasProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { screenshot, setScreenshot } = useEditorStore();
  const { uploadedImageUrl, editorMode, mockups, textOverlays, imageOverlays } = useImageStore();
  const hasText = textOverlays.length > 0;
  const hasMedia = imageOverlays.length > 0;
  const hasDeviceScene = editorMode === "device" && hasVisibleMockups(mockups);
  const hasSourceImage = !!screenshot.src
    && !!uploadedImageUrl
    && shouldRenderSourceImage(editorMode, mockups);

  // Load primary image from screenshot.src
  useEffect(() => {
    setLoadError(false);

    if (!hasSourceImage && !hasDeviceScene && !hasText && !hasMedia) {
      setImage(null);
      return;
    }

    const img = new window.Image();
    img.crossOrigin = "anonymous";

    const timeoutId = setTimeout(() => {
      if (!img.complete) {
        console.warn("Image load timeout");
        setLoadError(true);
        setScreenshot({ src: null });
      }
    }, 10000);

    img.onload = () => {
      clearTimeout(timeoutId);
      setImage(img);
    };

    img.onerror = () => {
      clearTimeout(timeoutId);
      console.warn("Image load error");
      setLoadError(true);
      setScreenshot({ src: null });
    };

    img.src = hasSourceImage && screenshot.src
      ? screenshot.src
      : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='1200'/%3E";

    return () => {
      clearTimeout(timeoutId);
    };
  }, [hasDeviceScene, hasSourceImage, hasText, hasMedia, screenshot.src, setScreenshot]);

  useEffect(() => {
    if (image) {
      onReady?.();
    }
  }, [image, onReady]);

  if (loadError || (!hasSourceImage && !hasDeviceScene && !hasText && !hasMedia)) {
    return null;
  }

  if (!image) {
    if (embedded) return null;
    return (
      <CanvasStageShell breathe showBackground className="overflow-hidden" />
    );
  }

  return <CanvasRenderer image={image} />;
}
