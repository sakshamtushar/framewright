import { describe, expect, it, vi } from "vitest";

// registerProjectHandlers (via electron/appPaths.ts) reads app.getPath at
// module load time, and its handlers touch dialog/shell/BrowserWindow —
// stub the whole electron surface it needs so the real registration
// function can run in this Node test environment.
vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp/recordly-mcp-phase1-test"),
		setPath: vi.fn(),
		isReady: vi.fn(() => true),
	},
	ipcMain: {
		handle: vi.fn(),
	},
	BrowserWindow: {
		getAllWindows: vi.fn(() => []),
	},
	dialog: {
		showOpenDialog: vi.fn(),
		showSaveDialog: vi.fn(),
	},
	shell: {
		showItemInFolder: vi.fn(),
		openPath: vi.fn(),
	},
}));

import { ipcHandlerRegistry } from "../ipc/registry";
import { registerProjectHandlers } from "../ipc/register/project";
import * as editorBridge from "./editorBridge";
import { dispatchRpcRequest } from "./server";

describe("dispatchRpcRequest", () => {
	it("returns a JSON-RPC result envelope when the method resolves", async () => {
		ipcHandlerRegistry.set("get-sources", async () => [{ id: "screen:0:0", name: "Screen 1" }]);

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 1,
			method: "sources.list",
			params: {},
		});

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: 1,
			result: [{ id: "screen:0:0", name: "Screen 1" }],
		});
	});

	it("returns a JSON-RPC error envelope for an unknown method", async () => {
		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 2,
			method: "not.a.real.method",
			params: {},
		});

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: 2,
			error: { code: -32601, message: "Unknown method: not.a.real.method" },
		});
	});

	it("returns a JSON-RPC error envelope when the underlying handler throws", async () => {
		ipcHandlerRegistry.set("start-native-screen-recording", async () => {
			throw new Error("boom");
		});

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 3,
			method: "recording.startNative",
			params: { source: { id: "screen:0:0" } },
		});

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: 3,
			error: { code: -32000, message: "boom" },
		});
	});

	it("app.status reports recording=false when nothing is active", async () => {
		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 4,
			method: "app.status",
			params: {},
		});

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: 4,
			result: { recording: false, platform: process.platform },
		});
	});

	it("forwards the arg parameter to the handler", async () => {
		ipcHandlerRegistry.set("open-project-file-at-path", async (_event, filePath) => ({
			received: filePath,
		}));

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 5,
			method: "project.read",
			params: { arg: "/some/path.recordly" },
		});

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: 5,
			result: { received: "/some/path.recordly" },
		});
	});

	it("editor.getState calls requestEditorState with the request's params as payload", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ zoomRegions: [] });

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 10,
			method: "editor.getState",
			params: {},
		});

		expect(spy).toHaveBeenCalledWith("getState", {});
		expect(response).toEqual({ jsonrpc: "2.0", id: 10, result: { zoomRegions: [] } });
		spy.mockRestore();
	});

	it("editor.addZoomRegion forwards params directly as the payload (not wrapped in arg)", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ id: "zoom-1" });

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 11,
			method: "editor.addZoomRegion",
			params: { startMs: 0, endMs: 1000, depth: 3 },
		});

		expect(spy).toHaveBeenCalledWith("addZoomRegion", { startMs: 0, endMs: 1000, depth: 3 });
		expect(response).toEqual({ jsonrpc: "2.0", id: 11, result: { id: "zoom-1" } });
		spy.mockRestore();
	});

	it("editor.getState returns a JSON-RPC error envelope when the editor bridge rejects", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockRejectedValue(new Error("No editor window is open."));

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 12,
			method: "editor.getState",
			params: {},
		});

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: 12,
			error: { code: -32000, message: "No editor window is open." },
		});
		spy.mockRestore();
	});

	it("lifecycle.openEditor routes to the switch-to-editor channel", async () => {
		ipcHandlerRegistry.set("switch-to-editor", async () => undefined);

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 13,
			method: "lifecycle.openEditor",
			params: {},
		});

		expect(response).toEqual({ jsonrpc: "2.0", id: 13, result: undefined });
	});

	it("editor.trimClip forwards params directly as the payload", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ success: true });

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 20,
			method: "editor.trimClip",
			params: { clipId: "clip-1", startMs: 0, endMs: 5000 },
		});

		expect(spy).toHaveBeenCalledWith("trimClip", { clipId: "clip-1", startMs: 0, endMs: 5000 });
		expect(response).toEqual({ jsonrpc: "2.0", id: 20, result: { success: true } });
		spy.mockRestore();
	});

	it("editor.setFrameStyle forwards params directly as the payload", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ success: true });

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 21,
			method: "editor.setFrameStyle",
			params: { wallpaper: "gradient-1", borderRadius: 12 },
		});

		expect(spy).toHaveBeenCalledWith("setFrameStyle", { wallpaper: "gradient-1", borderRadius: 12 });
		expect(response).toEqual({ jsonrpc: "2.0", id: 21, result: { success: true } });
		spy.mockRestore();
	});

	it("editor.setWebcamOverlay forwards params directly as the payload", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ success: true });
		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 30,
			method: "editor.setWebcamOverlay",
			params: { enabled: true, mirror: true },
		});
		expect(spy).toHaveBeenCalledWith("setWebcamOverlay", { enabled: true, mirror: true });
		expect(response).toEqual({ jsonrpc: "2.0", id: 30, result: { success: true } });
		spy.mockRestore();
	});

	it("editor.addAnnotation forwards params directly as the payload", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ id: "annotation-1" });
		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 31,
			method: "editor.addAnnotation",
			params: { startMs: 0, endMs: 2000, content: "Hello" },
		});
		expect(spy).toHaveBeenCalledWith("addAnnotation", { startMs: 0, endMs: 2000, content: "Hello" });
		expect(response).toEqual({ jsonrpc: "2.0", id: 31, result: { id: "annotation-1" } });
		spy.mockRestore();
	});
});

describe("registerProjectHandlers", () => {
	it("registers list-project-files and open-project-file-at-path in the IPC handler registry", () => {
		// Regression test for the bug where project.ts used ipcMain.handle(...)
		// directly instead of the registry's handle() wrapper, so
		// list_projects/read_project MCP tools silently 404'd at runtime even
		// though sources.ts/recording.ts (which do use handle()) worked fine.
		ipcHandlerRegistry.delete("list-project-files");
		ipcHandlerRegistry.delete("open-project-file-at-path");

		registerProjectHandlers();

		expect(ipcHandlerRegistry.has("list-project-files")).toBe(true);
		expect(ipcHandlerRegistry.has("open-project-file-at-path")).toBe(true);
	});
});
