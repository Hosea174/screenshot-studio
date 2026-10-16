import { Input, BlobSource, MP4, QTFF, WEBM, VideoSampleSink } from 'mediabunny';
import type { ImageOverlay } from '@/lib/store';
import { videoTimeAt } from './video-timing';
import { recordExportTime } from './export-diagnostics';

/** Export-owned decoding for the full DOM renderer, without preview seek races. */
export async function createTimelineVideoReader(overlays: ImageOverlay[], fps: number, totalFrames: number, signal?: AbortSignal, startTimeMs = 0) {
  const readers: { draw: (index: number) => Promise<void>; dispose: () => Promise<void> | void }[] = [];
  const blobs = new Map<string, Promise<Blob>>();
  const inputs: Input[] = [];
  const abort = () => { for (const input of inputs) input.dispose(); };
  signal?.addEventListener('abort', abort, { once: true });
  const dispose = async () => { signal?.removeEventListener('abort', abort); await Promise.allSettled(readers.map(r => r.dispose())); };
  try {
    for (const overlay of overlays.filter(o => o.isVisible && o.mediaType === 'video')) {
      signal?.throwIfAborted();
      const canvas = Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas[data-video-canvas]')).find(c => c.dataset.videoCanvas === overlay.id);
      if (!canvas) throw new Error('A video layer is not ready');
      // Preview playback may have drawn a cross-origin <video> into this canvas.
      // Resizing clears both its pixels and the origin-tainted flag before the
      // export-owned decoder paints same-origin frames into it.
      canvas.width = canvas.width;
      canvas.height = canvas.height;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Could not draw a video layer');
      if (!blobs.has(overlay.src)) blobs.set(overlay.src, fetch(overlay.src, { signal }).then(r => { if (!r.ok) throw new Error('Could not load the source video'); return r.blob(); }));
      const blob = await blobs.get(overlay.src)!;
      const input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF, WEBM] });
      inputs.push(input);
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track || !await track.canDecode()) throw new Error('Native video decoding required');
        const first = await track.getFirstTimestamp();
        function* timestamps() { for (let i = 0; i < totalFrames; i++) yield first + videoTimeAt(overlay, startTimeMs + i * 1000 / fps); }
        const iterator = new VideoSampleSink(track).samplesAtTimestamps(timestamps());
        readers.push({
          draw: async () => {
            signal?.throwIfAborted();
            const { value } = await iterator.next();
            if (!value) throw new Error('The video contains no frame at this timestamp');
            try { ctx.clearRect(0, 0, canvas.width, canvas.height); value.draw(ctx, 0, 0, canvas.width, canvas.height); }
            finally { value.close(); }
          },
          dispose: async () => { input.dispose(); await iterator.return(); },
        });
      } catch {
        input.dispose();
        signal?.throwIfAborted();
        const video = document.createElement('video');
        video.muted = true; video.preload = 'auto';
        const url = URL.createObjectURL(blob); video.src = url;
        const release = () => { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); };
        try { await videoEvent(video, 'loadeddata', () => video.load(), signal); }
        catch (error) { release(); throw error; }
        readers.push({
          draw: async index => {
            const time = videoTimeAt(overlay, startTimeMs + index * 1000 / fps);
            if (Math.abs(video.currentTime - time) > 0.001) await videoEvent(video, 'seeked', () => { video.currentTime = time; }, signal);
            signal?.throwIfAborted(); ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }, dispose: release,
        });
      }
    }
    return {
      async draw(index: number) { const start = performance.now(); await Promise.all(readers.map(r => r.draw(index))); recordExportTime('decoding', performance.now() - start); }, dispose,
    };
  } catch (error) { await dispose(); throw error; }
}

function videoEvent(video: HTMLVideoElement, event: string, action: () => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', fail); signal?.removeEventListener('abort', abort); };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('Could not decode the source video')); };
    const abort = () => { cleanup(); reject(new DOMException('Export cancelled', 'AbortError')); };
    const timer = setTimeout(fail, 10000);
    video.addEventListener(event, done, { once: true }); video.addEventListener('error', fail, { once: true }); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { action(); } catch (error) { cleanup(); reject(error); }
  });
}
