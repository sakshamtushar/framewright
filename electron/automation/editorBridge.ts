import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";

const REQUEST_TIMEOUT_MS = 10_000;

// Each in-flight requestEditorState call holds one listener on this shared channel until
// it resolves or times out. Legitimate concurrent editor.* automation calls (e.g. a batch
// of MCP tool calls) are expected to exceed Node's default cap of 10 and shouldn't log a
// MaxListenersExceededWarning for doing so — this is bounded by REQUEST_TIMEOUT_MS, not
// unbounded growth.
ipcMain.setMaxListeners(100);

function getEditorWindow(): Electron.BrowserWindow | null {
	return (
		BrowserWindow.getAllWindows().find((window) => {
			if (window.isDestroyed()) return false;
			try {
				return (
					new URL(window.webContents.getURL()).searchParams.get("windowType") === "editor"
				);
			} catch {
				return false;
			}
		}) ?? null
	);
}

interface EditorResponse {
	success: boolean;
	result?: unknown;
	error?: string;
}

export async function requestEditorState(type: string, payload: unknown): Promise<unknown> {
	const editorWindow = getEditorWindow();
	if (!editorWindow) {
		throw new Error("No editor window is open.");
	}

	const requestId = randomUUID();

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			ipcMain.removeListener("automation:editor-response", onResponse);
			reject(new Error(`Editor did not respond to "${type}" within ${REQUEST_TIMEOUT_MS}ms`));
		}, REQUEST_TIMEOUT_MS);

		function onResponse(
			_event: Electron.IpcMainEvent,
			responseId: string,
			response: EditorResponse,
		) {
			if (responseId !== requestId) {
				return;
			}
			clearTimeout(timeout);
			ipcMain.removeListener("automation:editor-response", onResponse);
			if (response.success) {
				resolve(response.result);
			} else {
				reject(new Error(response.error ?? "Editor request failed"));
			}
		}

		ipcMain.on("automation:editor-response", onResponse);
		editorWindow.webContents.send("automation:editor-request", { requestId, type, payload });
	});
}
