import os from "node:os";
import path from "node:path";

const APP_DATA_DIR_NAME = "Framewright-dev";
const LOCKFILE_NAME = "mcp.lock.json";
const SPAWN_MARKER_NAME = "mcp.spawn-marker.json";

/**
 * Mirrors electron/appPaths.ts's dev-mode userData path
 * (path.join(app.getPath("appData"), "Framewright-dev")) without depending on Electron.
 */
export function getFramewrightDevUserDataPath(
	platform: NodeJS.Platform = process.platform,
	homedir: string = os.homedir(),
	appDataEnv: string | undefined = process.env.APPDATA,
): string {
	let appDataRoot: string;
	if (platform === "darwin") {
		appDataRoot = path.join(homedir, "Library", "Application Support");
	} else if (platform === "win32") {
		appDataRoot = appDataEnv ?? path.join(homedir, "AppData", "Roaming");
	} else {
		appDataRoot = path.join(homedir, ".config");
	}
	return path.join(appDataRoot, APP_DATA_DIR_NAME);
}

export function getLockfilePath(
	platform: NodeJS.Platform = process.platform,
	homedir: string = os.homedir(),
	appDataEnv: string | undefined = process.env.APPDATA,
): string {
	return path.join(getFramewrightDevUserDataPath(platform, homedir, appDataEnv), LOCKFILE_NAME);
}

/**
 * Cross-process spawn debounce marker. An in-memory flag (e.g. a module-level
 * timestamp) is invisible to other `mcp-server` processes — each MCP client spawns
 * its own separate `node dist/index.js` process, so a debounce that only lives in
 * one process's memory doesn't stop a *different* process from also deciding to
 * spawn `npm run dev` at the same time. This file-based marker is shared across
 * all of them.
 */
export function getSpawnMarkerPath(
	platform: NodeJS.Platform = process.platform,
	homedir: string = os.homedir(),
	appDataEnv: string | undefined = process.env.APPDATA,
): string {
	return path.join(
		getFramewrightDevUserDataPath(platform, homedir, appDataEnv),
		SPAWN_MARKER_NAME,
	);
}
