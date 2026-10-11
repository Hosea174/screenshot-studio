import type {
  EasingFunction,
  EasingPreset,
  AnimatableProperties,
  AnimationTrack,
  AnimationClip,
  Keyframe,
} from '@/types/animation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';

// Easing functions - take progress (0-1) and return eased progress (0-1)
export const easingFunctions: Record<EasingPreset, (t: number) => number> = {
  linear: (t) => t,
  hold: (t) => t === 1 ? 1 : 0,
  'ease-in-out-cubic': (t) => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
  'ease-in-out-sine': (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  'ease-out-quint': (t) => 1 - (1 - t) ** 5,
  'ease-out-back': (t) => t === 0 || t === 1 ? t : 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  'ease-out-elastic': (t) => t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1,

  'ease-in': (t) => t * t,

  'ease-out': (t) => 1 - (1 - t) * (1 - t),

  'ease-in-out': (t) => {
    return t < 0.5
      ? 2 * t * t
      : 1 - Math.pow(-2 * t + 2, 2) / 2;
  },

  'ease-in-cubic': (t) => t * t * t,

  'ease-out-cubic': (t) => 1 - Math.pow(1 - t, 3),

  'ease-in-expo': (t) => {
    return t === 0 ? 0 : Math.pow(2, 10 * t - 10);
  },

  'ease-out-expo': (t) => {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  },
};

function cubicBezierCoordinate(t: number, a: number, b: number) {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * a + 3 * inverse * t * t * b + t * t * t;
}

/**
 * Apply easing function to get interpolated value
 */
export function applyEasing(
  progress: number,
  easing: EasingFunction
): number {
  const boundedProgress = Math.max(0, Math.min(1, progress));
  if (boundedProgress === 0 || boundedProgress === 1) return boundedProgress;
  if (easing.startsWith('cubic-bezier(')) {
    const values = easing.slice(13, -1).split(',').map(Number);
    if (values.length === 4 && values.every(Number.isFinite)) {
      const [rawX1, y1, rawX2, y2] = values;
      const x1 = Math.max(0, Math.min(1, rawX1));
      const x2 = Math.max(0, Math.min(1, rawX2));
      let low = 0;
      let high = 1;
      for (let i = 0; i < 18; i++) {
        const mid = (low + high) / 2;
        if (cubicBezierCoordinate(mid, x1, x2) < boundedProgress) low = mid;
        else high = mid;
      }
      return cubicBezierCoordinate((low + high) / 2, y1, y2);
    }
  }
  const easingFn = easingFunctions[easing as EasingPreset] || easingFunctions.linear;
  return easingFn(boundedProgress);
}

/** Matching clip-path shapes interpolate; incompatible shapes switch at their keyframe. */
export function getClipMaskAtTime(clips: AnimationClip[], tracks: AnimationTrack[], time: number, target = 'asset'): string | undefined {
  let clipMask: string | undefined;
  for (const clip of clips.filter(c => (c.target ?? 'asset') === target).sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id))) {
    if (time < clip.startTime) continue;
    const keys = tracks.filter(t => t.clipId === clip.id && t.isVisible).flatMap(t => t.keyframes.filter(k => k.clipMask !== undefined)).sort((a, b) => a.time - b.time);
    const prev = keys.filter(k => k.time <= time).at(-1);
    const next = keys.find(k => k.time > time);
    if (!prev) continue;
    clipMask = prev.clipMask;
    if (!next || !prev.clipMask || !next.clipMask) continue;
    const numberPattern = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi;
    const from = [...prev.clipMask.matchAll(numberPattern)];
    const to = [...next.clipMask.matchAll(numberPattern)];
    const shapeFrom = prev.clipMask.replace(numberPattern, '#');
    const shapeTo = next.clipMask.replace(numberPattern, '#');
    if (shapeFrom !== shapeTo || from.length !== to.length || next.time <= prev.time) continue;
    const progress = applyEasing((time - prev.time) / (next.time - prev.time), next.easing);
    let index = 0;
    clipMask = prev.clipMask.replace(numberPattern, () => {
      const a = Number(from[index][0]);
      const b = Number(to[index++][0]);
      return String(Number((a + (b - a) * progress).toFixed(3)));
    });
  }
  return clipMask;
}

/**
 * Linearly interpolate between two values
 */
export function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

