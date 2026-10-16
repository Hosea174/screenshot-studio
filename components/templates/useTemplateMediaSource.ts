'use client';

import { useEditorStore, useImageStore } from '@/lib/store';
import { TEMPLATE_DEMO_IMAGE_URL, isTemplateDemoMedia } from '@/lib/templates/demo-media';

/** Use the current project media in template previews, including media layers. */
export function useTemplateMediaSource(): string {
  const uploadedImageUrl = useImageStore((state) => state.uploadedImageUrl);
  const imageName = useImageStore((state) => state.imageName);
  const imageOverlays = useImageStore((state) => state.imageOverlays);
  const selectedOverlayId = useImageStore((state) => state.selectedOverlayId);
  const screenshot = useEditorStore((state) => state.screenshot);

  const uploadedSource = isTemplateDemoMedia(uploadedImageUrl, imageName)
    || uploadedImageUrl === TEMPLATE_DEMO_IMAGE_URL
    ? null
    : uploadedImageUrl;
  const screenshotSource = isTemplateDemoMedia(screenshot?.src, imageName)
    || screenshot?.src === TEMPLATE_DEMO_IMAGE_URL
    ? null
    : screenshot?.src;
  const selected = imageOverlays.find((overlay) => overlay.id === selectedOverlayId && overlay.isVisible);
  const overlay = selected ?? imageOverlays.find((item) => (
    item.isVisible && !item.src.includes('overlay-shadow')
  ));
  const overlaySource = overlay?.mediaType === 'video'
    ? overlay.poster ?? null
    : overlay?.src ?? null;

  return uploadedSource ?? screenshotSource ?? overlaySource ?? TEMPLATE_DEMO_IMAGE_URL;
}
