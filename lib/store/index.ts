"use client";

import React from "react";
import { SHADOW_PRESET_SETTINGS } from "@/lib/drop-shadow";
import { create } from "zustand";
import { shallow } from "zustand/shallow";
import { temporal } from "zundo";
import { exportImageWithGradient } from "./export-utils";
import { GradientKey } from "@/lib/constants/gradient-colors";
import { AspectRatioKey } from "@/lib/constants/aspect-ratios";
import { BackgroundConfig, BackgroundType } from "@/lib/constants/backgrounds";
import { gradientColors } from "@/lib/constants/gradient-colors";
import { solidColors } from "@/lib/constants/solid-colors";
import type { DeviceLayoutId, Mockup } from "@/types/mockup";
import { getDeviceLayout, MAX_DEVICE_MOCKUPS } from "@/lib/constants/mockups";
import {
  applyLayoutToMockups,
  cloneMockups,
  createMockup,
  createDeviceScreen,
  restoreMockupsFromLayoutSnapshot,
} from "@/lib/device-mockups/layouts";
import type { TimelineState, AnimationTrack, Keyframe, AnimatableProperties, AnimationClip, EasingFunction } from "@/types/animation";
import { getClipInterpolatedProperties } from '@/lib/animation/interpolation';
import { insertPropertyKey, previewPose } from '@/lib/animation/authoring';
import { beginMotionDrag } from '@/lib/animation/drag-history';
import { mediaTimelineDuration } from '@/lib/export/video-timing';
import { retimeClipTracks, clampClipDuration } from '@/lib/animation/retiming';
import { useMotionLibrary, useMotionSelection, createCustomPreset, splitPropertyTracks, PROPERTY_CONTROLS } from '@/lib/animation/editor';
import { DEFAULT_ANIMATABLE_PROPERTIES, DEFAULT_TIMELINE_STATE } from "@/types/animation";
import { clonePresetTracks, getPresetById, ANIMATION_PRESETS } from "@/lib/animation/presets";
import {
  buildAnimatedTemplateTimeline,
  getAnimatedTemplateById,
} from "@/lib/animation/templates";
import { getCinematicImageScale } from '@/lib/animation/cinematic-templates';
import { presets as visualPresets, type PresetConfig } from "@/lib/constants/presets";
import {
  TEMPLATE_DEMO_IMAGE_NAME,
  TEMPLATE_DEMO_IMAGE_URL,
  isTemplateDemoMedia,
} from "@/lib/templates/demo-media";
import {
  getImageTemplateById,
  type ImageTemplateScene,
} from "@/lib/templates/image-templates";
import {
  trackImageUpload,
  trackBackgroundChange,
  trackEffectApply,
  trackFrameApply,
  trackOverlayAdd,
  trackAspectRatioChange,
  trackPresetApply,
  trackAnimationClipAdd,
} from "@/lib/analytics";

interface TextShadow {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export interface ImageFilters {
  brightness: number;    // 0-200 (100 = normal)
  contrast: number;      // 0-200 (100 = normal)
  grayscale: number;     // 0-100
  blur: number;          // 0-20px
  hueRotate: number;     // 0-360 degrees
  invert: number;        // 0-100
  saturate: number;      // 0-200 (100 = normal)
  sepia: number;         // 0-100
}
interface Slide {
  id: string;
  src: string;
  name: string | null;
  duration: number;
}
export interface TextOverlay {
  id: string;
  text: string;
  position: { x: number; y: number };
  fontSize: number;
  fontWeight: string;
  fontFamily: string;
  color: string;
  opacity: number;
  isVisible: boolean;
  orientation: "horizontal" | "vertical";
  textShadow: TextShadow;
}

export interface ImageOverlayTilt {
  perspective: number;
  rotateX: number;
  rotateY: number;
}

export interface ImageOverlay {
  mediaType?: 'image' | 'video';
  poster?: string;
  mediaDuration?: number;
  mediaWidth?: number;
  mediaHeight?: number;
  startTime?: number;
  /** Timeline-visible duration for still images; videos derive this from source range and speed. */
  clipDuration?: number;
  trimStart?: number;
  /** Exclusive source endpoint in seconds; omitted means the source's end. */
  trimEnd?: number;
  /** Split segments retain the original video's inherited design controls. */
  inheritMainStyle?: boolean;
  videoTrackId?: string;
  playbackRate?: number;
  loop?: boolean;
  id: string;
  src: string;
  position: { x: number; y: number }; // Position in pixels relative to canvas
  size: number; // Size in pixels
  rotation: number; // Rotation in degrees
  opacity: number;
  blur?: number; // Blur amount in pixels (0 = no blur)
  flipX: boolean;
  flipY: boolean;
  isVisible: boolean;
  isCustom?: boolean; // Whether it's a custom uploaded overlay
  layer?: 'front' | 'back'; // Render in front of or behind the main image
  tilt?: ImageOverlayTilt;
  shadow?: ImageShadow;
  radius?: number;
  /** Optional screenshot-style frame applied to this media layer. */
  frame?: ImageBorder;
  /** Base scale controlled by the Design panel, independent of animation scale. */
  scale?: number;
  hsl?: { hue: number; saturation: number; lightness: number };
}

export type BlurRegionStyle = 'blur' | 'mosaic';

export interface BlurRegion {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  blurAmount: number; // Mosaic block size when style is 'mosaic'
  isVisible: boolean;
  style?: BlurRegionStyle; // Missing on regions saved before mosaic existed; treated as 'blur'
}

export type AnnotationToolType = 'arrow' | 'curved-arrow' | 'rectangle' | 'circle' | 'line' | 'blur';

export interface AnnotationShape {
  id: string;
  type: AnnotationToolType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx?: number;
  cy?: number;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
  opacity: number;
  isVisible: boolean;
}

export type ImageStylePreset = 'default' | 'glass-light' | 'glass-dark' | 'outline' | 'border-light' | 'border-dark';

function getImageStylePreset(imageBorder: ImageBorder): ImageStylePreset {
  switch (imageBorder.type) {
    case 'glass-light':
    case 'glass-dark':
    case 'border-light':
    case 'border-dark':
      return imageBorder.type;
    case 'outline-light':
      return 'outline';
    default:
      return 'default';
  }
}
export type ShadowPreset = 'none' | 'hug' | 'soft' | 'strong';

export interface ImageBorder {
  enabled: boolean;
  width: number;
  color: string;
  type:
    | "none"
    | "arc-light"
    | "arc-dark"
    | "macos-light"
    | "macos-dark"
    | "windows-light"
    | "windows-dark"
    | "photograph"
    | "glass-light"
    | "glass-dark"
    | "outline-light"
    | "border-light"
    | "border-dark";
  padding?: number;
  title?: string;
  opacity?: number;
}

export interface ImageShadow {
  enabled: boolean;
  blur: number;
  offsetX: number;
  offsetY: number;
  spread: number;
  color: string;
  opacity: number;
}

// Helper function to parse gradient string and extract colors
function parseGradientColors(gradientStr: string): {
  colorA: string;
  colorB: string;
  direction: number;
} {
  // Default fallback
  let colorA = "#4168d0";
  let colorB = "#c850c0";
  let direction = 43;

  try {
    // Extract angle from linear-gradient(angle, ...)
    const angleMatch = gradientStr.match(/linear-gradient\((\d+)deg/);
    if (angleMatch) {
      direction = parseInt(angleMatch[1], 10);
    }

    // Extract RGB colors
    const rgbMatches = gradientStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g);
    if (rgbMatches && rgbMatches.length >= 2) {
      colorA = rgbMatches[0];
      colorB = rgbMatches[rgbMatches.length - 1];
    } else {
      // Try hex colors
      const hexMatches = gradientStr.match(/#[0-9A-Fa-f]{6}/g);
      if (hexMatches && hexMatches.length >= 2) {
        colorA = hexMatches[0];
        colorB = hexMatches[hexMatches.length - 1];
      }
    }
  } catch (e) {
    // Use defaults
  }

  return { colorA, colorB, direction };
}

// helper function that omits setter types from EditorState and ImageState; only keeps the properties; excludes any functions
export type OmitFunctions<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof T as T[K] extends (...args: any[]) => any ? never : K]: T[K];
};

export interface EditorState {
  // Screenshot/image state
  screenshot: {
    src: string | null;
    scale: number;
    offsetX: number;
    offsetY: number;
    rotation: number;
    radius: number;
  };

  // Background state (for Konva)
  background: {
    mode: "solid" | "gradient";
    colorA: string;
    colorB: string;
    gradientDirection: number;
  };

  // Shadow state (for Konva)
  shadow: {
    enabled: boolean;
    elevation: number;
    side: "bottom" | "right" | "bottom-right";
    softness: number;
    spread: number;
    color: string;
    intensity: number;
    offsetX: number;
    offsetY: number;
  };

  // Pattern state
  pattern: {
    enabled: boolean;
    type: string;
    scale: number;
    spacing: number;
    color: string;
    rotation: number;
    blur: number;
    opacity: number;
  };

  // Frame state (same as imageBorder)
  frame: {
    enabled: boolean;
    type:
      | "none"
      | "arc-light"
      | "arc-dark"
      | "macos-light"
      | "macos-dark"
      | "windows-light"
      | "windows-dark"
      | "photograph"
      | "glass-light"
      | "glass-dark"
      | "outline-light"
      | "border-light"
      | "border-dark";
    width: number;
    color: string;
    padding?: number;
    title?: string;
    opacity?: number;
  };

  // Canvas state
  canvas: {
    aspectRatio: "square" | "4:3" | "2:1" | "3:2" | "free";
    padding: number;
  };

  // Noise state
  noise: {
    enabled: boolean;
    type: string;
    opacity: number;
  };

  // Setters
  setScreenshot: (screenshot: Partial<EditorState["screenshot"]>) => void;
  setBackground: (background: Partial<EditorState["background"]>) => void;
  setShadow: (shadow: Partial<EditorState["shadow"]>) => void;
  setPattern: (pattern: Partial<EditorState["pattern"]>) => void;
  setFrame: (frame: Partial<EditorState["frame"]>) => void;
  setCanvas: (canvas: Partial<EditorState["canvas"]>) => void;
  setNoise: (noise: Partial<EditorState["noise"]>) => void;
}

