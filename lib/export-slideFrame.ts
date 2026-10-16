import { exportElement, exportElementAsCanvas } from "@/lib/export/export-service";

import { getCanvasContainer } from "@/components/canvas/ClientCanvas";
import { getAspectRatioPreset } from "@/lib/aspect-ratio-utils";

import { useEditorStore, useImageStore } from "@/lib/store";
import { withVideoCanvasImages } from "@/lib/video-layers";

export async function exportSlideFrame(): Promise<HTMLImageElement> {
  const imageStore = useImageStore.getState();
  const editorStore = useEditorStore.getState();

  const preset = getAspectRatioPreset(imageStore.selectedAspectRatio);
  if (!preset) throw new Error("Invalid aspect ratio");

  const result = await exportElement(
    "image-render-card",
    {
      format: "png",
      qualityPreset: "high",
      scale: 1,
      exportWidth: preset.width,
      exportHeight: preset.height,
    },
    getCanvasContainer(),
    imageStore.backgroundConfig,
    imageStore.backgroundBorderRadius,
    imageStore.textOverlays,
    imageStore.imageOverlays,
    imageStore.perspective3D,
    editorStore.screenshot.src || undefined,
    editorStore.screenshot.radius,
    imageStore.backgroundBlur,
    imageStore.backgroundNoise,
    imageStore.backgroundConfig.opacity ?? 1
  );

  const img = new Image();
  img.src = result.dataURL;
  await img.decode();

  return img;
}

/**
 * Export slide frame as a Canvas element (for video encoding).
 * Uses direct DOM-to-canvas capture without Sharp processing.
 */
export async function exportSlideFrameAsCanvas(
  outputDimensions?: { width: number; height: number }
): Promise<HTMLCanvasElement> {
  const imageStore = useImageStore.getState();
  const editorStore = useEditorStore.getState();

  const preset = getAspectRatioPreset(imageStore.selectedAspectRatio);
  if (!preset) throw new Error("Invalid aspect ratio");

  return withVideoCanvasImages(() => exportElementAsCanvas(
    "image-render-card",
    {
      format: "png",
      qualityPreset: "high",
      scale: 1,
      exportWidth: outputDimensions?.width ?? preset.width,
      exportHeight: outputDimensions?.height ?? preset.height,
    },
    getCanvasContainer(),
    imageStore.backgroundBorderRadius,
    imageStore.perspective3D,
    editorStore.screenshot.src || undefined,
  ));
}
