/**
 * FFmpeg WASM Video Encoder
 *
 * Uses FFmpeg compiled to WebAssembly for high-quality video encoding.
 * Runs entirely in the browser - no server needed!
 *
 * Performance optimizations:
 * - Multi-threaded WASM core when cross-origin isolated (SharedArrayBuffer)
 * - JPEG frame encoding instead of PNG (~5x faster per frame)
 * - Concat demuxer mode: writes 1 file per slide instead of N duplicate frames
 * - Browser Cache API for WASM binary persistence across sessions
 * - ultrafast H.264 preset for WASM (massive speedup, minimal quality loss)
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';

export type FFmpegFormat = 'mp4' | 'webm' | 'gif';
export type FFmpegQuality = 'high' | 'medium' | 'low';

export interface FFmpegEncoderOptions {
  width: number;
  height: number;
  fps: number;
  format?: FFmpegFormat;
  quality?: FFmpegQuality;
  onProgress?: (progress: number) => void;
  onLog?: (message: string) => void;
}

// Quality presets (CRF values - lower = better quality, larger file)
const QUALITY_CRF: Record<FFmpegQuality, number> = {
  high: 18,    // Visually lossless
  medium: 23,  // Good quality, reasonable size
  low: 28,     // Smaller file, some quality loss
};

// Singleton FFmpeg instance
let ffmpegInstance: FFmpeg | null = null;
let isLoading = false;
let loadPromise: Promise<FFmpeg> | null = null;
let loadingInstance: FFmpeg | null = null;
let loadController: AbortController | null = null;
let ffmpegBlobUrls: string[] = [];
let multithreadedCore = false;

// Mutex to prevent concurrent exports from corrupting the virtual filesystem
let exportLock: Promise<void> = Promise.resolve();

const CACHE_NAME = 'ffmpeg-wasm-cache-v1';

/**
 * Check if the page is cross-origin isolated (required for SharedArrayBuffer / MT)
 */
function isCrossOriginIsolated(): boolean {
  return typeof globalThis !== 'undefined' && !!globalThis.crossOriginIsolated;
}

/**
 * Fetch a URL with Cache API persistence.
 * Returns a blob URL — reuses cached response across sessions.
 */
async function cachedToBlobURL(url: string, mimeType: string, signal?: AbortSignal): Promise<string> {
  let cache: Cache | undefined;
  let response: Response | undefined;
  try {
    if (typeof caches !== 'undefined') {
      cache = await caches.open(CACHE_NAME);
      response = await cache.match(url);
    }
  } catch { /* Cache availability does not determine export support. */ }
  signal?.throwIfAborted();
  if (!response) {
    response = await fetch(url, { signal });
    if (!response.ok) throw new Error('Could not load the video encoder');
    if (cache) await cache.put(url, response.clone()).catch(() => {});
  }
  const blob = await response.blob();
  signal?.throwIfAborted();
  return URL.createObjectURL(new Blob([blob], { type: mimeType }));
}

/**
 * Load FFmpeg WASM (singleton, loads only once).
 * Uses multi-threaded core when cross-origin isolated, single-threaded otherwise.
 * Caches WASM binaries via Cache API for fast reload across sessions.
 */
export async function loadFFmpeg(
  _onProgress?: (progress: number) => void,
  multithread = false
): Promise<FFmpeg> {
  // Return existing instance if loaded
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  // Return existing load promise if loading
  if (isLoading && loadPromise) {
    return loadPromise;
  }

  isLoading = true;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    loadingInstance = ffmpeg;
    const controller = new AbortController();
    loadController = controller;
    // The MT core preallocates a 1 GiB heap and 32 workers even for small jobs.
    // Use the reliable single-threaded fallback by default; WebCodecs is the fast path.
    const useMT = multithread && isCrossOriginIsolated();
    const tempBlobUrls: string[] = [];

    const trackedBlobURL = async (url: string, mimeType: string): Promise<string> => {
      const blobUrl = await cachedToBlobURL(url, mimeType, controller.signal);
      if (blobUrl.startsWith('blob:')) {
        tempBlobUrls.push(blobUrl);
      }
      return blobUrl;
    };

    try {
      // Run the package's unbundled worker: webpack rewrites its variable core
      // import into a context lookup that cannot resolve a blob URL.
      const workerBase = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/esm';
      const [workerSourceURL, constantsURL, errorsURL] = await Promise.all([
        trackedBlobURL(`${workerBase}/worker.js`, 'text/javascript'),
        trackedBlobURL(`${workerBase}/const.js`, 'text/javascript'),
        trackedBlobURL(`${workerBase}/errors.js`, 'text/javascript'),
      ]);
      const workerSource = await (await fetch(workerSourceURL, { signal: controller.signal })).text();
      const classWorkerURL = URL.createObjectURL(new Blob([workerSource.replace('"./const.js"', JSON.stringify(constantsURL)).replace('"./errors.js"', JSON.stringify(errorsURL))], { type: 'text/javascript' }));
      tempBlobUrls.push(classWorkerURL);
      if (useMT) {
        const baseURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm';
        await ffmpeg.load({
          classWorkerURL,
          coreURL: await trackedBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await trackedBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
          workerURL: await trackedBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
        });
      } else {
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
        await ffmpeg.load({
          classWorkerURL,
          coreURL: await trackedBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await trackedBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
      }

      ffmpegInstance = ffmpeg;
      multithreadedCore = useMT;
      ffmpegBlobUrls = tempBlobUrls;
      return ffmpeg;
    } catch (error) {
      ffmpeg.terminate();
      // Clear load promise to allow retries after transient CDN/network failures.
      loadPromise = null;
      throw error;
    } finally {
      isLoading = false;
      loadingInstance = null;
      loadController = null;
      // MT threads can start after load(), so keep their module URLs until termination.
      if (ffmpegInstance !== ffmpeg) for (const blobUrl of tempBlobUrls) URL.revokeObjectURL(blobUrl);
    }
  })();

  return loadPromise;
}