// Create editor store
export const useEditorStore = create<EditorState>((set, get) => ({
  screenshot: {
    src: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    radius: 0,
  },

  background: {
    mode: "gradient",
    colorA: "#4168d0",
    colorB: "#c850c0",
    gradientDirection: 43,
  },

  shadow: {
    enabled: true,
    elevation: 12,
    side: "bottom-right",
    softness: 15,
    spread: 3,
    color: "rgba(0, 0, 0, 1)",
    intensity: 0.5,
    offsetX: 5,
    offsetY: 8,
  },

  pattern: {
    enabled: false,
    type: "grid",
    scale: 1,
    spacing: 20,
    color: "#000000",
    rotation: 0,
    blur: 0,
    opacity: 0.5,
  },

  frame: {
    enabled: false,
    type: "none",
    width: 8,
    color: "#000000",
    padding: 20,
    title: "",
  },

  canvas: {
    aspectRatio: "free",
    padding: 40,
  },

  noise: {
    enabled: false,
    type: "none",
    opacity: 0.5,
  },

  setScreenshot: (screenshot) => {
    set((state) => ({
      screenshot: { ...state.screenshot, ...screenshot },
    }));
  },

  setBackground: (background) => {
    set((state) => ({
      background: { ...state.background, ...background },
    }));
  },

  setShadow: (shadow) => {
    set((state) => ({
      shadow: { ...state.shadow, ...shadow },
    }));
  },

  setPattern: (pattern) => {
    set((state) => ({
      pattern: { ...state.pattern, ...pattern },
    }));
  },

  setFrame: (frame) => {
    set((state) => ({
      frame: { ...state.frame, ...frame },
    }));
  },

  setCanvas: (canvas) => {
    set((state) => ({
      canvas: { ...state.canvas, ...canvas },
    }));
  },

  setNoise: (noise) => {
    set((state) => ({
      noise: { ...state.noise, ...noise },
    }));
  },
}));

type EditorSnapshot = OmitFunctions<EditorState>;
let syncingEditorStoreFromImage = false;

function snapshotEditorStore(state = useEditorStore.getState()): EditorSnapshot {
  const { screenshot, background, shadow, pattern, frame, canvas, noise } = state;
  return { screenshot, background, shadow, pattern, frame, canvas, noise };
}

function editorSnapshotsEqual(a: EditorSnapshot, b: EditorSnapshot): boolean {
  return (Object.keys(a) as (keyof EditorSnapshot)[]).every((key) => shallow(a[key], b[key]));
}

