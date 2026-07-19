import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const mockWindows: Array<{
	isDestroyed: () => boolean;
	webContents: { getURL: () => string; send: (channel: string, payload: unknown) => void };
}> = [];

vi.mock("electron", () => ({
	BrowserWindow: {
		getAllWindows: () => mockWindows,
	},
	ipcMain: new EventEmitter(),
}));

import { ipcMain } from "electron";
import { requestEditorState } from "./editorBridge";

function makeEditorWindow(send: (channel: string, payload: unknown) => void) {
	return {
		isDestroyed: () => false,
		webContents: {
			getURL: () => "file:///index.html?windowType=editor",
			send,
		},
	};
}

describe("requestEditorState", () => {
	it("rejects when no editor window is open", async () => {
		mockWindows.length = 0;
		await expect(requestEditorState("getState", {})).rejects.toThrow("No editor window is open.");
	});

	it("sends a request to the editor window and resolves with the response result", async () => {
		mockWindows.length = 0;
		const send = vi.fn((_channel: string, payload: { requestId: string }) => {
			queueMicrotask(() => {
				(ipcMain as unknown as EventEmitter).emit("automation:editor-response", {}, payload.requestId, {
					success: true,
					result: { zoomRegions: [] },
				});
			});
		});
		mockWindows.push(makeEditorWindow(send));

		const result = await requestEditorState("getState", { some: "payload" });

		expect(result).toEqual({ zoomRegions: [] });
		expect(send).toHaveBeenCalledWith(
			"automation:editor-request",
			expect.objectContaining({ type: "getState", payload: { some: "payload" } }),
		);
	});

	it("rejects with the response error when the renderer reports failure", async () => {
		mockWindows.length = 0;
		const send = vi.fn((_channel: string, payload: { requestId: string }) => {
			queueMicrotask(() => {
				(ipcMain as unknown as EventEmitter).emit("automation:editor-response", {}, payload.requestId, {
					success: false,
					error: "invalid payload",
				});
			});
		});
		mockWindows.push(makeEditorWindow(send));

		await expect(requestEditorState("addZoomRegion", {})).rejects.toThrow("invalid payload");
	});
});
