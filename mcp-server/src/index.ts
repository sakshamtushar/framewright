import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getOrCreateConnection } from "./connection.js";
import { buildToolHandlers } from "./tools.js";

const REPO_DIR = path.resolve(fileURLToPath(import.meta.url), "../../..");

async function main() {
	const client = await getOrCreateConnection({ repoDir: REPO_DIR });
	const handlers = buildToolHandlers(client);

	const server = new McpServer({ name: "recordly", version: "0.1.0" });

	server.tool("get_app_status", "Get whether Recordly is currently recording and its platform.", {}, async () =>
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
			capturesSystemAudio: z.boolean().optional(),
			capturesMicrophone: z.boolean().optional(),
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

	server.tool("list_projects", "List saved .recordly project files.", {}, async () =>
		toContent(await handlers.list_projects({})),
	);

	server.tool(
		"read_project",
		"Read a .recordly project file's contents by path.",
		{ filePath: z.string() },
		async (args) => toContent(await handlers.read_project(args)),
	);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

function toContent(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

main().catch((error) => {
	console.error("[recordly-mcp] Fatal error:", error);
	process.exit(1);
});
