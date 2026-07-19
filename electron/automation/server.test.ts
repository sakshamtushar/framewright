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
