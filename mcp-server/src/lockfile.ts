import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { getLockfilePath } from "./paths.js";

const execFileAsync = promisify(execFile);

const COMMAND_LINE_LOOKUP_TIMEOUT_MS = 1000;

export interface AutomationLockfile {
	pid: number;
	port: number;
	token: string;
}

export async function readLockfile(): Promise<AutomationLockfile | null> {
	try {
		const raw = await fs.readFile(getLockfilePath(), "utf8");
		const parsed = JSON.parse(raw);
		if (
			typeof parsed?.pid === "number" &&
			typeof parsed?.port === "number" &&
			typeof parsed?.token === "string"
		) {
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

export function isProcessAlive(pid: number): boolean {
	try {
		// Signal 0 performs no-op existence/permission checks without killing anything.
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Pure helper: returns true if a process command line looks like a Framewright
 * Electron main process. Used by `isFramewrightProcess` and exported for unit testing.
 *
 * Matches:
 *   - Packaged binary paths containing "Framewright" / "framewright"
 *   - Legacy packaged binary paths containing "Recordly" / "recordly"
 *   - Dev mode: `vite-plugin-electron` spawns Electron with the main entry as an
 *     argument, so the command line contains the path to `electron/main` (e.g.
 *     `dist-electron/electron/main.cjs`).
 */
export function commandLineMatchesFramewright(cmdline: string): boolean {
	if (!cmdline) return false;
	const lower = cmdline.toLowerCase();
	if (lower.includes("framewright")) return true;
	if (lower.includes("recordly")) return true;
	if (lower.includes("electron/main")) return true;
	if (lower.includes("electron-main")) return true;
	return false;
}

/**
 * Verify the process at `pid` is actually a Framewright Electron main process,
 * not just any process occupying that PID slot (which can happen after PID reuse
 * once the original Framewright instance has died). On any platform-specific
 * lookup failure we fall back to `isProcessAlive` so we don't regress behavior.
 */
export async function isFramewrightProcess(pid: number): Promise<boolean> {
	if (!isProcessAlive(pid)) return false;

	let cmdline: string | null = null;
	try {
		cmdline = await getProcessCommandLine(pid);
	} catch {
		// Be permissive: process exists, can't introspect, treat as alive.
		return true;
	}

	if (cmdline === null) return true;
	return commandLineMatchesFramewright(cmdline);
}

async function getProcessCommandLine(pid: number): Promise<string | null> {
	const timeout = COMMAND_LINE_LOOKUP_TIMEOUT_MS;

	if (process.platform === "darwin") {
		const { stdout } = await execFileAsync(
			"ps",
			["-p", String(pid), "-o", "command="],
			{ timeout },
		);
		return stdout.trim() || null;
	}

	if (process.platform === "linux") {
		try {
			const raw = await fs.readFile(`/proc/${pid}/cmdline`, "utf8");
			const normalized = raw.replace(/\0/g, " ").trim();
			return normalized || null;
		} catch {
			const { stdout } = await execFileAsync(
				"ps",
				["-p", String(pid), "-o", "args="],
				{ timeout },
			);
			return stdout.trim() || null;
		}
	}

	if (process.platform === "win32") {
		// Prefer PowerShell's CIM cmdline (rich); fall back to wmic / tasklist.
		try {
			const { stdout } = await execFileAsync(
				"powershell",
				[
					"-NoProfile",
					"-Command",
					`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
				],
				{ timeout },
			);
			const trimmed = stdout.trim();
			if (trimmed) return trimmed;
		} catch {
			// fall through
		}

		try {
			const { stdout } = await execFileAsync(
				"wmic",
				["process", "where", `ProcessId=${pid}`, "get", "CommandLine", "/format:list"],
				{ timeout },
			);
			const match = stdout.match(/CommandLine=(.+)/);
			if (match) return match[1].trim();
		} catch {
			// fall through
		}

		const { stdout } = await execFileAsync(
			"tasklist",
			["/FI", `PID eq ${pid}`, "/FO", "LIST", "/NH"],
			{ timeout },
		);
		return stdout.trim() || null;
	}

	return null;
}
