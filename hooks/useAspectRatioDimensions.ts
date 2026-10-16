import { useMemo, useState, useEffect } from 'react';
import { useImageStore } from '@/lib/store';
import { getAspectRatioPreset, calculateFitDimensions, getAspectRatioCSS } from '@/lib/aspect-ratio-utils';

export function useAspectRatioDimensions(options?: {
  maxWidth?: number;
  maxHeight?: number;
}) {
  const { selectedAspectRatio } = useImageStore();
  
  const dimensions = useMemo(() => {
    const preset = getAspectRatioPreset(selectedAspectRatio);
    if (!preset) {
      return { width: 1920, height: 1080, aspectRatio: '16/9' };
    }
    
    const { maxWidth, maxHeight } = options || {};
    
    if (maxWidth || maxHeight) {
      const fitDimensions = calculateFitDimensions(
        preset.width,
        preset.height,
        maxWidth,
        maxHeight
      );
      return {
        ...fitDimensions,
        aspectRatio: getAspectRatioCSS(preset.width, preset.height),
        originalWidth: preset.width,
        originalHeight: preset.height,
      };
    }
    
    return {
      width: preset.width,
      height: preset.height,
      aspectRatio: getAspectRatioCSS(preset.width, preset.height),
      originalWidth: preset.width,
      originalHeight: preset.height,
    };
  }, [selectedAspectRatio, options]);
  
  return dimensions;
}

export function useResponsiveCanvasDimensions() {
  const selectedAspectRatio = useImageStore((s) => s.selectedAspectRatio);
  const [measuredViewport, setViewportSize] = useState<{
    width: number;
    height: number;
    paddingX: number;
    paddingY: number;
  } | null>(null);
  const measured = measuredViewport !== null;
  
  useEffect(() => {
    const viewport = document.querySelector<HTMLElement>('[data-canvas-viewport]');
    if (!viewport) return;

    const updateViewportSize = () => {
      const styles = window.getComputedStyle(viewport);
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
        paddingX: parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight),
        paddingY: parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom),
      });
    };

    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  
  const dimensions = useMemo(() => {
    const preset = getAspectRatioPreset(selectedAspectRatio);
    if (!preset) {
      return { width: 1920, height: 1080, aspectRatio: '16/9', originalWidth: 1920, originalHeight: 1080, measured };
    }

    // The canvas viewport already shrinks when the timeline opens. Measure that
    // element directly so the stage follows its real available space instead of
    // subtracting a second, hardcoded timeline height from the browser window.
    const maxWidth = Math.max((measuredViewport?.width ?? 1920) - (measuredViewport?.paddingX ?? 0), 160);
    const maxHeight = Math.max((measuredViewport?.height ?? 1080) - (measuredViewport?.paddingY ?? 0), 160);
    
    const fitDimensions = calculateFitDimensions(
      preset.width,
      preset.height,
      maxWidth,
      maxHeight
    );
    
    return {
      ...fitDimensions,
      aspectRatio: getAspectRatioCSS(preset.width, preset.height),
      originalWidth: preset.width,
      originalHeight: preset.height,
      measured,
    };
  }, [
    selectedAspectRatio,
    measuredViewport?.width,
    measuredViewport?.height,
    measuredViewport?.paddingX,
    measuredViewport?.paddingY,
    measured,
  ]);
  
  return dimensions;
}
