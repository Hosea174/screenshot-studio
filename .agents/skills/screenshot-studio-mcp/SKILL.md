---
name: screenshot-studio-mcp
description: Use Screenshot Studio's connected MCP to inspect, design, edit, preview, and export a complete screenshot composition, animation, slideshow, or image-tool result. Use whenever an agent should operate Screenshot Studio through MCP.
---

# Screenshot Studio MCP workflow

Use this skill whenever the user asks you to make or change work in Screenshot Studio. The MCP is connected to the live browser session, so its tools operate on the project the user has open.

## Start with the live project

1. Call `connection_status`. If there is no connected editor, open Screenshot Studio in the browser and try again.
2. Call `inspect_project` to read the canvas, active assets, layers, device mockups, background, exports, slideshow, annotations, blur regions, clips, tracks, and keyframes. Original media bytes stay in the user’s browser.
3. Call `list_capabilities` to discover current actions, their argument counts and categories, design properties, easing curves, animation templates, masks, and standalone image-tool routes. For exact positional argument types, inspect the matching action in `lib/store/index.ts`, `lib/store/device-ui.ts`, or the store named by the capability entry.
4. For controls that are specific to another page or are not in the store action catalog, call `inspect_ui`, then use `interact_ui`. This covers the same-origin app’s other pages and their accessible buttons, inputs, menus, dialogs, uploads, and tool settings. Use `navigate` to move within this app.

## Work from the brief; don’t stop at a preset

Presets and templates are references and useful starting states. They are not a finished answer unless the user explicitly asks to apply one as-is. Inspect the real screenshot, device, text, aspect ratio, and constraints first. Make a composition that fits those elements: choose a deliberate background and contrast, give the subject intentional scale and placement, preserve readable text, and avoid decorative effects that compete with the content.

For animation requests, author the actual keyframes. Choose the duration and spacing to fit the action; key every property that materially changes; set meaningful start and end values; choose or design the easing for each segment; and use clip-mask keyframes only when a shaped reveal improves the scene. Prefer a few purposeful beats to generic simultaneous movement. Use presets as a base only when you still tailor their values, timing, targets, and easing to this project. Do not create camera-motion tracks: camera animation was removed from the editor workflow. Animate the intended image, mockup, or overlay layer instead.

For slideshow and video requests, inspect slide order, durations, and animation tracks before export. For image-tool requests, use `process_images` with the matching engine (compress, convert, resize, crop, or rotate); this runs the same local browser processing pipeline as the standalone tool pages.

## Editing through the MCP

`apply_editor_action` calls named store actions. The `store` is `image`, `editor`, or `device`; `args` is an array of positional arguments. Find the action in `list_capabilities` first, pass the exact number and order of arguments, and verify the returned project state. Destructive clear/remove/reset calls require `confirmDestructive: true` and should match the user’s request.

Frequently used action signatures:

- Background and canvas: `setBackgroundConfig(config)`, `setBackgroundType(type)`, `setBackgroundValue(value)`, `setBackgroundOpacity(opacity)`, `setBackgroundBlur(blur)`, `setAspectRatio(aspectRatio)`, `setCustomDimensions(width, height)`, `setCanvasDimensions(dimensions)`.
- Main image: `setImageOpacity(opacity)`, `setImageScale(scale)`, `setImageBorder(border)`, `setImageShadow(shadow)`, `setPerspective3D(perspective)`, `setImageFilter(key, value)`, `setImageStylePreset(preset)`, `setShadowPreset(preset)`.
- Text and image layers: `addTextOverlay(overlay)`, `updateTextOverlay(id, changes)`, `removeTextOverlay(id)`, `addImageOverlay(overlay)`, `updateImageOverlay(id, changes)`, `removeImageOverlay(id)`, `reorderImageOverlay(id, direction)`.
- Device mockups: `addMockup(mockup)`, `updateMockup(id, changes)`, `duplicateMockup(id)`, `removeMockup(id)`, `applyDeviceLayout(layoutId)`, `reorderMockup(id, direction)`.
- Timeline: `addAnimationClip(presetId, startTimeMs, target?)`, `updateAnimationClip(id, changes)`, `addTrack(track)`, `addKeyframe(trackId, keyframe)`, `updateKeyframe(trackId, keyframeId, changes)`, `removeKeyframe(trackId, keyframeId)`, `setTimelineDuration(milliseconds)`, `setPlayhead(milliseconds)`. Keep keyframe times inside their clip and use property names supported by `list_capabilities`. A keyframe includes `time`, `properties`, `easing`, and optional `clipMask`.
- Masks and easing: clip masks are CSS `clip-path` strings from the mask list or a valid custom shape. Easing is one of the listed named curves or a CSS `cubic-bezier(x1,y1,x2,y2)` curve. Each keyframe’s easing controls the segment that leads into it. Match mask geometry across adjacent keys for interpolation.
- Markup: `addAnnotation(annotation)`, `updateAnnotation(id, changes)`, `removeAnnotation(id)`, `addBlurRegion(region)`, `updateBlurRegion(id, changes)`, `removeBlurRegion(id)`.
- Slides: use `add_slides_from_files` to add local files, then `setActiveSlide(id)`, `setSlideshow(changes)`, and `removeSlide(id)` as needed.
- File import: use `load_image_file` for a single local image. Use `add_slides_from_files` for ordered slideshow inputs. Use `interact_ui`’s `upload` action when the destination is a standalone app tool’s own file control.

## Preview and deliver

After making substantial edits, call `capture_preview`. Inspect the image, compare it with the user’s brief, and correct visible spacing, crop, contrast, alignment, hierarchy, or timing issues. Iterate until the result looks intentional. Use `export_image` for PNG/JPEG/WebP output or `export_video` for animation/slideshow MP4, WebM, or GIF output. Report the format and outcome; don’t claim to have inspected or exported a file unless the tool returned success.

The browser bridge is local to the current app origin. Image files are read locally by the MCP process and sent to the browser editor; the image processing pipeline stays in the browser. No arbitrary code execution tool is provided. Custom clip-mask input is CSS clip-path only.