/**
 * Find the two keyframes that surround the given time
 */
export function findSurroundingKeyframes(
  keyframes: Keyframe[],
  time: number
): { prev: Keyframe | null; next: Keyframe | null } {
  if (keyframes.length === 0) {
    return { prev: null, next: null };
  }

  // Sort keyframes by time
  const sorted = [...new Map(keyframes.map(k => [k.time, k])).values()].sort((a, b) => a.time - b.time);

  // Find surrounding keyframes
  let prev: Keyframe | null = null;
  let next: Keyframe | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const kf = sorted[i];
    if (kf.time <= time) {
      prev = kf;
    }
    if (kf.time >= time && next === null) {
      next = kf;
    }
  }

  return { prev, next };
}

/**
 * Get interpolated value for a single property from a track at a given time
 */
export function getInterpolatedProperty<K extends keyof AnimatableProperties>(
  track: AnimationTrack,
  time: number,
  propertyKey: K,
  defaultValue: AnimatableProperties[K]
): AnimatableProperties[K] {
  const { prev, next } = findSurroundingKeyframes(track.keyframes.filter(kf => kf.properties[propertyKey] !== undefined), time);

  // No keyframes
  if (!prev && !next) {
    return defaultValue;
  }

  // Before first keyframe
  if (!prev && next) {
    return next.properties[propertyKey] ?? defaultValue;
  }

  // After last keyframe or at/past last keyframe
  if (prev && !next) {
    return prev.properties[propertyKey] ?? defaultValue;
  }

  // Between two keyframes
  if (prev && next) {
    // Same keyframe (at exact time)
    if (prev.id === next.id) {
      return prev.properties[propertyKey] ?? defaultValue;
    }

    const prevValue = prev.properties[propertyKey] ?? defaultValue;
    const nextValue = next.properties[propertyKey] ?? defaultValue;

    // Calculate progress between keyframes
    const duration = next.time - prev.time;
    const elapsed = time - prev.time;
    const rawProgress = duration > 0 ? elapsed / duration : 1;

    // Apply easing (use next keyframe's easing)
    const easedProgress = applyEasing(rawProgress, next.easing);

    // Interpolate
    return lerp(prevValue as number, nextValue as number, easedProgress) as AnimatableProperties[K];
  }

  return defaultValue;
}

/**
 * Get all interpolated properties from all tracks at a given time
 * @deprecated Use getClipInterpolatedProperties for clip-aware animation
 */
export function getInterpolatedProperties(
  tracks: AnimationTrack[],
  time: number,
  defaults: AnimatableProperties = DEFAULT_ANIMATABLE_PROPERTIES
): AnimatableProperties {
  const result: AnimatableProperties = { ...defaults };

  for (const track of tracks) {
    if (!track.isVisible) continue;

    // Get all properties from this track's keyframes
    const propertyKeys = new Set<keyof AnimatableProperties>();
    for (const kf of track.keyframes) {
      for (const key of Object.keys(kf.properties) as Array<keyof AnimatableProperties>) {
        propertyKeys.add(key);
      }
    }

    // Interpolate each property
    for (const key of propertyKeys) {
      result[key] = getInterpolatedProperty(track, time, key, defaults[key]);
    }
  }

  return result;
}

/**
 * Get interpolated properties for a single clip's tracks at a given local time
 * This handles time relative to the clip's start
 */
export function getClipLocalInterpolatedProperties(
  clipTracks: AnimationTrack[],
  localTime: number,
  originalDuration: number,
  clipDuration: number,
  defaults: AnimatableProperties
): AnimatableProperties {
  const result: AnimatableProperties = { ...defaults };

  // Calculate time scale factor for stretched/compressed clips
  const timeScale = originalDuration > 0 ? originalDuration / clipDuration : 1;
  const scaledTime = localTime * timeScale;

  for (const track of clipTracks) {
    if (!track.isVisible) continue;

    // Get all properties from this track's keyframes
    const propertyKeys = new Set<keyof AnimatableProperties>();
    for (const kf of track.keyframes) {
      for (const key of Object.keys(kf.properties) as Array<keyof AnimatableProperties>) {
        propertyKeys.add(key);
      }
    }

    // Interpolate each property using scaled time
    for (const key of propertyKeys) {
      result[key] = getInterpolatedProperty(track, scaledTime, key, defaults[key]);
    }
  }

  return result;
}

