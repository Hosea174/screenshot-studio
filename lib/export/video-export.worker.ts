import { createCachedRenderer } from './cached-renderer';
import { WebCodecsVideoEncoder, type WebCodecsEncoderOptions } from './webcodecs-encoder';
import type { CachedScene } from './cached-scene';

// Next's client webpack output assigns this global at worker startup. Module
// workers run in strict mode, so the binding must exist before that assignment.
(globalThis as typeof globalThis & { _N_E: unknown })._N_E = {};

export type WorkerRequest = { id: string; type: 'start'; scene: CachedScene; options: WebCodecsEncoderOptions; totalFrames: number } | { id: string; type: 'cancel' };
export type WorkerReply =
  | { id: string; type: 'progress'; frames: number; totalFrames: number; stage: 'Rendering' | 'Finalizing' }
  | { id: string; type: 'done'; blob: Blob; timings: Record<string, number> }
  | { id: string; type: 'error'; message: string };

let controller: AbortController | undefined;
let jobId = '';
const reply = (message: WorkerReply) => postMessage(message);
addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const job = event.data;
  if (job.type === 'cancel') { if (job.id === jobId) controller?.abort(); return; }
  if (controller) { reply({ id: job.id, type: 'error', message: 'The export worker is already busy' }); return; }
  jobId = job.id;
  controller = new AbortController();
  const encoder = new WebCodecsVideoEncoder(job.options);
  let renderer: Awaited<ReturnType<typeof createCachedRenderer>> | undefined;
  let encoding = 0;
  try {
    await encoder.initialize();
    renderer = await createCachedRenderer(job.scene, job.options.fps, job.totalFrames, controller.signal);
    let lastProgress = 0;
    for (let i = 0; i < job.totalFrames; i++) {
      controller.signal.throwIfAborted();
      const canvas = await renderer.render(i);
      const started = performance.now();
      await encoder.encodeFromCanvas(canvas, i);
      encoding += performance.now() - started;
      if (performance.now() - lastProgress >= 100 || i === job.totalFrames - 1) {
        reply({ id: job.id, type: 'progress', frames: i + 1, totalFrames: job.totalFrames, stage: 'Rendering' });
        lastProgress = performance.now();
      }
    }
    reply({ id: job.id, type: 'progress', frames: job.totalFrames, totalFrames: job.totalFrames, stage: 'Finalizing' });
    const started = performance.now();
    const blob = await encoder.finalize();
    controller.signal.throwIfAborted();
    reply({ id: job.id, type: 'done', blob, timings: { ...renderer.timings, encoding, finalization: performance.now() - started } });
  } catch (error) {
    reply({ id: job.id, type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    encoder.dispose();
    if (renderer) await renderer.dispose();
    else for (const layer of job.scene.layers) layer.bitmap?.close();
    controller = undefined;
  }
});
