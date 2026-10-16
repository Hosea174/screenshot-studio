import { useImageStore } from '@/lib/store';
import { beginMotionDrag } from '@/lib/animation/drag-history';
import { mediaTimelineDuration, videoClipDuration, videoTimeAt } from './export/video-timing';
export { videoTimeAt } from './export/video-timing';

let videoCanvasSnapshotDepth = 0;

/** Keep preview playback from repainting video canvases while a DOM snapshot is captured. */
export async function withVideoCanvasSnapshot<T>(capture: () => Promise<T>): Promise<T> {
  videoCanvasSnapshotDepth++;
  try { return await capture(); }
  finally { videoCanvasSnapshotDepth = Math.max(0, videoCanvasSnapshotDepth - 1); }
}

/** Let DOM snapshotters clone video frames as ordinary images instead of canvases. */
export async function withVideoCanvasImages<T>(capture: () => Promise<T>): Promise<T> {
  const replaced: { canvas: HTMLCanvasElement; image: HTMLImageElement }[] = [];
  try {
    for (const canvas of Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas[data-video-canvas]'))) {
      let src: string;
      try { src = canvas.toDataURL('image/png'); }
      catch { throw new Error('A video frame is not readable for export. Reload the source video and try again.'); }
      const image = document.createElement('img');
      for (const attribute of Array.from(canvas.attributes)) image.setAttribute(attribute.name, attribute.value);
      if (canvas.dataset.videoExport === 'true') image.style.visibility = 'visible';
      image.src = src;
      canvas.replaceWith(image);
      replaced.push({ canvas, image });
      await image.decode();
    }
    return await capture();
  } finally {
    for (const { canvas, image } of replaced.reverse()) image.replaceWith(canvas);
  }
}

export const VIDEO_FILE_ACCEPT = {
  'video/mp4': ['.mp4', '.m4v'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
};

export function isVideoFile(file: Pick<File, 'type' | 'name'>) {
  return file.type.startsWith('video/') || /\.(mp4|m4v|webm|mov)$/i.test(file.name);
}

export async function addVideoLayer(file: File) {
  const video = await readVideoFile(file);
  const state = useImageStore.getState();
  const width = state.canvasDimensions?.canvasW ?? 700;
  const height = state.canvasDimensions?.canvasH ?? 600;
  state.addImageOverlay({ src: video.url, poster: video.poster, mediaType: 'video', mediaDuration: video.duration, mediaWidth: video.width, mediaHeight: video.height, position: { x: width / 2, y: height / 2 }, size: Math.min(width, height) * 0.82, rotation: 0, opacity: 1, flipX: false, flipY: false, isVisible: true, isCustom: true, startTime: 0, trimStart: 0, playbackRate: 1, loop: false });
  state.setSelectedOverlayId(useImageStore.getState().imageOverlays.at(-1)!.id);
  state.setShowTimeline(true);
}

/** Replace only the source media of a layer, retaining its design and animation target. */
export async function replaceOverlayMedia(overlayId: string, file: File) {
  const state = useImageStore.getState();
  const overlay = state.imageOverlays.find(item => item.id === overlayId);
  if (!overlay) throw new Error('The selected layer no longer exists');

  if (isVideoFile(file)) {
    const video = await readVideoFile(file);
    const targetDuration = overlay.mediaType === 'video'
      ? videoClipDuration(overlay)
      : Math.max(1000 / 60, overlay.clipDuration ?? 5000);
    const playbackRate = Math.max(0.1, Math.min(16, video.duration * 1000 / targetDuration));
    const finish = beginMotionDrag();
    try {
      state.updateImageOverlay(overlayId, {
        src: video.url,
        poster: video.poster,
        mediaType: 'video',
        mediaDuration: video.duration,
        trimStart: 0,
        trimEnd: video.duration,
        playbackRate,
        loop: false,
        // Keep the layer's designed frame dimensions so swapping source aspect
        // ratios doesn't move or resize the asset on the canvas.
        mediaWidth: overlay.mediaWidth ?? video.width,
        mediaHeight: overlay.mediaHeight ?? video.height,
        isCustom: true,
      });
      state.setTimelineDuration(Math.max(state.timeline.duration, mediaTimelineDuration(useImageStore.getState().imageOverlays)), false);
    } finally { finish(); }
    return;
  }

  if (!file.type.startsWith('image/')) throw new Error('Choose an image or video file');
  const clipDuration = overlay.mediaType === 'video' ? videoClipDuration(overlay) : overlay.clipDuration;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const finish = beginMotionDrag();
    try {
      state.updateImageOverlay(overlayId, {
        src: url,
        poster: undefined,
        mediaType: 'image',
        mediaDuration: undefined,
        trimStart: undefined,
        trimEnd: undefined,
        playbackRate: undefined,
        loop: undefined,
        clipDuration,
        mediaWidth: overlay.mediaWidth ?? image.naturalWidth,
        mediaHeight: overlay.mediaHeight ?? image.naturalHeight,
        isCustom: true,
      });
    } finally { finish(); }
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
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

export function drawVideoFrame(video: HTMLVideoElement, id: string) {
  if (videoCanvasSnapshotDepth > 0) return;
  const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-video-canvas="${id}"]`);
  if (canvas && video.readyState >= 2) {
    if (video.videoWidth && video.videoHeight && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
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
