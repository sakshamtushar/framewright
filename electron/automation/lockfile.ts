import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

export interface AutomationLockfile {
	pid: number;
	port: number;
	token: string;
}

const LOCKFILE_NAME = "mcp.lock.json";

export function getLockfilePath(): string {
	return path.join(app.getPath("userData"), LOCKFILE_NAME);
}

export async function writeLockfile(data: AutomationLockfile): Promise<void> {
	const path = getLockfilePath();
	await fs.writeFile(path, JSON.stringify(data), { mode: 0o600 });
	await fs.chmod(path, 0o600);
}

/**
 * Removes the lockfile only if it still identifies this process. Without this check, a
 * process that's shutting down could delete a lockfile that a *different* Framewright
 * instance has since written (e.g. after a rapid restart, or a race during a
 * single-instance-lock handoff), orphaning that instance's MCP clients even though it's
 * still alive.
 */
export async function removeLockfile(): Promise<void> {
	const lockPath = getLockfilePath();
	try {
		const raw = await fs.readFile(lockPath, "utf8");
		const parsed = JSON.parse(raw);
		if (parsed?.pid !== process.pid) {
			return;
		}
	} catch {
		// Missing or unreadable — nothing of ours to remove.
		return;
	}
	await fs.rm(lockPath, { force: true });
}
