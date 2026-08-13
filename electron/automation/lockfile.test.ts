import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userDataDir: string;

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => {
			if (name === "userData") return userDataDir;
			throw new Error(`unexpected app.getPath("${name}") in test`);
		},
	},
}));

import { getLockfilePath, removeLockfile, writeLockfile } from "./lockfile";

describe("automation lockfile", () => {
	beforeEach(async () => {
		userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-lockfile-test-"));
	});

	afterEach(async () => {
		await fs.rm(userDataDir, { recursive: true, force: true });
	});

	it("writes lockfile contents as JSON under userData", async () => {
		await writeLockfile({ pid: 123, port: 4567, token: "abc" });
		const raw = await fs.readFile(getLockfilePath(), "utf8");
		expect(JSON.parse(raw)).toEqual({ pid: 123, port: 4567, token: "abc" });
	});

	it("removes the lockfile when it identifies this process", async () => {
		await writeLockfile({ pid: process.pid, port: 4567, token: "abc" });
		await removeLockfile();
		await expect(fs.access(getLockfilePath())).rejects.toThrow();
	});

	it("does not remove a lockfile that identifies a different process", async () => {
		// A different (and, for the test, definitely-not-us) pid — simulates a lockfile a
		// different Framewright instance has since written, e.g. after a rapid restart.
		await writeLockfile({ pid: process.pid + 1, port: 4567, token: "abc" });
		await removeLockfile();
		await expect(fs.access(getLockfilePath())).resolves.toBeUndefined();
	});

	it("removeLockfile does not throw when no lockfile exists", async () => {
		await expect(removeLockfile()).resolves.toBeUndefined();
	});

	it("enforces 0o600 permissions on lockfile", async () => {
		await writeLockfile({ pid: 123, port: 4567, token: "abc" });
		const stat = await fs.stat(getLockfilePath());
		const mode = stat.mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it("enforces 0o600 permissions when overwriting existing lockfile", async () => {
		const lockfilePath = getLockfilePath();
		// Write a lockfile with different permissions (simulating stale lockfile)
		await fs.writeFile(lockfilePath, "stale", { mode: 0o644 });
		let stat = await fs.stat(lockfilePath);
		expect(stat.mode & 0o777).toBe(0o644);

		// Overwrite with new data
		await writeLockfile({ pid: 456, port: 8901, token: "xyz" });

		// Verify new content
		const raw = await fs.readFile(lockfilePath, "utf8");
		expect(JSON.parse(raw)).toEqual({ pid: 456, port: 8901, token: "xyz" });

		// Verify permissions are reset to 0o600
		stat = await fs.stat(lockfilePath);
		const mode = stat.mode & 0o777;
		expect(mode).toBe(0o600);
	});
});
