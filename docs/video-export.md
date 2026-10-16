# Browser video exports

Video exports default to 30 fps and a 1920-pixel maximum edge. Resolution is
proportional and never enlarged. The dialog also offers 1280 pixels, original
size, and 24/60 fps. Quality controls encoding bitrate independently.

## Rendering

Automatic rendering captures static artwork in stacking order around changing
media layers. A module worker decodes MP4/MOV/WebM through Mediabunny, composites
into an OffscreenCanvas, and encodes/muxes through WebCodecs. Source timestamps
respect delayed starts, trim, playback rate, loops, and frozen end frames.
Preview video elements are never sought by this path.

Each slide is prepared once. Expired slide bitmaps are closed during rendering;
the raster cache is capped at 128 MiB. The decoder library bounds its internal
queues; the compositor retains one sample per active video. Encoder backpressure
drains queues through dequeue events, with a stall deadline.

Unsupported media filters, perspective animation, main-image animation, masks,
and cross-layer blur/mosaic effects use the full DOM renderer. Artwork is never
simplified. Full renderer can also be selected explicitly for reference exports.
It uses export-owned source readers and disables competing preview seek handlers.
Worker startup failures retry cached compositing on the main thread using software
encoding before falling back to DOM rendering.

FFmpeg loads only when needed and receives cached frames where compatible. Its
MP4/WebM path writes at most five seconds of JPEG frames, encodes a segment,
deletes those JPEGs, and joins the encoded segments without re-encoding. GIF
retains its palette path. Encoded output storage still grows with duration.
The FFmpeg WebM fallback uses VP8; its VP9 encoder failed the high-resolution
WASM check. The WebCodecs path still prefers VP9 where supported.

FFmpeg uses the reliable single-threaded 0.12.10 core by default. The MT core's
preallocated 1 GiB heap and 32-worker pool failed the forced fallback check on
this machine; its explicit loader option remains available for isolated pages.
FFmpeg's pinned 0.12.15 worker is loaded without webpack transformation so its
native dynamic core import works. Its core and worker blob URLs live until
termination because multithreaded core workers can start after initialization.

Cancellation aborts asset reads, stops workers, and releases media resources.
Exports pause undo tracking and restore the playhead, active slide, appearance,
and tracking afterward. Exports remain browser jobs: suspending a browser tab or
the operating system can pause them.

## Verification

`npm test` covers output sizing, timing, and renderer eligibility alongside the
existing suite. `tests/video-layer.browser.mjs` checks upload, scrubbing, decoded
frame changes, start visibility, opacity animation, cancellation, and retry.

Run the benchmark against a stable dev or production server; avoid source edits
while it runs because hot reload can interrupt an export:

```powershell
$env:STUDIO_URL = 'http://localhost:3555/editor'
$env:EXPORT_BENCH_RUNS = '3'
$env:EXPORT_BENCH_REQUIRE_SPEEDUP = '1'
npm run test:export
```

The benchmark compares a ten-second clip through both renderers at identical
settings, decodes four output timestamps, checks pixel differences and duration,
and reports the median speedup. The optional speed gate requires at least 3x on
the test machine; it is not a universal hardware guarantee.

For a forced FFmpeg check, use one run with `EXPORT_BENCH_RENDERERS=auto` and
`EXPORT_BENCH_FFMPEG=1`. This disables only VideoEncoder after creating the source
fixture, exercising the cached compositor and two five-second FFmpeg segments.

Diagnostics are retained in `useExportProgress.diagnostics` and printed locally
after export. They report renderer, fallback reasons, frames, DOM captures, stage
timings, and total elapsed time. They contain no source URLs or media bytes and
are not sent to telemetry.
