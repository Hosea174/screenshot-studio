"use client";

import { useExportProgress } from "@/hooks/useExportProgress";

export function ExportProgressOverlay() {
  const { active, progress, stage, processedFrames, totalFrames, elapsedMs, fallbackReason, abort } = useExportProgress();

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-9999 bg-black/70 flex items-center justify-center">
      <div className="w-[320px] bg-background rounded-lg p-6 space-y-4">
        <p className="text-sm font-medium text-center" aria-live="polite">{stage} video…</p>
        <div role="progressbar" aria-label="Video export" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} className="h-2 bg-muted rounded overflow-hidden">
          <div
            className="h-full bg-primary transition-[width] motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-center text-muted-foreground">
          {Math.round(progress)}% · {Math.round(elapsedMs / 1000)}s elapsed
          {totalFrames > 0 && ` · ${processedFrames}/${totalFrames} frames`}
        </p>
        {fallbackReason && <p className="text-xs text-muted-foreground">{fallbackReason}. All effects are preserved.</p>}
        <button type="button" onClick={abort} className="w-full rounded-md border border-border px-3 py-2 text-sm">Cancel export</button>
      </div>
    </div>
  );
}
