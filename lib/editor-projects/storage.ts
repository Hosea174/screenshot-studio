import type { EditorState, OmitFunctions } from "@/lib/store";
import type { PersistedImageState } from "@/lib/draft-storage";

const DB_NAME = "screenshotstudio-editor-projects";
const DB_VERSION = 2;
const PROJECTS = "projects";
const TEMPLATES = "templates";
const SETTINGS = "settings";
const ACTIVE_PROJECT_KEY = "active-project-id";

export interface EditorProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  editorState: OmitFunctions<EditorState>;
  imageState: PersistedImageState;
}

export type ProjectSnapshot = Pick<EditorProject, "editorState" | "imageState">;
export type EditorProjectSummary = Pick<EditorProject, "id" | "name" | "createdAt" | "updatedAt">;
export interface EditorTemplate extends ProjectSnapshot {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  previewImage?: string;
}
export type EditorTemplateSummary = Pick<EditorTemplate, "id" | "name" | "createdAt" | "updatedAt" | "previewImage">;
export type ProjectSaveResult = { ok: true } | { ok: false; reason: "quota" | "error"; error?: unknown };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TEMPLATES)) db.createObjectStore(TEMPLATES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: "key" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

export function makeProjectId(): string {
  return crypto.randomUUID();
}

const NAME_ADJECTIVES = ["Amber", "Bright", "Calm", "Clever", "Cosmic", "Golden", "Hidden", "Lucky", "Quiet", "Silver", "Velvet", "Wild"];
const NAME_NOUNS = ["Comet", "Fox", "Garden", "Harbor", "Lantern", "Meadow", "Orbit", "Panda", "River", "Studio", "Summit", "Wave"];

function randomItem(items: readonly string[]): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return items[bytes[0] % items.length];
}

export function generateProjectName(): string {
  return `${randomItem(NAME_ADJECTIVES)} ${randomItem(NAME_NOUNS)}`;
}

export function createEditorProjectRecord(
  snapshot: ProjectSnapshot,
  name = generateProjectName(),
  now = Date.now(),
): EditorProject {
  return { id: makeProjectId(), name, createdAt: now, updatedAt: now, ...snapshot };
}

export async function listEditorProjects(): Promise<EditorProjectSummary[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PROJECTS, "readonly");
    const projects: EditorProjectSummary[] = [];
    let reachedEnd = false;
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(projects);
    };
    const request = transaction.objectStore(PROJECTS).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        reachedEnd = true;
        return;
      }
      const { id, name, createdAt, updatedAt } = cursor.value as EditorProject;
      projects.push({ id, name, createdAt, updatedAt });
      cursor.continue();
    };
    request.onerror = () => finish(request.error ?? new Error("Could not read local projects."));
    transaction.oncomplete = () => {
      if (reachedEnd) finish();
      else finish(new Error("Project listing ended before all records were read."));
    };
    transaction.onerror = transaction.onabort = () => finish(transaction.error ?? new Error("Could not read local projects."));
  });
}

