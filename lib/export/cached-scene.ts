import { domToCanvas } from 'modern-screenshot';
import type { ImageOverlay, ImageState } from '@/lib/store';
import type { AnimationClip, AnimationTrack } from '@/types/animation';
import { cleanExportClone, shouldIncludeInExport } from './export-filter';
import { exportDiagnostics, recordExportTime } from './export-diagnostics';
import { useImageStore, useEditorStore } from '@/lib/store';

export interface RasterLayer { kind: 'raster'; bitmap: ImageBitmap; from?: number; until?: number }
export interface MediaLayer {
  kind: 'media'; overlay: ImageOverlay; bitmap?: ImageBitmap; source?: Blob;
}
export interface CachedScene {
  width: number; height: number; logicalWidth: number; logicalHeight: number; timelineDuration: number;
  layers: (RasterLayer | MediaLayer)[];
  clips: AnimationClip[]; tracks: AnimationTrack[];
}
type SceneState = Pick<ImageState, 'uploadedImageUrl' | 'mainImageStartTime' | 'mainImageDuration' | 'imageOverlays' | 'animationClips' | 'timeline' | 'camera' | 'blurRegions' | 'slides' | 'slideshow'>;
const MAX_RASTER_BYTES = 128 * 1024 * 1024;
const SUPPORTED_MOTION = new Set(['translateX', 'translateY', 'rotateZ', 'scale', 'imageOpacity', 'perspective']);

/** Conservative eligibility: an unsupported effect is rendered by the original exporter. */
export function cachedSceneFallback(state: SceneState): string | null {
  if (state.uploadedImageUrl && ((state.mainImageStartTime ?? 0) > 0 || (state.mainImageDuration ?? state.timeline.duration) < state.timeline.duration - 1)) return 'Timed main image uses the full renderer';
  if (state.blurRegions.some(r => r.isVisible)) return 'Blur and mosaic regions use the full renderer';
  const c = state.camera;
  if (c.cameraX || c.cameraY || c.cameraRotateX || c.cameraRotateY || c.cameraRotateZ || c.cameraZoom !== 1) return 'Scene transforms use the full renderer';
  const clips = new Map(state.animationClips.map(c => [c.id, c]));
  const animatedTargets = new Set(state.animationClips
    .filter(clip => state.timeline.tracks.some(track => track.clipId === clip.id && track.isVisible && track.keyframes.length))
    .map(clip => clip.target ?? 'asset'));
  if (animatedTargets.size > 1) return 'Multi-asset animation uses the full renderer';
  for (const track of state.timeline.tracks.filter(t => t.isVisible)) {
    const target = track.clipId ? clips.get(track.clipId)?.target ?? 'asset' : 'asset';
    if (target === 'asset' && track.keyframes.length) return 'Main image animation uses the full renderer';
    for (const key of track.keyframes) {
      if (key.clipMask || Object.keys(key.properties).some(p => !SUPPORTED_MOTION.has(p) && key.properties[p as keyof typeof key.properties] !== 0)) return 'Perspective or mask animation uses the full renderer';
    }
  }
  const dynamic = new Set(state.animationClips.map(c => c.target).filter(Boolean));
  for (const o of state.imageOverlays.filter(o => o.isVisible && (o.mediaType === 'video' || dynamic.has(o.id)))) {
    if (o.inheritMainStyle) return 'Split media design uses the full renderer';
    if ((o.blur ?? 0) > 0 || o.shadow?.enabled || o.tilt?.rotateX || o.tilt?.rotateY || o.src.includes('overlay-shadow')) return 'Media filters and tilt use the full renderer';
  }
  for (const o of state.imageOverlays.filter(o => o.isVisible && o.mediaType !== 'video' && o.clipDuration !== undefined)) {
    const isTimed = (o.startTime ?? 0) > 0 || (o.startTime ?? 0) + o.clipDuration! < state.timeline.duration - 1;
    if (isTimed && (o.frame?.enabled || (o.radius ?? 0) > 0 || o.shadow?.enabled || (o.blur ?? 0) > 0 || o.tilt?.rotateX || o.tilt?.rotateY || o.hsl)) return 'Timed styled images use the full renderer';
  }
  return null;
}

