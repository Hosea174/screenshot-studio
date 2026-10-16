'use client';

import { useEditorStore, useImageStore } from '@/lib/store';
import { TEMPLATE_DEMO_IMAGE_URL, isTemplateDemoMedia } from '@/lib/templates/demo-media';

/** Use the current project media in template previews, including media layers. */
export function useTemplateMediaSource(): string {
  const uploadedImageUrl = useImageStore((state) => state.uploadedImageUrl);
  const imageName = useImageStore((state) => state.imageName);
  const imageOverlays = useImageStore((state) => state.imageOverlays);
  const selectedOverlayId = useImageStore((state) => state.selectedOverlayId);
  const lastSelectedAssetId = useImageStore((state) => state.lastSelectedAssetId);
  const isMainImageSelected = useImageStore((state) => state.isMainImageSelected);
  const screenshot = useEditorStore((state) => state.screenshot);

  const uploadedSource = isTemplateDemoMedia(uploadedImageUrl, imageName)
    || uploadedImageUrl === TEMPLATE_DEMO_IMAGE_URL
    ? null
    : uploadedImageUrl;
  const screenshotSource = isTemplateDemoMedia(screenshot?.src, imageName)
    || screenshot?.src === TEMPLATE_DEMO_IMAGE_URL
    ? null
    : screenshot?.src;
  const visibleOverlays = imageOverlays.filter((item) => (
    item.isVisible && !item.src.includes('overlay-shadow')
  ));
  const selected = visibleOverlays.find((overlay) => overlay.id === selectedOverlayId);
  const lastSelected = !isMainImageSelected && lastSelectedAssetId && lastSelectedAssetId !== 'asset'
    ? visibleOverlays.find((overlay) => overlay.id === lastSelectedAssetId)
    : undefined;
  const overlay = selected
    ?? lastSelected
    ?? (!uploadedSource && visibleOverlays.length === 1 ? visibleOverlays[0] : undefined);
  const overlaySource = overlay?.mediaType === 'video'
    ? overlay.poster ?? null
    : overlay?.src ?? null;

  const fallbackOverlay = visibleOverlays[0];
  const fallbackOverlaySource = fallbackOverlay?.mediaType === 'video'
    ? fallbackOverlay.poster ?? null
    : fallbackOverlay?.src ?? null;

  return overlaySource ?? uploadedSource ?? screenshotSource ?? fallbackOverlaySource ?? TEMPLATE_DEMO_IMAGE_URL;
}
