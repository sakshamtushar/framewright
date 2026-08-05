// Automated smoke driver for Framewright MCP Phase 1.
// Exercises the real production code path (getOrCreateConnection + buildToolHandlers)
// against a live Framewright instance — either attaching to one that's already running,
// or spawning `npm run dev` itself, exactly as the MCP entrypoint (src/index.ts) would.
//
// Usage: node smoke-drive.mjs [--repo-dir=/path/to/framewright]
//
// This performs a REAL screen recording (a few seconds) and writes a real MP4 to
// Framewright's dev recordings directory. It cleans up after itself.

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

		console.log("\n--- Editor bridge test ---");
		log("open_editor", await handlers.open_editor({}));
		await new Promise((r) => setTimeout(r, 3000)); // give the editor window time to mount

		const state = await handlers.get_project_state({});
		log("get_project_state", { zoomRegionCount: state?.zoomRegions?.length ?? 0 });

		const zoomResult = await handlers.add_zoom_region({ startMs: 0, endMs: 1000, depth: 3 });
		log("add_zoom_region", zoomResult);

		const stateAfterZoom = await handlers.get_project_state({});
		const zoomRegions = stateAfterZoom?.zoomRegions ?? [];
		const addedRegion = zoomRegions.find((r) => r.id === zoomResult.id);
		if (!addedRegion) {
			throw new Error(
				`add_zoom_region reported id ${zoomResult.id} but get_project_state's zoomRegions does not contain it: ${JSON.stringify(zoomRegions)}`,
			);
		}
		console.log(`\nVerified: zoom region ${zoomResult.id} is present in project state after adding it.`);

		const frameResult = await handlers.set_frame_style({ borderRadius: 12, shadowIntensity: 40 });
		log("set_frame_style", frameResult);
		const stateAfterFrame = await handlers.get_project_state({});
		if (stateAfterFrame.borderRadius !== 12 || stateAfterFrame.shadowIntensity !== 40) {
			throw new Error(
				`set_frame_style did not persist: expected borderRadius=12/shadowIntensity=40, got borderRadius=${stateAfterFrame.borderRadius}/shadowIntensity=${stateAfterFrame.shadowIntensity}`,
			);
		}
		console.log("\nVerified: frame style change persisted in project state.");

		const clips = stateAfterFrame?.clipRegions ?? [];
		if (clips.length > 0) {
			const firstClip = clips[0];
			const trimResult = await handlers.trim_clip({
				clipId: firstClip.id,
				startMs: firstClip.startMs,
				endMs: Math.max(firstClip.startMs + 500, firstClip.endMs - 200),
			});
			log("trim_clip", trimResult);
			console.log("\nVerified: trim_clip call succeeded (clip existed to trim).");
		} else {
			console.log(
				"\nNo clip regions in project state — skipping trim_clip live verification (recording may have failed this run; not a Phase 2b regression).",
			);
		}

		const webcamResult = await handlers.set_webcam_overlay({ enabled: true, mirror: true });
		log("set_webcam_overlay", webcamResult);
		const stateAfterWebcam = await handlers.get_project_state({});
		if (stateAfterWebcam.webcam?.enabled !== true || stateAfterWebcam.webcam?.mirror !== true) {
			throw new Error(
				`set_webcam_overlay did not persist: got webcam=${JSON.stringify(stateAfterWebcam.webcam)}`,
			);
		}
		console.log("\nVerified: webcam overlay change persisted in project state.");

		const annotationResult = await handlers.add_annotation({ startMs: 0, endMs: 2000, content: "Smoke test annotation" });
		log("add_annotation", annotationResult);
		const stateAfterAnnotation = await handlers.get_project_state({});
		const annotations = stateAfterAnnotation?.annotationRegions ?? [];
		if (!annotations.find((a) => a.id === annotationResult.id)) {
			throw new Error(
				`add_annotation reported id ${annotationResult.id} but it's not in project state: ${JSON.stringify(annotations)}`,
			);
		}
		console.log(`\nVerified: annotation ${annotationResult.id} is present in project state after adding it.`);

		console.log("\n--- Captions test ---");
		let captionGenerated = false;
		try {
			const capResult = await handlers.generate_captions({ videoPath: recordedPaths[0] ?? "/tmp/does-not-exist.mp4" });
			log("generate_captions", capResult);
			captionGenerated = true;
		} catch (err) {
			console.log(`\ngenerate_captions failed (expected if the Whisper model isn't downloaded on this machine): ${err.message}`);
		}

		if (captionGenerated) {
			const stateAfterCaptions = await handlers.get_project_state({});
			const captions = stateAfterCaptions?.autoCaptions ?? [];
			if (captions.length > 0) {
				const editResult = await handlers.edit_caption({ action: "setText", id: captions[0].id, text: "Edited via MCP" });
				log("edit_caption (setText, on real transcribed cue)", editResult);
				console.log("\nVerified: edit_caption call succeeded on a real generated cue.");
			} else {
				console.log("\ngenerate_captions succeeded but produced zero cues — skipping edit_caption live verification.");
			}
		} else {
			// No Whisper model available in this environment — seed a caption directly via the
			// low-level RPC client (bypassing generate_captions) so edit_caption's live behavior
			// is still exercised, independent of Whisper model availability.
			console.log("\nSeeding a caption directly via editor.setCaptions to test edit_caption independent of transcription...");
			const seedCue = { id: "smoke-caption-1", startMs: 0, endMs: 1500, text: "Smoke test caption" };
			const seedResult = await client.call("editor.setCaptions", { cues: [seedCue] });
			log("editor.setCaptions (seed)", seedResult);

			const stateAfterSeed = await handlers.get_project_state({});
			const seededCue = (stateAfterSeed?.autoCaptions ?? []).find((c) => c.id === seedCue.id);
			if (!seededCue) {
				throw new Error(`Seeded caption ${seedCue.id} not found in project state after editor.setCaptions`);
			}
			console.log(`\nVerified: seeded caption ${seedCue.id} is present in project state.`);

			const editResult = await handlers.edit_caption({ action: "setText", id: seedCue.id, text: "Edited via MCP" });
			log("edit_caption (setText, on seeded cue)", editResult);

			const stateAfterEdit = await handlers.get_project_state({});
			const editedCue = (stateAfterEdit?.autoCaptions ?? []).find((c) => c.id === seedCue.id);
			if (editedCue?.text !== "Edited via MCP") {
				throw new Error(`edit_caption (setText) did not persist: expected text "Edited via MCP", got ${JSON.stringify(editedCue)}`);
			}
			console.log("\nVerified: edit_caption (setText) change persisted in project state.");

			const retimeResult = await handlers.edit_caption({ action: "retime", id: seedCue.id, startMs: 200, endMs: 1800 });
			log("edit_caption (retime)", retimeResult);
			const stateAfterRetime = await handlers.get_project_state({});
			const retimedCue = (stateAfterRetime?.autoCaptions ?? []).find((c) => c.id === seedCue.id);
			if (retimedCue?.startMs !== 200 || retimedCue?.endMs !== 1800) {
				throw new Error(`edit_caption (retime) did not persist: got ${JSON.stringify(retimedCue)}`);
			}
			console.log("\nVerified: edit_caption (retime) change persisted in project state.");

			const deleteResult = await handlers.edit_caption({ action: "delete", id: seedCue.id });
			log("edit_caption (delete)", deleteResult);
			const stateAfterDelete = await handlers.get_project_state({});
			const stillPresent = (stateAfterDelete?.autoCaptions ?? []).find((c) => c.id === seedCue.id);
			if (stillPresent) {
				throw new Error(`edit_caption (delete) did not remove the cue: ${JSON.stringify(stillPresent)}`);
			}
			console.log("\nVerified: edit_caption (delete) removed the cue from project state.");
		}

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
