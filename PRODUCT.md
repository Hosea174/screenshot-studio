# Screenshot Studio

Screenshot Studio is a browser editor for composing screenshots, device mockups, backgrounds, and media layers into still images and short animated presentations. The motion editor extends the existing editor: users can begin with a built-in preset or author their own property keyframes, then preview and export the composition.

## Motion behavior

- Animate the main asset or an uploaded image/video layer with independent position, scale, tilt, rotation, perspective, and opacity keyframes.
- Animate the CSS scene camera separately with X/Y movement, zoom, pitch, yaw, and roll. These are browser perspective transforms rather than a 3D mesh engine.
- Edit values at the playhead to create or update keyframes; retime diamonds, move/stretch clips, choose easing, and lock or hide individual property tracks.
- Use editable built-in presets with hover previews, save custom motion to a local preset library, and connect clips with a cut, blend, fade, slide, or zoom transition.
- Add muted MP4/WebM video layers with timeline start, trim-in, playback speed, and looping. Decoded source frames feed both the composition preview and frame export.
- Adjust light/shadow overlay opacity, background hue/saturation/lightness, and shadow direction, distance, opacity, softness, and spread.

## Scope and persistence

The timeline targets desktop use with a pointer and keyboard. The existing mobile notice recommends a desktop device; this extension does not establish a separate mobile editor. Video audio is not mixed into exports. Uploaded video uses session-local blob URLs and must be added again in a new session. Saved motion presets persist in this browser's localStorage; they do not contain uploaded media or sync across devices.

## Incumbent visual authority

Preserve the existing compact editor and its black/gray default dark appearance. Global semantic tokens supply backgrounds, foregrounds, muted labels, dividers, accents, and focus rings; the application already loads Geist font variables alongside its existing font configuration. Motion controls reuse the editor's small labels, rounded controls, restrained borders, and tonal selection states. This work is an ordinary functional extension, with no approved visual identity replacement. Existing light-theme tokens remain part of the incumbent system.

See [Motion editor guide](docs/MOTION_EDITOR.md) for usage, shortcuts, architecture, and development commands.
