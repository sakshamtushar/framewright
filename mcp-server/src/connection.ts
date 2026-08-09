import { spawn } from "node:child_process";
import { isFramewrightProcess, readLockfile } from "./lockfile.js";
import { RpcClient } from "./rpcClient.js";

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_SPAWN_TIMEOUT_MS = 60_000;

// When `getOrCreateConnection` decides the app isn't running and spawns
// `npm run dev`, this window suppresses follow-up spawns from racing MCP
// reconnects so we don't open a stack of detached Electron processes. The
// window resets the moment we successfully observe a live lockfile, so the
// user can deliberately re-launch the app immediately after closing it.
const SPAWN_DEBOUNCE_MS = 30_000;

let lastSpawnTimestamp = 0;

async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLockfile(
	timeoutMs: number,
	pollIntervalMs: number,
): Promise<{ port: number; token: string } | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const lockfile = await readLockfile();
		if (lockfile && (await isFramewrightProcess(lockfile.pid))) {
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
	lastSpawnTimestamp = Date.now();

	spawn("npm", ["run", "dev"], {
		cwd: repoDir,
		env: { ...process.env, FRAMEWRIGHT_MCP_TOKEN: token },
		detached: true,
		stdio: "ignore",
	}).unref();

	const lockfile = await waitForLockfile(timeoutMs, pollIntervalMs);
	if (!lockfile) {
		// Keep the debounce set so a tight retry loop can't keep spawning.
		throw new Error(
			"Timed out waiting for Framewright to start. Check that `npm run dev` succeeds in the Framewright repo.",
		);
	}

	// App is up — clear debounce so the user can immediately re-launch after closing.
	lastSpawnTimestamp = 0;
	return new RpcClient(lockfile.port, lockfile.token);
}

async function waitForInFlightSpawn(
	timeoutMs: number,
	pollIntervalMs: number,
): Promise<RpcClient> {
	// We're inside the debounce window. Don't spawn again — just wait for the
	// already-in-flight `npm run dev` (or whatever lockfile shows up) to be live.
	const lockfile = await waitForLockfile(timeoutMs, pollIntervalMs);
	if (!lockfile) {
		throw new Error(
			"Timed out waiting for Framewright to start. Check that `npm run dev` succeeds in the Framewright repo.",
		);
	}
	lastSpawnTimestamp = 0;
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
	if (existing && (await isFramewrightProcess(existing.pid))) {
		// App is already up. Clear any stale debounce state.
		lastSpawnTimestamp = 0;
		return new RpcClient(existing.port, existing.token);
	}

	const withinDebounce =
		lastSpawnTimestamp > 0 && Date.now() - lastSpawnTimestamp < SPAWN_DEBOUNCE_MS;

	if (withinDebounce) {
		return waitForInFlightSpawn(timeoutMs, pollIntervalMs);
	}

	return spawnAppAndWait(options.repoDir, timeoutMs, pollIntervalMs);
}
