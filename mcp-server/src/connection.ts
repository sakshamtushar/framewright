import { spawn } from "node:child_process";
import { isProcessAlive, readLockfile } from "./lockfile";
import { RpcClient } from "./rpcClient";

const POLL_INTERVAL_MS = 500;
const DEFAULT_SPAWN_TIMEOUT_MS = 60_000;

async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getOrCreateConnection(options: {
	repoDir: string;
	spawnTimeoutMs?: number;
}): Promise<RpcClient> {
	const existing = await readLockfile();
	if (existing && isProcessAlive(existing.pid)) {
		return new RpcClient(existing.port, existing.token);
	}

	const token = crypto.randomUUID();
	spawn("npm", ["run", "dev"], {
		cwd: options.repoDir,
		env: { ...process.env, RECORDLY_MCP_TOKEN: token },
		detached: true,
		stdio: "ignore",
	}).unref();

	const deadline = Date.now() + (options.spawnTimeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS);
	while (Date.now() < deadline) {
		const lockfile = await readLockfile();
		if (lockfile && lockfile.token === token && isProcessAlive(lockfile.pid)) {
			return new RpcClient(lockfile.port, lockfile.token);
		}
		await delay(POLL_INTERVAL_MS);
	}

	throw new Error(
		"Timed out waiting for Recordly to start. Check that `npm run dev` succeeds in the Recordly repo.",
	);
}
