'use client';

import * as React from 'react';
import { domToBlob, domToCanvas } from 'modern-screenshot';
import { useImageStore } from '@/lib/store';
import { useEditorStore } from '@/lib/store';
import { useDeviceUIStore } from '@/lib/store/device-ui';
import { ANIMATION_PRESETS } from '@/lib/animation/presets';
import { ANIMATED_TEMPLATES } from '@/lib/animation/templates';
import { EASE_LABELS, PROPERTY_CONTROLS } from '@/lib/animation/editor';
import { CLIP_MASK_PRESETS } from '@/components/timeline/MotionInspector';
import { processFile } from '@/lib/image-tools/ops';
import { buildOutputName, buildProcessOptions, DEFAULT_TOOL_SETTINGS, type BatchToolEngine, type ToolEngineName, type ToolSettings } from '@/lib/image-tools/plan';
import { TOOLS } from '@/lib/seo/tools';

const ACTIONS: Record<string, readonly string[]> = {
  image: ['setUploadedImageUrl', 'replaceTemplateMedia', 'clearImage', 'setGradient', 'setBorderRadius', 'setBackgroundBorderRadius', 'setAspectRatio', 'setCustomDimensions', 'setBackgroundConfig', 'setBackgroundType', 'setBackgroundValue', 'setBackgroundOpacity', 'setBackgroundBlur', 'setBackgroundNoise', 'addTextOverlay', 'updateTextOverlay', 'removeTextOverlay', 'clearTextOverlays', 'addImageOverlay', 'updateImageOverlay', 'removeImageOverlay', 'clearImageOverlays', 'addMockup', 'updateMockup', 'removeMockup', 'clearMockups', 'duplicateMockup', 'reorderMockup', 'clearDeviceLayout', 'applyDeviceLayout', 'setImageOpacity', 'setImageScale', 'setImageBorder', 'setImageShadow', 'setImageStylePreset', 'setShadowPreset', 'applyVisualPreset', 'applyAnimatedTemplate', 'setPerspective3D', 'setImageFilter', 'resetImageFilters', 'resetCanvasSettings', 'setExportSettings', 'exportImage', 'setSlideshow', 'setActiveSlide', 'removeSlide', 'startPreview', 'resetSlideshow', 'stopPreview', 'setTimeline', 'setShowTimeline', 'toggleTimeline', 'setPlayhead', 'togglePlayback', 'startPlayback', 'stopPlayback', 'addKeyframe', 'updateKeyframe', 'removeKeyframe', 'addTrack', 'updateTrack', 'removeTrack', 'applyAnimationPreset', 'clearTimeline', 'setTimelineDuration', 'addAnimationClip', 'updateAnimationClip', 'removeAnimationClip', 'clearAnimationClips', 'addAnnotation', 'updateAnnotation', 'removeAnnotation', 'clearAnnotations', 'setActiveAnnotationTool', 'setSelectedAnnotationId', 'setAnnotationDefaults', 'addBlurRegion', 'updateBlurRegion', 'removeBlurRegion', 'clearBlurRegions', 'setActiveRightPanelTab', 'reorderImageOverlay', 'setShowTemplates', 'setEditorMode', 'setBrowserUrl', 'setBrowserHeaderSize', 'setCanvasDimensions', 'toggleRulers', 'toggleGrid', 'setRulerInterval', 'setSelectedOverlayId', 'setIsMainImageSelected'],
  editor: ['setScreenshot', 'setBackground', 'setShadow', 'setPattern', 'setFrame', 'setCanvas', 'setNoise'],
  device: ['setSelectedDeviceId', 'setEditingScreenDeviceId', 'openGallery', 'closeGallery', 'reconcileMockups', 'resetDeviceUI'],
};

