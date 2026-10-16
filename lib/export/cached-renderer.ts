import { Input, BlobSource, MP4, QTFF, WEBM, VideoSampleSink, type VideoSample } from 'mediabunny';
import type { CachedScene, MediaLayer } from './cached-scene';
import { videoTimeAt, videoVisibleAt } from './video-timing';
import { getClipInterpolatedProperties } from '@/lib/animation/interpolation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** One cursor per layer; the decoder's iterator handles forward decoding and loop discontinuities. */
export async function createCachedRenderer(scene: CachedScene, fps: number, totalFrames: number, signal: AbortSignal) {
  const inputs: Input[] = [];
  const readers = new Map<MediaLayer, AsyncGenerator<VideoSample | null, void, unknown>>();
  const samples = new Map<MediaLayer, VideoSample>();
  const canvas = new OffscreenCanvas(scene.width, scene.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas compositing is unavailable');
  const timings = { decoding: 0, compositing: 0 };
  const abort = () => { for (const input of inputs) input.dispose(); };
  signal.addEventListener('abort', abort, { once: true });
  const dispose = async () => {
    signal.removeEventListener('abort', abort);
    for (const sample of samples.values()) sample.close();
    samples.clear();
    // Disposing the input first unblocks any pending decoder operations.
    for (const input of inputs) input.dispose();
    await Promise.allSettled(Array.from(readers.values(), reader => reader.return()));
    for (const layer of scene.layers) layer.bitmap?.close();
  };
  try {
    const shared = new Map<Blob, Input>();
    for (const layer of scene.layers) {
      if (layer.kind !== 'media' || !layer.source) continue;
      signal.throwIfAborted();
      let input = shared.get(layer.source);
      if (!input) { input = new Input({ source: new BlobSource(layer.source), formats: [MP4, QTFF, WEBM] }); shared.set(layer.source, input); inputs.push(input); }
      const track = await input.getPrimaryVideoTrack();
      if (!track || !await track.canDecode()) throw new Error('The source video needs the browser video decoder');
      const firstTimestamp = await track.getFirstTimestamp();
      const sink = new VideoSampleSink(track);
      const overlay = layer.overlay;
      function* timestamps() {
        for (let i = 0; i < totalFrames; i++) yield firstTimestamp + videoTimeAt(overlay, i * 1000 / fps);
      }
      readers.set(layer, sink.samplesAtTimestamps(timestamps()));
    }
    return {
      canvas, timings, dispose,
      async render(index: number) {
        signal.throwIfAborted();
        const decodeStart = performance.now();
        let changed = index === 0;
        for (const [layer, reader] of readers) {
          const previous = samples.get(layer);
          const { value: sample } = await reader.next();
          if (!sample) throw new Error('The source video returned no frame');
          if (previous?.timestamp !== sample.timestamp) changed = true;
          previous?.close();
          samples.set(layer, sample);
        }
        timings.decoding += performance.now() - decodeStart;
        const time = index * 1000 / fps;
        const hasMotion = scene.tracks.some(t => t.isVisible && t.keyframes.length);
        const startsNow = scene.layers.some(l => index > 0 && (l.kind === 'media' ? l.overlay.startTime ?? 0 : l.from ?? 0) > (index - 1) * 1000 / fps && (l.kind === 'media' ? l.overlay.startTime ?? 0 : l.from ?? 0) <= time);
        if (!changed && !hasMotion && !startsNow) return canvas;
        const drawStart = performance.now();
        ctx.clearRect(0, 0, scene.width, scene.height);
        ctx.save();
        ctx.scale(scene.width / scene.logicalWidth, scene.height / scene.logicalHeight);
        for (const layer of scene.layers) {
          if (layer.kind === 'raster') {
            if (time >= (layer.until ?? Infinity)) { layer.bitmap.close(); continue; }
            if (time >= (layer.from ?? 0)) ctx.drawImage(layer.bitmap, 0, 0, scene.logicalWidth, scene.logicalHeight);
            continue;
          }
          const o = layer.overlay;
          if (o.mediaType === 'video' && !videoVisibleAt(o, time)) continue;
          const motion = getClipInterpolatedProperties(scene.clips, scene.tracks, time, DEFAULT_ANIMATABLE_PROPERTIES, o.id);
          const sample = samples.get(layer);
          const width = o.mediaWidth ?? layer.bitmap?.width ?? 640;
          const height = o.mediaHeight ?? layer.bitmap?.height ?? 360;
          const ratio = width / height;
          const drawWidth = ratio >= 1 ? o.size : o.size * ratio;
          const drawHeight = ratio >= 1 ? o.size / ratio : o.size;
          ctx.save();
          ctx.translate(o.position.x + motion.translateX / 100 * o.size, o.position.y + motion.translateY / 100 * o.size);
          ctx.rotate((o.rotation + motion.rotateZ) * Math.PI / 180);
          ctx.scale(motion.scale * (o.flipX ? -1 : 1), motion.scale * (o.flipY ? -1 : 1));
          ctx.globalAlpha = o.opacity * motion.imageOpacity;
          clipMedia(ctx, drawWidth, drawHeight, o.radius ?? 0);
          if (sample) sample.draw(ctx, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
          else if (layer.bitmap) ctx.drawImage(layer.bitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
          ctx.restore();
        }
        ctx.restore();
        timings.compositing += performance.now() - drawStart;
        return canvas;
      },
    };
  } catch (error) { await dispose(); throw error; }
}

function clipMedia(ctx: Context, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(-width / 2, -height / 2, width, height, Math.min(radius, width / 2, height / 2));
  ctx.clip();
}
