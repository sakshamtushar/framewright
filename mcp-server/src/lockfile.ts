import fs from "node:fs/promises";
import { getLockfilePath } from "./paths";

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
