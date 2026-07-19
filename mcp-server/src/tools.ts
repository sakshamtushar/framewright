import type { RpcClient } from "./rpcClient.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

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
	};
}