// Sync hook to keep editor store in sync with image store
export function useEditorStoreSync() {
  const imageStore = useImageStore();
  const editorStore = useEditorStore();

  // Sync when image store changes
  React.useEffect(() => {
    syncingEditorStoreFromImage = true;
    // Sync screenshot src
    if (imageStore.uploadedImageUrl !== editorStore.screenshot.src) {
      editorStore.setScreenshot({ src: imageStore.uploadedImageUrl });
    }

    // Sync screenshot scale
    if (imageStore.imageScale / 100 !== editorStore.screenshot.scale) {
      editorStore.setScreenshot({ scale: imageStore.imageScale / 100 });
    }

    // Sync screenshot radius
    if (imageStore.borderRadius !== editorStore.screenshot.radius) {
      editorStore.setScreenshot({ radius: imageStore.borderRadius });
    }

    // Sync background
    const bgConfig = imageStore.backgroundConfig;
    if (bgConfig.type === "gradient") {
      const isCustomGradient =
        typeof bgConfig.value === "string" &&
        /^(?:linear|radial|conic)-gradient\(/.test(bgConfig.value);
      const gradientStr =
        (isCustomGradient ? bgConfig.value : gradientColors[bgConfig.value as GradientKey]) ||
        gradientColors.vibrant_orange_pink;
      const { colorA, colorB, direction } = parseGradientColors(gradientStr);
      if (
        editorStore.background.mode !== "gradient" ||
        editorStore.background.colorA !== colorA ||
        editorStore.background.colorB !== colorB ||
        editorStore.background.gradientDirection !== direction
      ) {
        editorStore.setBackground({
          mode: "gradient",
          colorA,
          colorB,
          gradientDirection: direction,
        });
      }
    } else if (bgConfig.type === "solid") {
      const color =
        (solidColors as Record<string, string>)[bgConfig.value as string] ||
        "#ffffff";
      if (
        editorStore.background.mode !== "solid" ||
        editorStore.background.colorA !== color
      ) {
        editorStore.setBackground({
          mode: "solid",
          colorA: color,
          colorB: color,
        });
      }
    }

    // Sync frame
    const frame = imageStore.imageBorder;
    if (
      editorStore.frame.enabled !== frame.enabled ||
      editorStore.frame.type !== frame.type ||
      editorStore.frame.width !== frame.width ||
      editorStore.frame.color !== frame.color ||
      editorStore.frame.padding !== frame.padding ||
      editorStore.frame.title !== frame.title ||
      editorStore.frame.opacity !== frame.opacity
    ) {
      editorStore.setFrame({
        enabled: frame.enabled,
        type: frame.type,
        width: frame.width,
        color: frame.color,
        padding: frame.padding,
        title: frame.title,
        opacity: frame.opacity,
      });
    }

    // Sync shadow
    const shadow = imageStore.imageShadow;
    const offsetX = shadow.offsetX || 0;
    const offsetY = shadow.offsetY || 0;
    const elevation = Math.max(Math.abs(offsetX), Math.abs(offsetY)) || 4;

    let side: "bottom" | "right" | "bottom-right" = "bottom";
    if (Math.abs(offsetX) > Math.abs(offsetY)) {
      side = "right";
    } else if (Math.abs(offsetX) > 0 && Math.abs(offsetY) > 0) {
      side = "bottom-right";
    }

    if (
      editorStore.shadow.enabled !== shadow.enabled ||
      editorStore.shadow.softness !== shadow.blur ||
      editorStore.shadow.spread !== (shadow.spread || 0) ||
      editorStore.shadow.color !== shadow.color ||
      editorStore.shadow.offsetX !== offsetX ||
      editorStore.shadow.offsetY !== offsetY ||
      editorStore.shadow.intensity !== (shadow.opacity ?? 0.5)
    ) {
      editorStore.setShadow({
        enabled: shadow.enabled,
        softness: shadow.blur,
        spread: shadow.spread || 0,
        color: shadow.color,
        elevation,
        side,
        intensity: shadow.opacity ?? 0.5,
        offsetX,
        offsetY,
      });
    }

    // Sync canvas aspect ratio
    const aspectRatioMap: Record<
      AspectRatioKey,
      "square" | "4:3" | "2:1" | "3:2" | "free"
    > = {
      "1_1": "square",
      "4_3": "4:3",
      "2_1": "2:1",
      "3_2": "3:2",
      "16_9": "free",
      "9_16": "free",
      "4_5": "free",
      "3_4": "free",
      "2_3": "free",
      "5_4": "free",
      "16_10": "free",
    };
    const canvasAspectRatio =
      aspectRatioMap[imageStore.selectedAspectRatio] || "free";
    if (editorStore.canvas.aspectRatio !== canvasAspectRatio) {
      editorStore.setCanvas({ aspectRatio: canvasAspectRatio });
    }

    // Keep the legacy editor controls represented in the main undo history,
    // without recording derived sync updates as separate user edits.
    const history = useImageStore.temporal.getState();
    const tracking = history.isTracking;
    if (tracking) history.pause();
    try {
      const editorSnapshot = snapshotEditorStore();
      const currentSnapshot = useImageStore.getState().editorSnapshot;
      if (!editorSnapshotsEqual(currentSnapshot, editorSnapshot)) useImageStore.setState({ editorSnapshot });
    } finally {
      if (tracking) history.resume();
      syncingEditorStoreFromImage = false;
    }
  }, [
    imageStore.uploadedImageUrl,
    imageStore.imageScale,
    imageStore.borderRadius,
    imageStore.backgroundConfig,
    imageStore.imageBorder,
    imageStore.imageShadow,
    imageStore.selectedAspectRatio,
  ]);
}

// Re-export existing ImageState interface and store
export interface ImageState {
  editorSnapshot: EditorSnapshot;
  uploadedImageUrl: string | null;
  imageName: string | null;
  mainImageStartTime?: number;
  mainImageDuration?: number;
  selectedGradient: GradientKey;
  borderRadius: number;
  backgroundBorderRadius: number;
  selectedAspectRatio: AspectRatioKey;
  customDimensions: { width: number; height: number } | null;
  backgroundConfig: BackgroundConfig;
  backgroundBlur: number;
  backgroundNoise: number;
  textOverlays: TextOverlay[];
  imageOverlays: ImageOverlay[];
  mockups: Mockup[];
  activeDeviceLayoutId: DeviceLayoutId | null;
  deviceLayoutSnapshot: Mockup[] | null;
  imageOpacity: number;
  imageClipPath: string | null;
  imageScale: number;
  mainImagePlacement: { offsetX: number; offsetY: number; rotation: number };
  imageBorder: ImageBorder;
  imageShadow: ImageShadow;
  imageStylePreset: ImageStylePreset;
  shadowPreset: ShadowPreset;
  perspective3D: {
    perspective: number;
    rotateX: number;
    rotateY: number;
    rotateZ: number;
    translateX: number;
    translateY: number;
    scale: number;
  };
  imageFilters: ImageFilters;
  exportSettings: {
    quality: '1x' | '2x' | '3x';
    format: 'png' | 'jpeg' | 'webp';
    fileName: string;
  };
  setUploadedImageUrl: (url: string | null, name: string | null) => void;
  replaceTemplateMedia: (url: string, name: string, mockupId?: string) => void;
  setImage: (file: File) => void;
  clearImage: () => void;
  setGradient: (gradient: GradientKey) => void;
  setBorderRadius: (radius: number) => void;
  setBackgroundBorderRadius: (radius: number) => void;
  setAspectRatio: (aspectRatio: AspectRatioKey) => void;
  setCustomDimensions: (width: number, height: number) => void;
  setBackgroundConfig: (config: BackgroundConfig) => void;
  setBackgroundType: (type: BackgroundType) => void;
  setBackgroundValue: (value: string) => void;
  setBackgroundOpacity: (opacity: number) => void;
  setBackgroundBlur: (blur: number) => void;
  setBackgroundNoise: (noise: number) => void;
  addTextOverlay: (overlay?: Omit<TextOverlay, "id">) => string;
  updateTextOverlay: (id: string, updates: Partial<TextOverlay>) => void;
  removeTextOverlay: (id: string) => void;
  clearTextOverlays: () => void;
  addImageOverlay: (overlay: Omit<ImageOverlay, "id">) => void;
  updateImageOverlay: (id: string, updates: Partial<ImageOverlay>) => void;
  removeImageOverlay: (id: string) => void;
  clearImageOverlays: () => void;
  addMockup: (mockup: Omit<Mockup, "id">) => string | null;
  updateMockup: (id: string, updates: Partial<Mockup>) => void;
  removeMockup: (id: string) => void;
  clearMockups: () => void;
  duplicateMockup: (id: string) => string | null;
  reorderMockup: (id: string, direction: 'up' | 'down' | 'top' | 'bottom') => void;
  clearDeviceLayout: () => void;
  applyDeviceLayout: (layoutId: DeviceLayoutId) => void;
  setImageOpacity: (opacity: number) => void;
  setImageScale: (scale: number) => void;
  setImageBorder: (border: ImageBorder | Partial<ImageBorder>) => void;
  setImageShadow: (shadow: ImageShadow | Partial<ImageShadow>) => void;
  setImageStylePreset: (preset: ImageStylePreset) => void;
  setShadowPreset: (preset: ShadowPreset) => void;
  applyVisualPreset: (
    preset: PresetConfig,
    options?: {
      clearAnimation?: boolean;
      closeTemplates?: boolean;
      scene?: ImageTemplateScene;
    },
  ) => void;
  applyAnimatedTemplate: (templateId: string) => void;
  setPerspective3D: (perspective: Partial<ImageState["perspective3D"]>) => void;
  setImageFilter: (key: keyof ImageFilters, value: number) => void;
  resetImageFilters: () => void;
  resetCanvasSettings: () => void;
  setExportSettings: (settings: Partial<ImageState["exportSettings"]>) => void;
  exportImage: () => Promise<void>;
  // Slideshow
  slides: Slide[];
  activeSlideId: string | null;

  slideshow: {
    enabled: boolean;
    defaultDuration: number;
    animation: "none" | "fade" | "slide";
  };
  // Preview
  isPreviewing: boolean;
  previewIndex: number;
  previewStartedAt: number | null;
  setSlideshow: (updates: Partial<ImageState["slideshow"]>) => void;
  // Slideshow actions
  addImages: (files: File[]) => void;
  setActiveSlide: (id: string) => void;
  removeSlide: (id: string) => void;
  startPreview: () => void;
  resetSlideshow: () => void;
  stopPreview: () => void;

  // Timeline / Animation
  animationBase: AnimatableProperties;
  camera: Pick<AnimatableProperties, 'cameraX' | 'cameraY' | 'cameraZoom' | 'cameraRotateX' | 'cameraRotateY' | 'cameraRotateZ'>;
  setCamera: (camera: Partial<ImageState['camera']>) => void;
  timeline: TimelineState;
  showTimeline: boolean;
  animationClips: AnimationClip[];
  setTimeline: (updates: Partial<TimelineState>) => void;
  setShowTimeline: (show: boolean) => void;
  toggleTimeline: () => void;
  setPlayhead: (time: number) => void;
  togglePlayback: () => void;
  startPlayback: () => void;
  stopPlayback: () => void;
  addKeyframe: (trackId: string, keyframe: Omit<Keyframe, 'id'>) => void;
  updateKeyframe: (trackId: string, keyframeId: string, updates: Partial<Keyframe>) => void;
  removeKeyframe: (trackId: string, keyframeId: string) => void;
  addTrack: (track: Omit<AnimationTrack, 'id'>) => void;
  updateTrack: (trackId: string, updates: Partial<AnimationTrack>) => void;
  removeTrack: (trackId: string) => void;
  applyAnimationPreset: (presetId: string) => void;
  clearTimeline: () => void;
  setTimelineDuration: (duration: number, lockDuration?: boolean) => void;
  // Animation clips
  addAnimationClip: (presetId: string, startTime: number, target?: string) => void;
  updateAnimationClip: (clipId: string, updates: Partial<AnimationClip>) => void;
  removeAnimationClip: (clipId: string) => void;
  clearAnimationClips: () => void;
  recordPropertyChange: <K extends keyof AnimatableProperties>(
    property: K,
    value: AnimatableProperties[K],
    easing?: EasingFunction
  ) => boolean;
  recordPropertyChanges: (
    properties: Partial<AnimatableProperties>,
    easing?: EasingFunction
  ) => void;

  // Annotations (custom SVG)
  annotations: AnnotationShape[];
  activeAnnotationTool: AnnotationToolType | null;
  selectedAnnotationId: string | null;
  annotationDefaults: { strokeColor: string; strokeWidth: number; fillColor: string };
  addAnnotation: (annotation: Omit<AnnotationShape, 'id'>) => void;
  updateAnnotation: (id: string, updates: Partial<AnnotationShape>) => void;
  removeAnnotation: (id: string) => void;
  clearAnnotations: () => void;
  setActiveAnnotationTool: (tool: AnnotationToolType | null) => void;
  setSelectedAnnotationId: (id: string | null) => void;
  setAnnotationDefaults: (defaults: Partial<{ strokeColor: string; strokeWidth: number; fillColor: string }>) => void;

  // Blur regions
  blurRegions: BlurRegion[];
  addBlurRegion: (region: Omit<BlurRegion, 'id'>) => void;
  updateBlurRegion: (id: string, updates: Partial<BlurRegion>) => void;
  removeBlurRegion: (id: string) => void;
  clearBlurRegions: () => void;

  // UI State
  activeRightPanelTab: 'settings' | 'edit' | 'background' | 'transforms' | 'animate' | 'depth';
  setActiveRightPanelTab: (tab: 'settings' | 'edit' | 'background' | 'transforms' | 'animate' | 'depth') => void;
  reorderImageOverlay: (id: string, direction: 'up' | 'down' | 'top' | 'bottom') => void;
  showTemplates: boolean;
  setShowTemplates: (show: boolean) => void;
  editorMode: 'screenshot' | 'browser' | 'device';
  setEditorMode: (mode: 'screenshot' | 'browser' | 'device') => void;
  browserUrl: string;
  setBrowserUrl: (url: string) => void;
  browserHeaderSize: number;
  setBrowserHeaderSize: (size: number) => void;
  canvasDimensions: { canvasW: number; canvasH: number; framedW: number; framedH: number } | null;
  setCanvasDimensions: (dims: { canvasW: number; canvasH: number; framedW: number; framedH: number }) => void;

  // Canvas visual guides
  showRulers: boolean;
  showGrid: boolean;
  rulerInterval: number;
  toggleRulers: () => void;
  toggleGrid: () => void;
  setRulerInterval: (interval: number) => void;

  // Layer Selection State
  selectedOverlayId: string | null;
  selectedOverlayIds: string[];
  isMainImageSelected: boolean;
  /** Last canvas asset targeted by transform controls; excluded from undo history. */
  lastSelectedAssetId: string | null;
  setSelectedOverlayId: (id: string | null) => void;
  setSelectedOverlayIds: (ids: string[]) => void;
  setIsMainImageSelected: (selected: boolean) => void;
}

function resolveTemplateMedia(imageState: Pick<ImageState, 'uploadedImageUrl' | 'imageName' | 'imageOverlays' | 'selectedOverlayId'>) {
  const screenshot = useEditorStore.getState().screenshot;
  const uploaded = imageState.uploadedImageUrl && !isTemplateDemoMedia(imageState.uploadedImageUrl, imageState.imageName)
    && imageState.uploadedImageUrl !== TEMPLATE_DEMO_IMAGE_URL
    ? imageState.uploadedImageUrl
    : null;
  const screenshotSource = screenshot?.src && screenshot.src !== TEMPLATE_DEMO_IMAGE_URL
    ? screenshot.src
    : null;
  const overlay = imageState.imageOverlays.find((item) => item.id === imageState.selectedOverlayId && item.isVisible && !item.src.includes('overlay-shadow'))
    ?? imageState.imageOverlays.find((item) => item.isVisible && !item.src.includes('overlay-shadow'));
  const overlaySource = overlay?.mediaType === 'video'
    ? overlay.poster ?? null
    : overlay?.src ?? null;
  const mainSource = uploaded ?? screenshotSource;

  return {
    mainSource,
    overlay,
    overlaySource,
    assetSource: mainSource ?? overlaySource,
    hasUserMedia: Boolean(mainSource || overlay),
  };
}

export const useImageStore = create<ImageState>()(
  temporal((set, get) => ({
    slides: [],
    activeSlideId: null,

    slideshow: {
      enabled: true,
      defaultDuration: 5,
      animation: "fade", // 'none' | 'fade' | 'slide'
    },
    setSlideshow: (updates) => {
      set((state) => ({
        slideshow: { ...state.slideshow, ...updates },
      }));
    },
    isPreviewing: false,
    previewIndex: 0,
    previewStartedAt: null,

    uploadedImageUrl: null,
    imageName: null,
    mainImageStartTime: 0,
    mainImageDuration: 5000,
    selectedGradient: "vibrant_orange_pink",
    borderRadius: 0,
    backgroundBorderRadius: 0,
    selectedAspectRatio: "4_3",
    customDimensions: null,
    backgroundConfig: {
      type: "image",
      value: "backgrounds/raycast/red_distortion_4.webp",
      opacity: 1,
    },
    backgroundBlur: 0,
    backgroundNoise: 0,
    textOverlays: [],
    imageOverlays: [],
    mockups: [],
    activeDeviceLayoutId: null,
    deviceLayoutSnapshot: null,
    imageOpacity: 1,
    imageClipPath: null,
    imageScale: 100,
    mainImagePlacement: { offsetX: 0, offsetY: 0, rotation: 0 },
    editorSnapshot: snapshotEditorStore(),
    imageBorder: {
      enabled: false,
      width: 8,
      color: "#000000",
      type: "none",
      padding: 0.5,
      title: "",
    },
    imageShadow: {
      enabled: true,
      blur: 15,
      offsetX: 5,
      offsetY: 8,
      spread: 3,
      color: "rgba(0, 0, 0, 0.6)",
      opacity: 0.25,
    },
    imageStylePreset: 'default' as ImageStylePreset,
    shadowPreset: 'soft' as ShadowPreset,
    perspective3D: {
      perspective: 2400,
      rotateX: 0,
      rotateY: 0,
      rotateZ: 0,
      translateX: 0,
      translateY: 0,
      scale: 1,
    },
    imageFilters: {
      brightness: 100,
      contrast: 100,
      grayscale: 0,
      blur: 0,
      hueRotate: 0,
      invert: 0,
      saturate: 100,
      sepia: 0,
    },
    exportSettings: {
      quality: '2x',
      format: 'png',
      fileName: '',
    },

    setUploadedImageUrl: (url: string | null, name: string | null = null) => {
      set({
        uploadedImageUrl: url,
        imageName: name,
      });
      // Immediately sync to editor store so canvas updates without
      // waiting for the EditorStoreSync useEffect cycle
      useEditorStore.getState().setScreenshot({ src: url });
    },

    replaceTemplateMedia: (url, name, mockupId) => {
      set((state) => ({
        uploadedImageUrl: url,
        imageName: name,
        ...(mockupId
          ? {
              mockups: state.mockups.map((mockup) => (
                mockup.id === mockupId
                  ? {
                      ...mockup,
                      screen: {
                        ...mockup.screen,
                        src: url,
                        name,
                        isCustom: true,
                        scale: 1,
                        offset: { x: 0, y: 0 },
                      },
                    }
                  : mockup
              )),
            }
          : {}),
      }));
      useEditorStore.getState().setScreenshot({ src: url });
    },

    setImage: (file: File) => {
      // Track image upload
      trackImageUpload('file', file.size);

      const imageUrl = URL.createObjectURL(file);
      // Reset ALL effects to defaults when uploading a new image
      set({
        uploadedImageUrl: imageUrl,
        imageName: file.name,
        mainImageStartTime: 0,
        mainImageDuration: 5000,
        // Reset image settings
        imageScale: 100,
        imageOpacity: 1,
        borderRadius: 0,
        backgroundBorderRadius: 0,
        // Reset background
        backgroundConfig: {
          type: "image",
          value: "backgrounds/raycast/red_distortion_4.webp",
          opacity: 1,
        },
        backgroundBlur: 0,
        backgroundNoise: 0,
        selectedGradient: "vibrant_orange_pink",
        // Reset shadow
        imageShadow: {
          enabled: true,
          blur: 15,
          offsetX: 5,
          offsetY: 8,
          spread: 3,
          color: "rgba(0, 0, 0, 0.6)",
          opacity: 0.25,
        },
        // Reset border/frame
        imageBorder: {
          enabled: false,
          width: 8,
          color: "#000000",
          type: "none",
          padding: 0.5,
          title: "",
        },
        imageStylePreset: 'default' as ImageStylePreset,
        shadowPreset: 'soft' as ShadowPreset,
        // Reset 3D perspective
        perspective3D: {
          perspective: 2400,
          rotateX: 0,
          rotateY: 0,
          rotateZ: 0,
          translateX: 0,
          translateY: 0,
          scale: 1,
        },
        // Reset filters
        imageFilters: {
          brightness: 100,
          contrast: 100,
          grayscale: 0,
          blur: 0,
          hueRotate: 0,
          invert: 0,
          saturate: 100,
          sepia: 0,
        },
        // Clear overlays
        textOverlays: [],
        imageOverlays: [],
        mockups: [],
        activeDeviceLayoutId: null,
        deviceLayoutSnapshot: null,
        // Reset annotations & blur
        annotations: [],
        activeAnnotationTool: null,
        blurRegions: [],
        // Reset timeline/animation
        timeline: { ...DEFAULT_TIMELINE_STATE },
        animationClips: [],
        showTimeline: false,
        animationBase: { ...DEFAULT_ANIMATABLE_PROPERTIES },
        camera: { cameraX: 0, cameraY: 0, cameraZoom: 1, cameraRotateX: 0, cameraRotateY: 0, cameraRotateZ: 0 },
      });
    },

    clearImage: () => {
      // ponytail: keep blob URLs for session-long undo; reclaim on history
      // eviction if history becomes bounded. The browser frees them on unload.
      // Clear everything and reset ALL effects to defaults
      set({
        uploadedImageUrl: null,
        imageName: null,
        slides: [],
        activeSlideId: null,
        isPreviewing: false,
        previewIndex: 0,
        previewStartedAt: null,
        // Reset image settings
        imageScale: 100,
        imageOpacity: 1,
        borderRadius: 0,
        backgroundBorderRadius: 0,
        // Reset background
        backgroundConfig: {
          type: "image",
          value: "backgrounds/raycast/red_distortion_4.webp",
          opacity: 1,
        },
        backgroundBlur: 0,
        backgroundNoise: 0,
        selectedGradient: "vibrant_orange_pink",
        // Reset shadow
        imageShadow: {
          enabled: true,
          blur: 15,
          offsetX: 5,
          offsetY: 8,
          spread: 3,
          color: "rgba(0, 0, 0, 0.6)",
          opacity: 0.25,
        },
        // Reset border/frame
        imageBorder: {
          enabled: false,
          width: 8,
          color: "#000000",
          type: "none",
          padding: 0.5,
          title: "",
        },
        imageStylePreset: 'default' as ImageStylePreset,
        shadowPreset: 'soft' as ShadowPreset,
        // Reset 3D perspective
        perspective3D: {
          perspective: 2400,
          rotateX: 0,
          rotateY: 0,
          rotateZ: 0,
          translateX: 0,
          translateY: 0,
          scale: 1,
        },
        // Reset filters
        imageFilters: {
          brightness: 100,
          contrast: 100,
          grayscale: 0,
          blur: 0,
          hueRotate: 0,
          invert: 0,
          saturate: 100,
          sepia: 0,
        },
        // Clear overlays
        textOverlays: [],
        imageOverlays: [],
        mockups: [],
        activeDeviceLayoutId: null,
        deviceLayoutSnapshot: null,
        // Reset annotations & blur
        annotations: [],
        activeAnnotationTool: null,
        blurRegions: [],
        // Reset timeline/animation
        timeline: { ...DEFAULT_TIMELINE_STATE },
        animationClips: [],
        showTimeline: false,
        animationBase: { ...DEFAULT_ANIMATABLE_PROPERTIES },
        camera: { cameraX: 0, cameraY: 0, cameraZoom: 1, cameraRotateX: 0, cameraRotateY: 0, cameraRotateZ: 0 },
      });
    },

    setGradient: (gradient: GradientKey) => {
      set({ selectedGradient: gradient });
    },

    setBorderRadius: (radius: number) => {
      set({ borderRadius: radius });
    },
    resetSlideshow: () => {
      set({
        slides: [],
        activeSlideId: null,
        isPreviewing: false,
        previewIndex: 0,
        previewStartedAt: null,
      });
    },
    setBackgroundBorderRadius: (radius: number) => {
      set({ backgroundBorderRadius: radius });
    },

    setAspectRatio: (aspectRatio: AspectRatioKey) => {
      trackAspectRatioChange(aspectRatio);
      set({ selectedAspectRatio: aspectRatio });
    },

    setCustomDimensions: (width: number, height: number) => {
      trackAspectRatioChange('custom');
      set({ selectedAspectRatio: 'custom', customDimensions: { width, height } });
    },

    setBackgroundConfig: (config: BackgroundConfig) => {
      trackBackgroundChange(config.type, config.value as string);
      const current = get().backgroundConfig;
      const hslByImage = { ...(current.hslByImage ?? {}), ...(config.hslByImage ?? {}) };
      if (current.type === 'image' && typeof current.value === 'string' && current.hsl) {
        hslByImage[current.value] = current.hsl;
      }
      if (config.type === 'image' && typeof config.value === 'string') {
        const explicitlyReset = Object.prototype.hasOwnProperty.call(config, 'hsl') && !config.hsl;
        if (config.hsl) hslByImage[config.value] = config.hsl;
        else if (explicitlyReset) delete hslByImage[config.value];
        set({ backgroundConfig: { ...config, hsl: explicitlyReset ? undefined : config.hsl ?? hslByImage[config.value] ?? { hue: 0, saturation: 100, lightness: 100 }, hslByImage } });
        return;
      }
      set({ backgroundConfig: { ...config, hslByImage } });
    },

    setBackgroundType: (type: BackgroundType) => {
      const { backgroundConfig } = get();

      // If switching to 'image' type and current value is not a valid image, set default to radiant9
      if (type === "image") {
        const currentValue = backgroundConfig.value;
        const isGradientKey = currentValue in gradientColors;
        const isSolidColorKey = currentValue in solidColors;
        const isValidImage =
          typeof currentValue === "string" &&
          (currentValue.startsWith("blob:") ||
            currentValue.startsWith("http") ||
            currentValue.startsWith("data:") ||
            // Check if it's a Cloudinary public ID (contains '/' but not a gradient/solid key)
            (currentValue.includes("/") && !isGradientKey && !isSolidColorKey));

        // If current value is a gradient or solid color key, or not a valid image, set default to asset-26
        const newValue =
          isGradientKey || isSolidColorKey || !isValidImage
            ? "backgrounds/raycast/red_distortion_4.webp"
            : currentValue;

        const hslByImage = { ...(backgroundConfig.hslByImage ?? {}) };
        if (backgroundConfig.type === 'image' && typeof backgroundConfig.value === 'string' && backgroundConfig.hsl) {
          hslByImage[backgroundConfig.value] = backgroundConfig.hsl;
        }
        set({
          backgroundConfig: {
            ...backgroundConfig,
            type,
            value: newValue,
            hsl: hslByImage[newValue] ?? { hue: 0, saturation: 100, lightness: 100 },
            hslByImage,
          },
        });
      } else {
        set({
          backgroundConfig: {
            ...backgroundConfig,
            type,
          },
        });
      }
    },

    setBackgroundValue: (value: string) => {
      const { backgroundConfig } = get();
      const hslByImage = { ...(backgroundConfig.hslByImage ?? {}) };
      if (backgroundConfig.type === 'image' && typeof backgroundConfig.value === 'string' && backgroundConfig.hsl) {
        hslByImage[backgroundConfig.value] = backgroundConfig.hsl;
      }
      set({
        backgroundConfig: {
          ...backgroundConfig,
          value,
          ...(backgroundConfig.type === 'image'
            ? { hsl: hslByImage[value] ?? { hue: 0, saturation: 100, lightness: 100 }, hslByImage }
            : {}),
        },
      });
    },

    setBackgroundOpacity: (opacity: number) => {
      const { backgroundConfig } = get();
      set({
        backgroundConfig: {
          ...backgroundConfig,
          opacity,
        },
      });
    },

    setBackgroundBlur: (blur: number) => {
      set({ backgroundBlur: blur });
    },

    setBackgroundNoise: (noise: number) => {
      set({ backgroundNoise: noise });
    },

    addTextOverlay: (overlay = {
      text: 'Text', position: { x: 50, y: 50 }, fontSize: 32,
      fontWeight: 'normal', fontFamily: 'inter', color: '#ffffff',
      opacity: 1, isVisible: true, orientation: 'horizontal',
      textShadow: { enabled: true, color: 'rgba(0, 0, 0, 0.5)', blur: 4, offsetX: 2, offsetY: 2 },
    }) => {
      trackOverlayAdd('text');
      const id = `text-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      set((state) => ({
        textOverlays: [...state.textOverlays, { ...overlay, id }],
      }));
      return id;
    },

    updateTextOverlay: (id, updates) => {
      set((state) => ({
        textOverlays: state.textOverlays.map((overlay) =>
          overlay.id === id ? { ...overlay, ...updates } : overlay
        ),
      }));
    },

    removeTextOverlay: (id) => {
      set((state) => ({
        textOverlays: state.textOverlays.filter((overlay) => overlay.id !== id),
      }));
    },

    clearTextOverlays: () => {
      set({ textOverlays: [] });
    },

    addImageOverlay: (overlay) => {
      trackOverlayAdd('sticker');
      const id = `overlay-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const finish = beginMotionDrag();
      const timelineAsset = {
        ...overlay,
        ...(overlay.mediaType === 'video'
          ? {}
          : { startTime: overlay.startTime ?? 0, clipDuration: overlay.clipDuration ?? 5000 }),
      };
      set((state) => ({
        imageOverlays: [...state.imageOverlays, { blur: 0, ...timelineAsset, id }],
      }));
      get().setTimelineDuration(Math.max(get().timeline.duration, mediaTimelineDuration(get().imageOverlays)), false);
      finish();
    },

    updateImageOverlay: (id, updates) => {
      set((state) => ({
        imageOverlays: state.imageOverlays.map((overlay) =>
          overlay.id === id ? { ...overlay, ...updates } : overlay
        ),
      }));
    },

    removeImageOverlay: (id) => {
      set((state) => ({
        imageOverlays: state.imageOverlays.filter(
          (overlay) => overlay.id !== id
        ),
      }));
    },

    clearImageOverlays: () => {
      set({ imageOverlays: [] });
    },

    reorderImageOverlay: (id, direction) => {
      set((state) => {
        const overlays = [...state.imageOverlays];
        const index = overlays.findIndex((o) => o.id === id);
        if (index === -1) return state;

        let newIndex: number;
        switch (direction) {
          case 'up':
            newIndex = Math.min(overlays.length - 1, index + 1);
            break;
          case 'down':
            newIndex = Math.max(0, index - 1);
            break;
          case 'top':
            newIndex = overlays.length - 1;
            break;
          case 'bottom':
            newIndex = 0;
            break;
        }

        if (newIndex === index) return state;
        const [item] = overlays.splice(index, 1);
        overlays.splice(newIndex, 0, item);
        return { imageOverlays: overlays };
      });
    },

    addMockup: (mockup) => {
      if (get().mockups.length >= MAX_DEVICE_MOCKUPS) return null;
      const id = `mockup-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      set((state) => ({
        mockups: [...state.mockups, { ...mockup, id }],
        activeDeviceLayoutId: null,
        deviceLayoutSnapshot: null,
      }));
      return id;
    },

    updateMockup: (id, updates) => {
      set((state) => ({
        mockups: state.mockups.map((mockup) =>
          mockup.id === id ? { ...mockup, ...updates } : mockup
        ),
      }));
    },

    removeMockup: (id) => {
      set((state) => ({
        mockups: state.mockups.filter((mockup) => mockup.id !== id),
        activeDeviceLayoutId: null,
        deviceLayoutSnapshot: null,
      }));
    },

    clearMockups: () => {
      set({ mockups: [], activeDeviceLayoutId: null, deviceLayoutSnapshot: null });
    },

    duplicateMockup: (id) => {
      const state = get();
      if (state.mockups.length >= MAX_DEVICE_MOCKUPS) return null;
      const source = state.mockups.find((mockup) => mockup.id === id);
      if (!source) return null;
      const duplicateId = `mockup-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      set({
        mockups: [
          ...state.mockups,
          {
            ...source,
            id: duplicateId,
            position: {
              x: Math.min(0.92, source.position.x + 0.04),
              y: Math.min(0.92, source.position.y + 0.04),
            },
            screen: { ...source.screen, offset: { ...source.screen.offset } },
          },
        ],
        activeDeviceLayoutId: null,
        deviceLayoutSnapshot: null,
      });
      return duplicateId;
    },

    reorderMockup: (id, direction) => {
      set((state) => {
        const mockups = [...state.mockups];
        const index = mockups.findIndex((mockup) => mockup.id === id);
        if (index === -1) return state;
        const target = direction === 'top'
          ? mockups.length - 1
          : direction === 'bottom'
            ? 0
            : direction === 'up'
              ? Math.min(mockups.length - 1, index + 1)
              : Math.max(0, index - 1);
        if (target === index) return state;
        const [mockup] = mockups.splice(index, 1);
        mockups.splice(target, 0, mockup);
        return { mockups };
      });
    },

    applyDeviceLayout: (layoutId) => {
      const layout = getDeviceLayout(layoutId);
      if (!layout) return;
      const state = get();
      if (state.mockups.length > layout.slots.length) return;
      const fallbackScreen = state.mockups[0]?.screen
        ?? createDeviceScreen(state.uploadedImageUrl, state.imageName);
      set({
        mockups: applyLayoutToMockups(state.mockups, layout, fallbackScreen),
        activeDeviceLayoutId: layoutId,
        deviceLayoutSnapshot: state.activeDeviceLayoutId
          ? state.deviceLayoutSnapshot
          : cloneMockups(state.mockups),
      });
    },

    clearDeviceLayout: () => {
      set((state) => {
        const snapshot = state.deviceLayoutSnapshot;
        if (!snapshot) {
          return { activeDeviceLayoutId: null, deviceLayoutSnapshot: null };
        }

        return {
          mockups: restoreMockupsFromLayoutSnapshot(snapshot, state.mockups),
          activeDeviceLayoutId: null,
          deviceLayoutSnapshot: null,
        };
      });
    },

    setImageOpacity: (opacity: number) => {
      set({ imageOpacity: opacity });
    },

    setImageScale: (scale: number) => {
      set({ imageScale: scale });
    },

    setImageBorder: (border: ImageBorder | Partial<ImageBorder>) => {
      const currentBorder = get().imageBorder;
      // Track frame changes
      if ('type' in border && border.type && border.type !== currentBorder.type) {
        trackFrameApply(border.type);
      }
      set({
        imageBorder: {
          ...currentBorder,
          ...border,
        },
      });
    },

    setImageShadow: (shadow: ImageShadow | Partial<ImageShadow>) => {
      const currentShadow = get().imageShadow;
      set({
        imageShadow: {
          ...currentShadow,
          ...shadow,
        },
      });
    },

    setImageStylePreset: (preset: ImageStylePreset) => {
      const borderMap: Record<ImageStylePreset, Partial<ImageBorder>> = {
        'default': { enabled: false, type: 'none' },
        'glass-light': { enabled: true, type: 'glass-light', opacity: 0.25, padding: 1 },
        'glass-dark': { enabled: true, type: 'glass-dark', opacity: 0.7, padding: 1 },
        'outline': { enabled: true, type: 'outline-light', opacity: 0.35, padding: 0.5 },
        'border-light': { enabled: true, type: 'border-light', padding: 1 },
        'border-dark': { enabled: true, type: 'border-dark', padding: 1 },
      };
      const currentBorder = get().imageBorder;
      set({
        imageStylePreset: preset,
        imageBorder: { ...currentBorder, ...borderMap[preset] },
      });
    },

    setShadowPreset: (preset: ShadowPreset) => {
      const shadowMap = SHADOW_PRESET_SETTINGS;

      set({
        shadowPreset: preset,
        imageShadow: shadowMap[preset],
      });
    },

    applyVisualPreset: (preset, options = {}) => {
      trackPresetApply(preset.id, preset.name);
      const templateMedia = resolveTemplateMedia(get());
      const shouldUseDemoMedia = !templateMedia.hasUserMedia;
      const mediaUrl = templateMedia.assetSource ?? TEMPLATE_DEMO_IMAGE_URL;
      const shouldSetScreenshot = shouldUseDemoMedia
        || (options.scene?.kind === 'screenshot' && Boolean(templateMedia.mainSource));

      set((state) => {
        const mediaName = state.imageName ?? TEMPLATE_DEMO_IMAGE_NAME;
        const retainedOverlays = state.imageOverlays.filter(
          (overlay) => !(typeof overlay.src === "string" && overlay.src.includes("overlay-shadow")),
        );
        const templateShadow: ImageOverlay[] = preset.shadowOverlay
          ? [{
              id: `template-shadow-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              src: preset.shadowOverlay.src,
              position: { x: 0, y: 0 },
              size: 100,
              rotation: 0,
              opacity: preset.shadowOverlay.opacity,
              flipX: false,
              flipY: false,
              isVisible: true,
            }]
          : [];
        const templateMockups = options.scene?.kind === "device"
          ? options.scene.devices.map((device, index) => ({
              ...createMockup(
                device.definitionId,
                createDeviceScreen(mediaUrl, mediaName),
                index,
              ),
              position: { ...device.position },
              size: device.size,
              rotation: device.rotation,
            }))
          : [];

        return {
          ...(shouldUseDemoMedia
            ? {
                uploadedImageUrl: TEMPLATE_DEMO_IMAGE_URL,
                imageName: TEMPLATE_DEMO_IMAGE_NAME,
              }
            : {}),
          selectedAspectRatio: preset.aspectRatio,
          backgroundConfig: preset.backgroundConfig,
          borderRadius: preset.borderRadius,
          backgroundBorderRadius: preset.backgroundBorderRadius,
          backgroundBlur: preset.backgroundBlur ?? 0,
          backgroundNoise: preset.backgroundNoise ?? 0,
          imageOpacity: preset.imageOpacity,
          imageScale: preset.imageScale,
          imageStylePreset: getImageStylePreset(preset.imageBorder),
          imageBorder: preset.imageBorder,
          imageShadow: preset.imageShadow,
          imageOverlays: [...retainedOverlays, ...templateShadow],
          perspective3D: preset.perspective3D ?? {
            perspective: DEFAULT_ANIMATABLE_PROPERTIES.perspective,
            rotateX: DEFAULT_ANIMATABLE_PROPERTIES.rotateX,
            rotateY: DEFAULT_ANIMATABLE_PROPERTIES.rotateY,
            rotateZ: DEFAULT_ANIMATABLE_PROPERTIES.rotateZ,
            translateX: DEFAULT_ANIMATABLE_PROPERTIES.translateX,
            translateY: DEFAULT_ANIMATABLE_PROPERTIES.translateY,
            scale: DEFAULT_ANIMATABLE_PROPERTIES.scale,
          },
          ...(options.scene
            ? {
                editorMode: options.scene.kind === "device" ? "device" as const : "screenshot" as const,
                mockups: templateMockups,
                activeDeviceLayoutId: null,
                deviceLayoutSnapshot: null,
              }
            : {}),
          ...(options.clearAnimation
            ? {
                animationClips: [],
                timeline: { ...DEFAULT_TIMELINE_STATE },
                showTimeline: false,
                animationBase: { ...DEFAULT_ANIMATABLE_PROPERTIES },
                camera: { cameraX: 0, cameraY: 0, cameraZoom: 1, cameraRotateX: 0, cameraRotateY: 0, cameraRotateZ: 0 },
              }
            : {}),
          ...(options.closeTemplates ? { showTemplates: false } : {}),
        };
      });

      if (shouldSetScreenshot) {
        const placement = options.scene?.kind === "screenshot"
          ? options.scene.placement ?? { offsetX: 0, offsetY: 0, rotation: 0 }
          : null;
        useEditorStore.getState().setScreenshot({
          src: mediaUrl,
          ...(placement ?? {}),
        });
      }
    },

    applyAnimatedTemplate: (templateId) => {
      const template = getAnimatedTemplateById(templateId);
      if (!template) return;

      const current = get();
      const visibleAssetOverlays = current.imageOverlays.filter(overlay => (
        overlay.isVisible && !overlay.src.includes('overlay-shadow')
      ));
      const selectedLayer = visibleAssetOverlays.find(overlay => overlay.id === current.selectedOverlayId);
      const lastSelectedLayer = !current.isMainImageSelected
        && current.lastSelectedAssetId
        && current.lastSelectedAssetId !== 'asset'
        ? visibleAssetOverlays.find(overlay => overlay.id === current.lastSelectedAssetId)
        : undefined;
      const targetLayer = selectedLayer ?? lastSelectedLayer;
      const target = targetLayer?.id ?? 'asset';
      const hasOtherTargetAnimation = current.animationClips.some(clip => (clip.target ?? 'asset') !== target);
      if (targetLayer || hasOtherTargetAnimation) {
        const animation = buildAnimatedTemplateTimeline(template);
        if (!animation) return;
        const startTime = current.animationClips
          .filter(clip => (clip.target ?? 'asset') === target)
          .reduce((end, clip) => Math.max(end, clip.startTime + clip.duration), 0);
        const appliedClip = { ...animation.clip, target, startTime };
        const addedTracks = splitPropertyTracks(animation.tracks).map(track => ({
          ...track,
          keyframes: track.keyframes.map(keyframe => ({ ...keyframe, time: keyframe.time + startTime })),
        }));
        trackPresetApply(`animated:${template.id}`, template.name);
        set(state => ({
          animationClips: [...state.animationClips, appliedClip],
          timeline: {
            ...state.timeline,
            duration: state.timeline.durationLocked
              ? state.timeline.duration
              : Math.max(state.timeline.duration, startTime + appliedClip.duration),
            tracks: [...state.timeline.tracks, ...addedTracks],
            isPlaying: false,
          },
          showTimeline: true,
          showTemplates: false,
        }));
        useMotionSelection.getState().selectClip(appliedClip.id);
        return;
      }

      if (template.category === 'cinematic' || template.category === 'smooth') {
        const animation = buildAnimatedTemplateTimeline(template);
        if (!animation) return;
        const state = get();
        const templateMedia = resolveTemplateMedia(state);
        const mediaUrl = templateMedia.mainSource ?? TEMPLATE_DEMO_IMAGE_URL;
        const overlayTarget = !templateMedia.mainSource ? templateMedia.overlay : null;
        const appliedClip = overlayTarget
          ? { ...animation.clip, target: overlayTarget.id }
          : animation.clip;
        const canvasWidth = state.canvasDimensions
          ? Math.min(state.canvasDimensions.canvasW, state.canvasDimensions.canvasH * 9 / 16)
          : 450;
        const imageScale = getCinematicImageScale(state.imageBorder, canvasWidth);
        const initial = { ...DEFAULT_ANIMATABLE_PROPERTIES, ...template.keyframes[0].properties };
        const { perspective, rotateX, rotateY, rotateZ, translateX, translateY, scale } = initial;
        trackPresetApply(`animated:${template.id}`, template.name);
        set({
          ...(!templateMedia.hasUserMedia ? { uploadedImageUrl: mediaUrl, imageName: TEMPLATE_DEMO_IMAGE_NAME } : {}),
          selectedAspectRatio: '9_16',
          customDimensions: null,
          imageScale,
          imageOpacity: initial.imageOpacity,
          imageClipPath: template.keyframes[0].clipMask ?? null,
          perspective3D: { perspective, rotateX, rotateY, rotateZ, translateX, translateY, scale },
          editorMode: 'screenshot',
          mockups: [],
          activeDeviceLayoutId: null,
          deviceLayoutSnapshot: null,
          animationClips: [appliedClip],
          animationBase: { ...DEFAULT_ANIMATABLE_PROPERTIES },
          camera: { cameraX: 0, cameraY: 0, cameraZoom: 1, cameraRotateX: 0, cameraRotateY: 0, cameraRotateZ: 0 },
          timeline: {
            ...DEFAULT_TIMELINE_STATE,
            duration: animation.duration,
            tracks: splitPropertyTracks(animation.tracks),
            isPlaying: true,
          },
          showTimeline: true,
          showTemplates: false,
        });
        useEditorStore.getState().setCanvas({ padding: 0 });
        if (!overlayTarget) {
          useEditorStore.getState().setScreenshot({ src: mediaUrl, offsetX: 0, offsetY: 0, rotation: 0, scale: imageScale / 100 });
        }
        useMotionSelection.getState().selectClip(appliedClip.id);
        return;
      }

      const imageTemplate = getImageTemplateById(template.visualPresetId);
      const visualPreset = imageTemplate?.preset
        ?? visualPresets.find((preset) => preset.id === template.visualPresetId);
      const animation = buildAnimatedTemplateTimeline(template);
      if (!visualPreset || !animation) return;
      const templateImageBorder = template.imageStylePreset === 'default'
        ? { ...visualPreset.imageBorder, enabled: false, type: 'none' as const }
        : visualPreset.imageBorder;

      trackPresetApply(`animated:${template.id}`, template.name);
      const templateMedia = resolveTemplateMedia(get());
      const shouldUseDemoMedia = !templateMedia.hasUserMedia;
      const mediaUrl = templateMedia.mainSource ?? TEMPLATE_DEMO_IMAGE_URL;
      const overlayTarget = !templateMedia.mainSource ? templateMedia.overlay : null;
      const appliedClip = overlayTarget
        ? { ...animation.clip, target: overlayTarget.id }
        : animation.clip;

      set((state) => {
        const retainedOverlays = state.imageOverlays.filter(
          (overlay) => !(typeof overlay.src === "string" && overlay.src.includes("overlay-shadow")),
        );
        const templateShadow: ImageOverlay[] = visualPreset.shadowOverlay
          ? [{
              id: `template-shadow-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              src: visualPreset.shadowOverlay.src,
              position: { x: 0, y: 0 },
              size: 100,
              rotation: 0,
              opacity: visualPreset.shadowOverlay.opacity,
              flipX: false,
              flipY: false,
              isVisible: true,
            }]
          : [];

        return {
          ...(shouldUseDemoMedia
            ? {
                uploadedImageUrl: TEMPLATE_DEMO_IMAGE_URL,
                imageName: TEMPLATE_DEMO_IMAGE_NAME,
              }
            : {}),
          selectedAspectRatio: visualPreset.aspectRatio,
          backgroundConfig: visualPreset.backgroundConfig,
          borderRadius: visualPreset.borderRadius,
          backgroundBorderRadius: visualPreset.backgroundBorderRadius,
          backgroundBlur: visualPreset.backgroundBlur ?? 0,
          backgroundNoise: visualPreset.backgroundNoise ?? 0,
          imageOpacity: visualPreset.imageOpacity,
          imageScale: visualPreset.imageScale,
          imageStylePreset: getImageStylePreset(templateImageBorder),
          imageBorder: templateImageBorder,
          imageShadow: visualPreset.imageShadow,
          imageOverlays: [...retainedOverlays, ...templateShadow],
          perspective3D: visualPreset.perspective3D ?? {
            perspective: DEFAULT_ANIMATABLE_PROPERTIES.perspective,
            rotateX: DEFAULT_ANIMATABLE_PROPERTIES.rotateX,
            rotateY: DEFAULT_ANIMATABLE_PROPERTIES.rotateY,
            rotateZ: DEFAULT_ANIMATABLE_PROPERTIES.rotateZ,
            translateX: DEFAULT_ANIMATABLE_PROPERTIES.translateX,
            translateY: DEFAULT_ANIMATABLE_PROPERTIES.translateY,
            scale: DEFAULT_ANIMATABLE_PROPERTIES.scale,
          },
          editorMode: "screenshot" as const,
          mockups: [],
          activeDeviceLayoutId: null,
          deviceLayoutSnapshot: null,
          animationClips: [appliedClip],
          animationBase: { ...DEFAULT_ANIMATABLE_PROPERTIES },
          camera: { cameraX: 0, cameraY: 0, cameraZoom: 1, cameraRotateX: 0, cameraRotateY: 0, cameraRotateZ: 0 },
          timeline: {
            ...DEFAULT_TIMELINE_STATE,
            duration: animation.duration,
            tracks: splitPropertyTracks(animation.tracks),
            isPlaying: true,
          },
          showTimeline: true,
          showTemplates: false,
        };
      });

      const placement = imageTemplate?.scene.kind === "screenshot"
        ? imageTemplate.scene.placement
        : undefined;
      if (!overlayTarget) {
        useEditorStore.getState().setScreenshot({
          src: mediaUrl,
          offsetX: placement?.offsetX ?? 0,
          offsetY: placement?.offsetY ?? 0,
          rotation: placement?.rotation ?? 0,
        });
      }
      useMotionSelection.getState().selectClip(appliedClip.id);
    },

    setPerspective3D: (perspective: Partial<ImageState["perspective3D"]>) => {
      const target = get().selectedOverlayId ?? 'asset';
      if (previewPose(target, perspective)) return;
      const currentPerspective = get().perspective3D;
      set({
        perspective3D: {
          ...currentPerspective,
          ...perspective,
        },
      });

    },

    setImageFilter: (key: keyof ImageFilters, value: number) => {
      const currentFilters = get().imageFilters;
      set({
        imageFilters: {
          ...currentFilters,
          [key]: value,
        },
      });
    },

    resetImageFilters: () => {
      set({
        imageFilters: {
          brightness: 100,
          contrast: 100,
          grayscale: 0,
          blur: 0,
          hueRotate: 0,
          invert: 0,
          saturate: 100,
          sepia: 0,
        },
      });
    },

    resetCanvasSettings: () => {
      set({
        imageScale: 100,
        imageOpacity: 1,
        borderRadius: 0,
        backgroundBorderRadius: 0,
        backgroundConfig: {
          type: "image",
          value: "backgrounds/raycast/red_distortion_4.webp",
          opacity: 1,
        },
        backgroundBlur: 0,
        backgroundNoise: 0,
        selectedGradient: "vibrant_orange_pink",
        imageShadow: {
          enabled: true,
          blur: 15,
          offsetX: 5,
          offsetY: 8,
          spread: 3,
          color: "rgba(0, 0, 0, 0.6)",
          opacity: 0.25,
        },
        imageBorder: {
          enabled: false,
          width: 8,
          color: "#000000",
          type: "none",
          padding: 0.5,
          title: "",
        },
        imageStylePreset: 'default' as ImageStylePreset,
        shadowPreset: 'soft' as ShadowPreset,
        perspective3D: {
          perspective: 2400,
          rotateX: 0,
          rotateY: 0,
          rotateZ: 0,
          translateX: 0,
          translateY: 0,
          scale: 1,
        },
        imageFilters: {
          brightness: 100,
          contrast: 100,
          grayscale: 0,
          blur: 0,
          hueRotate: 0,
          invert: 0,
          saturate: 100,
          sepia: 0,
        },
        textOverlays: [],
        imageOverlays: [],
        mockups: [],
        activeDeviceLayoutId: null,
        deviceLayoutSnapshot: null,
        annotations: [],
        activeAnnotationTool: null,
        blurRegions: [],
        timeline: { ...DEFAULT_TIMELINE_STATE },
        animationClips: [],
        showTimeline: false,
        animationBase: { ...DEFAULT_ANIMATABLE_PROPERTIES },
        camera: { cameraX: 0, cameraY: 0, cameraZoom: 1, cameraRotateX: 0, cameraRotateY: 0, cameraRotateZ: 0 },
      });
    },

    setExportSettings: (settings: Partial<ImageState["exportSettings"]>) => {
      const currentSettings = get().exportSettings;
      set({
        exportSettings: {
          ...currentSettings,
          ...settings,
        },
      });
    },

    exportImage: async () => {
      try {
        await exportImageWithGradient("image-render-card");
      } catch (error) {
        console.error("Export failed:", error);
        throw error;
      }
    },
    addImages: (files: File[]) => {
      const { slides, slideshow, timeline } = get();

      const newSlides = files.map((file) => ({
        id: `slide-${crypto.randomUUID()}`,
        src: URL.createObjectURL(file),
        name: file.name,
        duration: slideshow.defaultDuration,
      }));

      const allSlides = [...slides, ...newSlides];

      // Calculate total slideshow duration based on slides and their durations
      const totalSlideDuration = allSlides.reduce((sum, slide) => sum + slide.duration * 1000, 0);
      const newTimelineDuration = Math.max(timeline.duration, totalSlideDuration);

      set({
        slides: allSlides,
        activeSlideId: get().activeSlideId ?? newSlides[0]?.id ?? null,
        uploadedImageUrl: allSlides[0]?.src ?? null,
        imageName: allSlides[0]?.name ?? null,
        // Auto-show timeline when multiple slides are added
        showTimeline: allSlides.length > 1 ? true : get().showTimeline,
        // Extend timeline to fit all slides
        timeline: {
          ...timeline,
          duration: newTimelineDuration,
        },
      });
    },

    setActiveSlide: (id: string) => {
      const slide = get().slides.find((s) => s.id === id);
      if (!slide) return;

      set({
        activeSlideId: id,
        uploadedImageUrl: slide.src,
        imageName: slide.name,
      });

      // Also sync to editorStore for export compatibility
      // (React useEffect sync doesn't run during imperative export)
      useEditorStore.getState().setScreenshot({ src: slide.src });
    },

    removeSlide: (id) => {
      const { slides, activeSlideId } = get();
      const remaining = slides.filter((s) => s.id !== id);
      const nextActive =
        activeSlideId === id ? remaining[0]?.id ?? null : activeSlideId;
      const nextSlide = remaining.find((s) => s.id === nextActive);

      set({
        slides: remaining,
        activeSlideId: nextActive,
        uploadedImageUrl: nextSlide?.src ?? null,
        imageName: nextSlide?.name ?? null,
      });
    },

    startPreview: () => {
      if (!get().slides.length) return;
      set({
        isPreviewing: true,
        previewIndex: 0,
        previewStartedAt: Date.now(),
      });
    },

    stopPreview: () => {
      set({
        isPreviewing: false,
        previewIndex: 0,
        previewStartedAt: null,
      });
    },

    animationBase: { ...DEFAULT_ANIMATABLE_PROPERTIES },
    camera: { cameraX: 0, cameraY: 0, cameraZoom: 1, cameraRotateX: 0, cameraRotateY: 0, cameraRotateZ: 0 },
    setCamera: (camera) => set(state => ({ camera: { ...state.camera, ...camera } })),
    // Timeline / Animation state
    timeline: { ...DEFAULT_TIMELINE_STATE },
    showTimeline: false,
    animationClips: [],

    setTimeline: (updates) => {
      set((state) => ({
        timeline: { ...state.timeline, ...updates },
      }));
    },

    setShowTimeline: (show) => {
      set({ showTimeline: show });
    },

    toggleTimeline: () => {
      set((state) => ({ showTimeline: !state.showTimeline }));
    },

    setPlayhead: (time) => {
      if (!Number.isFinite(time)) return;
      if (time !== get().timeline.playhead) useMotionSelection.getState().discardPose();
      set((state) => ({
        timeline: { ...state.timeline, playhead: Math.max(0, Math.min(time, state.timeline.duration)) },
      }));
    },

    togglePlayback: () => {
      useMotionSelection.getState().discardPose();
      set((state) => ({
        timeline: { ...state.timeline, playhead: !state.timeline.isPlaying && state.timeline.playhead >= state.timeline.duration ? 0 : state.timeline.playhead, isPlaying: !state.timeline.isPlaying },
      }));
    },

    startPlayback: () => {
      useMotionSelection.getState().discardPose();
      set((state) => ({
        timeline: { ...state.timeline, isPlaying: true },
      }));
    },

    stopPlayback: () => {
      set((state) => ({
        timeline: { ...state.timeline, isPlaying: false },
      }));
    },

    addKeyframe: (trackId, keyframe) => {
      const id = `kf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      set((state) => ({
        timeline: {
          ...state.timeline,
          tracks: state.timeline.tracks.map((track) =>
            track.id === trackId
              ? track.isLocked ? track : { ...track, keyframes: [...track.keyframes.filter(k => k.time !== keyframe.time), { ...keyframe, id }].sort((a,b) => a.time-b.time) }
              : track
          ),
        },
      }));
    },

    updateKeyframe: (trackId, keyframeId, updates) => {
      if (updates.time !== undefined && !Number.isFinite(updates.time)) return;
      set(state => ({ timeline: { ...state.timeline, tracks: state.timeline.tracks.map(track => {
        if (track.id !== trackId || track.isLocked) return track;
        const old = track.keyframes.find(k => k.id === keyframeId);
        if (!old) return track;
        const clip = state.animationClips.find(c => c.id === track.clipId);
        const time = Math.round(Math.max(clip?.startTime ?? 0, Math.min(clip ? clip.startTime + clip.duration : state.timeline.duration, updates.time ?? old.time)));
        const collision = track.keyframes.find(k => k.id !== keyframeId && Math.abs(k.time - time) < 1);
        const key = { ...collision, ...old, ...updates, time, properties: { ...collision?.properties, ...old.properties, ...updates.properties } };
        return { ...track, keyframes: [...track.keyframes.filter(k => k.id !== keyframeId && k.id !== collision?.id), key].sort((a,b) => a.time-b.time) };
      }) } }));
    },

    removeKeyframe: (trackId, keyframeId) => {
      set((state) => ({
        timeline: {
          ...state.timeline,
          tracks: state.timeline.tracks.map((track) =>
            track.id === trackId && !track.isLocked
              ? { ...track, keyframes: track.keyframes.filter((kf) => kf.id !== keyframeId) }
              : track
          ),
        },
      }));
    },

    addTrack: (track) => {
      const id = `track-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      set((state) => ({
        timeline: {
          ...state.timeline,
          tracks: [...state.timeline.tracks, { ...track, id }],
        },
      }));
    },

    updateTrack: (trackId, updates) => {
      set((state) => ({
        timeline: {
          ...state.timeline,
          tracks: state.timeline.tracks.map((track) =>
            track.id === trackId ? { ...track, ...updates } : track
          ),
        },
      }));
    },

    removeTrack: (trackId) => {
      set((state) => ({
        timeline: {
          ...state.timeline,
          tracks: state.timeline.tracks.filter((track) => track.id !== trackId),
        },
      }));
    },

    applyAnimationPreset: (presetId) => {
      const preset = getPresetById(presetId);
      if (!preset) return;

      const tracks = clonePresetTracks(preset);
      set((state) => ({
        timeline: {
          ...state.timeline,
          duration: preset.duration,
          tracks,
          playhead: 0,
          isPlaying: false,
        },
      }));
    },

    clearTimeline: () => {
      set({
        animationClips: [],
        timeline: { ...DEFAULT_TIMELINE_STATE },
      });
    },

    setTimelineDuration: (duration, lockDuration = true) => {
      if (!Number.isFinite(duration)) return;
      set((state) => {
        const newDuration = Math.max(500, duration);
        const clampedClips = state.animationClips.map(clip => clampClipDuration(clip, newDuration));
        let retimed = state.timeline.tracks;
        state.animationClips.forEach((clip, index) => { retimed = retimeClipTracks(retimed, clip, clampedClips[index]); });
        return {
          animationClips: clampedClips,
          timeline: {
            ...state.timeline,
            duration: newDuration,
            durationLocked: lockDuration || state.timeline.durationLocked,
            tracks: retimed,
            playhead: Math.min(state.timeline.playhead, newDuration),
          },
        };
      });
    },

    // Animation clips
    addAnimationClip: (presetId, startTime, target = 'asset') => {
      const current3D = get().perspective3D;
      const currentAssetPose: AnimatableProperties = {
        ...DEFAULT_ANIMATABLE_PROPERTIES, ...current3D, ...get().camera, imageOpacity: get().imageOpacity,
      };
      const preset = presetId === 'custom-asset' || presetId === 'custom-camera'
        ? createCustomPreset(
            presetId === 'custom-camera' ? 'camera' : 'asset',
            get().animationClips.some(c => (c.target ?? 'asset') === target)
              ? getClipInterpolatedProperties(get().animationClips, get().timeline.tracks, startTime, target === 'asset' ? get().animationBase : DEFAULT_ANIMATABLE_PROPERTIES, target)
              : target === 'asset'
                ? currentAssetPose
                : DEFAULT_ANIMATABLE_PROPERTIES
          )
        : ANIMATION_PRESETS.find(p => p.id === presetId) ?? useMotionLibrary.getState().presets.find(p => p.id === presetId);
      if (!preset) return;

      trackAnimationClipAdd(presetId, preset.name, preset.duration);
      // Scene camera presets remain global even when a media layer is selected.
      if (preset.tracks.some(track => track.type === 'camera')) target = 'asset';

      const id = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      // Brand-matching green color palette
      const colors = ['#c9ff2e', '#10B981', '#22c55e', '#84cc16', '#34d399'];
      const color = colors[Math.floor(Math.random() * colors.length)];

      const newClip: AnimationClip = {
        id,
        presetId,
        target,
        transition: preset.transition ? { ...preset.transition } : undefined,
        name: preset.name,
        startTime,
        duration: preset.duration,
        color,
      };

      useMotionSelection.getState().selectClip(id);
      // Clone preset tracks with startTime offset and link to clip
      const tracks = splitPropertyTracks(clonePresetTracks(preset, { startTime, clipId: id }));

      set((state) => ({
        animationBase: state.animationClips.length === 0 ? { ...DEFAULT_ANIMATABLE_PROPERTIES, ...state.perspective3D, ...state.camera, imageOpacity: state.imageOpacity } : state.animationBase,
        animationClips: [...state.animationClips, newClip],
        timeline: {
          ...state.timeline,
          duration: state.timeline.durationLocked ? state.timeline.duration : Math.max(state.timeline.duration, startTime + preset.duration),
          tracks: [...state.timeline.tracks, ...tracks],
        },
        showTimeline: true,
      }));
    },

    updateAnimationClip: (clipId, updates) => {
      set((state) => {
        const existingClip = state.animationClips.find(c => c.id === clipId);
        if (!existingClip) return state;

        const newClip = { ...existingClip, ...updates,
          startTime: Math.max(0, updates.startTime ?? existingClip.startTime),
          duration: Math.max(200, updates.duration ?? existingClip.duration),
        };

        const updatedTracks = retimeClipTracks(state.timeline.tracks, existingClip, newClip);

        return {
          animationClips: state.animationClips.map((clip) =>
            clip.id === clipId ? newClip : clip
          ),
          timeline: {
            ...state.timeline,
            duration: state.timeline.durationLocked ? state.timeline.duration : Math.max(state.timeline.duration, newClip.startTime + newClip.duration),
            tracks: updatedTracks,
          },
        };
      });
    },

    removeAnimationClip: (clipId) => {
      if (useMotionSelection.getState().clipId === clipId) useMotionSelection.getState().selectClip(null);
      set((state) => ({
        animationClips: state.animationClips.filter((clip) => clip.id !== clipId),
        timeline: {
          ...state.timeline,
          // Remove tracks associated with this clip
          tracks: state.timeline.tracks.filter((track) => track.clipId !== clipId),
        },
      }));
    },

    clearAnimationClips: () => {
      useMotionSelection.getState().selectClip(null);
      set({
        animationClips: [],
        timeline: { ...DEFAULT_TIMELINE_STATE },
      });
    },

    recordPropertyChange: (property, value, easing = 'ease-in-out-cubic') => {
      const state = get();
      if (state.timeline.isPlaying || !Number.isFinite(value)) return false;
      const target = state.selectedOverlayId ?? 'asset';
      const clip = state.animationClips.find(c => c.id === useMotionSelection.getState().clipId && (c.target ?? 'asset') === target);
      if (!clip || state.timeline.playhead < clip.startTime || state.timeline.playhead > clip.startTime + clip.duration) return false;
      const locked = state.timeline.tracks.some(t => t.clipId === clip.id && t.isLocked && t.keyframes.some(k => property in k.properties));
      if (locked) return false;
      insertPropertyKey(clip, property, value, state.timeline.playhead, easing);
      return true;
    },

    recordPropertyChanges: (properties, easing = 'ease-in-out-cubic') => {
      for (const [key, val] of Object.entries(properties)) {
        if (val !== undefined && typeof val === 'number') {
          get().recordPropertyChange(key as keyof AnimatableProperties, val, easing);
        }
      }
    },

    // Annotations (custom SVG)
    annotations: [],
    activeAnnotationTool: null,
    selectedAnnotationId: null,
    annotationDefaults: { strokeColor: '#ef4444', strokeWidth: 6, fillColor: 'transparent' },
    addAnnotation: (annotation) => {
      const id = `ann-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      set((state) => ({
        annotations: [...state.annotations, { ...annotation, id }],
        selectedAnnotationId: id,
      }));
    },
    updateAnnotation: (id, updates) => {
      set((state) => ({
        annotations: state.annotations.map((a) =>
          a.id === id ? { ...a, ...updates } : a
        ),
      }));
    },
    removeAnnotation: (id) => {
      set((state) => ({
        annotations: state.annotations.filter((a) => a.id !== id),
        selectedAnnotationId: state.selectedAnnotationId === id ? null : state.selectedAnnotationId,
      }));
    },
    clearAnnotations: () => set({ annotations: [], selectedAnnotationId: null }),
    setActiveAnnotationTool: (tool) => set({ activeAnnotationTool: tool }),
    setSelectedAnnotationId: (id) => set({ selectedAnnotationId: id }),
    setAnnotationDefaults: (defaults) => {
      set((state) => ({
        annotationDefaults: { ...state.annotationDefaults, ...defaults },
      }));
    },

    // Blur regions
    blurRegions: [],
    addBlurRegion: (region) => {
      const id = `blur-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      set((state) => ({
        blurRegions: [...state.blurRegions, { ...region, id }],
      }));
    },
    updateBlurRegion: (id, updates) => {
      set((state) => ({
        blurRegions: state.blurRegions.map((r) =>
          r.id === id ? { ...r, ...updates } : r
        ),
      }));
    },
    removeBlurRegion: (id) => {
      set((state) => ({
        blurRegions: state.blurRegions.filter((r) => r.id !== id),
      }));
    },
    clearBlurRegions: () => set({ blurRegions: [] }),

    // UI State
    activeRightPanelTab: 'edit',
    setActiveRightPanelTab: (tab) => {
      set({ activeRightPanelTab: tab });
    },
    showTemplates: false,
    setShowTemplates: (show) => {
      set({ showTemplates: show });
    },
    editorMode: 'screenshot',
    setEditorMode: (mode) => {
      const currentBorder = get().imageBorder;
      const currentUrl = get().browserUrl || 'screenshot-studio.com';
      if (mode === 'browser') {
        // Apply default browser frame (Chrome Dark) if no browser frame is active
        const isBrowserFrame = ['macos-light', 'macos-dark', 'windows-light', 'windows-dark'].includes(currentBorder.type);
        set({
          editorMode: mode,
          imageBorder: {
            ...currentBorder,
            enabled: true,
            type: isBrowserFrame ? currentBorder.type : 'windows-dark',
            title: currentUrl,
          },
        });
      } else {
        // Switching back to screenshot: disable browser frame
        const isBrowserFrame = ['macos-light', 'macos-dark', 'windows-light', 'windows-dark'].includes(currentBorder.type);
        if (isBrowserFrame) {
          set({
            editorMode: mode,
            imageBorder: {
              ...currentBorder,
              enabled: false,
              type: 'none',
            },
          });
          return;
        }
        set({ editorMode: mode });
      }
    },
    browserUrl: 'screenshot-studio.com',
    setBrowserUrl: (url) => {
      const currentBorder = get().imageBorder;
      set({
        browserUrl: url,
        imageBorder: { ...currentBorder, title: url },
      });
    },
    browserHeaderSize: 100,
    setBrowserHeaderSize: (size) => {
      set({ browserHeaderSize: size });
    },
    canvasDimensions: null,
    setCanvasDimensions: (dims) => {
      set({ canvasDimensions: dims });
    },

    showRulers: false,
    showGrid: false,
    rulerInterval: 100,
    toggleRulers: () => set((state) => ({ showRulers: !state.showRulers })),
    toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
    setRulerInterval: (interval) =>
      set({ rulerInterval: Math.max(1, Math.round(Number.isFinite(interval) ? interval : 100)) }),

    selectedOverlayId: null,
    selectedOverlayIds: [],
    isMainImageSelected: false,
    lastSelectedAssetId: null,
    setSelectedOverlayId: (id: string | null) =>
      set((state) => ({
        selectedOverlayId: id,
        selectedOverlayIds: id ? [id] : [],
        isMainImageSelected: id ? false : state.isMainImageSelected,
        ...(id ? { lastSelectedAssetId: id } : {}),
      })),
    setSelectedOverlayIds: (ids: string[]) => set((state) => {
      const validIds = [...new Set(ids)].filter(id => state.imageOverlays.some(overlay => overlay.id === id));
      const activeId = validIds.at(-1) ?? null;
      return {
        selectedOverlayIds: validIds,
        selectedOverlayId: activeId,
        isMainImageSelected: false,
        ...(activeId ? { lastSelectedAssetId: activeId } : {}),
      };
    }),
    setIsMainImageSelected: (selected: boolean) =>
      set((state) => ({
        isMainImageSelected: selected,
        selectedOverlayId: selected ? null : state.selectedOverlayId,
        selectedOverlayIds: selected ? [] : state.selectedOverlayIds,
        ...(selected ? { lastSelectedAssetId: 'asset' } : {}),
      })),
  }), {
    // Layout measurements change on mount/resize and must not erase redo history.
    partialize: ({ selectedOverlayId: _overlay, selectedOverlayIds: _overlays, isMainImageSelected: _main, lastSelectedAssetId: _lastSelected, canvasDimensions: _dimensions, showTimeline: _timeline, activeRightPanelTab: _panel, showTemplates: _templates, showRulers: _rulers, showGrid: _grid, ...state }) => ({ ...state, timeline: { ...state.timeline, playhead: 0, isPlaying: false, zoom: 1, isLooping: true } }),
    equality: (past, current) => shallow({ ...past, timeline: null }, { ...current, timeline: null }) && shallow(past.timeline, current.timeline),
  })
);

// Keep document data across development module replacement. New action functions
// always come from this module; only data is carried forward from the prior store.
if (process.env.NODE_ENV === 'development') {
  const runtime = globalThis as typeof globalThis & {
    __studioDevDocument?: { image: ImageState; editor: EditorState; unsubscribe: () => void };
  };
  const previous = runtime.__studioDevDocument;
  if (previous) {
    previous.unsubscribe();
    const dataOnly = (state: object) => Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value !== 'function'));
    useImageStore.setState(dataOnly(previous.image));
    useEditorStore.setState(dataOnly(previous.editor));
    useImageStore.temporal.getState().clear();
  }
  const remember = () => {
    runtime.__studioDevDocument = { image: useImageStore.getState(), editor: useEditorStore.getState(), unsubscribe: () => { stopImage(); stopEditor(); } };
  };
  const stopImage = useImageStore.subscribe(remember);
  const stopEditor = useEditorStore.subscribe(remember);
  remember();
}

