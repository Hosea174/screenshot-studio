'use client';
import * as React from 'react';
import { useImageStore, type ImageOverlay } from '@/lib/store';
import { videoTimeAt, drawVideoFrame } from '@/lib/video-layers';
import { useExportProgress } from '@/hooks/useExportProgress';
import { videoVisibleAt } from '@/lib/export/video-timing';

export function VideoLayerMedia({ overlay, style }: { overlay: ImageOverlay; style: React.CSSProperties }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const playhead = useImageStore(s => s.timeline.playhead);
  const playing = useImageStore(s => s.timeline.isPlaying);
  const timelineDuration = useImageStore(s => s.timeline.duration);
  const settleFrame = (video: HTMLVideoElement) => {
    if (useExportProgress.getState().active) return;
    const latest = useImageStore.getState().timeline;
    const target = videoTimeAt(overlay, latest.playhead);
    if (!latest.isPlaying && Math.abs(video.currentTime - target) > 0.002) {
      video.currentTime = target;
      return;
    }
    drawVideoFrame(video, overlay.id);
  };
  React.useEffect(() => {
    const video = ref.current; if (!video) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    const loadVideo = async () => {
      // Media served from Screenshot Studio's local file bridge is on a
      // different port. Some browser paths still taint canvases when that
      // remote <video> is drawn directly, so decode from a fetched Blob URL.
      const response = await fetch(overlay.src);
      if (!response.ok) throw new Error('Could not load the video layer');
      const blob = await response.blob();
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      video.src = objectUrl;
      video.load();
    };
    void loadVideo().catch(error => {
      if (!cancelled) console.error('Could not load video layer', error);
    });
    return () => {
      cancelled = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [overlay.src]);
  React.useEffect(() => {
    const video = ref.current; if (!video) return;
    if (useExportProgress.getState().active) return;
    const target = videoTimeAt(overlay, playhead);
    if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) > (playing ? 0.12 : 0.001)) video.currentTime = target;
    video.playbackRate = overlay.playbackRate ?? 1;
    if (playing && videoVisibleAt(overlay, playhead, timelineDuration)) void video.play().catch(() => {});
    else video.pause();
  }, [playhead, playing, overlay, timelineDuration]);
  React.useEffect(() => {
    if (!playing) return;
    const video = ref.current;
    if (!video) return;
    if ('requestVideoFrameCallback' in video) {
      let callback = 0;
      const draw = () => {
        drawVideoFrame(video, overlay.id);
        callback = video.requestVideoFrameCallback(draw);
      };
      callback = video.requestVideoFrameCallback(draw);
      return () => video.cancelVideoFrameCallback(callback);
    }
    let raf = 0;
    const draw = () => { drawVideoFrame(video, overlay.id); raf = requestAnimationFrame(draw); };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing, overlay.id]);
  return <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    {/* Keep the decoder alive, but display its full-resolution frame canvas.
        CSS-transformed/clipped video elements can be rasterized at reduced
        quality by the browser compositor; the canvas preserves source pixels. */}
    <video ref={ref} muted playsInline preload="auto" data-video-layer={overlay.id} data-export-exclude="true" style={{ ...style, visibility: 'hidden' }} aria-label="Video layer" onLoadedData={e => settleFrame(e.currentTarget)} onSeeked={e => settleFrame(e.currentTarget)} />
    <canvas data-video-canvas={overlay.id} data-video-export="true" width={overlay.mediaWidth ?? 640} height={overlay.mediaHeight ?? 360} style={{ ...style, position: 'absolute', inset: 0, visibility: 'visible' }} aria-hidden="true" />
  </div>;
}
