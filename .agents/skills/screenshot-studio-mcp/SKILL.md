---
name: screenshot-studio-mcp
description: Operate every Screenshot Studio editor and image-tool feature through the connected MCP. Inspect, create, edit, animate, template, preview, and export local projects.
---

# Screenshot Studio MCP workflow

Use this skill for any task that changes or inspects Screenshot Studio. The MCP controls the connected local browser session; project media stays in that browser unless an image-tool result is explicitly returned.

## Connect and inspect

1. Call `connection_status`. If `ready` is false, open the editor at `/editor` in the in-app browser and retry.
2. Call `inspect_project` before editing. It returns current project identity, canvas/design state, selected assets, layers, slides, annotations, blur regions, main-image clip range, and animation clips/tracks/keyframes. Media bytes are intentionally omitted; use `hasSource` and `hasPoster` flags.
3. Call `list_capabilities` for the current store-action signatures, animation properties, easing, presets, templates, masks, and standalone image tools.
4. Use the named MCP tools below for common operations. For any feature without a named operation, call `inspect_ui`, operate its accessible control with `interact_ui`, then inspect or capture a preview to confirm the change. When a control is inside a collapsed section or dialog, open it and inspect again.

## Tool selection

### Projects and saved templates

- `list_projects`, `create_project`, `open_project`, `rename_project`, `delete_project` manage local projects. Choose IDs from the list; deleting requires `confirmDestructive:true`.
- `list_templates`, `save_template`, `apply_template`, `delete_template` manage reusable templates. Applying a template replaces the open project’s composition while keeping its project identity. Deleting requires `confirmDestructive:true`.

### Canvas, assets, and selection

- `load_image_file` sets the main image from a local image file. `add_slides_from_files` adds ordered images to a slideshow.
- `add_media_files` adds one or more image/video canvas layers. `replace_media_asset` swaps an imported image or video layer by its overlay ID; the layer’s effects, position, timing, and animation target remain attached to that layer across image/video swaps.
- `select_assets` selects overlay IDs, including multiple IDs for batch style/effect operations. Use `mainImageSelected:true` with `overlayIds:[]` to select the main image by itself.
- Use `apply_editor_action` for structured changes not covered by a dedicated tool. It calls a named store action with positional `args`; get its exact signature from `list_capabilities`. This covers backgrounds, gradients, frames, shadows, HSL/filter values, text, mockups, layer ordering, annotations, blur/mosaic regions, slideshow settings, canvas guides, and most animation/keyframe operations.
- For features available only through a page’s own controls (including standalone image tools), use `inspect_ui` then `interact_ui`. UI interaction supports click, fill, select, toggle, upload, same-origin navigation, and key presses with `ctrl`, `alt`, `shift`, or `meta` modifiers.

### Timeline and animation

- Use `edit_media_timeline` for media clips: `move` and `set-range` use milliseconds, `trim-left` / `trim-right` trim at the current playhead, `fit` fits still images or videos to the timeline, `set-speed` changes a video’s playback rate from 0.1× to 16×, and `split` splits a video at the playhead. A main uploaded image uses asset ID `__main_image__`; overlay IDs come from `inspect_project`.
- Use `setPlayhead`, `setTimelineDuration`, `addAnimationClip`, `updateAnimationClip`, `addTrack`, `updateTrack`, `addKeyframe`, `updateKeyframe`, and `removeKeyframe` via `apply_editor_action` for direct animation authoring. Keyframe times and clip times are milliseconds. Use the property list from `list_capabilities`; keyframe easing controls the segment into that keyframe.
- Animation clips are targeted per asset. Set the target overlay ID (or `asset` for the main image) when creating/updating clips. Use `inspect_project` to verify tracks and keyframes stay attached to the intended target.
- `history` performs undo or redo. The UI equivalent is `interact_ui` with `kind:"press"`, `value:"z"`/`"y"`, and `modifiers:["ctrl"]`.
- Camera animation is not supported. Animate an image, video, text, or device layer instead.

### Image tools and exports

- `process_images` runs the local browser pipeline for compression, conversion, resizing, cropping, and rotation. It accepts file paths and returns processed image content to the agent. Tool routes and engines are listed in `list_capabilities`.
- `capture_preview` returns a visual snapshot of the editor canvas. After substantial edits, inspect it and revise issues in crop, scale, alignment, contrast, effects, or timing.
- `export_image` returns PNG, JPEG, or WebP output. `export_video` renders an animation or slideshow as MP4, WebM, or GIF. Report export success only when the tool confirms it.

## Editing conventions

Inspect before editing, use structured actions for document state, and use UI controls when the feature is page-specific. Prefer a small sequence of relevant edits over a broad reset. Do not run destructive clear/remove/reset actions unless the user requested that change; MCP enforces `confirmDestructive:true` for those actions.

Treat presets and templates as editable starting points. Tailor background, contrast, scale, placement, animation targets, timing, and easing to the actual assets and brief. Keep text readable and visual effects subordinate to the subject. For multi-asset work, identify each asset by its current ID and verify the resulting state.

## Coverage rule

The MCP surface is intentionally layered: dedicated tools handle common workflows; `apply_editor_action` exposes the editor stores; `inspect_ui` plus `interact_ui` covers accessible page-specific controls; `process_images` exposes the standalone image engines. If a user-visible feature is missing from all four paths, treat it as an MCP coverage bug and add an operation or an accessible UI control bridge instead of telling agents to use an unexposed workflow.