// Editor selection is transient: deleting, resetting, restoring, or undoing layers must
// never leave controls or keyboard shortcuts targeting a removed image.
useImageStore.subscribe((state) => {
  const selectedClip = useMotionSelection.getState().clipId;
  if (selectedClip && !state.animationClips.some(c => c.id === selectedClip)) useMotionSelection.getState().selectClip(null);
  if (state.selectedOverlayId && !state.imageOverlays.some((overlay) => overlay.id === state.selectedOverlayId)) {
    state.setSelectedOverlayId(null);
  }
  if (state.selectedOverlayIds.some(id => !state.imageOverlays.some(overlay => overlay.id === id))) {
    state.setSelectedOverlayIds(state.selectedOverlayIds.filter(id => state.imageOverlays.some(overlay => overlay.id === id)));
  }
  if (state.isMainImageSelected && !state.uploadedImageUrl) {
    state.setIsMainImageSelected(false);
  }
});

// Main-image placement participates in the same history as overlays and keyframes.
useEditorStore.subscribe((state, previous) => {
  if (syncingEditorStoreFromImage) return;
  const { offsetX, offsetY, rotation } = state.screenshot;
  const placementChanged = offsetX !== previous.screenshot.offsetX || offsetY !== previous.screenshot.offsetY || rotation !== previous.screenshot.rotation;
  const placement = useImageStore.getState().mainImagePlacement;
  const nextPlacement = { offsetX, offsetY, rotation };
  const placementNeedsSync = placement.offsetX !== offsetX || placement.offsetY !== offsetY || placement.rotation !== rotation;
  const imageState = useImageStore.getState();
  const editorSnapshot = snapshotEditorStore(state);
  const snapshotChanged = !editorSnapshotsEqual(imageState.editorSnapshot, editorSnapshot);
  if (placementChanged || placementNeedsSync || snapshotChanged) {
    useImageStore.setState({
      ...(placementNeedsSync ? { mainImagePlacement: nextPlacement } : {}),
      ...(snapshotChanged ? { editorSnapshot } : {}),
    });
  }
});
useImageStore.subscribe((state, previous) => {
  if (state.editorSnapshot === previous.editorSnapshot) return;
  syncingEditorStoreFromImage = true;
  try {
    useEditorStore.setState(state.editorSnapshot);
  } finally {
    syncingEditorStoreFromImage = false;
  }
});
useImageStore.subscribe((state, previous) => {
  if (state.mainImagePlacement !== previous.mainImagePlacement) {
    const screenshot = useEditorStore.getState().screenshot;
    syncingEditorStoreFromImage = true;
    try {
      useEditorStore.setState({ screenshot: { ...screenshot, ...state.mainImagePlacement } });
    } finally {
      syncingEditorStoreFromImage = false;
    }
  }
});
