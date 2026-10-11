import type { EasingFunction } from '@/types/animation';
import { DEFAULT_ANIMATABLE_PROPERTIES } from '@/types/animation';
import type { AnimatedTemplate } from './templates';

export const CINEMATIC_READING_WIDTH = 88;

/** Canvas padding is zero for these scenes; compensate for the frame's inset. */
export function getCinematicImageScale(
  frame: { enabled: boolean; type: string; padding?: number },
  canvasWidth = 450,
): number {
  if (!frame.enabled || frame.type === 'none') return CINEMATIC_READING_WIDTH;
  if (frame.type === 'photograph') return (0.88 * canvasWidth - 16) / (0.88 * canvasWidth) * 100;
  const styleFrame = ['glass-light', 'glass-dark', 'outline-light', 'border-light', 'border-dark'].includes(frame.type);
  return styleFrame ? 100 / (1 + 2 * (frame.padding ?? 2) / 100) : 100;
}

/** Every spatial pose is explicit; opacity has an independent rhythm. */
type Pose = [x: number, y: number, zoom: number, tiltX: number, tiltY: number, roll: number, depth: number];
const key = (time: number, [translateX, translateY, scale, rotateX, rotateY, rotateZ, perspective]: Pose,
  easing: EasingFunction = 'cubic-bezier(0.42, 0, 0.32, 1)'): AnimatedTemplate['keyframes'][number] => ({
  time, properties: { translateX, translateY, scale, rotateX, rotateY, rotateZ, perspective }, easing,
});

function shot(id: string, name: string, description: string, duration: number, posterTime: number,
  poses: AnimatedTemplate['keyframes']): AnimatedTemplate {
  return {
    id, name, description, duration, posterTime, category: 'cinematic',
    visualPresetId: 'template-midnight-focus', animationPresetId: 'fade-zoom-out', accent: '#c9ff2e',
    keyframes: [
      { ...poses[0], properties: { ...DEFAULT_ANIMATABLE_PROPERTIES, ...poses[0].properties, imageOpacity: 0 } },
      { time: 520, properties: { imageOpacity: 1 }, easing: 'ease-in-out-sine' as const },
      ...poses.slice(1),
      { time: duration, properties: { imageOpacity: 1 }, easing: 'linear' as const },
    ].sort((a, b) => a.time - b.time).reduce<AnimatedTemplate['keyframes']>((keys, frame) => {
      const previous = keys.at(-1);
      if (previous?.time === frame.time) previous.properties = { ...previous.properties, ...frame.properties };
      else keys.push(frame);
      return keys;
    }, []),
  };
}

/** Bespoke detail studies: intentional cropping, evolving depth, no parked hero holds.
 * Positions use canvas percentages. Depth stays clear of the perspective projection plane.
 * Split curves retain velocity across the middle of multi-part passes.
 */
export const CINEMATIC_TEMPLATES: AnimatedTemplate[] = [
  shot('detail-current', 'Detail Current', 'Travel across an enlarged interface as its near edge changes sides.', 4200, 2600, [
    key(0, [-42, 10, 2.35, 9, -22, -9, 2200]),
    key(4200, [38, -9, 1.72, -7, 19, 8, 850]),
  ]),
  shot('depth-bloom', 'Depth Bloom', 'Begin with the whole screen, then grow into an immersive angled detail.', 3600, 2400, [
    key(0, [7, 9, 1.12, 18, -15, -11, 2400]),
    key(3600, [-22, -12, 2.45, -9, 15, 9, 1050]),
  ]),
  shot('reverse-aperture', 'Reverse Aperture', 'An extreme detail opens outward while the screen rolls into a sculpted wide view.', 4000, 3100, [
    key(0, [34, -17, 2.65, -12, 18, 14, 1800]),
    key(4000, [-5, 6, 1.18, 17, -17, -12, 700]),
  ]),
  shot('meridian', 'Meridian', 'Trace the interface vertically, tightening the lens as the surface tilts toward you.', 4600, 3000, [
    key(0, [-9, 24, 1.75, 22, 8, -6, 2600]),
    key(4600, [12, -22, 2.3, -19, -12, 10, 1000]),
  ]),
  shot('velvet-bank', 'Velvet Bank', 'A broad rolling bank carries a close screen through a changing diagonal silhouette.', 3800, 2700, [
    key(0, [-20, 17, 2.05, 14, -15, -26, 2100]),
    key(3800, [18, -12, 1.32, -10, 18, 24, 750]),
  ]),
  shot('lens-tide', 'Lens Tide', 'Pull back to reveal context, then return into a different enlarged detail.', 5000, 3200, [
    key(0, [-26, -8, 2.4, -8, -18, -12, 1900]),
    key(2300, [0, 6, 1.22, 15, 3, 5, 850], 'cubic-bezier(0.35, 0, 0.65, 1)'),
    key(5000, [28, -13, 2.1, -12, 20, 13, 1700], 'cubic-bezier(0.35, 0, 0.45, 1)'),
  ]),
  shot('oblique-study', 'Oblique Study', 'A magnified diagonal scan trades scale for increasingly pronounced perspective.', 4400, 2900, [
    key(0, [32, 20, 2.55, 17, 20, 11, 2800]),
    key(4400, [-26, -15, 1.62, -15, -21, -10, 800]),
  ]),
  shot('ribbon-flight', 'Ribbon Flight', 'Follow a curving close pass through three connected, progressively deeper compositions.', 4800, 3400, [
    key(0, [-35, 19, 2.05, 20, 20, -18, 2400]),
    key(2100, [-4, -6, 1.48, 7, -2, -3, 1600], 'cubic-bezier(0.4, 0, 0.65, 0.7)'),
    key(4800, [28, -15, 1.9, -13, -23, 16, 900], 'cubic-bezier(0.3, 0.3, 0.45, 1)'),
  ]),
  shot('near-field', 'Near Field', 'Push into the screen while counter-rotating its surface for an intimate detail finish.', 3200, 2200, [
    key(0, [-10, 5, 1.3, -15, 24, 13, 800]),
    key(3200, [24, -9, 2.6, 9, -8, -5, 2400]),
  ]),
  shot('horizon-fold', 'Horizon Fold', 'Lift an enlarged surface through a deep pitch change and reveal its opposite edge.', 4100, 2800, [
    key(0, [16, 22, 2.15, 31, -12, 8, 2500]),
    key(4100, [-16, -16, 1.42, -25, 15, -14, 950]),
  ]),
];
