import path from "node:path";
import { describe, expect, it } from "vitest";
import { getLockfilePath, getRecordlyDevUserDataPath } from "./paths.js";

describe("getRecordlyDevUserDataPath", () => {
	it("uses ~/Library/Application Support on darwin", () => {
		const result = getRecordlyDevUserDataPath("darwin", "/Users/test");
		expect(result).toBe(path.join("/Users/test", "Library", "Application Support", "Recordly-dev"));
	});

	it("uses %APPDATA% on win32 when set", () => {
		const result = getRecordlyDevUserDataPath("win32", "C:\\Users\\test", "C:\\Users\\test\\AppData\\Roaming");
		expect(result).toBe(path.join("C:\\Users\\test\\AppData\\Roaming", "Recordly-dev"));
	});

	it("falls back to AppData/Roaming on win32 when %APPDATA% is unset", () => {
		const result = getRecordlyDevUserDataPath("win32", "C:\\Users\\test", undefined);
		expect(result).toBe(path.join("C:\\Users\\test", "AppData", "Roaming", "Recordly-dev"));
	});

	it("uses ~/.config on linux", () => {
		const result = getRecordlyDevUserDataPath("linux", "/home/test");
		expect(result).toBe(path.join("/home/test", ".config", "Recordly-dev"));
	});
});

describe("getLockfilePath", () => {
	it("appends mcp.lock.json to the user data path", () => {
		const result = getLockfilePath("linux", "/home/test");
		expect(result).toBe(path.join("/home/test", ".config", "Recordly-dev", "mcp.lock.json"));
	});
});
