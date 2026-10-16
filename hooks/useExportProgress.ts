import { create } from "zustand";
import { startExportDiagnostics, finishExportDiagnostics, type ExportStage, type ExportDiagnostics } from '@/lib/export/export-diagnostics';

let lastUpdate = 0;

export const useExportProgress = create<{
  active: boolean;
  progress: number;
  stage: ExportStage;
  processedFrames: number;
  totalFrames: number;
  startedAt: number;
  elapsedMs: number;
  remainingMs: number | null;
  fallbackReason: string | null;
  diagnostics: ExportDiagnostics | undefined;
  update: (stage: ExportStage, processedFrames?: number, totalFrames?: number) => void;
  fallback: (reason: string) => void;
  controller: AbortController | null;
  /** Begins a new export and returns the signal that cancels it. */
  start: () => AbortSignal;
  set: (v: number) => void;
  done: () => void;
  /** Cancels the in-progress export, if any. */
  abort: () => void;
}>((set, get) => ({
  active: false,
  progress: 0,
  stage: 'Preparing', processedFrames: 0, totalFrames: 0, startedAt: 0, elapsedMs: 0,
  remainingMs: null, fallbackReason: null, diagnostics: undefined,
  controller: null,
  start: () => {
    if (get().controller) throw new Error('Another video export is still running');
    const controller = new AbortController();
    lastUpdate = 0;
    startExportDiagnostics();
    set({ active: true, progress: 0, stage: 'Preparing', processedFrames: 0, totalFrames: 0, startedAt: performance.now(), elapsedMs: 0, remainingMs: null, fallbackReason: null, diagnostics: undefined, controller });
    return controller.signal;
  },
  set: (v) => {
    if (!get().controller || get().controller?.signal.aborted) return;
    const now = performance.now();
    if (now - lastUpdate < 100 && v !== 0 && v !== 100) return;
    lastUpdate = now;
    set({ progress: Math.max(0, Math.min(100, v)), elapsedMs: now - get().startedAt });
  },
  update: (stage, processedFrames = get().processedFrames, totalFrames = get().totalFrames) => {
    const elapsedMs = performance.now() - get().startedAt;
    if (stage === get().stage && performance.now() - lastUpdate < 100 && processedFrames !== totalFrames) return;
    set({ stage, processedFrames, totalFrames, elapsedMs, remainingMs: stage === 'Rendering' && processedFrames >= 30 && elapsedMs > 2000 ? elapsedMs / processedFrames * (totalFrames - processedFrames) : null });
  },
  fallback: (reason) => set({ fallbackReason: reason, remainingMs: null }),
  done: () => set({ active: false, progress: 100, controller: null, diagnostics: finishExportDiagnostics(), remainingMs: null }),
  abort: () => {
    get().controller?.abort();
  },
}));
