import { describe, expect, it, vi } from "vitest";
import { buildToolHandlers } from "./tools.js";

function fakeClient(responses: Record<string, unknown>) {
	return {
		call: vi.fn(async (method: string) => {
			if (!(method in responses)) {
				throw new Error(`unexpected method: ${method}`);
			}
			return responses[method];
		}),
	} as unknown as import("./rpcClient.js").RpcClient;
}

describe("buildToolHandlers", () => {
	it("get_app_status calls app.status", async () => {
		const client = fakeClient({ "app.status": { recording: false, platform: "darwin" } });
		const handlers = buildToolHandlers(client);
		expect(await handlers.get_app_status({})).toEqual({ recording: false, platform: "darwin" });
	});

	it("list_capture_sources calls sources.list", async () => {
		const client = fakeClient({ "sources.list": [{ id: "screen:0:0", name: "Screen 1" }] });
		const handlers = buildToolHandlers(client);
		expect(await handlers.list_capture_sources({})).toEqual([{ id: "screen:0:0", name: "Screen 1" }]);
	});

	it("start_recording picks recording.startNative on darwin", async () => {
		const originalPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "darwin" });
		try {
			const client = fakeClient({ "recording.startNative": { success: true } });
			const handlers = buildToolHandlers(client);
			const result = await handlers.start_recording({ sourceId: "screen:0:0", sourceType: "screen" });
			expect(result).toEqual({ success: true });
			expect(client.call).toHaveBeenCalledWith("recording.startNative", {
				arg: { id: "screen:0:0", sourceType: "screen" },
			});
		} finally {
			Object.defineProperty(process, "platform", { value: originalPlatform });
		}
	});

	it("start_recording picks recording.startFfmpeg on linux", async () => {
		const originalPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "linux" });
		try {
			const client = fakeClient({ "recording.startFfmpeg": { success: true } });
			const handlers = buildToolHandlers(client);
			await handlers.start_recording({ sourceId: "screen:0:0", sourceType: "screen" });
			expect(client.call).toHaveBeenCalledWith("recording.startFfmpeg", {
				arg: { id: "screen:0:0", sourceType: "screen" },
			});
		} finally {
			Object.defineProperty(process, "platform", { value: originalPlatform });
		}
	});

	it("stop_recording throws a clear error when nothing is recording", async () => {
		const client = fakeClient({ "app.status": { recording: false, platform: "darwin" } });
		const handlers = buildToolHandlers(client);
		await expect(handlers.stop_recording({})).rejects.toThrow("No recording is currently active.");
	});

	it("list_projects calls project.list", async () => {
		const client = fakeClient({
			"project.list": { success: true, projectsDir: "/tmp", entries: [] },
		});
		const handlers = buildToolHandlers(client);
		expect(await handlers.list_projects({})).toEqual({
			success: true,
			projectsDir: "/tmp",
			entries: [],
		});
	});

	it("read_project calls project.read with the given path", async () => {
		const client = fakeClient({ "project.read": { success: true, projectData: {} } });
		const handlers = buildToolHandlers(client);
		await handlers.read_project({ filePath: "/tmp/foo.recordly" });
		expect(client.call).toHaveBeenCalledWith("project.read", { arg: "/tmp/foo.recordly" });
	});
});
