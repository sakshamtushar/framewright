import { describe, expect, it, vi } from "vitest";

const mockReadLockfile = vi.fn();
const mockIsProcessAlive = vi.fn();

vi.mock("./lockfile", () => ({
	readLockfile: () => mockReadLockfile(),
	isProcessAlive: (pid: number) => mockIsProcessAlive(pid),
}));

vi.mock("./rpcClient", () => ({
	RpcClient: vi.fn().mockImplementation(function (port: number, token: string) {
		return { port, token };
	}),
}));

import { getOrCreateConnection } from "./connection";
import { RpcClient } from "./rpcClient";

describe("getOrCreateConnection", () => {
	it("attaches to a live instance instead of spawning when the lockfile is valid", async () => {
		mockReadLockfile.mockResolvedValue({ pid: 111, port: 5000, token: "tok" });
		mockIsProcessAlive.mockReturnValue(true);

		const client = await getOrCreateConnection({ repoDir: "/does/not/matter" });

		expect(RpcClient).toHaveBeenCalledWith(5000, "tok");
		expect(client).toEqual({ port: 5000, token: "tok" });
	});
});
