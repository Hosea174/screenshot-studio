/* global process, console, WebMMuxer, VideoEncoder, VideoFrame */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const editorUrl = process.env.STUDIO_URL || "http://localhost:3000/editor";

async function waitForProjectLoad(page) {
  await page.getByRole("button", { name: /^Projects:/ }).waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: "Projects: Loading" }).waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
}

async function readProjects(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("screenshotstudio-editor-projects", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
try {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitForProjectLoad(page);

  await page.addScriptTag({ path: "node_modules/webm-muxer/build/webm-muxer.js" });
  const videoBytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    const target = new WebMMuxer.ArrayBufferTarget();
    const muxer = new WebMMuxer.Muxer({ target, video: { codec: "V_VP8", width: 320, height: 180, frameRate: 30 } });
    const encoder = new VideoEncoder({ output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata), error: (error) => { throw error; } });
    encoder.configure({ codec: "vp8", width: 320, height: 180, bitrate: 500000, framerate: 30 });
    for (let index = 0; index < 36; index += 1) {
      context.fillStyle = index < 18 ? "#e11d48" : "#2563eb";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(index * 1_000_000 / 30), duration: Math.round(1_000_000 / 30) });
      encoder.encode(frame, { keyFrame: index % 15 === 0 });
      frame.close();
    }
    await encoder.flush();
    encoder.close();
    muxer.finalize();
    return [...new Uint8Array(target.buffer)];
  });

  await page.locator("#image-render-card input[type=file]").setInputFiles({
    name: "project-check.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(videoBytes),
  });
  await page.locator("canvas[data-video-canvas]").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1800);
  const videoProjectName = (await page.getByRole("button", { name: /^Projects:/ }).getAttribute("aria-label")).replace("Projects: ", "");
  const savedProjects = await readProjects(page);
  const videoProject = savedProjects.find((project) => project.name === videoProjectName);
  assert.ok(videoProject, "the active project is persisted");
  const videoLayer = videoProject.imageState.imageOverlays.find((overlay) => overlay.mediaType === "video");
  assert.ok(videoLayer?.src.startsWith("data:video/"), "video bytes are saved with the project");

  await page.getByRole("button", { name: /^Projects:/ }).click();
  await page.getByRole("menuitem", { name: "New project", exact: true }).click();
  const blankProjectName = (await page.getByRole("button", { name: /^Projects:/ }).getAttribute("aria-label")).replace("Projects: ", "");
  assert.ok(blankProjectName);
  const afterCreate = await readProjects(page);
  assert.equal(afterCreate.find((project) => project.name === blankProjectName).imageState.imageOverlays.length, 0, "new projects start blank");

  await page.reload();
  await waitForProjectLoad(page);
  await page.getByRole("button", { name: /^Projects:/ }).click();
  await page.getByRole("menuitem", { name: videoProjectName, exact: true }).click();
  await page.locator("canvas[data-video-canvas]").waitFor({ timeout: 30000 });

  await page.getByRole("button", { name: /^Projects:/ }).click();
  await page.getByRole("menuitem", { name: "Manage projects…", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "Manage projects" });
  await manager.getByRole("button", { name: `Rename ${videoProjectName}`, exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename project" });
  await rename.getByRole("textbox").fill("Saved video project");
  await rename.getByRole("button", { name: "Save name" }).click();
  await manager.getByRole("button", { name: "Open project Saved video project", exact: true }).waitFor();
  await manager.getByRole("button", { name: "Delete Saved video project", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete project" }).click();
  await manager.getByRole("button", { name: "Open project Saved video project", exact: true }).waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log("Editor project browser checks passed: video persistence, refresh restore, project isolation, rename and delete fallback.");
} finally {
  await context.close();
  await browser.close();
}
