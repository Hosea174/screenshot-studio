import type { ImageOverlay } from '@/lib/store';

export function videoSourceRange(overlay: ImageOverlay) {
  const end = Math.max(0, Math.min(overlay.mediaDuration ?? 0, overlay.trimEnd ?? overlay.mediaDuration ?? 0));
  return { start: Math.max(0, Math.min(end, overlay.trimStart ?? 0)), end };
}

export function videoClipDuration(overlay: ImageOverlay) {
  const { start, end } = videoSourceRange(overlay);
  return (end - start) / Math.max(0.1, overlay.playbackRate ?? 1) * 1000;
}

export function videoClipEnd(overlay: ImageOverlay) {
  return (overlay.startTime ?? 0) + videoClipDuration(overlay);
}

export function videoVisibleAt(overlay: ImageOverlay, time: number) {
  return time >= (overlay.startTime ?? 0) && (overlay.loop || time < videoClipEnd(overlay));
}

export function mediaTimelineDuration(overlays: ImageOverlay[]) {
  const videos = overlays.filter(o => o.mediaType === 'video');
  return videos.length ? Math.max(500, ...videos.map(videoClipEnd)) : 5000;
}

/** Source seconds for an output timestamp in milliseconds, shared with preview. */
export function videoTimeAt(overlay: ImageOverlay, timelineMs: number) {
  const { start: trim, end } = videoSourceRange(overlay);
  const elapsed = Math.max(0, timelineMs - (overlay.startTime ?? 0)) / 1000 * Math.max(0.1, overlay.playbackRate ?? 1);
  const available = Math.max(0.001, end - trim);
  return Math.max(trim, Math.min(end - 0.001, trim + (overlay.loop ? elapsed % available : Math.min(elapsed, available))));
}

export function videoOutputDimensions(width: number, height: number, maxDimension: 1280 | 1920 | 'original' = 1920) {
  const scale = maxDimension === 'original' ? 1 : Math.min(1, maxDimension / Math.max(width, height));
  // Round down: an odd source dimension must never cause an upscale.
  return { width: Math.max(2, Math.floor(width * scale / 2) * 2), height: Math.max(2, Math.floor(height * scale / 2) * 2) };
}
