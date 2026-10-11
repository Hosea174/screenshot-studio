/* global process, console, document */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const output = '.impeccable/review/screenshots';
const scenes = [
  ['detail-current', 'Detail Current', 4200], ['depth-bloom', 'Depth Bloom', 3600],
  ['reverse-aperture', 'Reverse Aperture', 4000], ['meridian', 'Meridian', 4600],
  ['velvet-bank', 'Velvet Bank', 3800], ['lens-tide', 'Lens Tide', 5000],
  ['oblique-study', 'Oblique Study', 4400], ['ribbon-flight', 'Ribbon Flight', 4800],
  ['near-field', 'Near Field', 3200], ['horizon-fold', 'Horizon Fold', 4100],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  fs.mkdirSync(output, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('Page error:', error.message); });
  await page.goto(process.env.STUDIO_URL || 'http://localhost:3555/editor', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByRole('button', { name: 'Templates', exact: true }).waitFor({ timeout: 120000 });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button =>
    button.textContent?.trim() === 'Templates' && Object.keys(button).some(key => key.startsWith('__reactProps$')),
  ), undefined, { timeout: 120000 });
  console.log('Editor ready');

  for (const [id, name, poster] of scenes) {
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await page.getByRole('heading', { name: 'Cinematic', exact: true }).waitFor();
    assert.equal(await page.locator('[data-animated-template-preview]').count(), 11);
    const card = page.getByRole('button', { name: `View animated template ${name}`, exact: true });
    await card.scrollIntoViewIfNeeded();
    const preview = card.locator(`[data-animated-template-preview="${id}"]`);
    const box = await preview.boundingBox();
    assert.ok(Math.abs(box.width / box.height - 9 / 16) < 0.01);
    const layer = preview.locator('[style*="preserve-3d"]');
    const before = await layer.getAttribute('style');
    await card.hover();
    await page.waitForTimeout(250);
    assert.notEqual(await layer.getAttribute('style'), before, `${name} preview does not move`);
    if (id === 'detail-current') await page.screenshot({ path: `${output}/cinematic-gallery.png` });
    await card.click();
    await page.getByRole('button', { name: 'Use Template', exact: true }).click();
    await page.getByRole('button', { name: `Select ${name} animation`, exact: true }).waitFor();
    const expand = page.getByRole('button', { name: `Expand ${name} properties`, exact: true });
    if (await expand.count()) await expand.click();
    const key = page.getByRole('button', { name: `Position Y (%) keyframe at ${(poster / 1000).toFixed(2)}s · edit in property column`, exact: true });
    await key.click();
    const canvas = page.locator('[data-html-canvas="true"]');
    const dimensions = await canvas.boundingBox();
    assert.ok(Math.abs(dimensions.width / dimensions.height - 9 / 16) < 0.01);
    const image = page.locator('img[alt="Main image"]');
    await image.waitFor();
    const imageBox = await image.boundingBox();
    assert.ok(imageBox.width > dimensions.width, name + ' must enlarge screen details');
    assert.ok(imageBox.x < dimensions.x + dimensions.width && imageBox.x + imageBox.width > dimensions.x, name + ' misses the stage horizontally');
    assert.ok(imageBox.y < dimensions.y + dimensions.height && imageBox.y + imageBox.height > dimensions.y, name + ' misses the stage vertically');
    await canvas.screenshot({ path: `${output}/cinematic-${id}.png` });
    console.log(`Passed: ${name}`);
  }
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('heading', { name: 'Smooth', exact: true }).waitFor();
  const smoothCard = page.getByRole('button', { name: 'View animated template Smooth Cascade', exact: true });
  await smoothCard.scrollIntoViewIfNeeded();
  await smoothCard.click();
  await page.getByRole('button', { name: 'Use Template', exact: true }).click();
  await page.getByRole('button', { name: 'Select Smooth Cascade animation', exact: true }).waitFor();
  const smoothCanvas = page.locator('[data-html-canvas="true"]');
  const smoothDimensions = await smoothCanvas.boundingBox();
  assert.ok(Math.abs(smoothDimensions.width / smoothDimensions.height - 9 / 16) < 0.01);
  await smoothCanvas.screenshot({ path: `${output}/smooth-original.png` });
  console.log('Passed: Smooth Cascade applies with portrait framing.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  const reducedCard = page.getByRole('button', { name: 'View animated template Near Field', exact: true });
  await reducedCard.scrollIntoViewIfNeeded();
  await reducedCard.hover();
  const reducedLayer = reducedCard.locator('[style*="preserve-3d"]');
  const still = await reducedLayer.getAttribute('style');
  await page.waitForTimeout(300);
  assert.equal(await reducedLayer.getAttribute('style'), still);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/cinematic-gallery-mobile.png` });
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: all ten presets, portrait framing, hover playback, enlarged detail shots, and reduced motion.');
} finally {
  await browser.close();
}
