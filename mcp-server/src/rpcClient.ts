import WebSocket from "ws";

interface PendingCall {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	timeout: NodeJS.Timeout;
}

const CALL_TIMEOUT_MS = 15_000;

export class RpcClient {
	private socket: WebSocket;
	private nextId = 1;
	private pending = new Map<number, PendingCall>();
	private ready: Promise<void>;

	constructor(port: number, token: string) {
		this.socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
		this.ready = new Promise((resolve, reject) => {
			this.socket.once("open", () => resolve());
			this.socket.once("error", (error) => reject(error));
		});
		this.socket.on("message", (data) => this.handleMessage(data.toString()));
		this.socket.on("error", (error) => {
			this.rejectAllPending(error instanceof Error ? error : new Error(String(error)));
		});
	}

	private handleMessage(raw: string) {
		let message: { id: number; result?: unknown; error?: { message: string } };
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		this.pending.delete(message.id);
		clearTimeout(pending.timeout);
		if (message.error) {
			pending.reject(new Error(message.error.message));
		} else {
			pending.resolve(message.result);
		}
	}

	async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
		await this.ready;
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC call "${method}" timed out after ${CALL_TIMEOUT_MS}ms`));
			}, CALL_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, timeout });
			this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
		});
	}

	close(): void {
		this.rejectAllPending(new Error("RpcClient closed while call was pending"));
		this.socket.close();
	}

	private rejectAllPending(reason: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(reason);
		}
		this.pending.clear();
	}
}
