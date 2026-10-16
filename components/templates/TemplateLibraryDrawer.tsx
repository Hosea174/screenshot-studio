'use client';

import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BookmarkPlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  ArrowLeft01Icon,
  AspectRatioIcon,
  Cancel01Icon,
  GridIcon,
  Image01Icon,
  MagicWand01Icon,
  PaintBrush01Icon,
  Video01Icon,
} from 'hugeicons-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AnimatedTemplateGallery,
  AnimatedTemplatePreview,
} from './AnimatedTemplateGallery';
import { ImageTemplateGallery, ImageTemplatePreview } from './ImageTemplateGallery';
import type { AnimatedTemplate } from '@/lib/animation/templates';
import { getPresetById as getVisualPresetById } from '@/lib/constants/presets';
import { getAspectRatioPreset } from '@/lib/aspect-ratio-utils';
import {
  getImageTemplateById,
  type ImageTemplate,
} from '@/lib/templates/image-templates';
import { useImageStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getEditorProjectRuntime, useEditorProjectSession } from '@/lib/editor-projects/session';
import { deleteEditorTemplate, getEditorTemplate, listEditorTemplates, type EditorTemplate, type EditorTemplateSummary } from '@/lib/editor-projects/storage';
import { getClipInterpolatedProperties } from '@/lib/animation/interpolation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';

type TemplateFilter = 'all' | 'image' | 'animated' | 'mine';
type TemplateSelection =
  | { kind: 'image'; template: ImageTemplate }
  | { kind: 'animated'; template: AnimatedTemplate }
  | { kind: 'saved'; template: EditorTemplate };

const FILTERS: Array<{
  id: TemplateFilter;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'all', label: 'All', icon: <GridIcon size={14} /> },
  { id: 'image', label: 'Image', icon: <Image01Icon size={14} /> },
  { id: 'animated', label: 'Animated', icon: <Video01Icon size={14} /> },
  { id: 'mine', label: 'My templates', icon: <BookmarkPlus size={14} /> },
];

function TemplateMetadata({ selection }: { selection: TemplateSelection }) {
  if (selection.kind === 'saved') {
    const dimensions = getAspectRatioPreset(selection.template.imageState.selectedAspectRatio);
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><BookmarkPlus size={14} />Saved work</span>
        {dimensions ? <span className="inline-flex items-center gap-1.5 tabular-nums"><AspectRatioIcon size={14} />{dimensions.width} × {dimensions.height}</span> : null}
      </div>
    );
  }
  const preset = selection.kind === 'image'
    ? selection.template.preset
    : getImageTemplateById(selection.template.visualPresetId)?.preset
      ?? getVisualPresetById(selection.template.visualPresetId);
  const dimensions = getAspectRatioPreset(
    selection.kind === 'animated' && ['cinematic', 'smooth'].includes(selection.template.category) ? '9_16' : preset?.aspectRatio ?? '16_9',
  );

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        {selection.kind === 'animated' ? <Video01Icon size={14} /> : <Image01Icon size={14} />}
        {selection.kind === 'animated' ? 'Animated' : 'Image'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <PaintBrush01Icon size={14} />
        {selection.kind === 'animated' && ['cinematic', 'smooth'].includes(selection.template.category) ? 'Your current style' : preset?.name ?? 'Editable design'}
      </span>
      {dimensions ? (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <AspectRatioIcon size={14} />
          {dimensions.width} × {dimensions.height}
        </span>
      ) : null}
    </div>
  );
}

