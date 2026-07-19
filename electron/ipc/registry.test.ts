import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from "electron";
import { handle, ipcHandlerRegistry } from "./registry";

describe("handle", () => {
	it("registers the handler with ipcMain.handle", () => {
		const fn = vi.fn();
		handle("test-channel", fn);
		expect(ipcMain.handle).toHaveBeenCalledWith("test-channel", fn);
	});

	it("stores the handler in ipcHandlerRegistry under its channel name", () => {
		const fn = vi.fn();
		handle("another-channel", fn);
		expect(ipcHandlerRegistry.get("another-channel")).toBe(fn);
	});
});
