import type { ImageOverlay } from '@/lib/store';
import { useImageStore } from '@/lib/store';

export async function addVideoLayer(file: File) {
  const video = await readVideoFile(file);
  const state = useImageStore.getState();
  state.addImageOverlay({ src: video.url, poster: video.poster, mediaType: 'video', mediaDuration: video.duration, mediaWidth: video.width, mediaHeight: video.height, position: { x: 350, y: 300 }, size: 400, rotation: 0, opacity: 1, flipX: false, flipY: false, isVisible: true, isCustom: true, startTime: 0, trimStart: 0, playbackRate: 1, loop: false });
  state.setSelectedOverlayId(useImageStore.getState().imageOverlays.at(-1)!.id);
  state.setShowTimeline(true);
  state.setTimelineDuration(Math.max(state.timeline.duration, video.duration * 1000));
}

export async function readVideoFile(file: File) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true; video.preload = 'auto'; video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Video loading timed out')), 15000);
      video.onloadeddata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('This video cannot be decoded. Try MP4 or WebM.')); };
    });
    const width = video.videoWidth; const height = video.videoHeight;
    // Stream-recorded WebM files can omit the duration header. Decode the end
    // once to discover their duration, then return to the first frame.
    if (video.duration === Infinity) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Could not read video duration')), 10000);
        video.onseeked = () => { clearTimeout(timer); resolve(); };
        video.currentTime = 1e10;
      });
      await new Promise<void>(resolve => { video.onseeked = () => resolve(); video.currentTime = 0; });
    }
    if (!width || !height || !Number.isFinite(video.duration)) throw new Error('Video has no readable frames');
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(640, width); canvas.height = Math.round(canvas.width * height / width);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { url, poster: canvas.toDataURL('image/jpeg', 0.8), width, height, duration: video.duration };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
  finally { video.removeAttribute('src'); video.load(); }
}

export function videoTimeAt(overlay: ImageOverlay, timelineMs: number) {
  const duration = overlay.mediaDuration ?? 0;
  const trim = Math.min(Math.max(0, overlay.trimStart ?? 0), duration);
  const elapsed = Math.max(0, timelineMs - (overlay.startTime ?? 0)) / 1000 * Math.max(0.1, overlay.playbackRate ?? 1);
  const available = Math.max(0.001, duration - trim);
  return Math.max(0, Math.min(duration - 0.001, trim + (overlay.loop ? elapsed % available : Math.min(elapsed, available))));
}

export function drawVideoFrame(video: HTMLVideoElement, id: string) {
  const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-video-canvas="${id}"]`);
  if (canvas && video.readyState >= 2) canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
}

/** Await decoded source frames before the DOM exporter snapshots canvas pixels. */
export async function seekTimelineVideos(time: number) {
  const overlays = useImageStore.getState().imageOverlays;
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video[data-video-layer]'));
  await Promise.all(videos.map(async video => {
    const id = video.dataset.videoLayer!;
    const overlay = overlays.find(o => o.id === id); if (!overlay) return;
    video.pause();
    const target = videoTimeAt(overlay, time);
    if (Math.abs(video.currentTime - target) > 0.001 || video.seeking) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', fail); };
        const done = () => { cleanup(); resolve(); };
        const fail = () => { cleanup(); reject(new Error('Could not decode a video layer frame')); };
        const timer = setTimeout(fail, 10000);
        video.addEventListener('seeked', done); video.addEventListener('error', fail);
        video.currentTime = target;
      });
    }
    drawVideoFrame(video, id);
  }));
}