const DESTRUCTIVE = new Set(['clearImage', 'clearTextOverlays', 'clearImageOverlays', 'clearMockups', 'clearDeviceLayout', 'clearTimeline', 'clearAnimationClips', 'clearAnnotations', 'clearBlurRegions', 'removeSlide', 'removeAnimationClip', 'removeTrack', 'removeKeyframe', 'removeTextOverlay', 'removeImageOverlay', 'removeMockup', 'removeAnnotation', 'removeBlurRegion', 'resetCanvasSettings', 'resetImageFilters']);
const ACTION_HELP: Record<string, string> = {
  setBackgroundConfig: 'Set background type, value, and opacity together. Prefer this for a fully specified bespoke background.',
  applyVisualPreset: 'Apply a complete scene look. For a tailored result, inspect current state and then customize the individual background, shadow, frame, and image properties.',
  applyAnimatedTemplate: 'Add a designed, editable animation template. Treat it as a starting point: inspect and tailor its tracks, timing, values, and easing to the brief.',
  addAnimationClip: 'Add an animation clip. Use presetId custom-asset to create an editable clip, then author property tracks and keyframes with addTrack/addKeyframe.',
  addTrack: 'Create a property track in a clip. Keep one property per track, assign a unique meaningful name, set visibility/lock state, and supply the authored keyframes.',
  addKeyframe: 'Add a keyframe with time in milliseconds, property values, and the easing curve that leads into that keyframe.',
  updateKeyframe: 'Update a keyframe time, property value, clip mask, or easing. Preserve other properties on the keyframe.',
  setImage: 'Upload a local image with load_image_file, which converts it to a browser File before calling this action.',
  exportImage: 'Run the editor’s configured image export. Set format, quality, and filename with setExportSettings first.',
};

const FILE_ACTIONS = new Set(['setImage', 'addImages']);
const fileFromData = (value: unknown) => {
  if (!value || typeof value !== 'object' || !('_studioFile' in value)) return value;
  const data = value as { _studioFile: true; name: string; type: string; base64: string };
  const bytes = Uint8Array.from(atob(data.base64), char => char.charCodeAt(0));
  return new File([bytes], data.name, { type: data.type });
};

function compactProjectState() {
  const s = useImageStore.getState();
  const editor = useEditorStore.getState();
  return {
    editor: { mode: s.editorMode, hasImage: !!s.uploadedImageUrl, imageName: s.imageName, activeSlideId: s.activeSlideId, slides: s.slides.map(({ id, name, duration }) => ({ id, name, duration })), selectedOverlayId: s.selectedOverlayId, isMainImageSelected: s.isMainImageSelected },
    canvas: { selectedAspectRatio: s.selectedAspectRatio, customDimensions: s.customDimensions, canvas: editor.canvas },
    design: { background: s.backgroundConfig, backgroundBlur: s.backgroundBlur, backgroundNoise: s.backgroundNoise, imageOpacity: s.imageOpacity, imageScale: s.imageScale, imageBorder: s.imageBorder, imageShadow: s.imageShadow, perspective3D: s.perspective3D, imageFilters: s.imageFilters, exportSettings: s.exportSettings },
    layers: { text: s.textOverlays, images: s.imageOverlays.map(({ src: _src, ...layer }) => ({ ...layer, hasSource: !!_src })), mockups: s.mockups.map(({ screen, ...mockup }) => ({ ...mockup, screen: { ...screen, src: undefined, hasSource: !!screen.src } })) },
    slideshow: { settings: s.slideshow, slides: s.slides.map(({ id, name, duration }) => ({ id, name, duration })) },
    annotations: s.annotations,
    blurRegions: s.blurRegions,
    animation: { duration: s.timeline.duration, playhead: s.timeline.playhead, clips: s.animationClips, tracks: s.timeline.tracks.map(track => ({ ...track, keyframes: track.keyframes.map(key => ({ ...key, properties: Object.fromEntries(Object.entries(key.properties).filter(([name]) => !name.startsWith('camera'))) })) })) },
  };
}

