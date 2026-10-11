import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AnimationPreset, AnimationTrack, AnimatableProperties, EasingPreset } from '@/types/animation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';

/** Each property owns its key times, visibility and lock independently. */
export function splitPropertyTracks(tracks: AnimationTrack[]): AnimationTrack[] {
  return tracks.flatMap(track => {
    const properties: AnimationTrack[] = [...new Set(track.keyframes.flatMap(k => Object.keys(k.properties)))].map(property => {
      const key = property as keyof AnimatableProperties;
      return { ...track, id: crypto.randomUUID(), name: PROPERTY_CONTROLS.find(p => p.key === key)?.label ?? property,
        keyframes: track.keyframes.filter(k => key in k.properties).map(k => ({ ...k, id: crypto.randomUUID(), properties: { [key]: k.properties[key] } })) };
    });
    const maskKeys = track.keyframes.filter(k => k.clipMask !== undefined);
    if (!maskKeys.length) return properties;
    const maskTrack: AnimationTrack = { ...track, id: crypto.randomUUID(), name: 'Clip mask', keyframes: maskKeys.map(k => ({ ...k, id: crypto.randomUUID(), properties: {} })) };
    return [...properties, maskTrack];
  });
}

export function createCustomPreset(group: 'asset' | 'camera', state: AnimatableProperties = DEFAULT_ANIMATABLE_PROPERTIES): AnimationPreset {
  const properties = Object.fromEntries(PROPERTY_CONTROLS.filter(p => p.group === group).map(p => [p.key, state[p.key]]));
  return { id: `custom-${group}`, name: group === 'camera' ? 'Camera move' : 'Custom animation', description: 'Your editable before and after states', category: 'effects', duration: 2000,
    tracks: [{ id: 'custom-track', name: group === 'camera' ? 'Camera' : 'Asset', type: group === 'camera' ? 'camera' : 'transform', isLocked: false, isVisible: true,
      keyframes: [
        { id: 'before', time: 0, properties, easing: 'ease-in-out-cubic' },
        { id: 'after', time: 2000, properties: { ...properties, ...(group === 'camera' ? { cameraZoom: state.cameraZoom * 1.15 } : { scale: state.scale * 1.15 }) }, easing: 'ease-in-out-cubic' },
      ] }],
  };
}

export const PROPERTY_CONTROLS: { key: keyof AnimatableProperties; label: string; min: number; max: number; step: number; unit: string; group: 'asset' | 'camera' }[] = [
  { key: 'translateX', label: 'Position X (%)', min: -200, max: 200, step: 0.1, unit: '%', group: 'asset' },
  { key: 'translateY', label: 'Position Y (%)', min: -200, max: 200, step: 0.1, unit: '%', group: 'asset' },
  { key: 'scale', label: 'Scale', min: 0.05, max: 5, step: 0.01, unit: '×', group: 'asset' },
  { key: 'rotateX', label: 'Tilt X', min: -180, max: 180, step: 1, unit: '°', group: 'asset' },
  { key: 'rotateY', label: 'Tilt Y', min: -180, max: 180, step: 1, unit: '°', group: 'asset' },
  { key: 'rotateZ', label: 'Rotation', min: -360, max: 360, step: 1, unit: '°', group: 'asset' },
  { key: 'perspective', label: 'Perspective', min: 100, max: 8000, step: 25, unit: 'px', group: 'asset' },
  { key: 'imageOpacity', label: 'Opacity', min: 0, max: 1, step: 0.01, unit: '×', group: 'asset' },
  { key: 'cameraX', label: 'Camera X', min: -1200, max: 1200, step: 1, unit: 'px', group: 'camera' },
  { key: 'cameraY', label: 'Camera Y', min: -1200, max: 1200, step: 1, unit: 'px', group: 'camera' },
  { key: 'cameraZoom', label: 'Dolly / zoom', min: 0.1, max: 4, step: 0.01, unit: '×', group: 'camera' },
  { key: 'cameraRotateX', label: 'Camera pitch', min: -80, max: 80, step: 1, unit: '°', group: 'camera' },
  { key: 'cameraRotateY', label: 'Camera yaw', min: -80, max: 80, step: 1, unit: '°', group: 'camera' },
  { key: 'cameraRotateZ', label: 'Camera roll', min: -180, max: 180, step: 1, unit: '°', group: 'camera' },
];

export const EASE_LABELS: Record<EasingPreset, string> = {
  linear: 'Linear', 'ease-in': 'Ease in', 'ease-out': 'Ease out', 'ease-in-out': 'Smooth',
  'ease-in-cubic': 'Cubic in', 'ease-out-cubic': 'Cubic out', 'ease-in-expo': 'Expo in',
  'ease-out-expo': 'Expo out', 'ease-in-out-cubic': 'Cinematic', 'ease-in-out-sine': 'Gentle',
  'ease-out-quint': 'Snappy', 'ease-out-back': 'Overshoot', 'ease-out-elastic': 'Elastic', hold: 'Hold',
};

interface MotionSelection {
  clipId: string | null;
  keyframe: { trackId: string; keyframeId: string; property: keyof AnimatableProperties | 'clipMask' } | null;
  selectClip: (id: string | null) => void;
  selectKeyframe: (keyframe: MotionSelection['keyframe']) => void;
}
export const useMotionSelection = create<MotionSelection>((set) => ({
  clipId: null, keyframe: null,
  selectClip: (clipId) => set({ clipId, keyframe: null }),
  selectKeyframe: (keyframe) => set({ keyframe }),
}));

export const useMotionLibrary = create(persist<{
  presets: AnimationPreset[];
  save: (preset: AnimationPreset) => void;
  remove: (id: string) => void;
}>((set) => ({
  presets: [],
  save: (preset) => set((s) => ({ presets: [...s.presets.filter(p => p.id !== preset.id), preset] })),
  remove: (id) => set((s) => ({ presets: s.presets.filter(p => p.id !== id) })),
}), { name: 'screenshot-studio-motion-library', version: 1 }));
