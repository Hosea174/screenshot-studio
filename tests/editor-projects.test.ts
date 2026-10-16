import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEditorProjectRecord, generateProjectName, type ProjectSnapshot } from "../lib/editor-projects/storage";

test("new projects get random phrase names and unique IDs", () => {
  const name = generateProjectName();
  assert.match(name, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  const first = createEditorProjectRecord({ editorState: {} as never, imageState: {} as never }, name, 123);
  const second = createEditorProjectRecord({ editorState: {} as never, imageState: {} as never }, name, 123);
  assert.notEqual(first.id, second.id);
  assert.equal(first.name, name);
  assert.equal(first.createdAt, 123);
  assert.equal(first.updatedAt, 123);
});

test("project records retain complete editor and media snapshots", () => {
  const snapshot = {
    editorState: { screenshot: { src: "data:image/png;base64,canvas" } },
    imageState: { imageOverlays: [{ mediaType: "video", src: "data:video/mp4;base64,clip" }] },
  } as ProjectSnapshot;
  const project = createEditorProjectRecord(snapshot, "Amber Wave", 456);
  assert.deepEqual(project.editorState, snapshot.editorState);
  assert.deepEqual(project.imageState, snapshot.imageState);
});

test("legacy migration preserves its source unless the IndexedDB write succeeds", async () => {
  const source = await readFile(new URL("../lib/draft-storage.ts", import.meta.url), "utf8");
  assert.match(source, /const result = await saveDraft\(draft\.editorState, draft\.imageState\);\s*if \(result\.ok\) localStorage\.removeItem\('stage-draft'\);/);
  assert.doesNotMatch(source, /MAX_DRAFT_AGE_DAYS|draftAge > MAX_DRAFT_AGE_MS/);
});

test("project autosave converts custom video layer blob URLs to persistent data URLs", async () => {
  const source = await readFile(new URL("../hooks/useAutosaveDraft.ts", import.meta.url), "utf8");
  assert.match(source, /overlay\.isCustom \? \{ \.\.\.overlay, src: await toPersistableSrc\(overlay\.src\) \}/);
  assert.match(source, /imageState: \{[\s\S]*imageOverlays,[\s\S]*\}/);
});