export function closeCachedScene(scene: CachedScene) {
  for (const layer of scene.layers) layer.bitmap?.close();
}

/** Partition the DOM at dynamic layers; preserve each stacking context's paint order. */
export async function prepareCachedScene(state: SceneState, dimensions: { width: number; height: number }, signal: AbortSignal): Promise<CachedScene> {
  const sources = new Map<string, Promise<Blob>>();
  if (state.slides.length <= 1) return prepareSingleScene(state, dimensions, signal, sources);
  const { switchToSlideAndWait } = await import('../render-slideFrame');
  const activeSlideId = useImageStore.getState().activeSlideId;
  const savedSource = { uploadedImageUrl: useImageStore.getState().uploadedImageUrl, imageName: useImageStore.getState().imageName, activeSlideId };
  const savedScreenshot = { ...useEditorStore.getState().screenshot };
  const scenes: CachedScene[] = [];
  let from = 0;
  let bytes = 0;
  try {
    for (let i = 0; i < state.slides.length; i++) {
      signal.throwIfAborted();
      const slide = state.slides[i];
      // Each later slide has the same group count; check before allocating.
      if (scenes.length && bytes + scenes[0].layers.reduce((sum, l) => sum + (l.kind === 'raster' ? dimensions.width * dimensions.height * 4 : (l.bitmap?.width ?? 0) * (l.bitmap?.height ?? 0) * 4), 0) > MAX_RASTER_BYTES) throw new Error('The slide artwork exceeds the export cache budget');
      await switchToSlideAndWait(slide.id, slide.src, 0);
      const scene = await prepareSingleScene(state, dimensions, signal, sources);
      if (scenes.length && (scene.layers.length !== scenes[0].layers.length || scene.layers.some((l, index) => l.kind !== scenes[0].layers[index].kind))) { closeCachedScene(scene); throw new Error('The slides require different layer layouts'); }
      const until = i === state.slides.length - 1 ? Infinity : from + (slide.duration || state.slideshow.defaultDuration || 2) * 1000;
      for (const layer of scene.layers) {
        bytes += (layer.bitmap?.width ?? 0) * (layer.bitmap?.height ?? 0) * 4;
        if (layer.kind === 'raster') { layer.from = from; layer.until = until; }
      }
      scenes.push(scene); from = until;
    }
    const merged = { ...scenes[0], layers: [] as CachedScene['layers'] };
    for (let index = 0; index < scenes[0].layers.length; index++) {
      const first = scenes[0].layers[index];
      if (first.kind === 'media') {
        merged.layers.push(first);
        for (const scene of scenes.slice(1)) scene.layers[index]?.bitmap?.close();
      } else for (const scene of scenes) merged.layers.push(scene.layers[index]);
    }
    return merged;
  } catch (error) { for (const scene of scenes) closeCachedScene(scene); throw error; }
  finally {
    if (activeSlideId) {
      const slide = state.slides.find(s => s.id === activeSlideId);
      if (slide) await switchToSlideAndWait(slide.id, slide.src, 0);
    } else {
      useImageStore.setState(savedSource);
      useEditorStore.getState().setScreenshot(savedScreenshot);
    }
  }
}