async function runCommand(operation: string, payload: Record<string, unknown> = {}) {
  const image = useImageStore.getState();
  if (operation === 'inspect_project') return compactProjectState();
  if (operation === 'inspect_ui') {
    const visible = (element: Element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
    const controls = [...document.querySelectorAll<HTMLElement>('button, [role="button"], input, textarea, select, [role="checkbox"], [role="switch"], a[href], [role="tab"]')].filter(visible).slice(0, 300).map((element, index) => {
      const labels = 'labels' in element ? [...((element as HTMLInputElement).labels ?? [])].map(label => label.innerText.trim()).filter(Boolean).join(' ') : '';
      const name = element.getAttribute('aria-label') || labels || element.getAttribute('title') || (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.placeholder : '') || element.innerText?.trim() || element.getAttribute('href') || '';
      return { index, role: element.getAttribute('role') || element.tagName.toLowerCase(), name: name.slice(0, 160), value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element.value.slice(0, 200) : undefined, disabled: 'disabled' in element ? Boolean((element as HTMLButtonElement).disabled) : false, options: element instanceof HTMLSelectElement ? [...element.options].map(option => ({ label: option.label, value: option.value })) : undefined };
    });
    return { url: location.href, title: document.title, headings: [...document.querySelectorAll('h1,h2,h3,[role="dialog"] h2')].filter(visible).map(element => element.textContent?.trim()).filter(Boolean).slice(0, 100), visibleText: (document.querySelector('main')?.innerText ?? document.body.innerText).slice(0, 12000), controls };
  }
  if (operation === 'interact_ui') {
    const kind = String(payload.kind ?? ''); const targetName = String(payload.target ?? ''); const exact = payload.exact !== false;
    if (kind === 'navigate') {
      const destination = new URL(String(payload.path ?? ''), location.origin);
      if (destination.origin !== location.origin) throw new Error('Navigation is limited to pages on this Screenshot Studio origin.');
      history.pushState({}, '', destination.pathname + destination.search + destination.hash); window.dispatchEvent(new PopStateEvent('popstate')); return { ok: true, navigatingTo: destination.pathname };
    }
    if (kind === 'press' && !targetName) {
      const key = String(payload.value ?? ''); window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true })); window.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true })); return { ok: true, pressed: key };
    }
    const elements = [...document.querySelectorAll<HTMLElement>('button, [role="button"], input, textarea, select, [role="checkbox"], [role="switch"], a[href], [role="tab"]')];
    const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    const matches = elements.filter(element => {
      const labels = 'labels' in element ? [...((element as HTMLInputElement).labels ?? [])].map(label => label.innerText.trim()).join(' ') : '';
      const name = element.getAttribute('aria-label') || labels || element.getAttribute('title') || (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.placeholder : '') || element.innerText?.trim() || element.getAttribute('href') || '';
      return exact ? normalize(name) === normalize(targetName) : normalize(name).includes(normalize(targetName));
    });
    const element = matches[Number(payload.index ?? 0)];
    if (!element) throw new Error(`Could not find a visible control named “${targetName}”. Use inspect_ui to see its accessible name.`);
    if (kind === 'click' || kind === 'toggle') element.click();
    else if (kind === 'fill') {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error('fill requires a text input or textarea.');
      const value = String(payload.value ?? ''); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set; setter?.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (kind === 'select') {
      if (!(element instanceof HTMLSelectElement)) throw new Error('select requires a select control.');
      const requested = String(payload.value ?? ''); const option = [...element.options].find(candidate => candidate.value === requested || candidate.label === requested);
      if (!option) throw new Error(`No select option matches “${requested}”.`); element.value = option.value; element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (kind === 'press') {
      element.focus(); const key = String(payload.value ?? ''); element.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true })); element.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true }));
    } else if (kind === 'upload') {
      if (!(element instanceof HTMLInputElement) || element.type !== 'file') throw new Error('upload requires a file input.');
      const files = Array.isArray(payload.files) ? payload.files.map(fileFromData) : [fileFromData(payload.file)];
      if (!files.length || files.length > 20 || !files.every(file => file instanceof File && file.size <= 32 * 1024 * 1024)) throw new Error('Upload 1–20 image files, up to 32 MB each.');
      const transfer = new DataTransfer(); for (const file of files as File[]) transfer.items.add(file); element.files = transfer.files; element.dispatchEvent(new Event('change', { bubbles: true }));
    } else throw new Error('Supported UI actions: click, fill, select, toggle, press, upload, navigate.');
    return { ok: true, action: kind, target: targetName, matchedControls: matches.length };
  }
  if (operation === 'list_capabilities') return { actions: Object.entries(ACTIONS).flatMap(([storeName, names]) => { const store = storeName === 'image' ? useImageStore.getState() : storeName === 'editor' ? useEditorStore.getState() : useDeviceUIStore.getState(); return names.map(action => ({ store: storeName, action, argumentCount: typeof (store as unknown as Record<string, unknown>)[action] === 'function' ? ((store as unknown as Record<string, (...args: unknown[]) => unknown>)[action]).length : null, destructive: DESTRUCTIVE.has(action), description: ACTION_HELP[action] ?? `${action}: invoke the ${storeName} store action using the argument order and parameter types from its TypeScript signature.` })); }), standaloneImageTools: TOOLS.map(({ slug, name, engine, description }) => ({ slug, name, engine, description })), properties: PROPERTY_CONTROLS.filter(p => p.group === 'asset'), easing: EASE_LABELS, animationPresets: ANIMATION_PRESETS.map(({ id, name, description, category, duration }) => ({ id, name, description, category, duration })), animatedTemplates: ANIMATED_TEMPLATES.map(({ id, name, description, category, duration }) => ({ id, name, description, category, duration })), clipMaskPresets: CLIP_MASK_PRESETS };
  if (operation === 'apply_action') {
    const storeName = String(payload.store ?? 'image'); const action = String(payload.action ?? '');
    if (!(storeName in ACTIONS) || !ACTIONS[storeName].includes(action)) throw new Error(`Action ${storeName}.${action} is not available. Call list_capabilities to discover supported actions.`);
    if (DESTRUCTIVE.has(action) && payload.confirmDestructive !== true) throw new Error(`${action} removes user content. Set confirmDestructive:true to proceed.`);
    if (FILE_ACTIONS.has(action)) throw new Error(`Use load_image_file or add_slides_from_files for ${action}; file handles cannot be passed as JSON.`);
    const args = payload.args;
    if (!Array.isArray(args) || args.length > 8 || JSON.stringify(args).length > 2_000_000) throw new Error('args must be a JSON array of at most 8 items and under 2 MB.');
    if (action === 'addAnimationClip' && args[0] === 'custom-camera') throw new Error('Camera animation creation has been removed. Animate the selected image or device layer instead.');
    const store = storeName === 'image' ? useImageStore.getState() : storeName === 'editor' ? useEditorStore.getState() : useDeviceUIStore.getState();
    const fn = (store as unknown as Record<string, unknown>)[action];
    if (typeof fn !== 'function') throw new Error(`The ${storeName}.${action} action is not present in this editor version.`);
    const result = await (fn as (...values: unknown[]) => unknown)(...args.map(fileFromData));
    return { ok: true, action: `${storeName}.${action}`, result: result ?? null, state: compactProjectState() };
  }
  if (operation === 'load_image') {
    const file = fileFromData(payload.file);
    if (!(file instanceof File)) throw new Error('Expected a local image payload.');
    image.setImage(file);
    return { ok: true, name: file.name, size: file.size, type: file.type };
  }
  if (operation === 'add_slides') {
    const files = payload.files;
    if (!Array.isArray(files) || !files.length || files.length > 40) throw new Error('Supply 1–40 local image files.');
    const decoded = files.map(fileFromData);
    if (!decoded.every(file => file instanceof File)) throw new Error('Every slide must be a supported local image file.');
    image.addImages(decoded as File[]);
    return { ok: true, added: decoded.length, slides: useImageStore.getState().slides.map(({ id, name, duration }) => ({ id, name, duration })) };
  }
  if (operation === 'process_images') {
    const requestedEngine = payload.engine as ToolEngineName;
    const engine = (requestedEngine === 'crop' ? 'convert' : requestedEngine) as BatchToolEngine;
    if (!['compress', 'convert', 'resize', 'crop', 'rotate'].includes(requestedEngine)) throw new Error('Unsupported image-tool engine.');
    if (!Array.isArray(payload.files) || !payload.files.length || payload.files.length > 20) throw new Error('Process between 1 and 20 image files per call.');
    const files = payload.files.map(fileFromData);
    if (!files.every(file => file instanceof File && file.size <= 32 * 1024 * 1024)) throw new Error('Images must be supported files no larger than 32 MB each.');
    const settings = { ...DEFAULT_TOOL_SETTINGS, ...(payload.settings as Partial<ToolSettings> ?? {}) };
    const outputs = [];
    for (const file of files as File[]) {
      const options = buildProcessOptions(engine, settings, file.type);
      if (requestedEngine === 'crop') options.crop = settings.crop;
      const result = await processFile(file, options);
      const outputName = buildOutputName(requestedEngine, file.name, options.encode.format);
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(result.blob); });
      outputs.push({ name: outputName, mimeType: result.blob.type, width: result.width, height: result.height, bytes: result.bytes, base64 });
    }
    if (outputs.reduce((sum, output) => sum + output.bytes, 0) > 32 * 1024 * 1024) throw new Error('This batch produces more than 32 MB; process fewer or smaller files at once.');
    return { __studioMcpFiles: outputs };
  }
  if (operation === 'capture_preview') {
    const target = document.getElementById('image-render-card') ?? document.querySelector('main') ?? document.body;
    const blob = await domToBlob(target, { scale: Math.min(1, 1400 / Math.max(target.clientWidth, target.clientHeight)), backgroundColor: 'transparent' });
    const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob); });
    return { __studioMcpImage: true, mimeType: blob.type || 'image/png', base64 };
  }
  if (operation === 'export_image') {
    const target = document.getElementById('image-render-card');
    if (!target) throw new Error('No rendered editor canvas was found.');
    const format = String(payload.format ?? image.exportSettings.format);
    const mime = ({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[format];
    if (!mime) throw new Error('Image format must be PNG, JPEG, or WebP.');
    const scale = Math.max(1, Math.min(5, Number(payload.scale ?? image.exportSettings.quality.replace('x', '')) || 1));
    const canvas = await domToCanvas(target, { scale, backgroundColor: format === 'jpeg' ? '#ffffff' : null, width: target.scrollWidth, height: target.scrollHeight });
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(file => file ? resolve(file) : reject(new Error('Canvas export failed.')), mime, Number(payload.quality ?? 0.92)));
    const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob); });
    return { __studioMcpImage: true, mimeType: blob.type, base64, fileName: `${image.exportSettings.fileName || 'screenshot-studio'}.${format}` };
  }
  if (operation === 'export_video') {
    const mode = payload.mode === 'slideshow' ? 'slideshow' : 'animation';
    const format = payload.format === 'gif' || payload.format === 'webm' ? payload.format : 'mp4';
    const quality = payload.quality === 'low' || payload.quality === 'medium' ? payload.quality : 'high';
    const { exportAnimationVideo, exportSlideshowVideo } = await import('@/lib/export-slideshow-video');
    const result = mode === 'slideshow' ? await exportSlideshowVideo({ format, quality }) : await exportAnimationVideo({ format, quality });
    return { ok: true, mode, requestedFormat: format, actualFormat: result.format, downloaded: true };
  }
  throw new Error(`Unknown editor operation: ${operation}`);
}