/**
 * Check if FFmpeg is loaded and ready
 */
export function isFFmpegLoaded(): boolean {
  return ffmpegInstance !== null && ffmpegInstance.loaded;
}

/**
 * FFmpeg-based video encoder class
 *
 * Supports two modes:
 * - Frame mode (default): writes individual JPEG frames, best for animations
 * - Concat mode: writes 1 JPEG per unique slide + concat script, best for slideshows
 */
function encodingArgs(inputArgs: string[], format: FFmpegFormat, quality: FFmpegQuality, width: number, height: number, fps: number, outputFile: string): string[] {
    const crf = QUALITY_CRF[quality];
    inputArgs = ['-threads', multithreadedCore ? '2' : '1', ...inputArgs];
    let ffmpegArgs: string[];
    if (format === 'mp4') {
      ffmpegArgs = [
        ...inputArgs,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', String(crf),
        '-pix_fmt', 'yuv420p',
        '-threads', multithreadedCore ? '2' : '1',
        '-movflags', '+faststart',
        '-y',
        outputFile,
      ];
    } else if (format === 'webm') {
      // VP8 is faster and avoids libvpx-vp9's WASM memory failures at large sizes.
      const bitrate = { high: '10M', medium: '5M', low: '2M' }[quality];
      ffmpegArgs = [
        ...inputArgs, '-c:v', 'libvpx', '-crf', String(crf), '-b:v', bitrate,
        '-pix_fmt', 'yuv420p', '-deadline', 'realtime', '-cpu-used', '8',
        '-lag-in-frames', '0', '-threads', multithreadedCore ? '2' : '1',
        '-y', outputFile,
      ];
    } else if (format === 'gif') {
      ffmpegArgs = [
        ...inputArgs,
        '-vf', `fps=${Math.min(fps, 30)},scale=${width}:${height}:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer`,
        '-loop', '0',
        '-y',
        outputFile,
      ];
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }

    return ffmpegArgs;
}

export class FFmpegVideoEncoder {
  private ffmpeg: FFmpeg | null = null;
  private options: Required<FFmpegEncoderOptions>;
  private frameCount = 0;
  private pendingFrames = 0;
  private segments: string[] = [];
  private progressHandler: ((event: { progress: number }) => void) | null = null;
  private logHandler: ((event: { message: string }) => void) | null = null;
  private releaseLock: (() => void) | null = null;
  private cleanedUp = false;
  private recentLogs: string[] = [];

  // Concat demuxer mode
  private concatMode = false;
  private concatEntries: { file: string; duration: number }[] = [];
  private slideFileCount = 0;

  constructor(options: FFmpegEncoderOptions) {
    this.options = {
      ...options,
      format: options.format ?? 'mp4',
      quality: options.quality ?? 'high',
      onProgress: options.onProgress ?? (() => {}),
      onLog: options.onLog ?? (() => {}),
    };
  }

  /**
   * Enable concat demuxer mode for slideshow encoding.
   * Call this before addSlide() instead of addFrame().
   */
  enableConcatMode(): void {
    this.concatMode = true;
  }

