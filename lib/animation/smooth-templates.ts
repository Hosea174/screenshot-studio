import type { AnimatableProperties, EasingFunction } from '@/types/animation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';
import type { AnimatedTemplate } from './templates';

type Pose = Partial<AnimatableProperties>;
const key = (time: number, pose: Pose = {}, easing: EasingFunction = 'ease-in-out-cubic'): AnimatedTemplate['keyframes'][number] => ({
  time,
  properties: { ...DEFAULT_ANIMATABLE_PROPERTIES, perspective: 2200, ...pose },
  easing,
});

function smooth(
  id: string,
  name: string,
  description: string,
  duration: number,
  posterTime: number,
  animationPresetId: string,
  keyframes: AnimatedTemplate['keyframes'],
): AnimatedTemplate {
  return {
    id, name, description, duration, posterTime, animationPresetId, keyframes,
    category: 'smooth',
    visualPresetId: 'template-midnight-focus',
    accent: 'var(--chart-2)',
  };
}

/** Calm, continuous motion designed to keep SaaS screens readable in portrait video. */
export const SMOOTH_TEMPLATES: AnimatedTemplate[] = [
  smooth('smooth-cascade', 'Smooth Cascade', 'Your original fade, deep tilt, and diagonal glide, tuned for the portrait stage.', 2978, 2367, 'fade-zoom-out', [
    key(0, { translateX: -30.2, translateY: 39.9, scale: 1.64, rotateX: 23.263, rotateY: 26.937, rotateZ: -15, perspective: 2400, imageOpacity: 0 }),
    { time: 1483, properties: { imageOpacity: 1 }, easing: 'ease-in-out-cubic' },
    key(2817, { translateX: -8.5, translateY: -4.8, scale: 1.26, rotateX: 11.186, rotateY: -12.597, rotateZ: 20, perspective: 300, imageOpacity: 1 }),
    key(2978, { translateX: -8.5, translateY: -4.8, scale: 1.26, rotateX: 11.186, rotateY: -12.597, rotateZ: 20, perspective: 300, imageOpacity: 1 }, 'linear'),
  ]),
];
