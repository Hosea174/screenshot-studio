import { create } from "zustand";
import type { EditorProjectSummary, EditorTemplateSummary } from "./storage";

export interface EditorProjectRuntime {
  createProject: () => Promise<EditorProjectSummary>;
  openProject: (id: string) => Promise<EditorProjectSummary>;
  renameProject: (id: string, name: string) => Promise<EditorProjectSummary>;
  deleteProject: (id: string) => Promise<{ deletedId: string; activeProjectId: string | null }>;
  saveTemplate: (name: string) => Promise<EditorTemplateSummary>;
  applyTemplate: (id: string) => Promise<EditorProjectSummary>;
  flush: () => Promise<void>;
}

interface EditorProjectSessionState {
  projects: EditorProjectSummary[];
  activeProjectId: string | null;
  loading: boolean;
  saving: boolean;
  lastSaved: number | null;
  error: string | null;
  setProjects: (projects: EditorProjectSummary[]) => void;
  setActiveProject: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSaving: (saving: boolean) => void;
  setLastSaved: (at: number | null) => void;
  setError: (error: string | null) => void;
}

export const useEditorProjectSession = create<EditorProjectSessionState>((set) => ({
  projects: [],
  activeProjectId: null,
  loading: true,
  saving: false,
  lastSaved: null,
  error: null,
  setProjects: (projects) => set({ projects }),
  setActiveProject: (activeProjectId) => set({ activeProjectId }),
  setLoading: (loading) => set({ loading }),
  setSaving: (saving) => set({ saving }),
  setLastSaved: (lastSaved) => set({ lastSaved }),
  setError: (error) => set({ error }),
}));

let runtime: EditorProjectRuntime | null = null;

export function registerEditorProjectRuntime(next: EditorProjectRuntime | null): void {
  runtime = next;
}

export function getEditorProjectRuntime(): EditorProjectRuntime {
  if (!runtime) throw new Error("Open the main editor to manage its projects.");
  return runtime;
}
