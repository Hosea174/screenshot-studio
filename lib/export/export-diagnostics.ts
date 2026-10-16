export type ExportStage = 'Preparing' | 'Rendering' | 'Encoding' | 'Finalizing';
export interface ExportDiagnostics {
  renderer: string;
  fallbackReasons: string[];
  frames: number;
  domCaptures: number;
  timings: Record<string, number>;
  elapsedMs: number;
}

let current: ExportDiagnostics | undefined;
let started = 0;
export function startExportDiagnostics() {
  started = performance.now();
  current = { renderer: 'dom', fallbackReasons: [], frames: 0, domCaptures: 0, timings: {}, elapsedMs: 0 };
}
export function exportDiagnostics() { return current; }
export function recordExportTime(stage: string, elapsed: number) {
  if (current) current.timings[stage] = (current.timings[stage] ?? 0) + elapsed;
}
export function finishExportDiagnostics() {
  if (current) {
    current.elapsedMs = performance.now() - started;
    // Local diagnostics only; no source URLs, media bytes, or telemetry.
    // eslint-disable-next-line no-console -- intentionally local performance diagnostics
    console.info('Video export diagnostics', structuredClone(current));
  }
  return current;
}