/**
 * Get interpolated properties considering clips and their time ranges
 * This is the main function for animation playback with multiple clips
 *
 * When clips overlap, properties are determined by the clip that started most recently
 * (last-in takes precedence). This allows for smooth transitions between animations.
 *
 * When no clips are active (before first clip or after last clip ends),
 * properties hold at the last known keyframe value for smooth transitions.
 */
export function getClipInterpolatedProperties(
  clips: AnimationClip[],
  tracks: AnimationTrack[],
  time: number,
  defaults: AnimatableProperties = DEFAULT_ANIMATABLE_PROPERTIES,
  target: string = 'asset'
): AnimatableProperties {
  // Keyframe times are absolute timeline milliseconds, including moved/stretched clips.
  // Evaluate each property independently so sparse keys and hidden tracks cannot reset it.
  const result = getInterpolatedProperties(tracks.filter(t => !t.clipId && target === 'asset'), time, defaults);
  const ordered = clips.filter(c => (c.target ?? 'asset') === target).sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  for (const clip of ordered) {
    if (time < clip.startTime) continue;
    const clipTracks = tracks.filter(t => t.clipId === clip.id && t.isVisible);
    const sampleTime = Math.min(time, clip.startTime + clip.duration);
    const before = { ...result };
    const next = getInterpolatedProperties(clipTracks, sampleTime, before);
    const transition = clip.transition;
    if (transition && time < clip.startTime + Math.min(transition.duration, clip.duration)) {
      const length = Math.max(1, Math.min(transition.duration, clip.duration));
      const progress = Math.max(0, Math.min(1, (time - clip.startTime) / length));
      const eased = applyEasing(progress, transition.easing);
      for (const key of Object.keys(next) as (keyof AnimatableProperties)[]) {
        result[key] = lerp(before[key], next[key], eased);
      }
      if (transition.type === 'fade') result.imageOpacity *= Math.abs(2 * progress - 1);
      if (transition.type === 'slide') result.translateX += (1 - eased) * 20;
      if (transition.type === 'zoom') result.scale *= 0.8 + 0.2 * eased;
    } else Object.assign(result, next);
  }
  result.scale = Math.max(0.01, result.scale);
  result.cameraZoom = Math.max(0.01, result.cameraZoom);
  result.perspective = Math.max(100, result.perspective);
  result.imageOpacity = Math.max(0, Math.min(1, result.imageOpacity));
  return result;
}

/**
 * Get the property value at the nearest keyframe to a given time
 */
export function getKeyframeValueAtTime<K extends keyof AnimatableProperties>(
  track: AnimationTrack,
  time: number,
  propertyKey: K,
  defaultValue: AnimatableProperties[K]
): AnimatableProperties[K] {
  const { prev, next } = findSurroundingKeyframes(track.keyframes.filter(kf => kf.properties[propertyKey] !== undefined), time);

  if (!prev && !next) return defaultValue;
  if (!prev) return next!.properties[propertyKey] ?? defaultValue;
  if (!next) return prev.properties[propertyKey] ?? defaultValue;

  // Return the closest one
  const prevDist = Math.abs(time - prev.time);
  const nextDist = Math.abs(time - next.time);

  const closest = prevDist <= nextDist ? prev : next;
  return closest.properties[propertyKey] ?? defaultValue;
}

/**
 * Check if a time position is at or very close to a keyframe
 */
export function isAtKeyframe(
  keyframes: Keyframe[],
  time: number,
  threshold: number = 50 // 50ms threshold
): Keyframe | null {
  for (const kf of keyframes) {
    if (Math.abs(kf.time - time) <= threshold) {
      return kf;
    }
  }
  return null;
}

/**
 * Snap time to nearest keyframe if within threshold
 */
export function snapToKeyframe(
  keyframes: Keyframe[],
  time: number,
  threshold: number = 50
): number {
  const nearestKf = isAtKeyframe(keyframes, time, threshold);
  return nearestKf ? nearestKf.time : time;
}

/**
 * Get all keyframe times from all tracks (for snapping)
 */
export function getAllKeyframeTimes(tracks: AnimationTrack[]): number[] {
  const times = new Set<number>();
  for (const track of tracks) {
    for (const kf of track.keyframes) {
      times.add(kf.time);
    }
  }
  return Array.from(times).sort((a, b) => a - b);
}
