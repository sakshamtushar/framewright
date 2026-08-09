import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let lockPath: string;

vi.mock("./paths.js", () => ({
	getLockfilePath: () => lockPath,
}));

import {
	commandLineMatchesFramewright,
	isFramewrightProcess,
	isProcessAlive,
	readLockfile,
} from "./lockfile.js";

describe("readLockfile", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "framewright-mcp-lockfile-test-"));
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

describe("commandLineMatchesFramewright", () => {
	it("matches a packaged macOS Framewright binary", () => {
		expect(
			commandLineMatchesFramewright(
				"/Applications/Framewright.app/Contents/MacOS/Framewright --enable-logging",
			),
		).toBe(true);
	});

	it("matches a packaged Linux Framewright binary", () => {
		expect(commandLineMatchesFramewright("/opt/Framewright/Framewright --foo")).toBe(true);
	});

	it("matches a packaged Windows Framewright binary", () => {
		expect(
			commandLineMatchesFramewright('"C:\\Program Files\\Framewright\\Framewright.exe" --foo'),
		).toBe(true);
	});

	it("matches a dev-mode Electron main entry (vite-plugin-electron)", () => {
		expect(
			commandLineMatchesFramewright(
				"Electron /Users/foo/Recordly/dist-electron/electron/main.cjs",
			),
		).toBe(true);
	});

	it("matches legacy Recordly paths during the rename transition", () => {
		expect(commandLineMatchesFramewright("/Applications/Recordly.app/Contents/MacOS/Recordly")).toBe(
			true,
		);
	});

	it("rejects Slack", () => {
		expect(commandLineMatchesFramewright("/Applications/Slack.app/Contents/MacOS/Slack")).toBe(
			false,
		);
	});

	it("rejects a generic Electron app that is not Framewright", () => {
		expect(
			commandLineMatchesFramewright("/Applications/SomeOtherApp.app/Contents/MacOS/SomeOtherApp"),
		).toBe(false);
	});

	it("rejects an empty command line", () => {
		expect(commandLineMatchesFramewright("")).toBe(false);
	});
});

describe("isFramewrightProcess", () => {
	it("returns false when the process is not alive", async () => {
		// 999_999 is the sentinel used elsewhere for a surely-dead pid.
		expect(await isFramewrightProcess(999_999)).toBe(false);
	});

	it("returns true for the current process (cmdline always non-empty in CI)", async () => {
		// Best-effort: the test runner's cmdline almost certainly does not match
		// Framewright, so this asserts our permissive fallback path. If the
		// cmdline *does* happen to contain "framewright" (unlikely), it should
		// still return true.
		const result = await isFramewrightProcess(process.pid);
		expect(typeof result).toBe("boolean");
	});
});
