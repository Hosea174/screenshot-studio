"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useImageStore } from "@/lib/store";
import confetti from 'canvas-confetti';
import { toast } from 'sonner';
import { formatNumber, roundToTwoDecimals } from '@/lib/number-format';
import {
  exportSlideshowVideo,
  exportAnimationVideo,
  getVideoOutputDimensions,
  isExportAborted,
  type VideoExportOptions,
} from "@/lib/export-slideshow-video";
import { useExportProgress } from "@/hooks/useExportProgress";
import { type VideoFormat, type VideoQuality } from "@/lib/export/video-encoder";

type ExportMode = "slideshow" | "animation";

const FORMAT_OPTIONS: { value: VideoFormat; label: string; description: string }[] = [
  { value: "mp4", label: "MP4 (H.264)", description: "Best compatibility, smaller file size" },
  { value: "webm", label: "WebM (VP9/VP8)", description: "Open format, web-optimized" },
];

const QUALITY_OPTIONS: { value: VideoQuality; label: string; bitrate: string }[] = [
  { value: "high", label: "High", bitrate: "25 Mbps" },
  { value: "medium", label: "Medium", bitrate: "10 Mbps" },
  { value: "low", label: "Low", bitrate: "5 Mbps" },
];

function ExportProgressView({ progress, format }: { progress: number; format: string }) {
  const { stage, processedFrames, totalFrames, elapsedMs, remainingMs, fallbackReason } = useExportProgress();
  return (
    <div className="space-y-4 py-6" aria-live="polite">
      <p className="text-sm font-medium">{stage} {format.toUpperCase()}…</p>
      <div role="progressbar" aria-label="Video export" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 bg-accent rounded-full overflow-hidden">
        <div className="h-full bg-primary transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>{totalFrames ? `${processedFrames} / ${totalFrames} frames` : `${Math.round(progress)}%`}</span>
        <span>{Math.round(elapsedMs / 1000)}s elapsed{remainingMs !== null ? ` · ~${Math.ceil(remainingMs / 1000)}s left` : ''}</span>
      </div>
      {fallbackReason && <p className="text-xs text-muted-foreground">{fallbackReason}. All effects are preserved.</p>}
    </div>
  );
}