export async function getEditorProject(id: string): Promise<EditorProject | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(PROJECTS, "readonly").objectStore(PROJECTS).get(id);
    request.onsuccess = () => resolve((request.result as EditorProject | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveEditorProject(project: EditorProject): Promise<ProjectSaveResult> {
  let db: IDBDatabase;
  try {
    db = await openDatabase();
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? "quota" : "error", error };
  }
  return new Promise((resolve) => {
    const tx = db.transaction(PROJECTS, "readwrite");
    let settled = false;
    const finish = (result: ProjectSaveResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    tx.oncomplete = () => finish({ ok: true });
    tx.onabort = tx.onerror = () => finish({ ok: false, reason: isQuotaError(tx.error) ? "quota" : "error", error: tx.error });
    try {
      tx.objectStore(PROJECTS).put({ ...project, updatedAt: Date.now() });
    } catch (error) {
      finish({ ok: false, reason: isQuotaError(error) ? "quota" : "error", error });
    }
  });
}

export async function listEditorTemplates(): Promise<EditorTemplateSummary[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEMPLATES, "readonly");
    const items: EditorTemplateSummary[] = [];
    const request = tx.objectStore(TEMPLATES).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const template = cursor.value as EditorTemplate;
      const { id, name, createdAt, updatedAt } = template;
      const fallbackPreview = template.editorState.screenshot.src
        ?? template.imageState.uploadedImageUrl
        ?? template.imageState.imageOverlays.find(overlay => overlay.isVisible && overlay.poster)?.poster
        ?? template.imageState.imageOverlays.find(overlay => overlay.isVisible && overlay.mediaType !== "video")?.src
        ?? template.imageState.imageOverlays.find(overlay => overlay.isVisible)?.src;
      const preview = template.previewImage ?? fallbackPreview;
      items.push({ id, name, createdAt, updatedAt, ...(preview ? { previewImage: preview } : {}) });
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("Could not load saved templates."));
    tx.oncomplete = () => resolve(items.sort((a, b) => b.updatedAt - a.updatedAt));
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Could not load saved templates."));
  });
}

export async function getEditorTemplate(id: string): Promise<EditorTemplate | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(TEMPLATES, "readonly").objectStore(TEMPLATES).get(id);
    request.onsuccess = () => resolve((request.result as EditorTemplate | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not load this template."));
  });
}

export async function saveEditorTemplate(name: string, snapshot: ProjectSnapshot, previewImage?: string): Promise<EditorTemplateSummary> {
  const now = Date.now();
  const template: EditorTemplate = {
    id: makeProjectId(),
    name: name.trim().slice(0, 80),
    createdAt: now,
    updatedAt: now,
    ...snapshot,
    ...(previewImage ? { previewImage } : {}),
  };
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TEMPLATES, "readwrite");
    tx.objectStore(TEMPLATES).put(template);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Could not save this template."));
  });
  const { id, createdAt, updatedAt } = template;
  return { id, name: template.name, createdAt, updatedAt };
}

export async function deleteEditorTemplate(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TEMPLATES, "readwrite");
    tx.objectStore(TEMPLATES).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Could not delete this template."));
  });
}

export async function getActiveEditorProjectId(): Promise<string | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(SETTINGS, "readonly").objectStore(SETTINGS).get(ACTIVE_PROJECT_KEY);
    request.onsuccess = () => resolve((request.result as { value?: string } | undefined)?.value ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function setActiveEditorProjectId(id: string | null): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS, "readwrite");
    const store = tx.objectStore(SETTINGS);
    const request = id
      ? store.put({ key: ACTIVE_PROJECT_KEY, value: id })
      : store.delete(ACTIVE_PROJECT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(request.error ?? tx.error);
  });
}

export async function renameEditorProject(id: string, name: string): Promise<EditorProjectSummary> {
  const project = await getEditorProject(id);
  if (!project) throw new Error("Project not found.");
  const cleanedName = name.trim();
  if (!cleanedName) throw new Error("Project name cannot be empty.");
  const next = { ...project, name: cleanedName.slice(0, 80), updatedAt: Date.now() };
  const result = await saveEditorProject(next);
  if (!result.ok) throw result.error ?? new Error("Project could not be saved.");
  const { editorState: _editorState, imageState: _imageState, ...summary } = next;
  return summary;
}

export async function deleteEditorProject(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([PROJECTS, SETTINGS], "readwrite");
    tx.objectStore(PROJECTS).delete(id);
    const settingStore = tx.objectStore(SETTINGS);
    const activeRequest = settingStore.get(ACTIVE_PROJECT_KEY);
    activeRequest.onsuccess = () => {
      if ((activeRequest.result as { value?: string } | undefined)?.value === id) settingStore.delete(ACTIVE_PROJECT_KEY);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function getStorageErrorMessage(reason: "quota" | "error"): Promise<string> {
  return reason === "quota"
    ? "Browser storage is full. Delete an old project or free space; the latest changes could not be saved."
    : "Browser storage could not save this project. Keep this tab open and try again.";
}
