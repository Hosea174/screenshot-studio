"use client";

import * as React from "react";
import { Check, ChevronDown, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditorProjectSession } from "@/lib/editor-projects/session";
import { getEditorProjectRuntime } from "@/lib/editor-projects/session";

export function EditorProjectMenu() {
  const projects = useEditorProjectSession((state) => state.projects);
  const activeProjectId = useEditorProjectSession((state) => state.activeProjectId);
  const loading = useEditorProjectSession((state) => state.loading);
  const saving = useEditorProjectSession((state) => state.saving);
  const error = useEditorProjectSession((state) => state.error);
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const [managerOpen, setManagerOpen] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await operation();
    } catch (cause) {
      toast.error("Project action failed", { description: cause instanceof Error ? cause.message : "Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const saveRename = () => {
    if (!renameTarget) return;
    void run(async () => {
      await getEditorProjectRuntime().renameProject(renameTarget.id, renameValue);
      setRenameTarget(null);
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || busy}
            aria-label={`Projects: ${activeProject?.name ?? "Loading"}`}
            title={error ?? (saving ? "Saving project…" : "Saved locally")}
            className="ml-1 h-9 max-w-[clamp(6rem,16vw,11.875rem)] gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          >
            <FolderOpen size={14} className="shrink-0" />
            <span className="truncate">{loading ? "Loading…" : activeProject?.name ?? "Projects"}</span>
            <span
              className={`size-1.5 shrink-0 rounded-full ${saving ? "animate-pulse bg-amber-500" : "opacity-0"}`}
              aria-label={saving ? "Saving" : undefined}
              aria-hidden={!saving}
            />
            <ChevronDown size={13} className="shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="truncate">{activeProject?.name ?? "Your projects"}</DropdownMenuLabel>
          <DropdownMenuItem disabled={busy} onSelect={() => void run(() => getEditorProjectRuntime().createProject())}>
            <Plus /> New project
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {projects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              disabled={busy || project.id === activeProjectId}
              onSelect={() => void run(() => getEditorProjectRuntime().openProject(project.id))}
            >
              {project.id === activeProjectId ? <Check /> : <span className="size-4" />}
              <span className="truncate">{project.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setManagerOpen(true)}>
            <FolderOpen /> Manage projects…
          </DropdownMenuItem>
          {error ? <p role="status" className="px-2 py-1.5 text-xs text-destructive">{error}</p> : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={managerOpen} onOpenChange={setManagerOpen}>
        <DialogContent className="max-h-[min(80vh,640px)] overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage projects</DialogTitle>
            <DialogDescription>Projects autosave in this browser. Your uploaded images and videos stay with each project.</DialogDescription>
          </DialogHeader>
          <div className="-mx-1 max-h-[50vh] space-y-1 overflow-y-auto px-1">
            {projects.map((project) => (
              <div key={project.id} className="flex items-center gap-2 rounded-md border border-foreground/10 px-3 py-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm hover:text-foreground"
                  onClick={() => void run(async () => { await getEditorProjectRuntime().openProject(project.id); setManagerOpen(false); })}
                  aria-label={`Open project ${project.name}`}
                >
                  <span className="block truncate">{project.name}</span>
                  {project.id === activeProjectId ? <span className="text-xs text-muted-foreground">Current project</span> : null}
                </button>
                <Button
                  type="button" variant="ghost" size="icon"
                  aria-label={`Rename ${project.name}`}
                  disabled={busy}
                  onClick={() => { setRenameTarget(project); setRenameValue(project.name); }}
                  className="size-8 shrink-0 text-muted-foreground"
                ><Pencil size={14} /></Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${project.name}`} disabled={busy} className="size-8 shrink-0 text-destructive"><Trash2 size={14} /></Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
                      <AlertDialogDescription>This permanently removes the project and its saved media from this browser.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => void run(async () => { await getEditorProjectRuntime().deleteProject(project.id); })}
                      >Delete project</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => void run(async () => { await getEditorProjectRuntime().createProject(); setManagerOpen(false); })} disabled={busy}>
              <Plus size={15} /> New project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>Choose a name up to 80 characters.</DialogDescription>
          </DialogHeader>
          <Input autoFocus maxLength={80} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveRename(); }} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button type="button" disabled={!renameValue.trim() || busy} onClick={saveRename}>Save name</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
