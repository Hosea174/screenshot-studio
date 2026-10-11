import { useImageStore } from '@/lib/store';
import type { AnimatableProperties, EasingFunction } from '@/types/animation';

export const KEYFRAME_SNAP_THRESHOLD = 60;
export const DEFAULT_KEYFRAME_EASING: EasingFunction = 'ease-in-out-cubic';

export function recordPropertyChange<K extends keyof AnimatableProperties>(
  property: K,
  value: AnimatableProperties[K],
  easing: EasingFunction = DEFAULT_KEYFRAME_EASING
): boolean {
  return useImageStore.getState().recordPropertyChange(property, value, easing);
}

export function recordPropertyChanges(
  properties: Partial<AnimatableProperties>,
  easing: EasingFunction = DEFAULT_KEYFRAME_EASING
): void {
  useImageStore.getState().recordPropertyChanges(properties, easing);
}
