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

	it("removes the lockfile", async () => {
		await writeLockfile({ pid: 123, port: 4567, token: "abc" });
		await removeLockfile();
		await expect(fs.access(getLockfilePath())).rejects.toThrow();
	});

	it("removeLockfile does not throw when no lockfile exists", async () => {
		await expect(removeLockfile()).resolves.toBeUndefined();
	});
});
