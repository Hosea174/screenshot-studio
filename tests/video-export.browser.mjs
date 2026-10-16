/* global process, console, document, WebMMuxer, VideoEncoder, VideoFrame, Buffer, URL, Blob */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const diagnostics = [];
  page.on('console', async msg => { if (msg.text().startsWith('Video export diagnostics')) diagnostics.push(await msg.args()[1].jsonValue()); });
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.log('Browser error',e.message); });
  page.on('console',msg=>{ if(msg.type()==='error') console.log('Browser error',msg.text()); });
  page.on('worker',worker=>console.log('Worker created',worker.url()));
  console.log('Opening editor');
  await page.goto(process.env.STUDIO_URL || 'http://localhost:3000/editor', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByRole('button', { name: 'Motion', exact: true }).waitFor({ timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.addScriptTag({ path: 'node_modules/webm-muxer/build/webm-muxer.js' });
  console.log('Generating source video');
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d');
    const target = new WebMMuxer.ArrayBufferTarget();
    const muxer = new WebMMuxer.Muxer({ target, video: { codec: 'V_VP8', width: 320, height: 180, frameRate: 30 } });
    const encoder = new VideoEncoder({ output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata), error: e => { throw e; } });
    encoder.configure({ codec: 'vp8', width: 320, height: 180, bitrate: 500000, framerate: 30 });
    for (let i=0;i<300;i++) {
      ctx.fillStyle=i<150?'#f00000':'#0000f0'; ctx.fillRect(0,0,320,180);
      const frame=new VideoFrame(canvas,{timestamp:Math.round(i*1000000/30),duration:Math.round(1000000/30)});
      encoder.encode(frame,{keyFrame:i%15===0});frame.close();
    }
    await encoder.flush();encoder.close();muxer.finalize();return [...new Uint8Array(target.buffer)];
  });
  console.log('Uploading source video');
  await page.locator('#image-render-card input[type=file]').setInputFiles({ name: 'benchmark.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) });
  await page.locator('canvas[data-video-canvas]').waitFor({ timeout: 30000 });
  await page.getByLabel('Timeline duration seconds').fill('10');
  await page.waitForTimeout(800);
  if (process.env.EXPORT_BENCH_FFMPEG === '1') await page.evaluate(() => { globalThis.VideoEncoder = undefined; });
  const results = { dom: [], auto: [] };
  fs.mkdirSync('.impeccable/review', { recursive: true });
  for (const renderer of (process.env.EXPORT_BENCH_RENDERERS || 'dom,auto').split(',')) {
    const runs = Number(process.env.EXPORT_BENCH_RUNS || 3);
    for (let i = 0; i < runs; i++) {
      await page.getByRole('button', { name: 'Export Video', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: /WebM/ }).click();
      await dialog.getByLabel('Video rendering').selectOption(renderer);
      await dialog.getByLabel('Video resolution').selectOption('1920');
      await dialog.getByLabel('Video frame rate').selectOption('30');
      console.log('Starting export', renderer, i + 1);
      const download = page.waitForEvent('download', { timeout: 240000 });
      await dialog.getByRole('button', { name: 'Export as WEBM', exact: true }).click();
      const file = await download;
      const path = `.impeccable/review/video-benchmark-${renderer}.webm`;
      await file.saveAs(path);
      await page.waitForTimeout(100);
      const report = diagnostics.at(-1);
      assert.equal(report.frames, 300);
      if (renderer === 'auto') { assert.equal(report.renderer, process.env.EXPORT_BENCH_FFMPEG === '1' ? 'cached-main' : 'cached-worker', JSON.stringify(report)); assert.ok(report.domCaptures < 5); }
      else assert.equal(report.domCaptures, 300);
      results[renderer].push(report.elapsedMs);
      console.log(renderer, i + 1, report);
      await dialog.waitFor({ state: 'hidden' });
    }
  }
  const sampleExport = async path => page.evaluate(async bytes => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/webm' }));
    const video = document.createElement('video'); video.src = url; video.muted = true;
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = Math.round(256 * video.videoHeight / video.videoWidth);
    const ctx = canvas.getContext('2d');
    const samples = [];
    for (const time of [0.2, 4.8, 5.2, 9.8]) {
      await new Promise(resolve => { video.onseeked = resolve; video.currentTime = time; });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      samples.push([...ctx.getImageData(0, 0, canvas.width, canvas.height).data]);
    }
    URL.revokeObjectURL(url);
    return { samples, width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  }, [...fs.readFileSync(path)]);
  if (process.env.EXPORT_BENCH_RENDERERS) { await browser.close(); return; }
  const legacy = await sampleExport('.impeccable/review/video-benchmark-dom.webm');
  const fast = await sampleExport('.impeccable/review/video-benchmark-auto.webm');
  assert.equal(fast.width, legacy.width); assert.equal(fast.height, legacy.height);
  assert.ok(Math.abs(fast.duration - 10) < 1 / 30 + 0.005);
  let maxMeanError = 0;
  for (let frame = 0; frame < fast.samples.length; frame++) {
    let error = 0;
    for (let i = 0; i < fast.samples[frame].length; i += 4) {
      for (let channel = 0; channel < 3; channel++) error += Math.abs(fast.samples[frame][i + channel] - legacy.samples[frame][i + channel]);
    }
    maxMeanError = Math.max(maxMeanError, error / (fast.samples[frame].length / 4 * 3));
  }
  assert.ok(maxMeanError < 4, `Cached/DOM pixel mismatch: ${maxMeanError}`);
  const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];
  const speedup = median(results.dom) / median(results.auto);
  console.log('Export benchmark', { ...results, speedup, maxMeanError, dimensions: [fast.width, fast.height] });
  if (process.env.EXPORT_BENCH_REQUIRE_SPEEDUP === '1') assert.ok(speedup >= 3, `Expected >=3x speedup, received ${speedup}`);
  assert.deepEqual(errors, []);
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
