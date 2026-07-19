import path from "node:path";
import os from "node:os";

const APP_DATA_DIR_NAME = "Recordly-dev";
const LOCKFILE_NAME = "mcp.lock.json";

/**
 * Mirrors electron/appPaths.ts's dev-mode userData path
 * (path.join(app.getPath("appData"), "Recordly-dev")) without depending on Electron.
 */
export function getRecordlyDevUserDataPath(
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
	return path.join(getRecordlyDevUserDataPath(platform, homedir, appDataEnv), LOCKFILE_NAME);
}
