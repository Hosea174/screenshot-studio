'use client';

import { useImageStore } from '@/lib/store';
import { forwardRef, type ReactNode, type CSSProperties } from 'react';

interface HTMLCanvasRendererProps {
  width: number;
  height: number;
  borderRadius?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
}

/**
 * HTML-based canvas container that replaces Konva Stage.
 * Uses pure CSS for rendering with proper overflow handling.
 */
export const HTMLCanvasRenderer = forwardRef<HTMLDivElement, HTMLCanvasRendererProps>(
  function HTMLCanvasRenderer(
    { width, height, borderRadius = 0, children, className, style, onClick, onPointerDown },
    ref
  ) {
    const camera = useImageStore(s => s.camera);
    return (
      <div
        ref={ref}
        className={className}
        data-html-canvas="true"
        onClick={onClick}
        onPointerDown={onPointerDown}
        style={{
          position: 'relative',
          width: `${width}px`,
          height: `${height}px`,
          minWidth: `${width}px`,
          minHeight: `${height}px`,
          borderRadius: `${borderRadius}px`,
          overflow: 'hidden',
          isolation: 'isolate',
          ...style,
        }}
      >
        <div data-camera-scene style={{ position: 'absolute', inset: 0, transformOrigin: 'center', transform: `perspective(2400px) translate(${-camera.cameraX}px, ${-camera.cameraY}px) rotateX(${-camera.cameraRotateX}deg) rotateY(${-camera.cameraRotateY}deg) rotateZ(${-camera.cameraRotateZ}deg) scale(${camera.cameraZoom})` }}>
          {children}
        </div>
      </div>
    );
  }
);
