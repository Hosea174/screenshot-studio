"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  useEditorStore,
  useImageStore,
  type ImageState,
  type OmitFunctions,
} from "@/lib/store";
import { useDeviceUIStore } from "@/lib/store/device-ui";
import { compactDeviceScreenForDraft } from "@/lib/device-mockups/layouts";
import { normalizeDraftMockups, resolveRestoredEditorMode } from "@/lib/device-mockups/draft-migration";
import {
  createEditorProjectRecord,
  deleteEditorProject,
  getActiveEditorProjectId,
  getEditorProject,
  getStorageErrorMessage,
  listEditorProjects,
  renameEditorProject,
  saveEditorProject,
  setActiveEditorProjectId,
  type EditorProject,
  type EditorProjectSummary,
  type ProjectSnapshot,
} from "@/lib/editor-projects/storage";
import { registerEditorProjectRuntime, useEditorProjectSession } from "@/lib/editor-projects/session";
import { blobUrlToBase64, deleteDraft, getDraft, migrateFromLocalStorage, type PersistedImageState } from "@/lib/draft-storage";

const AUTOSAVE_DELAY = 900;
const IDLE_SESSION_STATE = {
  isPreviewing: false,
  previewIndex: 0,
  previewStartedAt: null,
  activeAnnotationTool: null,
  selectedAnnotationId: null,
  showTemplates: false,
} satisfies Partial<OmitFunctions<ImageState>>;

const MAX_CACHED_BLOBS = 32;
const blobToDataUrlCache = new Map<string, string>();

async function toPersistableSrc(src: string): Promise<string> {
  if (!src.startsWith("blob:")) return src;
  const cached = blobToDataUrlCache.get(src);
  if (cached) return cached;
  const value = await blobUrlToBase64(src);
  if (blobToDataUrlCache.size >= MAX_CACHED_BLOBS) {
    const oldest = blobToDataUrlCache.keys().next().value;
    if (oldest !== undefined) blobToDataUrlCache.delete(oldest);
  }
  blobToDataUrlCache.set(src, value);
  return value;
}

function withoutFunctions<T extends object>(state: T): OmitFunctions<T> {
  return Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value !== "function")) as OmitFunctions<T>;
}

function toPersistedImageState(state: ImageState): PersistedImageState {
  const persisted = withoutFunctions(state);
  return {
    ...persisted,
    ...IDLE_SESSION_STATE,
    timeline: { ...state.timeline, isPlaying: false, playhead: 0 },
  } as PersistedImageState;
}

function captureCurrentSnapshot(): ProjectSnapshot {
  const editor = useEditorStore.getState();
  return {
    editorState: {
      screenshot: editor.screenshot,
      background: editor.background,
      shadow: editor.shadow,
      pattern: editor.pattern,
      frame: editor.frame,
      canvas: editor.canvas,
      noise: editor.noise,
    },
    imageState: toPersistedImageState(useImageStore.getState()),
  };
}

function captureBlankSnapshot(): ProjectSnapshot {
  const editor = useEditorStore.getInitialState();
  const image = useImageStore.getInitialState();
  return {
    editorState: {
      screenshot: editor.screenshot,
      background: editor.background,
      shadow: editor.shadow,
      pattern: editor.pattern,
      frame: editor.frame,
      canvas: editor.canvas,
      noise: editor.noise,
    },
    imageState: toPersistedImageState(image),
  };
}

function fingerprint(snapshot: ProjectSnapshot): string {
  return JSON.stringify(snapshot, (_key, value: unknown) => (
    typeof value === "string" && value.length > 256
      ? `${value.length}:${value.slice(0, 64)}:${value.slice(Math.floor(value.length / 2), Math.floor(value.length / 2) + 64)}:${value.slice(-64)}`
      : value
  ));
}

