import { WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RpcClient } from "./rpcClient.js";

describe("RpcClient", () => {
	let server: WebSocketServer;
	let port: number;

	beforeEach(async () => {
		server = new WebSocketServer({ port: 0 });
		await new Promise<void>((resolve) => server.once("listening", () => resolve()));
		const address = server.address();
		if (typeof address === "string" || address === null) {
			throw new Error("Expected server to bind to a port");
		}
		port = address.port;
	});

	afterEach(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	});

	it("rejects in-flight calls when close() is called", async () => {
		// The test server never responds, so the call stays pending until close() rejects it.
		const client = new RpcClient(port, "tok");
		const callPromise = client.call("noop");

		// Give the socket a moment to connect before closing so the call is actually pending.
		await new Promise((resolve) => setTimeout(resolve, 50));
		client.close();

		await expect(callPromise).rejects.toThrow("RpcClient closed while call was pending");
	});
});