function SavedTemplatePreview({ template, active }: { template: EditorTemplate; active: boolean }) {
  const reducedMotion = useReducedMotion();
  const previewRef = React.useRef<HTMLImageElement>(null);
  const imageState = template.imageState;
  const fallbackSource = template.editorState.screenshot.src
    ?? imageState.uploadedImageUrl
    ?? imageState.imageOverlays.find(overlay => overlay.isVisible && overlay.mediaType !== 'video')?.src
    ?? imageState.imageOverlays.find(overlay => overlay.isVisible)?.poster
    ?? imageState.imageOverlays.find(overlay => overlay.isVisible)?.src;
  const source = template.previewImage ?? fallbackSource;
  const aspectRatio = getAspectRatioPreset(imageState.selectedAspectRatio);

  React.useEffect(() => {
    const image = previewRef.current;
    if (!image) return;
    const clips = imageState.animationClips ?? [];
    const tracks = imageState.timeline?.tracks ?? [];
    const target = clips[0]?.target ?? 'asset';
    const targetClips = clips.filter(clip => (clip.target ?? 'asset') === target);
    const start = targetClips.length ? Math.min(...targetClips.map(clip => clip.startTime)) : 0;
    const duration = targetClips.length ? Math.max(...targetClips.map(clip => clip.startTime + clip.duration)) - start : 0;
    let request = 0;
    let animationStart: number | undefined;

    const render = (time: number) => {
      const properties = getClipInterpolatedProperties(clips, tracks, time, DEFAULT_ANIMATABLE_PROPERTIES, target);
      image.style.transform = `perspective(${properties.perspective}px) translate3d(${properties.translateX}%, ${properties.translateY}%, 0) rotateX(${properties.rotateX}deg) rotateY(${properties.rotateY}deg) rotateZ(${properties.rotateZ}deg) scale(${properties.scale})`;
      image.style.opacity = String(properties.imageOpacity);
    };

    if (!targetClips.length) {
      image.style.transform = '';
      image.style.opacity = '1';
      return;
    }
    render(start);
    if (!active || reducedMotion || duration <= 0) return;

    const tick = (now: number) => {
      animationStart ??= now;
      render(start + ((now - animationStart) % duration));
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [active, imageState, reducedMotion]);

  return (
    <div className="relative isolate overflow-hidden bg-muted" style={{ aspectRatio: aspectRatio ? `${aspectRatio.width} / ${aspectRatio.height}` : '16 / 9' }}>
      <div className="absolute inset-0" style={{ background: imageState.backgroundConfig.type === 'solid' ? imageState.backgroundConfig.value : undefined }} />
      {source ? (
        <img
          ref={previewRef}
          src={source}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-contain"
          style={{ transformStyle: 'preserve-3d', transformOrigin: 'center' }}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-muted-foreground">Preview unavailable for this saved template.</div>
      )}
      <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-foreground/10" />
    </div>
  );
}

function TemplateDetail({
  selection,
  onBack,
  onClose,
}: {
  selection: TemplateSelection;
  onBack: () => void;
  onClose: () => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const applyVisualPreset = useImageStore((state) => state.applyVisualPreset);
  const applyAnimatedTemplate = useImageStore((state) => state.applyAnimatedTemplate);
  const name = selection.kind === 'image' ? selection.template.preset.name : selection.template.name;
  const description = selection.kind === 'saved'
    ? 'Saved design with its media, layout, effects, and animation.'
    : selection.kind === 'image'
      ? selection.template.preset.description
      : selection.template.description;

  const handleApply = async () => {
    if (selection.kind === 'saved') {
      try {
        await getEditorProjectRuntime().applyTemplate(selection.template.id);
        onClose();
        toast.success(`Applied “${selection.template.name}”`);
      } catch (error) {
        toast.error('Could not apply template', { description: error instanceof Error ? error.message : undefined });
      }
      return;
    }
    if (selection.kind === 'animated') {
      applyAnimatedTemplate(selection.template.id);
      return;
    }

    applyVisualPreset(selection.template.preset, {
      clearAnimation: true,
      closeTemplates: true,
      scene: selection.template.scene,
    });
  };

  return (
    <motion.div
      key={`detail-${selection.kind}-${name}`}
      initial={shouldReduceMotion ? false : { opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={shouldReduceMotion ? undefined : { opacity: 0, x: 12 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="grid shrink-0 grid-cols-[40px_1fr_40px] items-center border-b border-foreground/10 px-3 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to templates"
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/30"
        >
          <ArrowLeft01Icon size={18} />
        </button>
        <div className="min-w-0 text-center">
          <SheetTitle className="truncate text-base leading-6">{name}</SheetTitle>
          <SheetDescription className="sr-only">Preview and apply the {name} template.</SheetDescription>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close templates"
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/30"
        >
          <Cancel01Icon size={17} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 scrollbar-hide">
        <TemplateMetadata selection={selection} />
        <p className="mx-auto mt-3 max-w-sm text-center text-xs leading-5 text-muted-foreground">
          {description}
        </p>

        <div className="mt-8 overflow-hidden rounded-xl border border-foreground/10 bg-muted shadow-xl">
          {selection.kind === 'saved' ? (
            <SavedTemplatePreview template={selection.template} active />
          ) : selection.kind === 'animated' ? (
            <AnimatedTemplatePreview
              template={selection.template}
              active
              showBadges={false}
              className="rounded-xl"
            />
          ) : (
            <ImageTemplatePreview
              template={selection.template}
              className="rounded-xl"
            />
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-foreground/10 bg-background/95 px-5 pb-5 pt-4 backdrop-blur-md">
        <button
          type="button"
          onClick={() => void handleApply()}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-5 text-sm font-semibold text-background outline-none transition-[opacity,transform] duration-150 ease-out hover:opacity-90 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <MagicWand01Icon size={16} />
          Use Template
        </button>
        <p className="mx-auto mt-3 max-w-sm text-center text-[11px] leading-4 text-muted-foreground">
          {selection.kind === 'saved'
            ? 'Applies this saved design and animation to the current project.'
            : selection.kind === 'animated' && ['cinematic', 'smooth'].includes(selection.template.category)
            ? 'Applies portrait framing and replaces the animation. Keeps your media and visual style.'
            : 'This replaces the current design and animation. Your uploaded media stays.'}
        </p>
      </div>
    </motion.div>
  );
}

export function TemplateLibraryDrawer() {
  const isMobile = useIsMobile();
  const open = useImageStore((state) => state.showTemplates);
  const setOpen = useImageStore((state) => state.setShowTemplates);
  const shouldReduceMotion = useReducedMotion();
  const tabListId = React.useId();
  const [filter, setFilter] = React.useState<TemplateFilter>('animated');
  const [selection, setSelection] = React.useState<TemplateSelection | null>(null);
  const [savedTemplates, setSavedTemplates] = React.useState<EditorTemplateSummary[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [templateName, setTemplateName] = React.useState('');
  const [savingTemplate, setSavingTemplate] = React.useState(false);
  const [activeTemplateAction, setActiveTemplateAction] = React.useState<string | null>(null);
  const projectName = useEditorProjectSession((state) => state.projects.find(project => project.id === state.activeProjectId)?.name);

  const refreshSavedTemplates = React.useCallback(async () => {
    setSavedTemplates(await listEditorTemplates());
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void refreshSavedTemplates().catch(error => toast.error('Could not load saved templates', { description: error instanceof Error ? error.message : undefined }));
  }, [open, refreshSavedTemplates]);

  React.useEffect(() => {
    if (!open) {
      setSelection(null);
      setFilter('animated');
    }
  }, [open]);

  React.useEffect(() => {
    if (isMobile && open) setOpen(false);
  }, [isMobile, open, setOpen]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSelection(null);
      setFilter('animated');
    }
  };

  const handleFilterKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % FILTERS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + FILTERS.length) % FILTERS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = FILTERS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    setFilter(FILTERS[nextIndex].id);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]
      ?.focus();
  };

  const handleSaveTemplate = async () => {
    const name = templateName.trim();
    if (!name || savingTemplate) return;
    setSavingTemplate(true);
    try {
      await getEditorProjectRuntime().saveTemplate(name);
      await refreshSavedTemplates();
      setSaveDialogOpen(false);
      setFilter('mine');
      toast.success(`Saved “${name}” as a template`);
    } catch (error) {
      toast.error('Could not save template', { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleApplySavedTemplate = async (template: EditorTemplateSummary) => {
    setActiveTemplateAction(template.id);
    try {
      await getEditorProjectRuntime().applyTemplate(template.id);
      handleOpenChange(false);
      toast.success(`Applied “${template.name}”`);
    } catch (error) {
      toast.error('Could not apply template', { description: error instanceof Error ? error.message : undefined });
    } finally {
      setActiveTemplateAction(null);
    }
  };

  const handlePreviewSavedTemplate = async (template: EditorTemplateSummary) => {
    setActiveTemplateAction(template.id);
    try {
      const saved = await getEditorTemplate(template.id);
      if (!saved) throw new Error('Template not found.');
      setSelection({ kind: 'saved', template: saved });
    } catch (error) {
      toast.error('Could not preview template', { description: error instanceof Error ? error.message : undefined });
    } finally {
      setActiveTemplateAction(null);
    }
  };

  const handleDeleteSavedTemplate = async (template: EditorTemplateSummary) => {
    setActiveTemplateAction(template.id);
    try {
      await deleteEditorTemplate(template.id);
      await refreshSavedTemplates();
      toast.success(`Deleted “${template.name}”`);
    } catch (error) {
      toast.error('Could not delete template', { description: error instanceof Error ? error.message : undefined });
    } finally {
      setActiveTemplateAction(null);
    }
  };

  return (
    <>
    <Sheet open={open && !isMobile} onOpenChange={handleOpenChange}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-[min(94vw,560px)] max-w-none gap-0 overflow-hidden border-foreground/10 p-0 data-[state=closed]:duration-200 data-[state=open]:duration-300 sm:max-w-[560px]"
      >
        <AnimatePresence mode="wait" initial={false}>
          {selection ? (
            <TemplateDetail
              selection={selection}
              onBack={() => setSelection(null)}
              onClose={() => handleOpenChange(false)}
            />
          ) : (
            <motion.div
              key="template-browser"
              initial={shouldReduceMotion ? false : { opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={shouldReduceMotion ? undefined : { opacity: 0, x: -10 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex shrink-0 items-center justify-between gap-4 border-b border-foreground/10 px-5 py-3.5">
                <SheetTitle className="text-base leading-6">Templates</SheetTitle>
                <SheetDescription className="sr-only">
                  Browse image and animated templates.
                </SheetDescription>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => { setTemplateName(projectName ?? 'My template'); setSaveDialogOpen(true); }} className="h-8 gap-1.5 px-2.5 text-xs">
                    <BookmarkPlus size={14} />Save work
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleOpenChange(false)}
                    aria-label="Close templates"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/30"
                  >
                    <Cancel01Icon size={17} />
                  </button>
                </div>
              </div>

              <div className="shrink-0 border-b border-foreground/10 px-5 py-3">
                <div
                  role="tablist"
                  aria-label="Template type"
                  className="flex w-fit items-center gap-1 rounded-lg border border-foreground/10 bg-foreground/[0.04] p-1"
                >
                  {FILTERS.map((item) => {
                    const selected = filter === item.id;
                    return (
                      <button
                        key={item.id}
                        id={`${tabListId}-${item.id}-tab`}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls={`${tabListId}-panel`}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => setFilter(item.id)}
                        onKeyDown={(event) => handleFilterKeyDown(event, FILTERS.indexOf(item))}
                        className={cn(
                          'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium outline-none transition-[background-color,color,box-shadow] duration-150 ease-out',
                          'focus-visible:ring-2 focus-visible:ring-foreground/30',
                          selected
                            ? 'bg-background text-foreground shadow-sm ring-1 ring-foreground/10'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {item.icon}
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={filter}
                    id={`${tabListId}-panel`}
                    role="tabpanel"
                    aria-labelledby={`${tabListId}-${filter}-tab`}
                    initial={shouldReduceMotion ? false : { opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={shouldReduceMotion ? undefined : { opacity: 0, y: -3 }}
                    transition={{ duration: shouldReduceMotion ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-7 p-5"
                  >
                    {filter === 'all' || filter === 'animated' ? (
                      <section>
                        <AnimatedTemplateGallery
                          onTemplateSelect={(template) => setSelection({ kind: 'animated', template })}
                        />
                      </section>
                    ) : null}

                    {filter === 'all' || filter === 'image' ? (
                      <section>
                        <ImageTemplateGallery
                          onTemplateSelect={(template) => setSelection({ kind: 'image', template })}
                        />
                      </section>
                    ) : null}
                    {filter === 'mine' ? (
                      <section className="space-y-3">
                        <div>
                          <h2 className="text-sm font-semibold">My templates</h2>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">Saved locally with their media, layout, effects, and animation.</p>
                        </div>
                        {savedTemplates.length ? savedTemplates.map(template => (
                          <div key={template.id} className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/[0.025] p-3">
                            <button type="button" onClick={() => void handlePreviewSavedTemplate(template)} aria-label={`Preview ${template.name}`} className="group flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-foreground/10 bg-gradient-to-br from-primary/20 via-background to-foreground/5 text-primary outline-none focus-visible:ring-2 focus-visible:ring-foreground/30">
                              {template.previewImage ? <motion.img src={template.previewImage} alt="" draggable={false} className="size-full object-cover" whileHover={{ scale: 1.08 }} transition={{ duration: 0.25 }} /> : <BookmarkPlus size={20} />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{template.name}</p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">Saved {new Date(template.updatedAt).toLocaleDateString()}</p>
                            </div>
                            <Button type="button" size="sm" variant="ghost" disabled={activeTemplateAction !== null} onClick={() => void handlePreviewSavedTemplate(template)} className="h-8 px-2.5 text-xs">{activeTemplateAction === template.id ? 'Loading…' : 'Preview'}</Button>
                            <Button type="button" size="sm" variant="secondary" disabled={activeTemplateAction !== null} onClick={() => void handleApplySavedTemplate(template)} className="h-8 px-3 text-xs">Use</Button>
                            <Button type="button" size="icon-sm" variant="ghost" disabled={activeTemplateAction !== null} onClick={() => void handleDeleteSavedTemplate(template)} aria-label={`Delete ${template.name}`} className="text-muted-foreground hover:text-destructive"><Trash2 size={14} /></Button>
                          </div>
                        )) : (
                          <div className="rounded-xl border border-dashed border-foreground/15 px-5 py-10 text-center">
                            <BookmarkPlus size={22} className="mx-auto text-muted-foreground" />
                            <p className="mt-3 text-sm font-medium">No saved templates yet</p>
                            <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Save this work to reuse its complete design and media later.</p>
                            <Button type="button" variant="outline" size="sm" onClick={() => { setTemplateName(projectName ?? 'My template'); setSaveDialogOpen(true); }} className="mt-4 gap-1.5"><BookmarkPlus size={14} />Save current work</Button>
                          </div>
                        )}
                      </section>
                    ) : null}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </SheetContent>
    </Sheet>
    <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save as a template</DialogTitle>
          <DialogDescription>This saves the current design, imported media, effects, layout, and animation in this browser.</DialogDescription>
        </DialogHeader>
        <label className="space-y-2 text-sm font-medium" htmlFor="saved-template-name">Template name
          <Input id="saved-template-name" autoFocus maxLength={80} value={templateName} onChange={event => setTemplateName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void handleSaveTemplate(); } }} placeholder="My template" />
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setSaveDialogOpen(false)} disabled={savingTemplate}>Cancel</Button>
          <Button type="button" onClick={() => void handleSaveTemplate()} disabled={savingTemplate || !templateName.trim()}>{savingTemplate ? 'Saving…' : 'Save template'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
