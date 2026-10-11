# Screenshot Studio agent workflow

When working in this repository to create or change a Screenshot Studio composition, animation, slideshow, or image-tool result, use the project's `screenshot-studio` MCP server when available. Start with `connection_status`, inspect the live project, then read `get_agent_workflow` for the detailed workflow and design standards. Use `list_capabilities` before invoking editor actions, and preview substantial edits before presenting them.

Build bespoke results from the user's brief and the actual assets. Treat presets as editable starting points, not a substitute for design decisions. Do not create camera-motion tracks; the camera animation feature was removed. For other repository code changes, follow the normal project instructions and use MCP only when it helps verify behavior against the live editor.
