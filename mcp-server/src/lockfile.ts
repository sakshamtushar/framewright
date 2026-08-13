import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getLockfilePath, getSpawnMarkerPath } from "./paths.js";

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

/**
 * Cross-process spawn debounce, backed by an atomically-created marker file (see
 * `getSpawnMarkerPath`'s doc comment for why an in-memory flag isn't enough).
 *
 * Returns `true` if this call successfully claimed the right to spawn `npm run dev`
 * (no other process has an unexpired claim) — the caller should proceed to spawn.
 * Returns `false` if another process already holds an unexpired claim — the caller
 * should wait for that in-flight spawn instead of starting a second one.
 *
 * `{ flag: "wx" }` is an atomic exclusive-create: it fails with ENOENT-adjacent
 * EEXIST if the file already exists, so two processes racing to claim can't both
 * succeed.
 */
export async function tryClaimSpawn(debounceMs: number): Promise<boolean> {
	const markerPath = getSpawnMarkerPath();
	const claim = { pid: process.pid, claimedAt: Date.now() };
	await fs.mkdir(path.dirname(markerPath), { recursive: true });
	try {
		await fs.writeFile(markerPath, JSON.stringify(claim), { flag: "wx" });
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			// Unexpected write failure (e.g. missing parent dir) — don't block spawning
			// on a debounce mechanism that can't function; behave as if unclaimed.
			return true;
		}
	}

	// Marker exists — check whether it's expired or corrupt, in which case we can
	// reclaim it ourselves rather than waiting out a stale window forever.
	try {
		const raw = await fs.readFile(markerPath, "utf8");
		const parsed = JSON.parse(raw);
		const claimedAt = typeof parsed?.claimedAt === "number" ? parsed.claimedAt : 0;
		if (Date.now() - claimedAt < debounceMs) {
			return false;
		}
	} catch {
		// Corrupt/unreadable marker — treat as expired and reclaim below.
	}

	try {
		await fs.writeFile(markerPath, JSON.stringify(claim));
		return true;
	} catch {
		// Couldn't reclaim — fall back to treating the marker as still held.
		return false;
	}
}

export async function clearSpawnMarker(): Promise<void> {
	await fs.rm(getSpawnMarkerPath(), { force: true });
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
 *   - Packaged binary paths containing "Framewright" / "framewright" (electron-builder
 *     controls this naming via productName, so it's reliable regardless of where the
 *     app is installed)
 *   - Legacy packaged binary paths containing "Recordly" / "recordly", for the rename
 *     transition period
 *   - Dev mode, keyed off the actual repo directory being controlled (`repoDir`), not
 *     a name guess: `npm run dev` resolves the `electron` binary from
 *     `<repoDir>/node_modules/electron/...`, so the command line always contains the
 *     repo's own path regardless of what the checkout folder is named. This is the
 *     precise check; the "electron/main" substring below is a looser fallback for
 *     when `repoDir` isn't available to compare against.
 *   - Dev mode fallback: `vite-plugin-electron` spawns Electron with the main entry as
 *     an argument, so the command line can contain the path to `electron/main` (e.g.
 *     `dist-electron/electron/main.cjs`).
 */
export function commandLineMatchesFramewright(cmdline: string, repoDir?: string): boolean {
	if (!cmdline) return false;
	const lower = cmdline.toLowerCase();
	if (lower.includes("framewright")) return true;
	if (lower.includes("recordly")) return true;
	if (repoDir && lower.includes(repoDir.toLowerCase())) return true;
	if (lower.includes("electron/main")) return true;
	if (lower.includes("electron-main")) return true;
	return false;
}

/**
 * Verify the process at `pid` is actually a Framewright Electron main process,
 * not just any process occupying that PID slot (which can happen after PID reuse
 * once the original Framewright instance has died). On any platform-specific
 * lookup failure we fall back to `isProcessAlive` so we don't regress behavior.
 *
 * Pass `repoDir` (the checkout `getOrCreateConnection` would spawn `npm run dev`
 * from) so dev-mode instances are recognized correctly no matter what the checkout
 * folder is named — see `commandLineMatchesFramewright`.
 */
export async function isFramewrightProcess(pid: number, repoDir?: string): Promise<boolean> {
	if (!isProcessAlive(pid)) return false;

	let cmdline: string | null = null;
	try {
		cmdline = await getProcessCommandLine(pid);
	} catch {
		// The lookup can fail either because we genuinely can't introspect a live process
		// (permissions, sandboxing) or because the process died between the isProcessAlive
		// check above and this lookup running. Re-check liveness to tell those apart rather
		// than assuming "alive" for both — the latter would otherwise attach to a dead
		// port/token and hang every subsequent call for the full RPC timeout instead of
		// triggering a respawn.
		return isProcessAlive(pid);
	}

	if (cmdline === null) return true;
	return commandLineMatchesFramewright(cmdline, repoDir);
}

async function getProcessCommandLine(pid: number): Promise<string | null> {
	const timeout = COMMAND_LINE_LOOKUP_TIMEOUT_MS;

	if (process.platform === "darwin") {
		const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="], {
			timeout,
		});
		return stdout.trim() || null;
	}

	if (process.platform === "linux") {
		try {
			const raw = await fs.readFile(`/proc/${pid}/cmdline`, "utf8");
			const normalized = raw.replace(/\0/g, " ").trim();
			return normalized || null;
		} catch {
			const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "args="], {
				timeout,
			});
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