  /**
   * Initialize FFmpeg (waits for any concurrent export to finish)
   */
  async initialize(): Promise<void> {
    // Wait for any in-progress export to finish (prevents VFS corruption)
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => { releaseLock = resolve; });
    const previousLock = exportLock;
    exportLock = lockPromise;
    await previousLock;
    this.releaseLock = releaseLock!;

    this.ffmpeg = await loadFFmpeg((p) => {
      this.options.onProgress(p * 0.1);
    });

    // Set up logging with tracked handler for cleanup
    this.logHandler = ({ message }) => {
      this.recentLogs.push(message);
      if (this.recentLogs.length > 12) this.recentLogs.shift();
      this.options.onLog(message);
    };
    this.ffmpeg.on('log', this.logHandler);
  }

  /**
   * Add a slide with its duration (concat mode).
   * Writes one JPEG per unique canvas to VFS — no duplicate files.
   */
  async addSlide(canvas: HTMLCanvasElement, durationSecs: number): Promise<void> {
    if (!this.ffmpeg) throw new Error('FFmpeg not initialized');

    const slideFile = `slide_${String(this.slideFileCount).padStart(4, '0')}.jpg`;

    // Encode canvas to JPEG
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92);
    });
    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    await this.ffmpeg.writeFile(slideFile, data);
    this.concatEntries.push({ file: slideFile, duration: durationSecs });
    this.slideFileCount++;
  }

  /**
   * Add a frame from canvas — writes directly to FFmpeg VFS.
   * Uses JPEG encoding (much faster than PNG) and duplicate detection.
   */
  async addFrame(canvas: HTMLCanvasElement): Promise<void> {
    if (!this.ffmpeg) throw new Error('FFmpeg not initialized');

    const paddedIndex = String(this.pendingFrames).padStart(6, '0');
    const fileName = `frame_${paddedIndex}.jpg`;

    // Encode canvas to JPEG (much faster than PNG, fine for video frames)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Frame capture failed')), 'image/jpeg', 0.92);
    });

    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    await this.ffmpeg.writeFile(fileName, data);

    this.frameCount++;
    this.pendingFrames++;
    if (this.options.format !== 'gif' && this.pendingFrames >= this.options.fps * 5) await this.flushSegment();
  }

  private async flushSegment(): Promise<void> {
    if (!this.ffmpeg || !this.pendingFrames) return;
    const { format, quality, width, height, fps } = this.options;
    const file = `segment_${this.segments.length}.${format}`;
    let exitCode: number;
    try { exitCode = await this.ffmpeg.exec(encodingArgs(['-framerate', String(fps), '-i', 'frame_%06d.jpg'], format, quality, width, height, fps, file)); }
    catch (error) { console.error('FFmpeg segment failed', this.recentLogs.join('\n')); throw error; }
    if (exitCode !== 0) throw new Error('FFmpeg failed to encode a video segment');
    this.segments.push(file);
    await Promise.all(Array.from({ length: this.pendingFrames }, (_, i) => this.ffmpeg!.deleteFile(`frame_${String(i).padStart(6, '0')}.jpg`)));
    this.pendingFrames = 0;
  }

  /**
   * Encode all frames and return video blob
   */
  async encode(): Promise<Blob> {
    if (!this.ffmpeg) {
      throw new Error('FFmpeg not initialized');
    }

    const { fps, format, quality, width, height, onProgress } = this.options;

    // Build FFmpeg command based on format
    const outputFile = `output.${format}`;
    let ffmpegArgs: string[];

    // Determine input args based on mode
    const inputArgs = this.concatMode
      ? ['-f', 'concat', '-safe', '0', '-i', 'concat.txt']
      : ['-framerate', String(fps), '-i', 'frame_%06d.jpg'];

    // Write concat script if in concat mode
    if (this.concatMode) {
      const lines = ['ffconcat version 1.0'];
      for (const entry of this.concatEntries) {
        lines.push(`file '${entry.file}'`);
        lines.push(`duration ${entry.duration.toFixed(4)}`);
      }
      // Repeat last file (FFmpeg concat demuxer quirk — last entry needs a trailing file)
      if (this.concatEntries.length > 0) {
        lines.push(`file '${this.concatEntries[this.concatEntries.length - 1].file}'`);
      }
      const concatScript = lines.join('\n');
      await this.ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatScript));
    }

    if (!this.concatMode && format !== 'gif' && this.segments.length) {
      await this.flushSegment();
      await this.ffmpeg.writeFile('segments.txt', new TextEncoder().encode(this.segments.map(file => `file '${file}'`).join('\n')));
      ffmpegArgs = ['-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-c', 'copy', ...(format === 'mp4' ? ['-movflags', '+faststart'] : []), '-y', outputFile];
    } else {
      ffmpegArgs = encodingArgs(inputArgs, format, quality, width, height, fps, outputFile);
    }

    this.progressHandler = ({ progress }) => {
      onProgress(10 + progress * 90);
    };
    this.ffmpeg.on('progress', this.progressHandler);

    try {
      // Run FFmpeg
      const exitCode = await this.ffmpeg.exec(ffmpegArgs);
      if (exitCode !== 0) throw new Error('FFmpeg failed to encode the video');

      // Read output file
      const data = await this.ffmpeg.readFile(outputFile);

      // Convert to blob
      const mimeTypes: Record<FFmpegFormat, string> = {
        mp4: 'video/mp4',
        webm: 'video/webm',
        gif: 'image/gif',
      };

      const blobData = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : new Uint8Array(data);

      return new Blob([blobData], { type: mimeTypes[format] });
    } finally {
      // Always clean up: remove listeners, delete files, release lock
      await this.cleanup();
    }
  }

  /**
   * Dispose the encoder without encoding — releases the export lock and frees
   * VFS/listeners. Safe to call on a cancelled or failed export.
   */
  async dispose(): Promise<void> {
    await this.cleanup();
  }

  /**
   * Clean up FFmpeg VFS, listeners, and release export lock.
   * Idempotent: safe to call multiple times (e.g. from encode() and dispose()).
   */
  private async cleanup(): Promise<void> {
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    if (this.ffmpeg) {
      // Remove event listeners to prevent accumulation
      if (this.progressHandler) {
        this.ffmpeg.off('progress', this.progressHandler);
        this.progressHandler = null;
      }
      if (this.logHandler) {
        this.ffmpeg.off('log', this.logHandler);
        this.logHandler = null;
      }

      // Batch cleanup: delete all VFS files concurrently
      const deleteOps: Promise<unknown>[] = [];

      if (this.concatMode) {
        // Concat mode: delete slide files + concat script
        for (let i = 0; i < this.slideFileCount; i++) {
          const file = `slide_${String(i).padStart(4, '0')}.jpg`;
          deleteOps.push(this.ffmpeg.deleteFile(file).catch(() => {}));
        }
        deleteOps.push(this.ffmpeg.deleteFile('concat.txt').catch(() => {}));
      } else {
        // Frame mode: delete frame files
        for (let i = 0; i < this.pendingFrames; i++) {
          const paddedIndex = String(i).padStart(6, '0');
          deleteOps.push(this.ffmpeg.deleteFile(`frame_${paddedIndex}.jpg`).catch(() => {}));
        }
      }

      for (const file of this.segments) deleteOps.push(this.ffmpeg.deleteFile(file).catch(() => {}));
      deleteOps.push(this.ffmpeg.deleteFile('segments.txt').catch(() => {}));
      deleteOps.push(this.ffmpeg.deleteFile('output.mp4').catch(() => {}));
      deleteOps.push(this.ffmpeg.deleteFile('output.webm').catch(() => {}));
      deleteOps.push(this.ffmpeg.deleteFile('output.gif').catch(() => {}));

      await Promise.all(deleteOps);
    }

    // Release the export lock so next export can proceed
    if (this.releaseLock) {
      this.releaseLock();
      this.releaseLock = null;
    }
  }

  /**
   * Get current frame count
   */
  getFrameCount(): number {
    return this.concatMode ? this.slideFileCount : this.frameCount;
  }
}

/**
 * High-level function to encode canvas frames to video using FFmpeg
 */
export async function encodeWithFFmpeg(
  canvases: HTMLCanvasElement[],
  options: FFmpegEncoderOptions
): Promise<Blob> {
  const encoder = new FFmpegVideoEncoder(options);
  await encoder.initialize();

  const total = canvases.length;

  for (let i = 0; i < total; i++) {
    await encoder.addFrame(canvases[i]);

    // Yield to main thread periodically
    if (i % 5 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  return encoder.encode();
}

/**
 * Terminate FFmpeg and free memory
 */
export function terminateFFmpeg(): void {
  loadController?.abort();
  loadingInstance?.terminate();
  if (ffmpegInstance) {
    ffmpegInstance.terminate();
    ffmpegInstance = null;
    loadPromise = null;
  }
  loadPromise = null;
  for (const url of ffmpegBlobUrls) URL.revokeObjectURL(url);
  ffmpegBlobUrls = [];
  // Reset the mutex so a cancelled export mid-encode can't deadlock the next one.
  // Any encoder still holding the old lock resolves a now-unreferenced promise.
  exportLock = Promise.resolve();
  isLoading = false;
}
