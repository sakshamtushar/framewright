import { ipcMain } from "electron";

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry of IPC handlers with unrelated signatures; a narrower type would break every real handler's assignability to this map.
export type IpcHandlerFn = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any;

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
