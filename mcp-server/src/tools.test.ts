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

	it("open_editor calls lifecycle.openEditor with no params", async () => {
		const client = fakeClient({ "lifecycle.openEditor": undefined });
		const handlers = buildToolHandlers(client);
		await handlers.open_editor({});
		expect(client.call).toHaveBeenCalledWith("lifecycle.openEditor");
	});

	it("get_project_state calls editor.getState", async () => {
		const client = fakeClient({ "editor.getState": { zoomRegions: [] } });
		const handlers = buildToolHandlers(client);
		expect(await handlers.get_project_state({})).toEqual({ zoomRegions: [] });
	});

	it("add_zoom_region forwards startMs/endMs/depth and combines focusX/focusY into a focus object", async () => {
		const client = fakeClient({ "editor.addZoomRegion": { id: "zoom-1" } });
		const handlers = buildToolHandlers(client);
		const result = await handlers.add_zoom_region({ startMs: 0, endMs: 1000, depth: 3, focusX: 0.3, focusY: 0.7 });
		expect(result).toEqual({ id: "zoom-1" });
		expect(client.call).toHaveBeenCalledWith("editor.addZoomRegion", {
			startMs: 0,
			endMs: 1000,
			depth: 3,
			focus: { cx: 0.3, cy: 0.7 },
		});
	});

	it("add_zoom_region omits focus when focusX/focusY are not both provided", async () => {
		const client = fakeClient({ "editor.addZoomRegion": { id: "zoom-2" } });
		const handlers = buildToolHandlers(client);
		await handlers.add_zoom_region({ startMs: 0, endMs: 1000 });
		expect(client.call).toHaveBeenCalledWith("editor.addZoomRegion", {
			startMs: 0,
			endMs: 1000,
			depth: undefined,
			focus: undefined,
		});
	});

	it("trim_clip calls editor.trimClip with clipId/startMs/endMs", async () => {
		const client = fakeClient({ "editor.trimClip": { success: true } });
		const handlers = buildToolHandlers(client);
		const result = await handlers.trim_clip({ clipId: "clip-1", startMs: 0, endMs: 5000 });
		expect(result).toEqual({ success: true });
		expect(client.call).toHaveBeenCalledWith("editor.trimClip", { clipId: "clip-1", startMs: 0, endMs: 5000 });
	});

	it("set_frame_style forwards args directly to editor.setFrameStyle", async () => {
		const client = fakeClient({ "editor.setFrameStyle": { success: true } });
		const handlers = buildToolHandlers(client);
		const result = await handlers.set_frame_style({ wallpaper: "gradient-1", borderRadius: 12 });
		expect(result).toEqual({ success: true });
		expect(client.call).toHaveBeenCalledWith("editor.setFrameStyle", { wallpaper: "gradient-1", borderRadius: 12 });
	});

	it("set_webcam_overlay forwards args directly to editor.setWebcamOverlay", async () => {
		const client = fakeClient({ "editor.setWebcamOverlay": { success: true } });
		const handlers = buildToolHandlers(client);
		const result = await handlers.set_webcam_overlay({ enabled: true, mirror: true });
		expect(result).toEqual({ success: true });
		expect(client.call).toHaveBeenCalledWith("editor.setWebcamOverlay", { enabled: true, mirror: true });
	});

	it("add_annotation forwards args directly to editor.addAnnotation", async () => {
		const client = fakeClient({ "editor.addAnnotation": { id: "annotation-1" } });
		const handlers = buildToolHandlers(client);
		const result = await handlers.add_annotation({ startMs: 0, endMs: 2000, content: "Hello" });
		expect(result).toEqual({ id: "annotation-1" });
		expect(client.call).toHaveBeenCalledWith("editor.addAnnotation", { startMs: 0, endMs: 2000, content: "Hello" });
	});
});