export function StudioMcpBridge() {
  React.useEffect(() => {
    let stopped = false;
    let sessionId = '';
    let controller: AbortController | null = null;
    const post = async (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const connect = async () => {
      try {
        const response = await post('/api/studio-mcp/register', {});
        if (!response.ok) return;
        sessionId = (await response.json()).sessionId;
        while (!stopped && sessionId) {
          controller = new AbortController();
          const poll = await fetch(`/api/studio-mcp/poll?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store', signal: controller.signal });
          if (poll.status === 204) continue;
          if (poll.status === 410) break;
          if (!poll.ok) { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
          const command = await poll.json() as { id: string; operation: string; payload: Record<string, unknown> };
          try {
            const result = await runCommand(command.operation, command.payload ?? {});
            await post('/api/studio-mcp/reply', { sessionId, requestId: command.id, result });
          } catch (error) {
            await post('/api/studio-mcp/reply', { sessionId, requestId: command.id, error: error instanceof Error ? error.message : 'Editor operation failed' });
          }
        }
      } catch (error) {
        if (!stopped && !(error instanceof DOMException && error.name === 'AbortError')) await new Promise(resolve => setTimeout(resolve, 1000));
      }
    };
    void connect();
    return () => { stopped = true; controller?.abort(); if (sessionId) void post('/api/studio-mcp/unregister', { sessionId }); };
  }, []);
  return null;
}
