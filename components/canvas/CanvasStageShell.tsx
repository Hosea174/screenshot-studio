"use client";

import { useImageStore } from "@/lib/store";
import { useResponsiveCanvasDimensions } from "@/hooks/useAspectRatioDimensions";
import { getBackgroundCSS } from "@/lib/constants/backgrounds";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

type CanvasStageShellProps = {
  children?: React.ReactNode;
  breathe?: boolean;
  showBackground?: boolean;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
};

export function CanvasStageShell({
  children,
  breathe = false,
  showBackground = false,
  className,
  id,
  style,
  onDragOver,
  onDrop,
}: CanvasStageShellProps): React.JSX.Element {
  const backgroundBorderRadius = useImageStore((s) => s.backgroundBorderRadius);
  const backgroundConfig = useImageStore((s) => s.backgroundConfig);
  const { measured, width, height, originalWidth } =
    useResponsiveCanvasDimensions();
  useEffect(() => {
    if (!measured) return;
    const state = useImageStore.getState();
    const empty = !state.uploadedImageUrl && !state.imageOverlays.length && !state.textOverlays.length && !state.mockups.length;
    if (!state.canvasDimensions || empty) state.setCanvasDimensions({ canvasW: width, canvasH: height, framedW: width, framedH: height });
  }, [measured, width, height]);
  const backgroundStyle = showBackground
    ? getBackgroundCSS(backgroundConfig, 32)
    : undefined;

  return (
    <div
      id={id}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "relative shrink-0 transition-[border-radius] duration-300",
        "shadow-xl ring-1 ring-foreground/10",
        breathe && "canvas-stage-breathe",
        !measured && "canvas-stage-presize",
        className
      )}
      style={{
        ...(measured
          ? { width: `${width}px`, height: `${height}px` }
          : ({
              "--stage-w": `${originalWidth}px`,
              "--stage-ratio": width / height,
            } as React.CSSProperties)),
        borderRadius: `${backgroundBorderRadius}px`,
        ...style,
      }}
    >
      {showBackground ? (
        <div className="absolute inset-0 overflow-hidden rounded-[inherit] bg-muted" aria-hidden>
          <div className="absolute inset-0 scale-110 blur-2xl" style={backgroundStyle} />
        </div>
      ) : null}
      {children}
    </div>
  );
}