async function prepareSnapshot(snapshot: ProjectSnapshot): Promise<ProjectSnapshot> {
  const { editorState, imageState } = snapshot;
  const rawUploadedImageUrl = imageState.uploadedImageUrl ?? editorState.screenshot.src;
  const deviceScreenAssets: Record<string, string> = {};
  const assetIds = new Map<string, string>();
  const processMockups = async (mockups: typeof imageState.mockups) => Promise.all(mockups.map(async (mockup) => {
    const screen = compactDeviceScreenForDraft(mockup.screen, rawUploadedImageUrl ?? null);
    const src = screen.src ? await toPersistableSrc(screen.src) : null;
    if (screen.isCustom && src) {
      let id = assetIds.get(src);
      if (!id) {
        id = `screen-${assetIds.size + 1}`;
        assetIds.set(src, id);
        deviceScreenAssets[id] = src;
      }
      return { ...mockup, screen: { ...screen, src: null, sourceRef: `device-screen:${id}` as const } };
    }
    return { ...mockup, screen: { ...screen, src } };
  }));
  const imageOverlays = await Promise.all(imageState.imageOverlays.map(async (overlay) => (
    overlay.isCustom ? { ...overlay, src: await toPersistableSrc(overlay.src) } : overlay
  )));
  const slides = await Promise.all(imageState.slides.map(async (slide) => ({ ...slide, src: await toPersistableSrc(slide.src) })));
  const backgroundConfig = { ...imageState.backgroundConfig };
  if (backgroundConfig.type === "image" && typeof backgroundConfig.value === "string") {
    backgroundConfig.value = await toPersistableSrc(backgroundConfig.value);
  }
  const mockups = await processMockups(imageState.mockups);
  const deviceLayoutSnapshot = imageState.deviceLayoutSnapshot
    ? await processMockups(imageState.deviceLayoutSnapshot)
    : imageState.deviceLayoutSnapshot;
  return {
    editorState: { ...editorState, screenshot: { ...editorState.screenshot, src: editorState.screenshot.src ? await toPersistableSrc(editorState.screenshot.src) : null } },
    imageState: {
      ...imageState,
      uploadedImageUrl: rawUploadedImageUrl ? await toPersistableSrc(rawUploadedImageUrl) : null,
      backgroundConfig,
      imageOverlays,
      slides,
      mockups,
      deviceLayoutSnapshot,
      deviceScreenAssets,
    },
  };
}

function restoreProjectState(project: EditorProject): void {
  const temporal = useImageStore.temporal.getState();
  temporal.pause();
  try {
    useImageStore.setState(useImageStore.getInitialState(), true);
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    useDeviceUIStore.setState(useDeviceUIStore.getInitialState(), true);

    const img = project.imageState;
    const { timeline, browserUrl, mockups, deviceLayoutSnapshot, deviceScreenAssets, editorMode, ...rest } = img;
    const normalize = (draftMockups: typeof mockups) => normalizeDraftMockups(draftMockups, {
      uploadedImageUrl: img.uploadedImageUrl ?? null,
      imageName: img.imageName ?? null,
      canvasDimensions: img.canvasDimensions,
      deviceScreenAssets,
    });
    const normalized = normalize(mockups);
    useImageStore.setState({
      ...(Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)) as Partial<OmitFunctions<ImageState>>),
      mockups: normalized.mockups,
      ...(editorMode !== undefined || normalized.migratedLegacyMockups
        ? { editorMode: resolveRestoredEditorMode(editorMode, normalized.migratedLegacyMockups) }
        : {}),
      ...(deviceLayoutSnapshot !== undefined ? { deviceLayoutSnapshot: deviceLayoutSnapshot ? normalize(deviceLayoutSnapshot).mockups : null } : {}),
      ...IDLE_SESSION_STATE,
      ...(timeline ? { timeline: { ...timeline, isPlaying: false, playhead: 0 } } : {}),
      ...(browserUrl !== undefined ? { browserUrl } : img.imageBorder?.title ? { browserUrl: img.imageBorder.title } : {}),
    });
    useEditorStore.getState().setScreenshot(project.editorState.screenshot);
    useEditorStore.getState().setBackground(project.editorState.background);
    useEditorStore.getState().setShadow(project.editorState.shadow);
    useEditorStore.getState().setPattern(project.editorState.pattern);
    useEditorStore.getState().setFrame(project.editorState.frame);
    useEditorStore.getState().setCanvas(project.editorState.canvas);
    useEditorStore.getState().setNoise(project.editorState.noise);
    temporal.clear();
  } finally {
    temporal.resume();
  }
}

function summarize(project: EditorProject): EditorProjectSummary {
  return { id: project.id, name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt };
}

