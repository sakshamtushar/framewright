import { randomBytes } from "node:crypto";
import { app } from "electron";
import { type WebSocket, WebSocketServer } from "ws";
import { ipcHandlerRegistry } from "../ipc/registry";
import {
	ffmpegScreenRecordingActive,
	nativeScreenRecordingActive,
	windowsNativeCaptureActive,
} from "../ipc/state";
import { removeLockfile, writeLockfile } from "./lockfile";

interface RpcRequest {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params: Record<string, unknown>;
}

interface RpcSuccess {
	jsonrpc: "2.0";
	id: number | string;
	result: unknown;
}

interface RpcFailure {
	jsonrpc: "2.0";
	id: number | string;
	error: { code: number; message: string };
}

type RpcResponse = RpcSuccess | RpcFailure;

/** Fake ipcMain.handle event — recording/source handlers never read `event`, only its args. */
const FAKE_EVENT = {} as Electron.IpcMainInvokeEvent;

const METHOD_TO_CHANNEL: Record<string, string> = {
	"sources.list": "get-sources",
	"recording.startNative": "start-native-screen-recording",
	"recording.startFfmpeg": "start-ffmpeg-recording",
	"recording.pause": "pause-native-screen-recording",
	"recording.resume": "resume-native-screen-recording",
	"recording.stopNative": "stop-native-screen-recording",
	"recording.stopFfmpeg": "stop-ffmpeg-recording",
	"project.list": "list-project-files",
	"project.read": "open-project-file-at-path",
};

function isRecording(): boolean {
	return nativeScreenRecordingActive || windowsNativeCaptureActive || ffmpegScreenRecordingActive;
}

async function callChannel(channel: string, params: Record<string, unknown>): Promise<unknown> {
	const handler = ipcHandlerRegistry.get(channel);
	if (!handler) {
		throw new Error(`No IPC handler registered for channel: ${channel}`);
	}
	// Every Phase-1 channel takes at most one positional argument beyond the
	// event (source, filePath, etc.) or none at all — see METHOD_TO_CHANNEL callers.
	if ("arg" in params) {
		return handler(FAKE_EVENT, params.arg);
	}
	return handler(FAKE_EVENT);
}

export async function dispatchRpcRequest(request: RpcRequest): Promise<RpcResponse> {
	try {
		if (request.method === "app.status") {
			return {
				jsonrpc: "2.0",
				id: request.id,
				result: { recording: isRecording(), platform: process.platform },
			};
		}

		const channel = METHOD_TO_CHANNEL[request.method];
		if (!channel) {
			return {
				jsonrpc: "2.0",
				id: request.id,
				error: { code: -32601, message: `Unknown method: ${request.method}` },
			};
		}

		const result = await callChannel(channel, request.params ?? {});
		return { jsonrpc: "2.0", id: request.id, result };
	} catch (error) {
		return {
			jsonrpc: "2.0",
			id: request.id,
			error: {
				code: -32000,
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

let wss: WebSocketServer | null = null;

export async function startAutomationServerIfRequested(): Promise<void> {
	const token = process.env.RECORDLY_MCP_TOKEN;
	if (!token) {
		return;
	}

	wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });

	wss.on("connection", (socket: WebSocket, req) => {
		const url = new URL(req.url ?? "", "http://localhost");
		if (url.searchParams.get("token") !== token) {
			socket.close(4001, "invalid token");
			return;
		}

		socket.on("message", async (data) => {
			let request: RpcRequest;
			try {
				request = JSON.parse(data.toString());
			} catch {
				return; // ignore malformed frames
			}
			const response = await dispatchRpcRequest(request);
			socket.send(JSON.stringify(response));
		});
	});

	await new Promise<void>((resolve) => wss?.once("listening", () => resolve()));
	const address = wss.address();
	const port = typeof address === "object" && address ? address.port : 0;

	await writeLockfile({ pid: process.pid, port, token });

	app.on("before-quit", () => {
		void stopAutomationServer();
	});
}

export async function stopAutomationServer(): Promise<void> {
	await removeLockfile();
	if (wss) {
		await new Promise<void>((resolve) => wss?.close(() => resolve()));
		wss = null;
	}
}

// Exposed for RECORDLY_MCP_TOKEN generation callers (Task 4).
export function generateAutomationToken(): string {
	return randomBytes(24).toString("hex");
}
