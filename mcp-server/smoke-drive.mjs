// Automated smoke driver for Recordly MCP Phase 1.
// Exercises the real production code path (getOrCreateConnection + buildToolHandlers)
// against a live Recordly instance — either attaching to one that's already running,
// or spawning `npm run dev` itself, exactly as the MCP entrypoint (src/index.ts) would.
//
// Usage: node smoke-drive.mjs [--repo-dir=/path/to/Recordly]
//
// This performs a REAL screen recording (a few seconds) and writes a real MP4 to
// Recordly's dev recordings directory. It cleans up after itself.

import { getOrCreateConnection } from "./dist/connection.js";
import { buildToolHandlers } from "./dist/tools.js";
import fs from "node:fs/promises";

const repoDirArg = process.argv.find((arg) => arg.startsWith("--repo-dir="));
const REPO_DIR = repoDirArg ? repoDirArg.slice("--repo-dir=".length) : process.cwd().replace(/\/mcp-server$/, "");

function log(label, value) {
	console.log(`\n=== ${label} ===`);
	console.log(JSON.stringify(value, null, 2));
}

async function main() {
	console.log(`Connecting (repoDir=${REPO_DIR}; will spawn \`npm run dev\` if no live instance is found)...`);
	const client = await getOrCreateConnection({ repoDir: REPO_DIR, spawnTimeoutMs: 90_000 });
	console.log("Connected.");

	const handlers = buildToolHandlers(client);
	const recordedPaths = [];

	try {
		log("get_app_status", await handlers.get_app_status({}));

		const sources = await handlers.list_capture_sources({});
		log("list_capture_sources", { count: sources.length, first: sources[0] });

		log("list_projects", await handlers.list_projects({}));

		if (sources.length === 0) {
			console.log("\nNo capture sources returned — skipping recording tests.");
			return;
		}

		const screenSource = sources.find((s) => s.sourceType === "screen") ?? sources[0];

		console.log(`\n--- Recording lifecycle test on ${screenSource.id} ---`);
		log("start_recording", await handlers.start_recording({
			sourceId: screenSource.id,
			sourceType: screenSource.sourceType,
			displayId: screenSource.display_id,
		}));

		await new Promise((r) => setTimeout(r, 1500));
		log("pause_recording", await handlers.pause_recording({}));
		await new Promise((r) => setTimeout(r, 1000));
		log("resume_recording", await handlers.resume_recording({}));
		await new Promise((r) => setTimeout(r, 1500));

		const stopResult = await handlers.stop_recording({});
		log("stop_recording", stopResult);
		if (stopResult?.path) recordedPaths.push(stopResult.path);

		console.log("\n--- Error-path checks ---");
		log("read_project (nonexistent path)", await handlers.read_project({ filePath: "/tmp/does-not-exist.recordly" }).catch((e) => ({ threw: e.message })));

		try {
			await handlers.stop_recording({});
			console.log("UNEXPECTED: stop_recording succeeded with nothing active!");
		} catch (err) {
			log("stop_recording (nothing active, expected error)", { message: err.message });
		}

		console.log("\nAll smoke checks completed.");
	} finally {
		client.close();
		for (const path of recordedPaths) {
			await fs.rm(path, { force: true }).catch(() => {});
		}
	}
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("FATAL:", err);
		process.exit(1);
	});