export function ExportSlideshowDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { slideshow, setSlideshow, timeline, slides, animationClips, imageOverlays } = useImageStore();
  const { active: exporting, progress, abort } = useExportProgress();
  const [format, setFormat] = useState<VideoFormat>("mp4");
  const [quality, setQuality] = useState<VideoQuality>("high");
  const [fps, setFps] = useState<24 | 30 | 60>(30);
  const [maxDimension, setMaxDimension] = useState<1280 | 1920 | 'original'>(1920);
  const [renderer, setRenderer] = useState<'auto' | 'dom'>('auto');
  const dimensions = getVideoOutputDimensions(maxDimension);

  const hasAnimation = timeline.tracks.length > 0 || animationClips.length > 0 || imageOverlays.some(o => o.mediaType === 'video');
  const hasSlides = slides.length > 1;
  const [exportMode, setExportMode] = useState<ExportMode>("animation");

  // Sync export mode when dialog opens
  useEffect(() => {
    if (open) {
      if (hasAnimation) {
        setExportMode("animation");
      } else {
        setExportMode("slideshow");
      }
    }
  }, [open, hasAnimation]);

  const handleExport = async () => {
    try {
      const options: VideoExportOptions = { format, quality, fps, maxDimension, renderer };
      let result;
      if (exportMode === "animation") {
        result = await exportAnimationVideo(options);
      } else {
        result = await exportSlideshowVideo(options);
      }
      if (result.format !== format) {
        console.info(`Exported as ${result.format} (${format} not supported)`);
      }

      // Confetti on successful video export
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
      });

      toast.success('Video exported successfully!', {
        description: `Saved as ${result.format.toUpperCase()}`,
      });
    } catch (error) {
      // User cancelled â€” not a failure, no error toast.
      if (isExportAborted(error)) {
        return;
      }
      console.error('Video export failed:', error);
      toast.error('Video export failed', {
        description: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        duration: 8000,
      });
    } finally {
      onOpenChange(false);
    }
  };

  // Closing the dialog while an export is running cancels it.
  const handleOpenChange = (next: boolean) => {
    if (!next && exporting) {
      abort();
      toast('Export cancelled', { id: 'export-cancelled', duration: 1500 });
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        {exporting ? (
          /* ---- Fun export progress view ---- */
          <div>
            <DialogHeader>
              <DialogTitle>Exporting Video</DialogTitle>
              <DialogDescription>
                Sit back while we render your creation
              </DialogDescription>
            </DialogHeader>
            <ExportProgressView progress={progress} format={format} />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          /* ---- Settings view ---- */
          <>
            <DialogHeader>
              <DialogTitle>Export Video</DialogTitle>
              <DialogDescription>
                Configure your video export settings
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 pt-2">
              {/* Export Mode Selection */}
              {(hasAnimation || hasSlides) && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Export Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setExportMode("animation")}
                      className={`
                        relative p-3 rounded-lg border text-left transition-all
                        ${exportMode === "animation"
                          ? "border-primary/50 bg-primary/10"
                          : "border-border bg-card hover:border-border/80"
                        }
                      `}
                    >
                      <div className="font-medium text-sm text-foreground/90">Animation</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {(timeline.duration / 1000).toFixed(1)}s video
                      </div>
                    </button>
                    <button
                      onClick={() => setExportMode("slideshow")}
                      className={`
                        relative p-3 rounded-lg border text-left transition-all
                        ${exportMode === "slideshow"
                          ? "border-primary/50 bg-primary/10"
                          : "border-border bg-card hover:border-border/80"
                        }
                      `}
                    >
                      <div className="font-medium text-sm text-foreground/90">Slideshow</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {slides.length > 0 ? `${slides.length} slide${slides.length > 1 ? 's' : ''}` : 'Single image'}
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Format Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Format</label>
                <div className="grid grid-cols-2 gap-2">
                  {FORMAT_OPTIONS.map((opt) => {
                    const isDisabled = false;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => !isDisabled && setFormat(opt.value)}
                        disabled={isDisabled}
                        className={`
                          relative p-3 rounded-lg border text-left transition-all
                          ${format === opt.value
                            ? "border-primary/50 bg-primary/10"
                            : "border-border bg-card hover:border-border/80"
                          }
                          ${isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
                        `}
                      >
                        <div className="font-medium text-sm text-foreground/90">{opt.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                        {isDisabled && (
                          <div className="text-xs text-amber-400 mt-1">Browser not supported</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quality Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Quality</label>
                <div className="flex gap-2">
                  {QUALITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setQuality(opt.value)}
                      className={`
                        flex-1 py-2 px-3 rounded-lg border text-center transition-all
                        ${quality === opt.value
                          ? "border-primary/50 bg-primary/10"
                          : "border-border bg-card hover:border-border/80"
                        }
                      `}
                    >
                      <div className="font-medium text-sm text-foreground/90">{opt.label}</div>
                      <div className="text-xs text-muted-foreground">{opt.bitrate}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-2 text-sm font-medium">Resolution
                  <select aria-label="Video resolution" value={maxDimension} onChange={e => setMaxDimension(e.target.value === 'original' ? 'original' : Number(e.target.value) as 1280 | 1920)} className="block w-full rounded-md border border-border bg-card p-2 text-sm">
                    <option value="1280">720p · max edge 1280</option>
                    <option value="1920">1080p · max edge 1920</option>
                    <option value="original">Original size</option>
                  </select>
                </label>
                <label className="space-y-2 text-sm font-medium">Frame rate
                  <select aria-label="Video frame rate" value={fps} onChange={e => setFps(Number(e.target.value) as 24 | 30 | 60)} className="block w-full rounded-md border border-border bg-card p-2 text-sm">
                    <option value="24">24 fps</option><option value="30">30 fps</option><option value="60">60 fps</option>
                  </select>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">{dimensions ? `${dimensions.width} × ${dimensions.height}` : 'Original dimensions'} · {fps} fps</p>
              <label className="block space-y-2 text-sm font-medium">Rendering
                <select aria-label="Video rendering" value={renderer} onChange={e => setRenderer(e.target.value as 'auto' | 'dom')} className="block w-full rounded-md border border-border bg-card p-2 text-sm">
                  <option value="auto">Automatic · fastest compatible renderer</option>
                  <option value="dom">Full renderer · reference export</option>
                </select>
                <span className="block text-xs font-normal text-muted-foreground">Both preserve all effects.</span>
              </label>

              {/* Slide Duration */}
              {exportMode === "slideshow" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">
                    Slide Duration
                  </label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min={0.5}
                      max={30}
                      step={0.5}
                      value={formatNumber(slideshow.defaultDuration)}
                      onChange={(e) =>
                        setSlideshow({ defaultDuration: roundToTwoDecimals(Number(e.target.value)) || 3 })
                      }
                      className="flex-1"
                    />
                    <span className="text-sm text-muted-foreground">seconds per slide</span>
                  </div>
                </div>
              )}

              {/* Animation Duration Info */}
              {exportMode === "animation" && (
                <div className="p-3 rounded-lg bg-card border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground/70">Animation Duration</span>
                    <span className="text-sm font-medium text-foreground/90">
                      {(timeline.duration / 1000).toFixed(1)} seconds
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Adjust duration in the timeline controls
                  </p>
                </div>
              )}

              {/* Export Button */}
              <Button
                onClick={handleExport}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                size="lg"
              >
                Export as {format.toUpperCase()}
              </Button>


            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
