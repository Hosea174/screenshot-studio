// Easing function types
export type EasingPreset =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'ease-in-cubic'
  | 'ease-out-cubic'
  | 'ease-in-expo'
  | 'ease-out-expo'
  | 'ease-in-out-cubic'
  | 'ease-in-out-sine'
  | 'ease-out-quint'
  | 'ease-out-back'
  | 'ease-out-elastic'
  | 'hold';
export type EasingFunction = EasingPreset | `cubic-bezier(${number},${number},${number},${number})`;

// Properties that can be animated over time
export interface AnimatableProperties {
  perspective: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  translateX: number;
  translateY: number;
  scale: number;
  imageOpacity: number;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  cameraRotateX: number;
  cameraRotateY: number;
  cameraRotateZ: number;
}

// Default values for animatable properties
export const DEFAULT_ANIMATABLE_PROPERTIES: AnimatableProperties = {
  perspective: 2400,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  translateX: 0,
  translateY: 0,
  scale: 1,
  imageOpacity: 1,
  cameraX: 0,
  cameraY: 0,
  cameraZoom: 1,
  cameraRotateX: 0,
  cameraRotateY: 0,
  cameraRotateZ: 0,
};

// A keyframe represents a specific state at a point in time
export interface Keyframe {
  id: string;
  time: number; // milliseconds from start
  properties: Partial<AnimatableProperties>;
  /** A discrete CSS clip-path value, sampled from the latest keyframe. */
  clipMask?: string;
  easing: EasingFunction;
}

// Track types for different property groups
export type AnimationTrackType = 'transform' | 'opacity' | 'camera';

// A track contains keyframes for a specific group of properties
export interface AnimationTrack {
  id: string;
  name: string;
  type: AnimationTrackType;
  keyframes: Keyframe[];
  isLocked: boolean;
  isVisible: boolean;
  clipId?: string; // Links this track to an animation clip
  originalDuration?: number; // Original preset duration for scaling
}

// The overall timeline state
export interface TimelineState {
  duration: number; // total duration in milliseconds
  playhead: number; // current position in milliseconds
  isPlaying: boolean;
  isLooping: boolean;
  tracks: AnimationTrack[];
  zoom: number; // zoom level for timeline UI (1 = 100%)
  snapToKeyframes: boolean;
}

// Default timeline state
export const DEFAULT_TIMELINE_STATE: TimelineState = {
  duration: 3000, // 3 seconds default
  playhead: 0,
  isPlaying: false,
  isLooping: true,
  tracks: [],
  zoom: 1,
  snapToKeyframes: true,
};

// Animation preset definition
export interface AnimationPreset {
  transition?: AnimationClip['transition'];
  id: string;
  name: string;
  description: string;
  category: AnimationPresetCategory;
  duration: number; // in milliseconds
  tracks: AnimationTrack[];
  thumbnail?: string; // optional thumbnail URL
}

// Categories for organizing presets
export type AnimationPresetCategory =
  | 'reveal'
  | 'slide'
  | 'fade'
  | 'flip'
  | 'perspective'
  | 'orbit'
  | 'depth'
  | 'kenburns'
  | 'effects'
  | 'bounce';

// Helper type for creating keyframes with partial properties
export type KeyframeInput = Omit<Keyframe, 'id'>;

// Helper type for creating tracks with partial properties
export type AnimationTrackInput = Omit<AnimationTrack, 'id'>;

// Animation clip on the timeline (visual representation)
export interface AnimationClip {
  target?: string; // 'asset' (default), or an image/video layer id
  id: string;
  presetId: string;
  name: string;
  startTime: number; // milliseconds
  duration: number; // milliseconds
  color: string;
  transition?: {
    type: 'blend' | 'fade' | 'slide' | 'zoom';
    duration: number;
    easing: EasingFunction;
  };
}
