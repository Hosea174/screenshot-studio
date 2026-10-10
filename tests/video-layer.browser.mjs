/* global process, console, document, WebMMuxer, VideoEncoder, VideoFrame, Buffer, URL, Blob, DataTransfer, File, DragEvent */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.STUDIO_URL || 'http://localhost:3000/editor', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByRole('button', { name: 'Motion', exact: true }).waitFor({ timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.addScriptTag({ path: 'node_modules/webm-muxer/build/webm-muxer.js' });
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d');
    const target = new WebMMuxer.ArrayBufferTarget();
    const muxer = new WebMMuxer.Muxer({ target, video: { codec: 'V_VP8', width: 320, height: 180, frameRate: 30 } });
    const encoder = new VideoEncoder({ output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata), error: e => { throw e; } });
    encoder.configure({ codec: 'vp8', width: 320, height: 180, bitrate: 500000, framerate: 30 });
    for (let i=0;i<54;i++) {
      ctx.fillStyle=i<21?'#f00000':'#0000f0'; ctx.fillRect(0,0,320,180);
      const frame=new VideoFrame(canvas,{timestamp:Math.round(i*1000000/30),duration:Math.round(1000000/30)});
      encoder.encode(frame,{keyFrame:i%15===0});frame.close();
    }
    await encoder.flush();encoder.close();muxer.finalize();return [...new Uint8Array(target.buffer)];
  });
  // Exercise the empty canvas and populated canvas drop paths, separately from
  // the Media layers picker. This catches image-only validation regressions.
  const dropPage = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  dropPage.on('pageerror', e => errors.push(e.message));
  await dropPage.goto(process.env.STUDIO_URL || 'http://localhost:3000/editor', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await dropPage.getByRole('button', { name: 'Motion', exact: true }).waitFor({ timeout: 120000 });
  await dropPage.waitForTimeout(3000);
  const dropVideo = async () => dropPage.locator('#image-render-card').evaluate((element, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'dropped.webm', { type: 'video/webm' }));
    const target = element.querySelector('[role="presentation"]') || element;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }
  }, bytes);
  await dropVideo();
  await dropPage.locator('canvas[data-video-canvas]').waitFor({ timeout: 30000 });
  await dropVideo();
  await dropPage.waitForFunction(() => document.querySelectorAll('canvas[data-video-canvas]').length === 2);
  assert.equal(await dropPage.getByText(/File type not supported/).count(), 0);
  await dropPage.close();

  await page.locator('#image-render-card input[type=file]').setInputFiles({ name: 'colors.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) });
  const canvas = page.locator('canvas[data-video-canvas]'); await canvas.waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  const pixel = () => canvas.evaluate(e => [...e.getContext('2d').getImageData(160,90,1,1).data]);
  const red = await pixel(); assert.ok(red[0] > 180 && red[2] < 60, `initial video frame: ${red}`);
  await page.getByRole('region', { name: 'Animation timeline' }).click({ position: { x: 100, y: 70 } });
  await page.keyboard.press('Home');
  for (let i=0; i<6; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(500);
  const blue = await pixel(); assert.ok(blue[2] > 180 && blue[0] < 60, `scrubbed video frame: ${blue}`);
  if (process.env.STUDIO_UPLOAD_ONLY === '1') {
    assert.deepEqual(errors, []);
    console.log('Empty and populated canvas video drops, canvas picker, and scrubbing passed');
    await browser.close();
    return;
  }
  // Video-only export must work with zero animation tracks.
  await page.getByLabel('Timeline duration seconds').fill('1.2');
  await page.getByRole('button', { name: 'Export Video', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /WebM/ }).click();
  const download = page.waitForEvent('download', { timeout: 180000 });
  await dialog.getByRole('button', { name: 'Export as WEBM', exact: true }).click();
  const result = await download;
  const path = '.impeccable/review/video-layer-export.webm'; await result.saveAs(path);
  assert.ok(fs.statSync(path).size > 1000);
  // Decode the downloaded export; it must contain the changing source frames.
  const inspectExport = async path => page.evaluate(async bytes => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/webm' }));
    const video = document.createElement('video'); video.src=url; video.muted=true;
    await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject;});
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    const ctx=canvas.getContext('2d');
    const sample=async time=>{video.currentTime=time;await new Promise(r=>video.onseeked=r);ctx.drawImage(video,0,0);return [...ctx.getImageData(0,0,canvas.width,canvas.height).data];};
    const count = data => {let red=0,blue=0;for(let i=0;i<data.length;i+=4){if(data[i]>170&&data[i+2]<70)red++;if(data[i+2]>170&&data[i]<70)blue++;}return {red,blue};};
    const first=count(await sample(.1)),last=count(await sample(1));URL.revokeObjectURL(url);return {first,last,width:canvas.width,height:canvas.height};
  }, [...fs.readFileSync(path)]);
  const exported = await inspectExport(path);
  assert.ok(exported.first.red > exported.last.red, JSON.stringify(exported));
  assert.ok(exported.last.blue > exported.first.blue, JSON.stringify(exported));
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  const start = page.getByRole('slider', { name: 'Start on timeline', exact: true });
  await start.press('Home'); await start.press('ArrowRight'); await start.press('ArrowRight');
  await page.getByRole('region', { name: 'Animation timeline' }).click({ position: { x: 100, y: 70 } });
  await page.keyboard.press('Home');
  const wrapper = page.locator('[data-overlay-id]').filter({ has: canvas }).first();
  await page.waitForTimeout(300);
  assert.equal(await wrapper.evaluate(e => +e.style.opacity), 0, 'Video must be hidden before its start');
  await start.press('Home');
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await page.getByRole('button', { name: 'Create custom animation' }).click();
  await page.getByRole('button', { name: 'After', exact: true }).click();
  await page.getByLabel('Opacity keyframe value', { exact: true }).fill('0');
  assert.equal(await wrapper.evaluate(e => +e.style.opacity), 0, 'Layer opacity key must affect rendered video');
  await page.getByRole('button', { name: 'Before', exact: true }).click();
  assert.equal(await wrapper.evaluate(e => +e.style.opacity), 1);
  await page.getByLabel('Timeline duration seconds').fill('1.2');
  await page.getByRole('button', { name: 'Export Video', exact: true }).click();
  await dialog.getByRole('button', { name: /WebM/ }).click();
  const animatedDownload = page.waitForEvent('download', { timeout: 180000 });
  await dialog.getByRole('button', { name: 'Export as WEBM', exact: true }).click();
  const animatedPath = '.impeccable/review/video-layer-animated-export.webm';
  await (await animatedDownload).saveAs(animatedPath);
  const animated = await inspectExport(animatedPath);
  assert.ok(animated.last.blue < exported.last.blue / 2, JSON.stringify({ exported, animated }));
  assert.deepEqual(errors, []); console.log('Video upload, scrubbing, start visibility, layer opacity and both decoded WebM exports passed', { exported, animated });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
