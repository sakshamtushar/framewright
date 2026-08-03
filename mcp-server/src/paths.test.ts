import path from "node:path";
import { describe, expect, it } from "vitest";
import { getFramewrightDevUserDataPath, getLockfilePath } from "./paths.js";

describe("getFramewrightDevUserDataPath", () => {
	it("uses ~/Library/Application Support on darwin", () => {
		const result = getFramewrightDevUserDataPath("darwin", "/Users/test");
		expect(result).toBe(path.join("/Users/test", "Library", "Application Support", "Framewright-dev"));
	});

	it("uses %APPDATA% on win32 when set", () => {
		const result = getFramewrightDevUserDataPath("win32", "C:\\Users\\test", "C:\\Users\\test\\AppData\\Roaming");
		expect(result).toBe(path.join("C:\\Users\\test\\AppData\\Roaming", "Framewright-dev"));
	});

	it("falls back to AppData/Roaming on win32 when %APPDATA% is unset", () => {
		const result = getFramewrightDevUserDataPath("win32", "C:\\Users\\test", undefined);
		expect(result).toBe(path.join("C:\\Users\\test", "AppData", "Roaming", "Framewright-dev"));
	});

	it("uses ~/.config on linux", () => {
		const result = getFramewrightDevUserDataPath("linux", "/home/test");
		expect(result).toBe(path.join("/home/test", ".config", "Framewright-dev"));
	});
});

describe("getLockfilePath", () => {
	it("appends mcp.lock.json to the user data path", () => {
		const result = getLockfilePath("linux", "/home/test");
		expect(result).toBe(path.join("/home/test", ".config", "Framewright-dev", "mcp.lock.json"));
	});
});