async function prepareSingleScene(state: SceneState, dimensions: { width: number; height: number }, signal: AbortSignal, sources: Map<string, Promise<Blob>>): Promise<CachedScene> {
  const started = performance.now();
  const container = document.querySelector<HTMLElement>('#image-render-card [data-html-canvas="true"]');
  if (!container) throw new Error('No rendered canvas found');
  const dynamicIds = new Set(state.animationClips.map(c => c.target).filter(id => id && id !== 'asset'));
  for (const o of state.imageOverlays) {
    const hasTimedImageRange = o.mediaType !== 'video' && o.clipDuration !== undefined && ((o.startTime ?? 0) > 0 || (o.startTime ?? 0) + o.clipDuration < state.timeline.duration - 1);
    if (o.isVisible && (o.mediaType === 'video' || hasTimedImageRange)) dynamicIds.add(o.id);
  }
  const dynamicElements = new Map<Element, ImageOverlay>();
  for (const o of state.imageOverlays) {
    if (!o.isVisible || !dynamicIds.has(o.id)) continue;
    const node = Array.from(container.querySelectorAll<HTMLElement>('[data-overlay-id]')).find(el => el.dataset.overlayId === o.id);
    if (!node) throw new Error('A media layer is still loading');
    dynamicElements.set(node, o);
  }
  const units: Element[] = [];
  const visit = (node: Element) => {
    if (!shouldIncludeInExport(node)) return;
    if (dynamicElements.has(node) || !Array.from(dynamicElements.keys()).some(el => node.contains(el))) { units.push(node); return; }
    const children = Array.from(node.children).sort((a, b) => (Number.parseInt(getComputedStyle(a).zIndex) || 0) - (Number.parseInt(getComputedStyle(b).zIndex) || 0));
    for (const child of children) visit(child);
  };
  visit(container);
  const scene: CachedScene = { ...dimensions, logicalWidth: container.clientWidth, logicalHeight: container.clientHeight, timelineDuration: state.timeline.duration, layers: [], clips: structuredClone(state.animationClips), tracks: structuredClone(state.timeline.tracks) };
  const groups: Element[][] = [[]];
  for (const node of units) {
    if (dynamicElements.has(node)) groups.push([node], []);
    else groups[groups.length - 1].push(node);
  }
  const rasterCount = groups.filter(g => g.length && !dynamicElements.has(g[0])).length;
  if (rasterCount * dimensions.width * dimensions.height * 4 > MAX_RASTER_BYTES) throw new Error('The static artwork exceeds the export cache budget');
  const fetchSource = (src: string) => {
    if (!sources.has(src)) sources.set(src, fetch(src, { signal }).then(r => { if (!r.ok) throw new Error('Could not read a media asset'); return r.blob(); }));
    return sources.get(src)!;
  };
  try {
    await document.fonts.ready;
    for (const group of groups.filter(g => g.length)) {
      signal.throwIfAborted();
      const overlay = dynamicElements.get(group[0]);
      if (overlay) {
        const blob = await fetchSource(overlay.src);
        const bitmap = overlay.mediaType === 'video' ? undefined : await createImageBitmap(blob);
        scene.layers.push({ kind: 'media', overlay: structuredClone(overlay), source: overlay.mediaType === 'video' ? blob : undefined, bitmap });
        if (rasterCount * dimensions.width * dimensions.height * 4 + scene.layers.reduce((sum, l) => sum + (l.kind === 'media' ? (l.bitmap?.width ?? 0) * (l.bitmap?.height ?? 0) * 4 : 0), 0) > MAX_RASTER_BYTES) throw new Error('The animated artwork exceeds the export cache budget');
      } else {
        const belongs = (node: Node) => !(node instanceof Element) || group.some(el => el === node || el.contains(node) || node.contains(el));
        const canvas = await domToCanvas(container, {
          width: scene.logicalWidth, height: scene.logicalHeight, scale: dimensions.width / scene.logicalWidth, backgroundColor: null,
          filter: node => shouldIncludeInExport(node) && belongs(node), onCloneNode: cleanExportClone,
        });
        const normalized = new OffscreenCanvas(dimensions.width, dimensions.height);
        normalized.getContext('2d')!.drawImage(canvas, 0, 0, dimensions.width, dimensions.height);
        scene.layers.push({ kind: 'raster', bitmap: normalized.transferToImageBitmap() });
        const diagnostics = exportDiagnostics(); if (diagnostics) diagnostics.domCaptures++;
      }
    }
    return scene;
  } catch (error) { closeCachedScene(scene); throw error; }
  finally { recordExportTime('preparation', performance.now() - started); }
}
