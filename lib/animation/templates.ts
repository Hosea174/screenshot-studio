import type {
  AnimatableProperties,
  AnimationClip,
  AnimationTrack,
  EasingFunction,
} from '@/types/animation';
import { getPresetById } from './presets';
import { CINEMATIC_TEMPLATES } from './cinematic-templates';
import { SMOOTH_TEMPLATES } from './smooth-templates';

export type AnimatedTemplateCategory = 'cinematic' | 'smooth' | 'reveals' | 'camera-moves';

export interface AnimatedTemplate {
  id: string;
  name: string;
  description: string;
  category: AnimatedTemplateCategory;
  visualPresetId: string;
  animationPresetId: string;
  imageStylePreset?: 'default';
  duration: number;
  accent: string;
  /** A fully revealed, readable frame for inactive and reduced-motion previews. */
  posterTime?: number;
  keyframes: Array<{
    time: number;
    properties: Partial<AnimatableProperties>;
    easing: EasingFunction;
    clipMask?: string;
  }>;
}

export interface AnimatedTemplateTimeline {
  clip: AnimationClip;
  tracks: AnimationTrack[];
  duration: number;
}

export const ANIMATED_TEMPLATE_CATEGORY_LABELS: Record<AnimatedTemplateCategory, string> = {
  cinematic: 'Cinematic',
  smooth: 'Smooth',
  reveals: 'Reveals',
  'camera-moves': 'Camera moves',
};

export const ANIMATED_TEMPLATES: AnimatedTemplate[] = [
  ...CINEMATIC_TEMPLATES,
  ...SMOOTH_TEMPLATES,
];

export function getAnimatedTemplateById(id: string): AnimatedTemplate | undefined {
  return ANIMATED_TEMPLATES.find((template) => template.id === id);
}

export function buildAnimatedTemplateTimeline(
  template: AnimatedTemplate,
  uniqueToken = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
): AnimatedTemplateTimeline | null {
  const preset = getPresetById(template.animationPresetId);
  if (!preset) return null;

  const clipId = `template-clip-${template.id}-${uniqueToken}`;
  const clip: AnimationClip = {
    id: clipId,
    presetId: preset.id,
    name: template.name,
    startTime: 0,
    duration: template.duration,
    color: template.accent,
  };

  const transformTrack: AnimationTrack = {
    id: `template-transform-${uniqueToken}`,
    name: `${template.name} motion`,
    type: 'transform',
    clipId,
    originalDuration: template.duration,
    isLocked: false,
    isVisible: true,
    keyframes: template.keyframes.map((keyframe, index) => {
      const { perspective, rotateX, rotateY, rotateZ, translateX, translateY, scale } = keyframe.properties;
      const properties = Object.fromEntries(
        Object.entries({ perspective, rotateX, rotateY, rotateZ, translateX, translateY, scale })
          .filter(([, value]) => value !== undefined),
      ) as Partial<AnimatableProperties>;
      return {
        id: `template-transform-kf-${uniqueToken}-${index}`,
        time: keyframe.time,
        properties,
        easing: keyframe.easing,
      };
    }),
  };
  const opacityTrack: AnimationTrack = {
    id: `template-opacity-${uniqueToken}`,
    name: `${template.name} opacity`,
    type: 'opacity',
    clipId,
    originalDuration: template.duration,
    isLocked: false,
    isVisible: true,
    keyframes: template.keyframes.flatMap((keyframe, index) => keyframe.properties.imageOpacity === undefined ? [] : [{
      id: `template-opacity-kf-${uniqueToken}-${index}`,
      time: keyframe.time,
      properties: { imageOpacity: keyframe.properties.imageOpacity },
      easing: keyframe.easing,
    }]),
  };

  const maskKeys = template.keyframes.filter((keyframe) => keyframe.clipMask !== undefined);
  const maskTracks: AnimationTrack[] = maskKeys.length ? [{
    id: `template-mask-${uniqueToken}`,
    name: `${template.name} reveal`,
    type: 'transform',
    clipId,
    originalDuration: template.duration,
    isLocked: false,
    isVisible: true,
    keyframes: maskKeys.map((keyframe, index) => ({
      id: `template-mask-kf-${uniqueToken}-${index}`,
      time: keyframe.time,
      properties: {},
      clipMask: keyframe.clipMask,
      easing: keyframe.easing,
    })),
  }] : [];

  return {
    clip,
    tracks: [transformTrack, opacityTrack, ...maskTracks],
    duration: template.duration,
  };
}
