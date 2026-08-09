import { describe, expect, it, vi } from "vitest";

const mockReadLockfile = vi.fn();
const mockIsFramewrightProcess = vi.fn();

vi.mock("./lockfile.js", () => ({
	readLockfile: () => mockReadLockfile(),
	isFramewrightProcess: (pid: number, repoDir?: string) => mockIsFramewrightProcess(pid, repoDir),
}));

vi.mock("./rpcClient.js", () => ({
	RpcClient: vi.fn().mockImplementation(function (port: number, token: string) {
		return { port, token };
	}),
}));

const mockSpawn = vi.fn(() => ({ unref: vi.fn() }));

vi.mock("node:child_process", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import { getOrCreateConnection } from "./connection.js";
import { RpcClient } from "./rpcClient.js";

// Tiny poll interval so tests run in milliseconds, not seconds.
const FAST_POLL_MS = 5;
const SHORT_TIMEOUT_MS = 500;

/**
 * Set readLockfile / isFramewrightProcess to return values from a sequence on the
 * first N calls, then stick on the final value forever. The polling loop in
 * connection.ts re-reads the lockfile every FAST_POLL_MS, so we need the mocks to
 * keep returning something after the planned transitions.
 */
function setupMocks(
	readlockSequence: Array<{ pid: number; port: number; token: string } | null>,
	aliveSequence: boolean[],
) {
	let callIndex = 0;
	mockReadLockfile.mockImplementation(() => {
		const idx = Math.min(callIndex, readlockSequence.length - 1);
		callIndex++;
		return Promise.resolve(readlockSequence[idx]);
	});
	mockIsFramewrightProcess.mockImplementation(() => {
		const idx = Math.min(callIndex - 1, aliveSequence.length - 1);
		return Promise.resolve(aliveSequence[idx]);
	});
}

describe("getOrCreateConnection", () => {
	it("attaches to a live instance instead of spawning when the lockfile is valid", async () => {
		mockSpawn.mockClear();
		mockReadLockfile.mockReset();
		mockIsFramewrightProcess.mockReset();

		mockReadLockfile.mockResolvedValue({ pid: 111, port: 5000, token: "tok" });
		mockIsFramewrightProcess.mockResolvedValue(true);

		const client = await getOrCreateConnection({
			repoDir: "/does/not/matter",
			pollIntervalMs: FAST_POLL_MS,
			spawnTimeoutMs: SHORT_TIMEOUT_MS,
		});

		expect(RpcClient).toHaveBeenCalledWith(5000, "tok");
		expect(client).toEqual({ port: 5000, token: "tok" });
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("passes repoDir through to isFramewrightProcess on the attach path", async () => {
		mockSpawn.mockClear();
		mockReadLockfile.mockReset();
		mockIsFramewrightProcess.mockReset();

		mockReadLockfile.mockResolvedValue({ pid: 999, port: 5001, token: "tok-repo" });
		mockIsFramewrightProcess.mockResolvedValue(true);

		await getOrCreateConnection({
			repoDir: "/Users/someone/my-fork",
			pollIntervalMs: FAST_POLL_MS,
			spawnTimeoutMs: SHORT_TIMEOUT_MS,
		});

		expect(mockIsFramewrightProcess).toHaveBeenCalledWith(999, "/Users/someone/my-fork");
	});

	it("passes repoDir through to isFramewrightProcess while polling after a spawn", async () => {
		mockSpawn.mockClear();
		mockReadLockfile.mockReset();
		mockIsFramewrightProcess.mockReset();

		setupMocks(
			[null, { pid: 1000, port: 5002, token: "tok-repo2" }],
			[false, true],
		);

		await getOrCreateConnection({
			repoDir: "/Users/someone/my-fork",
			spawnTimeoutMs: SHORT_TIMEOUT_MS,
			pollIntervalMs: FAST_POLL_MS,
		});

		expect(mockIsFramewrightProcess).toHaveBeenCalledWith(1000, "/Users/someone/my-fork");
	});

	it("spawns npm run dev when no live lockfile exists and no debounce is active", async () => {
		mockSpawn.mockClear();
		mockReadLockfile.mockReset();
		mockIsFramewrightProcess.mockReset();

		// First call: no lockfile. After spawn, lockfile appears.
		setupMocks(
			[null, { pid: 222, port: 6000, token: "tok2" }],
			[false, true],
		);

		const client = await getOrCreateConnection({
			repoDir: "/repo",
			spawnTimeoutMs: SHORT_TIMEOUT_MS,
			pollIntervalMs: FAST_POLL_MS,
		});

		expect(mockSpawn).toHaveBeenCalledTimes(1);
		expect(RpcClient).toHaveBeenCalledWith(6000, "tok2");
		expect(client).toEqual({ port: 6000, token: "tok2" });
	});

	it("does NOT spawn a second time during the debounce window after a recent spawn", async () => {
		mockSpawn.mockClear();
		mockReadLockfile.mockReset();
		mockIsFramewrightProcess.mockReset();

		// First call: lockfile missing then appears.
		setupMocks(
			[null, { pid: 333, port: 7000, token: "tok3" }],
			[false, true],
		);

		const first = await getOrCreateConnection({
			repoDir: "/repo",
			spawnTimeoutMs: SHORT_TIMEOUT_MS,
			pollIntervalMs: FAST_POLL_MS,
		});

		// Second call: lockfile already valid — should attach without spawning.
		mockReadLockfile.mockResolvedValue({ pid: 333, port: 7000, token: "tok3" });
		mockIsFramewrightProcess.mockResolvedValue(true);

		const second = await getOrCreateConnection({
			repoDir: "/repo",
			spawnTimeoutMs: SHORT_TIMEOUT_MS,
			pollIntervalMs: FAST_POLL_MS,
		});

		expect(mockSpawn).toHaveBeenCalledTimes(1);
		expect(first).toEqual({ port: 7000, token: "tok3" });
		expect(second).toEqual({ port: 7000, token: "tok3" });
	});

	it("treats a stale lockfile whose PID is not a Framewright process as 'no live instance'", async () => {
		mockSpawn.mockClear();
		mockReadLockfile.mockReset();
		mockIsFramewrightProcess.mockReset();

		// Initial check sees stale lockfile (PID not Framewright), then post-spawn sees fresh.
		setupMocks(
			[
				{ pid: 444, port: 8000, token: "stale" },
				{ pid: 555, port: 9000, token: "fresh" },
			],
			[false, true],
		);

		const client = await getOrCreateConnection({
			repoDir: "/repo",
			spawnTimeoutMs: SHORT_TIMEOUT_MS,
			pollIntervalMs: FAST_POLL_MS,
		});

		expect(mockSpawn).toHaveBeenCalledTimes(1);
		expect(client).toEqual({ port: 9000, token: "fresh" });
	});

	it("clears the debounce once a live lockfile is observed, so re-launch after close works", async () => {
		mockSpawn.mockClear();
		mockReadLockfile.mockReset();
		mockIsFramewrightProcess.mockReset();

		// First launch: spawn + lockfile appears.
		setupMocks(
			[null, { pid: 666, port: 10000, token: "tok6" }],
			[false, true],
		);
		await getOrCreateConnection({
			repoDir: "/repo",
			spawnTimeoutMs: SHORT_TIMEOUT_MS,
			pollIntervalMs: FAST_POLL_MS,
		});

		// User closes the app. Next call sees lockfile with dead PID → should spawn again.
		setupMocks(
			[
				{ pid: 666, port: 10000, token: "tok6" }, // stale (PID no longer Framewright)
				{ pid: 777, port: 11000, token: "tok7" }, // fresh after new spawn
			],
			[false, true],
		);

		await getOrCreateConnection({
			repoDir: "/repo",
			spawnTimeoutMs: SHORT_TIMEOUT_MS,
			pollIntervalMs: FAST_POLL_MS,
		});

		expect(mockSpawn).toHaveBeenCalledTimes(2);
	});

	it("suppresses spawn attempts during the debounce window when the app hasn't appeared yet", async () => {
		mockSpawn.mockClear();
		mockReadLockfile.mockReset();
		mockIsFramewrightProcess.mockReset();

		// First call: lockfile never appears, spawn times out.
		setupMocks([null], [false]);
		await expect(
			getOrCreateConnection({
				repoDir: "/repo",
				spawnTimeoutMs: 30,
				pollIntervalMs: FAST_POLL_MS,
			}),
		).rejects.toThrow(/Timed out/);

		expect(mockSpawn).toHaveBeenCalledTimes(1);

		// Second call immediately after — within debounce window. Should NOT spawn again.
		// Lockfile appears mid-poll, so we return a client.
		mockReadLockfile.mockResolvedValueOnce(null); // first poll: nothing yet
		mockReadLockfile.mockResolvedValue({ pid: 888, port: 12000, token: "tok8" }); // subsequent polls: live
		mockIsFramewrightProcess.mockResolvedValueOnce(false);
		mockIsFramewrightProcess.mockResolvedValue(true);

		const client = await getOrCreateConnection({
			repoDir: "/repo",
			spawnTimeoutMs: SHORT_TIMEOUT_MS,
			pollIntervalMs: FAST_POLL_MS,
		});

		// Still only one spawn total — second call was suppressed by debounce.
		expect(mockSpawn).toHaveBeenCalledTimes(1);
		expect(client).toEqual({ port: 12000, token: "tok8" });
	});
});