export function useAutosaveDraft() {
  const editorStore = useEditorStore();
  const imageStore = useImageStore();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedRef = useRef(false);
  const initializationRef = useRef<Promise<void> | null>(null);
  const projectRef = useRef<EditorProject | null>(null);
  const generationRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSnapshotRef = useRef("");
  const dirtyRef = useRef(false);
  const warnedRef = useRef(false);
  const isSaving = useEditorProjectSession((state) => state.saving);
  const lastSaved = useEditorProjectSession((state) => state.lastSaved);

  const syncProjectList = useCallback(async () => {
    const projects = await listEditorProjects();
    useEditorProjectSession.getState().setProjects(projects);
    return projects;
  }, []);

  const enqueueSave = useCallback((projectId: string, snapshot: ProjectSnapshot) => {
    const generation = generationRef.current;
    const write = saveQueueRef.current.catch(() => undefined).then(async () => {
      const prepared = await prepareSnapshot(snapshot);
      const current = await getEditorProject(projectId);
      const project = current ?? projectRef.current;
      if (!project || project.id !== projectId) throw new Error("Project is no longer available.");
      const result = await saveEditorProject({ ...project, ...prepared, updatedAt: Date.now() });
      if (!result.ok) {
        const error = new Error(await getStorageErrorMessage(result.reason));
        Object.assign(error, { storageReason: result.reason });
        throw error;
      }
      if (generation === generationRef.current && projectRef.current?.id === projectId) {
        projectRef.current = { ...project, ...prepared, updatedAt: Date.now() };
        const savedFingerprint = fingerprint(snapshot);
        lastSnapshotRef.current = savedFingerprint;
        dirtyRef.current = fingerprint(captureCurrentSnapshot()) !== savedFingerprint;
        useEditorProjectSession.getState().setLastSaved(Date.now());
        useEditorProjectSession.getState().setError(null);
        warnedRef.current = false;
        await syncProjectList();
      }
    });
    saveQueueRef.current = write;
    useEditorProjectSession.getState().setSaving(true);
    void write.catch(async (error: unknown) => {
      if (generation !== generationRef.current) return;
      const message = error instanceof Error ? error.message : "Project could not be saved.";
      useEditorProjectSession.getState().setError(message);
      if (!warnedRef.current) {
        warnedRef.current = true;
        toast.error("Project autosave failed", { description: message, duration: 10000 });
      }
    }).finally(() => {
      if (generation === generationRef.current) useEditorProjectSession.getState().setSaving(false);
    });
    return write;
  }, [syncProjectList]);

  const flush = useCallback(async () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    const project = projectRef.current;
    if (hasLoadedRef.current && project) await enqueueSave(project.id, captureCurrentSnapshot());
    await saveQueueRef.current;
  }, [enqueueSave]);

  const openProject = useCallback(async (id: string): Promise<EditorProjectSummary> => {
    const current = projectRef.current;
    if (current?.id === id) return summarize(current);
    await flush();
    const next = await getEditorProject(id);
    if (!next) throw new Error("Project not found.");
    await setActiveEditorProjectId(id);
    generationRef.current += 1;
    projectRef.current = next;
    restoreProjectState(next);
    lastSnapshotRef.current = fingerprint({ editorState: next.editorState, imageState: next.imageState });
    useEditorProjectSession.getState().setActiveProject(id);
    useEditorProjectSession.getState().setLastSaved(next.updatedAt);
    useEditorProjectSession.getState().setError(null);
    await syncProjectList();
    return summarize(next);
  }, [flush, syncProjectList]);

  const createProject = useCallback(async (): Promise<EditorProjectSummary> => {
    await flush();
    const blank = captureBlankSnapshot();
    const project = createEditorProjectRecord(blank);
    const result = await saveEditorProject(project);
    if (!result.ok) throw new Error(await getStorageErrorMessage(result.reason));
    await setActiveEditorProjectId(project.id);
    generationRef.current += 1;
    projectRef.current = project;
    restoreProjectState(project);
    lastSnapshotRef.current = fingerprint(blank);
    useEditorProjectSession.getState().setActiveProject(project.id);
    useEditorProjectSession.getState().setLastSaved(project.updatedAt);
    useEditorProjectSession.getState().setError(null);
    await syncProjectList();
    return summarize(project);
  }, [flush, syncProjectList]);

  const renameProject = useCallback(async (id: string, name: string): Promise<EditorProjectSummary> => {
    const result = await renameEditorProject(id, name);
    if (projectRef.current?.id === id) projectRef.current = { ...projectRef.current, name: result.name, updatedAt: result.updatedAt };
    await syncProjectList();
    return result;
  }, [syncProjectList]);

  const deleteProject = useCallback(async (id: string) => {
    const active = projectRef.current?.id === id;
    if (active) await flush();
    const projects = await listEditorProjects();
    const fallback = projects.find((project) => project.id !== id);
    let next: EditorProjectSummary | null = null;
    if (active && fallback) next = await openProject(fallback.id);
    else if (active) next = await createProject();
    await deleteEditorProject(id);
    if (active && next) await setActiveEditorProjectId(next.id);
    await syncProjectList();
    return { deletedId: id, activeProjectId: useEditorProjectSession.getState().activeProjectId };
  }, [createProject, flush, openProject, syncProjectList]);

  useEffect(() => {
    if (initializationRef.current) return;
    useEditorProjectSession.getState().setLoading(true);
    initializationRef.current = (async () => {
      try {
        await migrateFromLocalStorage();
        let projects = await listEditorProjects();
        let activeId = await getActiveEditorProjectId();
        if (projects.length === 0) {
          const legacy = await getDraft();
          const snapshot = legacy
            ? { editorState: legacy.editorState, imageState: legacy.imageState }
            : captureBlankSnapshot();
          const migrated = createEditorProjectRecord(snapshot);
          const saved = await saveEditorProject(migrated);
          if (saved.ok) {
            if (legacy) await deleteDraft();
            projects = await listEditorProjects();
          } else {
            useEditorProjectSession.getState().setError(await getStorageErrorMessage(saved.reason));
            toast.error("Could not create a local project", { description: await getStorageErrorMessage(saved.reason) });
          }
          activeId = migrated.id;
          projectRef.current = migrated;
        }
        if (!activeId || !projects.some((project) => project.id === activeId)) activeId = projects[0]?.id ?? activeId;
        let active = activeId ? await getEditorProject(activeId) : null;
        if (!active && projectRef.current) active = projectRef.current;
        if (!active) throw new Error("No local project is available.");
        if (activeId) await setActiveEditorProjectId(activeId);
        generationRef.current += 1;
        projectRef.current = active;
        restoreProjectState(active);
        lastSnapshotRef.current = fingerprint({ editorState: active.editorState, imageState: active.imageState });
        const refreshed = await listEditorProjects();
        const state = useEditorProjectSession.getState();
        state.setProjects(refreshed.length ? refreshed : [summarize(active)]);
        state.setActiveProject(active.id);
        state.setLastSaved(active.updatedAt);
        hasLoadedRef.current = true;
      } catch (error) {
        console.error("Failed to load local projects:", error);
        useEditorProjectSession.getState().setError(error instanceof Error ? error.message : "Could not load local projects.");
        hasLoadedRef.current = true;
      } finally {
        useEditorProjectSession.getState().setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    registerEditorProjectRuntime({ createProject, openProject, renameProject, deleteProject, flush });
    return () => registerEditorProjectRuntime(null);
  }, [createProject, deleteProject, flush, openProject, renameProject]);

  useEffect(() => {
    if (!hasLoadedRef.current || !projectRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      const current = projectRef.current;
      if (!current) return;
      const snapshot = captureCurrentSnapshot();
      if (fingerprint(snapshot) === lastSnapshotRef.current) {
        dirtyRef.current = false;
        return;
      }
      dirtyRef.current = true;
      void enqueueSave(current.id, snapshot).catch(() => undefined);
    }, AUTOSAVE_DELAY);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [editorStore, enqueueSave, imageStore]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (useEditorProjectSession.getState().saving || dirtyRef.current || saveTimeoutRef.current) {
        event.preventDefault();
        event.returnValue = "Your project is still saving.";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    const handlePageHide = () => { void flush(); };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [flush]);

  const clearDraft = useCallback(async () => {
    const project = projectRef.current;
    if (!project) return;
    const blank = captureBlankSnapshot();
    restoreProjectState({ ...project, ...blank });
    await enqueueSave(project.id, blank);
    useEditorProjectSession.getState().setLastSaved(Date.now());
  }, [enqueueSave]);

  return {
    isSaving,
    lastSaved: lastSaved ? new Date(lastSaved) : null,
    clearDraft,
    projectActions: { createProject, openProject, renameProject, deleteProject, flush },
  };
}
