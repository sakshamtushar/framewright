import fs from "node:fs";
import path from "node:path";
import { getFramewrightDevUserDataPath } from "./paths.js";
import type { RpcClient } from "./rpcClient.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

// Registry-routed RPC methods (e.g. "captions.generate") take one positional argument and
// must be wrapped as `{ arg: ... }`; editor-bridge methods (e.g. "editor.*") take the params
// object flat, with no wrapping. See electron/automation/server.ts's callChannel comment.
export function buildToolHandlers(client: RpcClient): Record<string, ToolHandler> {
	return {
		async get_app_status() {
			return client.call("app.status");
		},

		async list_capture_sources() {
			return client.call("sources.list", { arg: { types: ["screen", "window"] } });
		},

		async start_recording(args) {
			const source = {
				id: args.sourceId,
				sourceType: args.sourceType,
				...(args.displayId !== undefined ? { display_id: args.displayId } : {}),
			};
			const method = process.platform === "linux" ? "recording.startFfmpeg" : "recording.startNative";
			return client.call(method, { arg: source });
		},

		async pause_recording() {
			return client.call("recording.pause");
		},

		async resume_recording() {
			return client.call("recording.resume");
		},

		async stop_recording() {
			const status = (await client.call("app.status")) as { recording: boolean };
			if (!status.recording) {
				throw new Error("No recording is currently active.");
			}
			const method = process.platform === "linux" ? "recording.stopFfmpeg" : "recording.stopNative";
			return client.call(method);
		},

		async get_recording_status() {
			return client.call("app.status");
		},

		async list_projects() {
			return client.call("project.list");
		},

		async read_project(args) {
			return client.call("project.read", { arg: args.filePath });
		},

		async open_editor() {
			return client.call("lifecycle.openEditor");
		},

		async get_project_state() {
			return client.call("editor.getState");
		},

		async add_zoom_region(args) {
			const focus =
				typeof args.focusX === "number" && typeof args.focusY === "number"
					? { cx: args.focusX, cy: args.focusY }
					: undefined;
			return client.call("editor.addZoomRegion", {
				startMs: args.startMs,
				endMs: args.endMs,
				depth: args.depth,
				focus,
			});
		},

		async trim_clip(args) {
			return client.call("editor.trimClip", {
				clipId: args.clipId,
				startMs: args.startMs,
				endMs: args.endMs,
			});
		},

		async set_frame_style(args) {
			return client.call("editor.setFrameStyle", args);
		},

		async set_webcam_overlay(args) {
			return client.call("editor.setWebcamOverlay", args);
		},

		async add_annotation(args) {
			return client.call("editor.addAnnotation", args);
		},

		async generate_captions(args) {
			const whisperModelPath = path.join(getFramewrightDevUserDataPath(), "whisper", "ggml-small.bin");
			if (!fs.existsSync(whisperModelPath)) {
				throw new Error(
					`The Whisper caption model isn't downloaded yet (expected at ${whisperModelPath}). ` +
						"Open Framewright's caption settings and download the small model, then retry.",
				);
			}

			let videoPath = args.videoPath as string | undefined;
			if (!videoPath) {
				const state = (await client.call("editor.getState")) as { sourcePath?: string | null };
				if (!state.sourcePath) {
					throw new Error(
						"generate_captions requires videoPath, and no video is currently loaded in the open editor to default to.",
					);
				}
				videoPath = state.sourcePath;
			}

			const genResult = (await client.call("captions.generate", {
				arg: { videoPath, whisperModelPath, language: args.language },
			})) as { success: boolean; cues?: unknown[]; error?: string; message?: string };
			if (!genResult.success) {
				throw new Error(genResult.error ?? genResult.message ?? "Caption generation failed");
			}
			return client.call("editor.setCaptions", { cues: genResult.cues });
		},

		async edit_caption(args) {
			return client.call("editor.editCaption", args);
		},
	};
}
