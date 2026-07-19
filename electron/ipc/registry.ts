import { ipcMain } from "electron";

export type IpcHandlerFn = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export const ipcHandlerRegistry = new Map<string, IpcHandlerFn>();

/**
 * Drop-in replacement for ipcMain.handle that also records the handler in
 * ipcHandlerRegistry, so main-process code (e.g. the automation server) can
 * invoke the exact same handler logic without a real renderer IPC event.
 */
export function handle(channel: string, fn: IpcHandlerFn) {
	ipcHandlerRegistry.set(channel, fn);
	ipcMain.handle(channel, fn);
}
