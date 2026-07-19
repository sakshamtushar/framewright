import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let lockPath: string;

vi.mock("./paths", () => ({
	getLockfilePath: () => lockPath,
}));

import { isProcessAlive, readLockfile } from "./lockfile";

describe("readLockfile", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-mcp-lockfile-test-"));
		lockPath = path.join(dir, "mcp.lock.json");
	});

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	it("returns null when the lockfile does not exist", async () => {
		expect(await readLockfile()).toBeNull();
	});

	it("returns the parsed lockfile contents when present", async () => {
		await fs.writeFile(lockPath, JSON.stringify({ pid: 42, port: 5555, token: "tok" }));
		expect(await readLockfile()).toEqual({ pid: 42, port: 5555, token: "tok" });
	});

	it("returns null when the lockfile contains invalid JSON", async () => {
		await fs.writeFile(lockPath, "not json");
		expect(await readLockfile()).toBeNull();
	});
});

describe("isProcessAlive", () => {
	it("returns true for the current process", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
	});

	it("returns false for a pid that almost certainly does not exist", () => {
		expect(isProcessAlive(999_999)).toBe(false);
	});
});
