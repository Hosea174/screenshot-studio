'use client';
import * as React from 'react';
import { useImageStore, type ImageOverlay } from '@/lib/store';
import { videoTimeAt, drawVideoFrame } from '@/lib/video-layers';

export function VideoLayerMedia({ overlay, style }: { overlay: ImageOverlay; style: React.CSSProperties }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const playhead = useImageStore(s => s.timeline.playhead);
  const playing = useImageStore(s => s.timeline.isPlaying);
  const settleFrame = (video: HTMLVideoElement) => {
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
    const target = videoTimeAt(overlay, playhead);
    if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) > (playing ? 0.12 : 0.001)) video.currentTime = target;
    video.playbackRate = overlay.playbackRate ?? 1;
    if (playing && playhead >= (overlay.startTime ?? 0)) void video.play().catch(() => {});
    else video.pause();
  }, [playhead, playing, overlay]);
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const draw = () => { if (ref.current) drawVideoFrame(ref.current, overlay.id); raf = requestAnimationFrame(draw); };
    raf = requestAnimationFrame(draw); return () => cancelAnimationFrame(raf);
  }, [playing, overlay.id]);
  return <>
    <video ref={ref} src={overlay.src} muted playsInline preload="auto" data-video-layer={overlay.id} data-export-exclude="true" style={{ display: 'none' }} onLoadedData={e => settleFrame(e.currentTarget)} onSeeked={e => settleFrame(e.currentTarget)} />
    <canvas data-video-canvas={overlay.id} width={Math.min(1920, overlay.mediaWidth ?? 640)} height={Math.round(Math.min(1920, overlay.mediaWidth ?? 640) * (overlay.mediaHeight ?? 360) / (overlay.mediaWidth ?? 640))} style={style} aria-label="Video layer" />
  </>;
}
