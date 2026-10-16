#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getOrCreateStudioMcpToken } from '../lib/mcp/security.js';
import { aspectRatios } from '../lib/constants/aspect-ratios.js';

async function main() {
const projectRoot = process.cwd();
const token = await getOrCreateStudioMcpToken();
const baseUrl = 'http://127.0.0.1:3555';

async function findBaseUrl() {
  return baseUrl;
}

async function callEditor(operation: string, payload: Record<string, unknown> = {}) {
  const url = await findBaseUrl();
  const response = await fetch(`${url}/api/studio-mcp/dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ operation, payload }), signal: AbortSignal.timeout(300_000),
  });
  const body = await response.json().catch(() => ({})) as { result?: unknown; error?: string };
  if (!response.ok || body.error) throw new Error(body.error ?? `Screenshot Studio returned HTTP ${response.status}.`);
  if (body.result && typeof body.result === 'object' && '__studioMcpError' in body.result) throw new Error(String((body.result as { __studioMcpError: string }).__studioMcpError));
  return body.result;
}

function jsonResult(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> }; }

const server = new McpServer({ name: 'screenshot-studio', version: '1.0.0' });

server.registerTool('connection_status', {
  title: 'Check Screenshot Studio connection', description: 'Check that the local editor and its live browser bridge are available before making changes.', inputSchema: {},
}, async () => {
  const url = await findBaseUrl();
  const response = await fetch(`${url}/api/studio-mcp/health`, { cache: 'no-store' });
  const data = await response.json() as { online: boolean; connectedEditors: number };
  return jsonResult({ url, ...data, ready: data.connectedEditors > 0, nextStep: data.connectedEditors ? 'Inspect the active project.' : 'Open Screenshot Studio /editor in a browser tab.' });
});

server.registerTool('inspect_project', {
  title: 'Inspect active project', description: 'Read the active editor state: canvas, design, assets, layers, slides, annotations, blur regions, and animation clips/keyframes. Original media bytes stay in the browser.', inputSchema: {},
}, async () => jsonResult(await callEditor('inspect_project')));

server.registerTool('list_projects', {
  title: 'List local editor projects', description: 'List saved projects in the connected browser and identify the active project. Project data remains local to that browser.', inputSchema: {},
}, async () => jsonResult(await callEditor('list_projects')));

server.registerTool('create_project', {
  title: 'Create local editor project', description: 'Save the current project and create a new blank local project with a generated phrase name.', inputSchema: {},
}, async () => jsonResult(await callEditor('create_project')));

server.registerTool('open_project', {
  title: 'Open local editor project', description: 'Save the current project, then switch the connected editor to a saved project by its ID. Call list_projects to choose an ID.', inputSchema: { projectId: z.string().min(1).max(128) },
}, async ({ projectId }) => jsonResult(await callEditor('open_project', { projectId })));

server.registerTool('rename_project', {
  title: 'Rename local editor project', description: 'Rename a saved project in the connected browser. Names must contain 1–80 characters.', inputSchema: { projectId: z.string().min(1).max(128), name: z.string().trim().min(1).max(80) },
}, async ({ projectId, name }) => jsonResult(await callEditor('rename_project', { projectId, name })));

server.registerTool('delete_project', {
  title: 'Delete local editor project', description: 'Permanently delete a saved project and its local media. Call list_projects first; deleting a project requires confirmDestructive:true. If the active project is deleted, the editor opens the most recently updated remaining project or creates a blank project.', inputSchema: { projectId: z.string().min(1).max(128), confirmDestructive: z.boolean().default(false) },
}, async ({ projectId, confirmDestructive }) => jsonResult(await callEditor('delete_project', { projectId, confirmDestructive })));

server.registerTool('inspect_ui', {
  title: 'Inspect active page controls', description: 'Read the active Screenshot Studio page’s headings, visible content, accessible controls, field values, select options, and dialog names. Use this to operate any page feature that is not represented by a named project-store action.', inputSchema: {},
}, async () => jsonResult(await callEditor('inspect_ui')));

server.registerTool('interact_ui', {
  title: 'Operate Screenshot Studio UI', description: 'Click, fill, select, toggle, press a key, upload a local file, or navigate to any same-origin Screenshot Studio route using accessible control names. Call inspect_ui first to find the control name. This makes page-specific and standalone UI features available through MCP as well as the structured project actions.',
  inputSchema: { kind: z.enum(['click', 'fill', 'select', 'toggle', 'press', 'upload', 'navigate']), target: z.string().optional(), value: z.string().optional(), path: z.string().optional(), exact: z.boolean().default(true), index: z.number().int().min(0).default(0), filePaths: z.array(z.string()).max(20).optional() },
}, async ({ kind, target, value, path: destination, exact, index, filePaths }) => {
  const files = kind === 'upload' ? await Promise.all((filePaths ?? []).map(async input => {
    const absolute = path.resolve(input); const info = await stat(absolute); if (info.size > 32 * 1024 * 1024) throw new Error(`${path.basename(absolute)} exceeds 32 MB.`);
    const extension = path.extname(absolute).toLowerCase(); const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' } as Record<string, string>)[extension]; if (!mime) throw new Error(`${path.basename(absolute)} is not a supported image or video. Supported formats: PNG, JPEG, WebP, AVIF, GIF, MP4, WebM, and MOV.`);
    return { _studioFile: true, name: path.basename(absolute), type: mime, base64: (await readFile(absolute)).toString('base64') };
  })) : undefined;
  return jsonResult(await callEditor('interact_ui', { kind, target, value, path: destination, exact, index, files }));
});

server.registerTool('list_capabilities', {
  title: 'List editor capabilities', description: 'Discover every supported live-store action, its category and parameter contract, transform properties, easing curves, animation templates, and mask shapes. Use this before authoring a workflow; the app supports detailed custom compositions, not only presets.', inputSchema: {},
}, async () => jsonResult(await callEditor('list_capabilities')));

server.registerTool('apply_editor_action', {
  title: 'Apply Screenshot Studio action', description: 'Invoke any supported Screenshot Studio image, editor, or device store action by its exact name. Call list_capabilities first for argument signatures. Destructive clear/remove/reset operations require confirmDestructive=true. Keep edits grouped logically and inspect the resulting state.',
  inputSchema: { store: z.enum(['image', 'editor', 'device']).default('image'), action: z.string().min(1), args: z.array(z.unknown()).max(8).default([]), confirmDestructive: z.boolean().default(false) },
}, async ({ store, action, args, confirmDestructive }) => jsonResult(await callEditor('apply_action', { store, action, args, confirmDestructive })));

server.registerTool('set_aspect_ratio', {
  title: 'Set canvas aspect ratio', description: 'Set the active Screenshot Studio canvas to any supported aspect-ratio preset. Use this direct action instead of operating the aspect-ratio menu.',
  inputSchema: { aspectRatio: z.string().refine(value => aspectRatios.some(preset => preset.id === value), 'Choose a supported aspect-ratio preset ID.').describe(`Supported IDs: ${aspectRatios.map(preset => preset.id).join(', ')}`) },
}, async ({ aspectRatio }) => jsonResult(await callEditor('apply_action', { store: 'image', action: 'setAspectRatio', args: [aspectRatio] })));

server.registerTool('load_image_file', {
  title: 'Load local image', description: 'Load a user-selected local PNG, JPEG, or WebP file into the active editor as the main image. The absolute path must be supplied by the user or selected from project files; the image is not uploaded to a remote service.', inputSchema: { filePath: z.string().min(1).max(1024) },
}, async ({ filePath }) => {
  const absolute = path.resolve(filePath);
  const file = await readFile(absolute);
  const info = await stat(absolute);
  if (info.size > 32 * 1024 * 1024) throw new Error('Images must be 32 MB or smaller.');
  const extension = path.extname(absolute).toLowerCase();
  const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' } as Record<string, string>)[extension];
  if (!mime) throw new Error('Supported images: PNG, JPEG, and WebP.');
  return jsonResult(await callEditor('load_image', { file: { _studioFile: true, name: path.basename(absolute), type: mime, base64: file.toString('base64') } }));
});

server.registerTool('add_slides_from_files', {
  title: 'Add slideshow images', description: 'Add 1–20 user-selected PNG, JPEG, or WebP files to the active slideshow in the order supplied. Each file is limited to 32 MB.', inputSchema: { filePaths: z.array(z.string().min(1)).min(1).max(20) },
}, async ({ filePaths }) => {
  const files = await Promise.all(filePaths.map(async input => {
    const absolute = path.resolve(input); const info = await stat(absolute); if (info.size > 32 * 1024 * 1024) throw new Error(`${path.basename(absolute)} exceeds 32 MB.`);
    const extension = path.extname(absolute).toLowerCase(); const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' } as Record<string, string>)[extension]; if (!mime) throw new Error(`${path.basename(absolute)} is not PNG, JPEG, or WebP.`);
    return { _studioFile: true, name: path.basename(absolute), type: mime, base64: (await readFile(absolute)).toString('base64') };
  }));
  return jsonResult(await callEditor('add_slides', { files }));
});

server.registerTool('process_images', {
  title: 'Run browser image tools', description: 'Run Screenshot Studio’s private, browser-local image engines for batch compression, conversion, resizing, cropping, and rotation. Uses the same Canvas/Web Worker pipeline as its standalone image-tool pages. Files never leave the editor browser.',
  inputSchema: {
    engine: z.enum(['compress', 'convert', 'resize', 'crop', 'rotate']), filePaths: z.array(z.string().min(1)).min(1).max(20),
    settings: z.object({ format: z.enum(['auto', 'png', 'jpeg', 'webp', 'avif']).optional(), level: z.enum(['low', 'medium', 'high']).optional(), quality: z.number().min(0.1).max(1).optional(), useCustomQuality: z.boolean().optional(), background: z.string().max(128).optional(), resize: z.object({ mode: z.enum(['pixels', 'percentage']).optional(), width: z.number().int().min(1).max(16000).nullable().optional(), height: z.number().int().min(1).max(16000).nullable().optional(), percentage: z.number().min(1).max(400).optional(), lockAspectRatio: z.boolean().optional(), allowUpscale: z.boolean().optional() }).optional(), transform: z.object({ rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(), flipHorizontal: z.boolean().optional(), flipVertical: z.boolean().optional() }).optional(), crop: z.object({ x: z.number().min(0), y: z.number().min(0), width: z.number().positive(), height: z.number().positive() }).nullable().optional() }).optional(),
  },
}, async ({ engine, filePaths, settings = {} }) => {
  const files = await Promise.all(filePaths.map(async input => {
    const absolute = path.resolve(input); const info = await stat(absolute); if (info.size > 32 * 1024 * 1024) throw new Error(`${path.basename(absolute)} exceeds 32 MB.`);
    const extension = path.extname(absolute).toLowerCase(); const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif' } as Record<string, string>)[extension]; if (!mime) throw new Error(`${path.basename(absolute)} is not a supported image.`);
    return { _studioFile: true, name: path.basename(absolute), type: mime, base64: (await readFile(absolute)).toString('base64') };
  }));
  const output = await callEditor('process_images', { engine, files, settings }) as { __studioMcpFiles?: Array<{ name: string; mimeType: string; width: number; height: number; bytes: number; base64: string }> };
  if (!output?.__studioMcpFiles) throw new Error('The browser image pipeline returned no result.');
  return { content: output.__studioMcpFiles.flatMap(file => [
    { type: 'image' as const, mimeType: file.mimeType, data: file.base64 },
    { type: 'text' as const, text: `${file.name} — ${file.width} × ${file.height}, ${file.bytes} bytes.` },
  ]) };
});

server.registerTool('capture_preview', {
  title: 'Capture canvas preview', description: 'Render the active canvas and return a PNG image for visual review. Use after edits and refine the layout when the result does not fit the brief.', inputSchema: {},
}, async () => {
  const result = await callEditor('capture_preview') as { __studioMcpImage?: boolean; mimeType?: string; base64?: string };
  if (!result?.__studioMcpImage || !result.base64) throw new Error('The editor did not return a preview image.');
  return { content: [{ type: 'image' as const, mimeType: result.mimeType ?? 'image/png', data: result.base64 }, { type: 'text' as const, text: `Screenshot Studio canvas preview (${result.mimeType ?? 'image/png'}).` }] };
});

server.registerTool('export_image', {
  title: 'Export canvas image', description: 'Render and return the active canvas as a PNG, JPEG, or WebP image. Respects the selected editor design and the user-approved output scale; it returns the image to the agent instead of triggering a browser download.', inputSchema: { format: z.enum(['png', 'jpeg', 'webp']).default('png'), scale: z.number().min(1).max(5).optional(), quality: z.number().min(0.1).max(1).optional() },
}, async ({ format, scale, quality }) => {
  const result = await callEditor('export_image', { format, scale, quality }) as { __studioMcpImage?: boolean; mimeType?: string; base64?: string; fileName?: string };
  if (!result?.__studioMcpImage || !result.base64) throw new Error('The editor could not export its canvas image.');
  return { content: [{ type: 'image' as const, mimeType: result.mimeType ?? 'image/png', data: result.base64 }, { type: 'text' as const, text: `Exported ${result.fileName ?? format} (${result.mimeType ?? format}).` }] };
});

server.registerTool('export_video', {
  title: 'Export animation or slideshow video', description: 'Render the active animation or slideshow through Screenshot Studio’s video export pipeline. Exports default to a 1920-pixel maximum edge, 30 fps, and medium quality. MP4, WebM, and GIF are supported. The rendered file downloads from the editor browser.', inputSchema: { mode: z.enum(['animation', 'slideshow']).default('animation'), format: z.enum(['mp4', 'webm', 'gif']).default('mp4'), quality: z.enum(['high', 'medium', 'low']).default('medium'), fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30), resolution: z.enum(['720p', '1080p', 'source']).default('1080p') },
}, async ({ mode, format, quality, fps, resolution }) => jsonResult(await callEditor('export_video', { mode, format, quality, fps, resolution })));

const skillPath = path.join(projectRoot, '.agents/skills/screenshot-studio-mcp/SKILL.md');
server.registerTool('get_agent_workflow', {
  title: 'Read Screenshot Studio workflow', description: 'Read the full project skill: tool usage, layer and animation model, bespoke-design requirements, preview checks, validation limits, and export workflow.', inputSchema: {},
}, async () => ({ content: [{ type: 'text', text: await readFile(skillPath, 'utf8') }] }));

const transport = new StdioServerTransport();
await server.connect(transport);
}

void main().catch(error => {
  console.error('Screenshot Studio MCP server failed to start:', error);
  process.exitCode = 1;
});
