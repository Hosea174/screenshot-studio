# Motion editor

## Create and edit motion

1. Select a layer on the canvas and choose **New animation**. A new custom clip captures its initial pose and is appended after the target's existing animations. Alternatively, hover a preset to preview it, then click it to add an editable clip.
2. Select the clip in the timeline. Choose **Animation target** to animate the main asset/mockup or a custom image/video layer.
3. Use **Before** and **After**, or scrub the ruler, to set the playhead. Canvas gestures and numeric pose fields preview changes. Choose **Set keyframe** (K) to capture the pose, or a property's diamond to capture only that property. Selecting an existing diamond exposes its exact time, value and easing for direct editing.
4. Expand the clip's property lanes. Drag a diamond to change its time; select one to edit its value, time, and incoming easing. Without a selected diamond, the easing menu applies to all unlocked segments in the clip. Each property lane has visibility and lock controls. A hidden track stops contributing to interpolation; a locked track protects its keyframes from editing.
5. Drag the clip body to move it, or its edges to stretch its duration. Keyframe times follow clip retiming. Snap aligns timing to available keyframe/clip boundaries; hold **Alt** while dragging to bypass it. A completed drag is grouped into one undo step. Timeline zoom changes the editing scale.
6. Choose **Transition from previous animation** and its duration to connect motion clips. Options are Cut, Smooth blend, Fade through transparent, Slide, and Zoom. These transitions connect animation states; they are not video-source editing transitions.
7. Enter a preset name and choose **Save**. The result appears in **My presets** and can be reused or deleted there. Presets store motion tracks and transition settings, with times relative to the saved clip.

Position X/Y keyframes use percentages; tilt and rotation use degrees. Scale is a multiplier; opacity runs from 0 to 1. Perspective uses pixels.

## Keyboard controls

Shortcuts operate while the timeline is open and yield to text entry and other editable controls.

| Key | Action |
| --- | --- |
| Space | Play or pause |
| K | Capture the selected clip's pose at the playhead |
| Left / Right | Step one frame |
| Shift + Left / Right | Step ten frames |
| Home / End | Jump to timeline start / end |
| Delete / Backspace | Remove the selected property keyframe, or the clip if no keyframe is selected |
| Escape | Discard the pose preview and clear keyframe selection |
| Alt during drag | Bypass timing snap |

Deleting a diamond removes only its selected property. Locked tracks reject keyframe changes. Selecting a keyframe moves the playhead to its time; the inspector then edits that keyframe.

## Video and appearance

Drop a browser-decodable MP4, WebM, or MOV onto the canvas, use the empty canvas file picker, or upload through Media layers to add a video layer. Select it and use its Depth controls for **Start on timeline**, **Trim in**, **Speed**, and **Loop video**. Trim-in skips the beginning of the source; there is no separate trim-out field. Playback is muted, and export does not mix source audio. Loop repeats the remaining source interval after trim-in; without loop, its source time clamps at the end.

Video preview draws decoded frames onto a source canvas. Frame rendering awaits video seeking before capturing those canvas pixels, so exported frames use the source image at the requested timeline time. Codec support depends on the browser and export encoder. Uploaded video sources are autosaved with their editor project in local browser storage; saving a motion preset does not include the video file.

Use the overlay opacity controls for light/shadow overlays, the Background controls for hue/saturation/lightness, and the shared Shadow adjustments for direction, distance, opacity, softness, and spread. These appearance controls complement motion; they are not additional timeline keyframe properties.

## Implementation map

- `components/timeline/TimelineEditor.tsx`: clip and property lanes, drag gestures, snapping, ruler, and shortcuts.
- `components/timeline/MotionInspector.tsx`: numeric pose previews, explicit capture, targets, easing, transitions, and preset saving.
- `components/timeline/NumberField.tsx`: editable numeric drafts and commits on Enter or blur.
- `lib/animation/authoring.ts`: transient poses, property capture, and grouped pose capture history.
- `components/timeline/AnimationPresetGallery.tsx`: built-in and saved preset gallery and previews.
- `lib/animation/editor.ts`: property definitions, property-track splitting, selection, and persisted motion library (`screenshot-studio-motion-library`).
- `lib/animation/interpolation.ts`, `retiming.ts`, `playback.ts`, and `drag-history.ts`: animation evaluation, timing changes, playback, and grouped gesture history.
- `lib/store.ts` and `types/animation.ts`: composition state and motion data contracts. Timeline times are milliseconds; video source duration and trim-in are seconds.
- `lib/video-layers.ts`: video metadata/poster loading, source-time mapping, decoded-frame seeking, and canvas drawing.
- `lib/render-slideFrame.ts`: shared composition frame rendering and video synchronization before capture.
- `components/controls/ShadowAdjustments.tsx`: shared main-asset and media-layer shadow controls.

## Development

Run from the project root after installing dependencies and configuring the project's environment:

```sh
npm run dev
npm test
npx tsc --noEmit
npm run build
npm run lint
```

With the dev server running on port 3000, `npm run test:browser` checks the motion controls and decodes downloaded video exports in Chrome. Set `STUDIO_URL` to use another server URL.

`dev` and `build` generate the Prisma client before starting Next.js. The test command runs `tests/*.test.ts` through `tsx`. These commands describe the available workflow; this document is not a verification report.

The UI inherits semantic colors from `app/globals.css` and the existing application font setup in `app/layout.tsx`. Timeline and inspector controls use the same compact borders, muted labels, small rounded shapes, and focus rings as the incumbent editor. Keep future changes within that system unless a visual redesign is explicitly approved.


## Canvas pose workflow

1. Select an image or video layer on the canvas and choose **New animation**. New custom animations capture the initial pose only.
2. Move the playhead to a new time, then drag, resize or rotate the layer. Numeric pose fields also preview a change.
3. Choose **Set keyframe** (K) to capture the pose. The timeline shows **Pose preview · not saved** until capture. Seeking, playing, switching clips or resetting the pose discards the preview.
4. Select a diamond to edit its exact time, value and easing in the fixed keyframe panel. Drag to retime; arrow keys nudge a focused diamond by one frame, or ten with Shift. Hold Alt to bypass snapping.

The timeline's upper divider resizes the panel. **Fit** shows the complete duration; previous/next keyframe buttons jump between authored poses. Number fields commit on Enter or blur so intermediate input remains editable. New properties receive an initial key when needed, without an automatic end key. Capturing a pose is one undo step.
