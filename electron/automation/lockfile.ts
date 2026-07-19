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
	await fs.writeFile(getLockfilePath(), JSON.stringify(data), { mode: 0o600 });
}

export async function removeLockfile(): Promise<void> {
	await fs.rm(getLockfilePath(), { force: true });
}
