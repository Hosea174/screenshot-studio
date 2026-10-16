import type { ImageState } from '@/lib/store';
import type { WebCodecsEncoderOptions } from './webcodecs-encoder';
import { cachedSceneFallback, prepareCachedScene, closeCachedScene } from './cached-scene';
import { exportDiagnostics, recordExportTime } from './export-diagnostics';
import type { WorkerReply, WorkerRequest } from './video-export.worker';
import { useExportProgress } from '@/hooks/useExportProgress';

/** The same compositor feeds FFmpeg without requiring a WebCodecs encoder. */
export async function streamCachedVideo(state: ImageState, dimensions: { width: number; height: number }, fps: number, onFrame: (canvas: HTMLCanvasElement, index: number) => Promise<void>, signal: AbortSignal, onProgress?: (value: number) => void) {
  const reason = cachedSceneFallback(state);
  if (reason) return false;
  let renderer: Awaited<ReturnType<typeof import('./cached-renderer')['createCachedRenderer']>>;
  let scene: Awaited<ReturnType<typeof prepareCachedScene>> | undefined;
  const totalFrames = Math.ceil(state.timeline.duration * fps / 1000);
  try {
    scene = await prepareCachedScene(state, dimensions, signal);
    const { createCachedRenderer } = await import('./cached-renderer');
    renderer = await createCachedRenderer(scene, fps, totalFrames, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    if (scene) closeCachedScene(scene);
    const reason = error instanceof Error ? error.message : String(error);
    exportDiagnostics()?.fallbackReasons.push(reason);
    useExportProgress.getState().fallback(reason);
    return false;
  }
  const canvas = document.createElement('canvas'); canvas.width = dimensions.width; canvas.height = dimensions.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) { await renderer.dispose(); throw new Error('Could not create an export canvas'); }
  try {
    for (let i = 0; i < totalFrames; i++) {
      signal.throwIfAborted();
      ctx.drawImage(await renderer.render(i), 0, 0);
      const encodingStarted = performance.now();
      await onFrame(canvas, i);
      recordExportTime('encoding', performance.now() - encodingStarted);
      useExportProgress.getState().update('Rendering', i + 1, totalFrames);
      onProgress?.((i + 1) / totalFrames * 100);
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }
    const diagnostics = exportDiagnostics(); if (diagnostics) { diagnostics.renderer = 'cached-main'; diagnostics.frames = totalFrames; }
    for (const [stage, elapsed] of Object.entries(renderer.timings)) recordExportTime(stage, elapsed);
    return true;
  } finally { await renderer.dispose(); }
}

/** Returns null for an unsupported scene; infrastructure errors are handled by the caller. */
export async function exportCachedVideo(state: ImageState, options: WebCodecsEncoderOptions, signal: AbortSignal): Promise<Blob | null> {
  const reason = cachedSceneFallback(state);
  const diagnostics = exportDiagnostics();
  if (reason) { diagnostics?.fallbackReasons.push(reason); useExportProgress.getState().fallback(reason); return null; }
  let scene = await prepareCachedScene(state, options, signal);
  const totalFrames = Math.ceil(state.timeline.duration * options.fps / 1000);
  if (typeof Worker !== 'undefined') {
    let worker: Worker;
    try { worker = new Worker(new URL('./video-export.worker.ts', import.meta.url), { type: 'module' }); }
    catch { return runOnMain(); }
    const id = crypto.randomUUID();
    let transferred = false;
    try {
      return await new Promise<Blob>((resolve, reject) => {
        let watchdog: ReturnType<typeof setTimeout>;
        const armWatchdog = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => { cleanup(); reject(new Error('The export worker stopped responding')); }, 60_000);
        };
        const abort = () => { cleanup(); worker.postMessage({ id, type: 'cancel' } satisfies WorkerRequest); reject(new DOMException('Export cancelled', 'AbortError')); };
        signal.addEventListener('abort', abort, { once: true });
        const cleanup = () => { clearTimeout(watchdog); signal.removeEventListener('abort', abort); };
        worker.onerror = event => { cleanup(); reject(new Error(event.message || 'The export worker failed')); };
        worker.onmessage = (event: MessageEvent<WorkerReply>) => {
          const result = event.data; if (result.id !== id) return;
          armWatchdog();
          if (result.type === 'progress') {
            const p = useExportProgress.getState(); p.update(result.stage, result.frames, result.totalFrames); p.set(result.frames / result.totalFrames * 90);
          } else {
            cleanup();
            if (result.type === 'error') reject(new Error(result.message));
            else {
              for (const [stage, elapsed] of Object.entries(result.timings)) recordExportTime(stage, elapsed);
              if (diagnostics) { diagnostics.renderer = 'cached-worker'; diagnostics.frames = totalFrames; }
              resolve(result.blob);
            }
          }
        };
        if (signal.aborted) { cleanup(); reject(new DOMException('Export cancelled', 'AbortError')); return; }
        worker.postMessage({ id, type: 'start', scene, options, totalFrames } satisfies WorkerRequest, scene.layers.flatMap(l => l.bitmap ? [l.bitmap] : []));
        transferred = true;
        armWatchdog();
      });
    } catch (error) {
      worker.terminate();
      if (signal.aborted) { if (!transferred) closeCachedScene(scene); throw error; }
      const reason = error instanceof Error ? error.message : String(error);
      diagnostics?.fallbackReasons.push(reason);
      useExportProgress.getState().fallback('Continuing with the compatible browser renderer');
      if (!transferred) closeCachedScene(scene);
      scene = await prepareCachedScene(state, options, signal);
      options = { ...options, hardwareAcceleration: 'prefer-software' };
      return await runOnMain();
    } finally { worker.terminate(); }
  }
  return runOnMain();

  async function runOnMain() {
    const [{ createCachedRenderer }, { WebCodecsVideoEncoder }] = await Promise.all([import('./cached-renderer'), import('./webcodecs-encoder')]);
    const encoder = new WebCodecsVideoEncoder(options);
    let renderer: Awaited<ReturnType<typeof createCachedRenderer>> | undefined;
    try {
      await encoder.initialize();
      renderer = await createCachedRenderer(scene, options.fps, totalFrames, signal);
      for (let i = 0; i < totalFrames; i++) {
        signal.throwIfAborted();
        const frame = await renderer.render(i);
        const started = performance.now(); await encoder.encodeFromCanvas(frame, i); recordExportTime('encoding', performance.now() - started);
        const p = useExportProgress.getState(); p.update('Rendering', i + 1, totalFrames); p.set((i + 1) / totalFrames * 90);
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }
      useExportProgress.getState().update('Finalizing');
      const blob = await encoder.finalize(); signal.throwIfAborted();
      if (diagnostics) { diagnostics.renderer = 'cached-main'; diagnostics.frames = totalFrames; }
      for (const [stage, elapsed] of Object.entries(renderer.timings)) recordExportTime(stage, elapsed);
      return blob;
    } finally { encoder.dispose(); if (renderer) await renderer.dispose(); else closeCachedScene(scene); }
  }
}
