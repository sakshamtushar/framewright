import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getOrCreateConnection } from "./connection.js";
import type { RpcClient } from "./rpcClient.js";
import { buildToolHandlers } from "./tools.js";

const REPO_DIR = path.resolve(fileURLToPath(import.meta.url), "../../..");

// Lazily connects to (or launches) Framewright on the *first tool call*, not at
// process startup — see the GetClient doc comment in tools.ts for why this matters.
// Memoized so repeated tool calls in the same session reuse one connection; a
// failed attempt clears the memo so the next tool call gets a fresh try instead
// of permanently caching the rejection.
let clientPromise: Promise<RpcClient> | null = null;
function getClient(): Promise<RpcClient> {
	if (!clientPromise) {
		clientPromise = getOrCreateConnection({ repoDir: REPO_DIR }).catch((error: unknown) => {
			clientPromise = null;
			throw error;
		});
	}
	return clientPromise;
}

async function main() {
	const handlers = buildToolHandlers(getClient);

	const server = new McpServer({ name: "framewright", version: "0.1.0" });

	server.tool("get_app_status", "Get whether Framewright is currently recording and its platform.", {}, async () =>
		toContent(await handlers.get_app_status({})),
	);

	server.tool(
		"list_capture_sources",
		"List available screen/window capture sources.",
		{},
		async () => toContent(await handlers.list_capture_sources({})),
	);

	server.tool(
		"start_recording",
		"Start a screen recording of the given source.",
		{
			sourceId: z.string(),
			sourceType: z.enum(["screen", "window"]),
			displayId: z.string().optional(),
		},
		async (args) => toContent(await handlers.start_recording(args)),
	);

	server.tool("pause_recording", "Pause the active recording.", {}, async () =>
		toContent(await handlers.pause_recording({})),
	);

	server.tool("resume_recording", "Resume a paused recording.", {}, async () =>
		toContent(await handlers.resume_recording({})),
	);

	server.tool("stop_recording", "Stop the active recording and finalize the video file.", {}, async () =>
		toContent(await handlers.stop_recording({})),
	);

	server.tool("get_recording_status", "Get current recording status.", {}, async () =>
		toContent(await handlers.get_recording_status({})),
	);

	server.tool("list_projects", "List saved .framewright (or legacy .recordly) project files.", {}, async () =>
		toContent(await handlers.list_projects({})),
	);

	server.tool(
		"read_project",
		"Read a .framewright (or legacy .recordly) project file's contents by path.",
		{ filePath: z.string() },
		async (args) => toContent(await handlers.read_project(args)),
	);

	server.tool("open_editor", "Open (or focus) Framewright's editor window.", {}, async () =>
		toContent(await handlers.open_editor({})),
	);

	server.tool(
		"get_project_state",
		"Get the currently open editor's full project state (zoom regions, trim, webcam, frame style, captions, etc.).",
		{},
		async () => toContent(await handlers.get_project_state({})),
	);

	server.tool(
		"add_zoom_region",
		"Add a zoom-in region to the currently open editor's timeline.",
		{
			startMs: z.number(),
			endMs: z.number(),
			depth: z.number().min(1).max(6).optional(),
			focusX: z.number().min(0).max(1).optional(),
			focusY: z.number().min(0).max(1).optional(),
		},
		async (args) => toContent(await handlers.add_zoom_region(args)),
	);

	server.tool(
		"trim_clip",
		"Resize or move a clip's boundaries on the currently open editor's timeline.",
		{ clipId: z.string(), startMs: z.number(), endMs: z.number() },
		async (args) => toContent(await handlers.trim_clip(args)),
	);

	server.tool(
		"set_frame_style",
		"Set the currently open editor's frame style: wallpaper, frame preset, padding, border radius, shadow, background blur. All fields optional — only provided fields are changed.",
		{
			wallpaper: z.string().optional(),
			frame: z.string().nullable().optional(),
			padding: z
				.object({
					top: z.number().optional(),
					bottom: z.number().optional(),
					left: z.number().optional(),
					right: z.number().optional(),
				})
				.optional(),
			borderRadius: z.number().optional(),
			shadowIntensity: z.number().optional(),
			backgroundBlur: z.number().optional(),
		},
		async (args) => toContent(await handlers.set_frame_style(args)),
	);

	server.tool(
		"set_webcam_overlay",
		"Set webcam overlay properties on the currently open editor: enabled, source path, position, size, crop, mirror, corner radius, shadow, etc. All fields optional — only provided fields are changed.",
		{
			enabled: z.boolean().optional(),
			sourcePath: z.string().nullable().optional(),
			timeOffsetMs: z.number().optional(),
			mirror: z.boolean().optional(),
			reactToZoom: z.boolean().optional(),
			cropRegion: z
				.object({
					x: z.number(),
					y: z.number(),
					width: z.number(),
					height: z.number(),
				})
				.optional(),
			corner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
			positionPreset: z
				.enum([
					"top-left",
					"top-right",
					"bottom-left",
					"bottom-right",
					"top-center",
					"center-left",
					"center",
					"center-right",
					"bottom-center",
					"custom",
				])
				.optional(),
			positionX: z.number().min(0).max(1).optional(),
			positionY: z.number().min(0).max(1).optional(),
			size: z.number().optional(),
			width: z.number().optional(),
			height: z.number().optional(),
			cornerRadius: z.number().optional(),
			shadow: z.number().optional(),
			margin: z.number().optional(),
		},
		async (args) => toContent(await handlers.set_webcam_overlay(args)),
	);

	server.tool(
		"add_annotation",
		"Add a text annotation to the currently open editor's timeline. Only the \"text\" annotation type is supported by this tool today — image/figure/blur annotations require additional payload fields (imageContent/figureData/blurIntensity) this tool doesn't yet populate.",
		{
			startMs: z.number(),
			endMs: z.number(),
			content: z.string().optional(),
			trackIndex: z.number().optional(),
		},
		async (args) => toContent(await handlers.add_annotation(args)),
	);

	server.tool(
		"generate_captions",
		"Transcribe a video's audio into caption cues using the locally downloaded Whisper model, and apply them to the currently open editor. Requires the small Whisper model to already be downloaded (via Framewright's caption settings UI) — fails with a clear error otherwise. If videoPath is omitted, defaults to the video currently loaded in the open editor.",
		{ videoPath: z.string().optional(), language: z.string().optional() },
		async (args) => toContent(await handlers.generate_captions(args)),
	);

	server.tool(
		"edit_caption",
		"Edit an existing caption cue on the currently open editor's timeline: change its text, retime it, split it, merge it with another cue, or delete it.",
		{
			action: z.enum(["setText", "retime", "split", "merge", "delete"]),
			id: z.string(),
			text: z.string().optional(),
			startMs: z.number().optional(),
			endMs: z.number().optional(),
			atMs: z.number().optional(),
			mergeWithId: z.string().optional(),
		},
		async (args) => toContent(await handlers.edit_caption(args)),
	);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

function toContent(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

main().catch((error) => {
	console.error("[framewright-mcp] Fatal error:", error);
	process.exit(1);
});
