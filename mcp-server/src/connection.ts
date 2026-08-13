import { spawn } from "node:child_process";
import { clearSpawnMarker, isFramewrightProcess, readLockfile, tryClaimSpawn } from "./lockfile.js";
import { RpcClient } from "./rpcClient.js";

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_SPAWN_TIMEOUT_MS = 60_000;

// When `getOrCreateConnection` decides the app isn't running and spawns
// `npm run dev`, this window suppresses follow-up spawns from racing MCP
// reconnects so we don't open a stack of detached Electron processes. Backed by a
// cross-process marker file (see lockfile.ts's tryClaimSpawn) since each MCP
// client spawns its own separate process — an in-memory flag here would be
// invisible to a sibling process racing the same decision. The window resets the
// moment we successfully observe a live lockfile, so the user can deliberately
// re-launch the app immediately after closing it. Must be >= DEFAULT_SPAWN_TIMEOUT_MS
// — otherwise the debounce could expire mid-spawn and let a second `npm run dev`
// start while the first one is still legitimately starting up.
const SPAWN_DEBOUNCE_MS = 60_000;

async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLockfile(
	timeoutMs: number,
	pollIntervalMs: number,
	repoDir: string,
): Promise<{ port: number; token: string } | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const lockfile = await readLockfile();
		if (lockfile && (await isFramewrightProcess(lockfile.pid, repoDir))) {
			return { port: lockfile.port, token: lockfile.token };
		}
		await delay(pollIntervalMs);
	}
	return null;
}

async function spawnAppAndWait(
	repoDir: string,
	timeoutMs: number,
	pollIntervalMs: number,
): Promise<RpcClient> {
	const token = crypto.randomUUID();

	spawn("npm", ["run", "dev"], {
		cwd: repoDir,
		env: { ...process.env, FRAMEWRIGHT_MCP_TOKEN: token },
		detached: true,
		stdio: "ignore",
	}).unref();

	const lockfile = await waitForLockfile(timeoutMs, pollIntervalMs, repoDir);
	if (!lockfile) {
		// Keep the debounce marker set so a tight retry loop can't keep spawning.
		throw new Error(
			"Timed out waiting for Framewright to start. Check that `npm run dev` succeeds in the Framewright repo.",
		);
	}

	// App is up — clear the marker so the user can immediately re-launch after closing.
	await clearSpawnMarker();
	return new RpcClient(lockfile.port, lockfile.token);
}

async function waitForInFlightSpawn(
	timeoutMs: number,
	pollIntervalMs: number,
	repoDir: string,
): Promise<RpcClient> {
	// We're inside the debounce window. Don't spawn again — just wait for the
	// already-in-flight `npm run dev` (or whatever lockfile shows up) to be live.
	const lockfile = await waitForLockfile(timeoutMs, pollIntervalMs, repoDir);
	if (!lockfile) {
		throw new Error(
			"Timed out waiting for Framewright to start. Check that `npm run dev` succeeds in the Framewright repo.",
		);
	}
	await clearSpawnMarker();
	return new RpcClient(lockfile.port, lockfile.token);
}

export async function getOrCreateConnection(options: {
	repoDir: string;
	spawnTimeoutMs?: number;
	pollIntervalMs?: number;
}): Promise<RpcClient> {
	const timeoutMs = options.spawnTimeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

	const existing = await readLockfile();
	if (existing && (await isFramewrightProcess(existing.pid, options.repoDir))) {
		// App is already up. Clear any stale debounce marker.
		await clearSpawnMarker();
		return new RpcClient(existing.port, existing.token);
	}

	const claimed = await tryClaimSpawn(SPAWN_DEBOUNCE_MS);
	if (!claimed) {
		return waitForInFlightSpawn(timeoutMs, pollIntervalMs, options.repoDir);
	}

	return spawnAppAndWait(options.repoDir, timeoutMs, pollIntervalMs);
}
