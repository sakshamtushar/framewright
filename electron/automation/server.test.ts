import { describe, expect, it, vi } from "vitest";
import { ipcHandlerRegistry } from "../ipc/registry";
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
});
