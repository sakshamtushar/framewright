# Recordly MCP — Phase 1 (Lifecycle + Recording + Project Read) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an MCP client (Claude) the ability to launch/attach to Recordly, enumerate capture sources, start/pause/resume/stop screen recordings, check status, and read project files — via a new automation server inside Recordly's Electron main process and a new standalone MCP server that manages Recordly's lifecycle and proxies to it.

**Architecture:** (1) A new `electron/ipc/registry.ts` captures every IPC handler function alongside its normal `ipcMain.handle` registration, so main-process code (including the new automation server) can invoke the exact same handler logic directly without a real IPC event. (2) A new `electron/automation/` module runs a token-authed, localhost-only WebSocket JSON-RPC server inside the Electron main process, started only when `RECORDLY_MCP_TOKEN` is set, and writes a lockfile other processes can discover. (3) A new standalone `mcp-server/` Node package uses `@modelcontextprotocol/sdk` over stdio; on first tool call it attaches to a running Recordly instance via the lockfile or spawns the dev build itself, then translates MCP tool calls into JSON-RPC calls against the automation server.

**Tech Stack:** TypeScript, Electron 43, `ws` (new dep, both sides), `@modelcontextprotocol/sdk` (new dep, `mcp-server/` only), Vitest, Biome (tabs, 100 col width).

## Global Constraints

- Follow existing repo conventions: tabs for indentation, Biome-formatted, `noUnusedLocals`/`noUnusedParameters` enabled in `tsconfig.json` (unused IPC event params must be prefixed `_`, matching existing handlers).
- The automation server must bind `127.0.0.1` only, require a per-launch random token, and never start unless `RECORDLY_MCP_TOKEN` env var is present at Electron startup (never on a normal manual launch).
- Both processes must agree on the lockfile location: Electron dev mode sets `userData` to `path.join(<OS appData root>, "Recordly-dev")` (see `electron/appPaths.ts:4-8`); `mcp-server/` must replicate that exact path without Electron.
- Vitest tests live next to the code they test (`*.test.ts`), matching existing files like `electron/gpuSwitches.test.ts`.
- This phase does **not** implement editing (timeline mutation) or export tools — those require a main→renderer bridge and deep exploration of `src/components/video-editor` state, and are deferred to a Phase 2 plan.

---

### Task 1: IPC handler registry + wire it into recording and source handlers

**Files:**
- Create: `electron/ipc/registry.ts`
- Create: `electron/ipc/registry.test.ts`
- Modify: `electron/ipc/register/recording.ts` (all 20 `ipcMain.handle(` call sites, all inside `registerRecordingHandlers`; remove now-unused `ipcMain` from the `electron` import)
- Modify: `electron/ipc/register/sources.ts` (all 6 `ipcMain.handle(` call sites, all inside `registerSourceHandlers`; remove now-unused `ipcMain` from the `electron` import)

**Interfaces:**
- Produces: `handle(channel: string, fn: IpcHandlerFn): void` — drop-in replacement for `ipcMain.handle` that also stores `fn` in `ipcHandlerRegistry`.
- Produces: `ipcHandlerRegistry: Map<string, IpcHandlerFn>` — read by the automation server (Task 3) to invoke handler logic directly, e.g. `ipcHandlerRegistry.get("get-sources")`.
- Produces: `type IpcHandlerFn = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown`.

- [ ] **Step 1: Write the failing test**

```typescript
// electron/ipc/registry.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/registry.test.ts`
Expected: FAIL with "Cannot find module './registry'" or similar.

- [ ] **Step 3: Write minimal implementation**

```typescript
// electron/ipc/registry.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/registry.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/registry.ts electron/ipc/registry.test.ts
git commit -m "feat: add IPC handler registry for main-process automation callers"
```

- [ ] **Step 6: Wire the registry into recording.ts**

In `electron/ipc/register/recording.ts`:
1. Change the `electron` import (lines 6-14) to drop `ipcMain` (it becomes unused once every call site below is replaced):
```typescript
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	shell,
	systemPreferences,
} from "electron";
```
2. Add a new import right after it: `import { handle } from "../registry";`
3. Replace every occurrence of `ipcMain.handle(` with `handle(` in this file (all 20 occurrences, all inside `registerRecordingHandlers`). Run:
```bash
sed -i '' 's/ipcMain\.handle(/handle(/g' electron/ipc/register/recording.ts
```
(On Linux, drop the `''` after `-i`.)

- [ ] **Step 7: Wire the registry into sources.ts**

In `electron/ipc/register/sources.ts`:
1. Change the `electron` import (line 3) to drop `ipcMain`:
```typescript
import { app, BrowserWindow, desktopCapturer } from "electron";
```
2. Add a new import right after it: `import { handle } from "../registry";`
3. Replace every occurrence of `ipcMain.handle(` with `handle(` (all 6 occurrences, all inside `registerSourceHandlers`):
```bash
sed -i '' 's/ipcMain\.handle(/handle(/g' electron/ipc/register/sources.ts
```

- [ ] **Step 8: Typecheck and fix any fallout**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `recording.ts` or `sources.ts`. If `ipcMain` still shows as unused-import or used-but-not-imported, double check step 6/7 removed it from the import and that no other `ipcMain.` usage remains in either file (there should be none — verified during planning via `grep -c "ipcMain\." electron/ipc/register/recording.ts electron/ipc/register/sources.ts`, which returned exactly the handle-call counts).

- [ ] **Step 9: Run full test suite to confirm no regressions**

Run: `npm test`
Expected: all existing tests still PASS (this change is a mechanical rename, not a logic change).

- [ ] **Step 10: Commit**

```bash
git add electron/ipc/register/recording.ts electron/ipc/register/sources.ts
git commit -m "refactor: route recording and source IPC handlers through the shared registry"
```

---

### Task 2: Automation server lockfile (Electron side)

**Files:**
- Create: `electron/automation/lockfile.ts`
- Create: `electron/automation/lockfile.test.ts`

**Interfaces:**
- Consumes: `app.getPath("userData")` from `electron` (already set to the dev-mode path by `electron/appPaths.ts` before this module is ever called, since `main.ts` imports `appPaths` first).
- Produces: `interface AutomationLockfile { pid: number; port: number; token: string }`
- Produces: `getLockfilePath(): string`
- Produces: `writeLockfile(data: AutomationLockfile): Promise<void>`
- Produces: `removeLockfile(): Promise<void>`

- [ ] **Step 1: Write the failing test**

```typescript
// electron/automation/lockfile.test.ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userDataDir: string;

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => {
			if (name === "userData") return userDataDir;
			throw new Error(`unexpected app.getPath("${name}") in test`);
		},
	},
}));

import { getLockfilePath, removeLockfile, writeLockfile } from "./lockfile";

describe("automation lockfile", () => {
	beforeEach(async () => {
		userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-lockfile-test-"));
	});

	afterEach(async () => {
		await fs.rm(userDataDir, { recursive: true, force: true });
	});

	it("writes lockfile contents as JSON under userData", async () => {
		await writeLockfile({ pid: 123, port: 4567, token: "abc" });
		const raw = await fs.readFile(getLockfilePath(), "utf8");
		expect(JSON.parse(raw)).toEqual({ pid: 123, port: 4567, token: "abc" });
	});

	it("removes the lockfile", async () => {
		await writeLockfile({ pid: 123, port: 4567, token: "abc" });
		await removeLockfile();
		await expect(fs.access(getLockfilePath())).rejects.toThrow();
	});

	it("removeLockfile does not throw when no lockfile exists", async () => {
		await expect(removeLockfile()).resolves.toBeUndefined();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/automation/lockfile.test.ts`
Expected: FAIL with "Cannot find module './lockfile'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// electron/automation/lockfile.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/automation/lockfile.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/automation/lockfile.ts electron/automation/lockfile.test.ts
git commit -m "feat: add automation server lockfile read/write"
```

---

### Task 3: Automation server (WebSocket JSON-RPC, Electron side)

**Files:**
- Modify: `package.json` (add `"ws": "^8.18.0"` to `dependencies`, `"@types/ws": "^8.5.13"` to `devDependencies`)
- Create: `electron/automation/server.ts`
- Create: `electron/automation/server.test.ts`

**Interfaces:**
- Consumes: `ipcHandlerRegistry` from `../ipc/registry` (Task 1), `writeLockfile`/`removeLockfile` from `./lockfile` (Task 2), `nativeScreenRecordingActive`, `windowsNativeCaptureActive`, `ffmpegScreenRecordingActive` from `../ipc/state`.
- Produces: `startAutomationServerIfRequested(): Promise<void>` — no-ops if `process.env.RECORDLY_MCP_TOKEN` is unset; otherwise starts the server, called once from `electron/main.ts` (Task 4).
- Produces: `stopAutomationServer(): Promise<void>` — called from `app.on("before-quit")` in `electron/main.ts`.

- [ ] **Step 1: Install the new dependency**

```bash
npm install ws@^8.18.0
npm install -D @types/ws@^8.5.13
```

Verify `package.json` now lists `"ws"` under `dependencies` and `"@types/ws"` under `devDependencies`.

- [ ] **Step 2: Write the failing test for the RPC dispatch logic**

The dispatch logic (method name → registry lookup → invoke → JSON-RPC response shape) is the part worth unit testing in isolation; the actual `WebSocketServer` wiring is covered by the Task 9 manual smoke test. Extract dispatch into an exported, directly-testable function.

```typescript
// electron/automation/server.test.ts
import { describe, expect, it, vi } from "vitest";
import { ipcHandlerRegistry } from "../ipc/registry";
import { dispatchRpcRequest } from "./server";

describe("dispatchRpcRequest", () => {
	it("returns a JSON-RPC result envelope when the method resolves", async () => {
		ipcHandlerRegistry.set("get-sources", async () => [{ id: "screen:0:0", name: "Screen 1" }]);

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 1,
			method: "sources.list",
			params: {},
		});

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: 1,
			result: [{ id: "screen:0:0", name: "Screen 1" }],
		});
	});

	it("returns a JSON-RPC error envelope for an unknown method", async () => {
		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 2,
			method: "not.a.real.method",
			params: {},
		});

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: 2,
			error: { code: -32601, message: "Unknown method: not.a.real.method" },
		});
	});

	it("returns a JSON-RPC error envelope when the underlying handler throws", async () => {
		ipcHandlerRegistry.set("start-native-screen-recording", async () => {
			throw new Error("boom");
		});

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 3,
			method: "recording.startNative",
			params: { source: { id: "screen:0:0" } },
		});

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: 3,
			error: { code: -32000, message: "boom" },
		});
	});

	it("app.status reports recording=false when nothing is active", async () => {
		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 4,
			method: "app.status",
			params: {},
		});

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: 4,
			result: { recording: false, platform: process.platform },
		});
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run electron/automation/server.test.ts`
Expected: FAIL with "Cannot find module './server'".

- [ ] **Step 4: Write minimal implementation**

```typescript
// electron/automation/server.ts
import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { app } from "electron";
import { ipcHandlerRegistry } from "../ipc/registry";
import { ffmpegScreenRecordingActive, nativeScreenRecordingActive, windowsNativeCaptureActive } from "../ipc/state";
import { removeLockfile, writeLockfile } from "./lockfile";

interface RpcRequest {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params: Record<string, unknown>;
}

interface RpcSuccess {
	jsonrpc: "2.0";
	id: number | string;
	result: unknown;
}

interface RpcFailure {
	jsonrpc: "2.0";
	id: number | string;
	error: { code: number; message: string };
}

type RpcResponse = RpcSuccess | RpcFailure;

/** Fake ipcMain.handle event — recording/source handlers never read `event`, only its args. */
const FAKE_EVENT = {} as Electron.IpcMainInvokeEvent;

const METHOD_TO_CHANNEL: Record<string, string> = {
	"sources.list": "get-sources",
	"recording.startNative": "start-native-screen-recording",
	"recording.startFfmpeg": "start-ffmpeg-recording",
	"recording.pause": "pause-native-screen-recording",
	"recording.resume": "resume-native-screen-recording",
	"recording.stopNative": "stop-native-screen-recording",
	"recording.stopFfmpeg": "stop-ffmpeg-recording",
	"project.list": "list-project-files",
	"project.read": "open-project-file-at-path",
};

function isRecording(): boolean {
	return nativeScreenRecordingActive || windowsNativeCaptureActive || ffmpegScreenRecordingActive;
}

async function callChannel(channel: string, params: Record<string, unknown>): Promise<unknown> {
	const handler = ipcHandlerRegistry.get(channel);
	if (!handler) {
		throw new Error(`No IPC handler registered for channel: ${channel}`);
	}
	// Every Phase-1 channel takes at most one positional argument beyond the
	// event (source, filePath, etc.) or none at all — see METHOD_TO_CHANNEL callers.
	if ("arg" in params) {
		return handler(FAKE_EVENT, params.arg);
	}
	return handler(FAKE_EVENT);
}

export async function dispatchRpcRequest(request: RpcRequest): Promise<RpcResponse> {
	try {
		if (request.method === "app.status") {
			return {
				jsonrpc: "2.0",
				id: request.id,
				result: { recording: isRecording(), platform: process.platform },
			};
		}

		const channel = METHOD_TO_CHANNEL[request.method];
		if (!channel) {
			return {
				jsonrpc: "2.0",
				id: request.id,
				error: { code: -32601, message: `Unknown method: ${request.method}` },
			};
		}

		const result = await callChannel(channel, request.params ?? {});
		return { jsonrpc: "2.0", id: request.id, result };
	} catch (error) {
		return {
			jsonrpc: "2.0",
			id: request.id,
			error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
		};
	}
}

let wss: WebSocketServer | null = null;

export async function startAutomationServerIfRequested(): Promise<void> {
	const token = process.env.RECORDLY_MCP_TOKEN;
	if (!token) {
		return;
	}

	wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });

	wss.on("connection", (socket: WebSocket, req) => {
		const url = new URL(req.url ?? "", "http://localhost");
		if (url.searchParams.get("token") !== token) {
			socket.close(4001, "invalid token");
			return;
		}

		socket.on("message", async (data) => {
			let request: RpcRequest;
			try {
				request = JSON.parse(data.toString());
			} catch {
				return; // ignore malformed frames
			}
			const response = await dispatchRpcRequest(request);
			socket.send(JSON.stringify(response));
		});
	});

	await new Promise<void>((resolve) => wss?.once("listening", () => resolve()));
	const address = wss.address();
	const port = typeof address === "object" && address ? address.port : 0;

	await writeLockfile({ pid: process.pid, port, token });

	app.on("before-quit", () => {
		void stopAutomationServer();
	});
}

export async function stopAutomationServer(): Promise<void> {
	await removeLockfile();
	if (wss) {
		await new Promise<void>((resolve) => wss?.close(() => resolve()));
		wss = null;
	}
}

// Exposed for RECORDLY_MCP_TOKEN generation callers (Task 4).
export function generateAutomationToken(): string {
	return randomBytes(24).toString("hex");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run electron/automation/server.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json electron/automation/server.ts electron/automation/server.test.ts
git commit -m "feat: add automation server WebSocket JSON-RPC dispatch"
```

---

### Task 4: Wire the automation server into app startup

**Files:**
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: `startAutomationServerIfRequested` from `./automation/server` (Task 3).

- [ ] **Step 1: Add the import**

In `electron/main.ts`, alongside the other local imports near the top (after the `./ipc/handlers` import block around line 29):

```typescript
import { startAutomationServerIfRequested } from "./automation/server";
```

- [ ] **Step 2: Start the server once IPC handlers are registered**

In the `app.whenReady().then(async () => { ... })` block, immediately after the existing `registerIpcHandlers(...)` and `registerExtensionIpcHandlers()` calls (around line 1045), add:

```typescript
	try {
		await startAutomationServerIfRequested();
	} catch (error) {
		console.warn("[automation] Failed to start automation server:", error);
	}
```

This must run after `registerIpcHandlers` so `ipcHandlerRegistry` (Task 1) is fully populated before the automation server can dispatch to it.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat: start automation server on app ready when RECORDLY_MCP_TOKEN is set"
```

---

### Task 5: `mcp-server` package scaffold + shared lockfile path resolution (Node side)

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`
- Create: `mcp-server/vitest.config.ts`
- Create: `mcp-server/src/paths.ts`
- Create: `mcp-server/src/paths.test.ts`

**Interfaces:**
- Produces: `getRecordlyDevUserDataPath(platform?: NodeJS.Platform): string` — must resolve to the exact same path as Electron's `app.getPath("userData")` in dev mode (`electron/appPaths.ts:4-8`: `path.join(<appData root>, "Recordly-dev")`).
- Produces: `getLockfilePath(platform?: NodeJS.Platform): string` — `path.join(getRecordlyDevUserDataPath(platform), "mcp.lock.json")`.

- [ ] **Step 1: Scaffold the package**

```json
// mcp-server/package.json
{
	"name": "recordly-mcp-server",
	"version": "0.1.0",
	"private": true,
	"type": "module",
	"scripts": {
		"build": "tsc",
		"test": "vitest --run",
		"start": "node dist/index.js"
	},
	"dependencies": {
		"@modelcontextprotocol/sdk": "^1.12.0",
		"ws": "^8.18.0"
	},
	"devDependencies": {
		"@types/node": "^25.0.3",
		"@types/ws": "^8.5.13",
		"typescript": "^5.2.2",
		"vitest": "^4.1.10"
	}
}
```

```json
// mcp-server/tsconfig.json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "NodeNext",
		"moduleResolution": "NodeNext",
		"outDir": "dist",
		"rootDir": "src",
		"strict": true,
		"noUnusedLocals": true,
		"noUnusedParameters": true,
		"esModuleInterop": true,
		"skipLibCheck": true
	},
	"include": ["src"],
	"exclude": ["**/*.test.ts"]
}
```

```typescript
// mcp-server/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
```

- [ ] **Step 2: Install dependencies**

```bash
cd mcp-server && npm install
```

- [ ] **Step 3: Write the failing test**

```typescript
// mcp-server/src/paths.test.ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getLockfilePath, getRecordlyDevUserDataPath } from "./paths";

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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/paths.test.ts`
Expected: FAIL with "Cannot find module './paths'".

- [ ] **Step 5: Write minimal implementation**

```typescript
// mcp-server/src/paths.ts
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/paths.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add mcp-server/package.json mcp-server/package-lock.json mcp-server/tsconfig.json mcp-server/vitest.config.ts mcp-server/src/paths.ts mcp-server/src/paths.test.ts
git commit -m "feat: scaffold mcp-server package with Recordly lockfile path resolution"
```

---

### Task 6: `mcp-server` lockfile reader + liveness check

**Files:**
- Create: `mcp-server/src/lockfile.ts`
- Create: `mcp-server/src/lockfile.test.ts`

**Interfaces:**
- Consumes: `getLockfilePath` from `./paths` (Task 5).
- Produces: `interface AutomationLockfile { pid: number; port: number; token: string }`
- Produces: `readLockfile(): Promise<AutomationLockfile | null>` — returns `null` if the file doesn't exist or fails to parse.
- Produces: `isProcessAlive(pid: number): boolean` — `true` if a process with that PID exists on this machine.

- [ ] **Step 1: Write the failing test**

```typescript
// mcp-server/src/lockfile.test.ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let lockPath: string;

vi.mock("./paths", () => ({
	getLockfilePath: () => lockPath,
}));

import { isProcessAlive, readLockfile } from "./lockfile";

describe("readLockfile", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-mcp-lockfile-test-"));
		lockPath = path.join(dir, "mcp.lock.json");
	});

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	it("returns null when the lockfile does not exist", async () => {
		expect(await readLockfile()).toBeNull();
	});

	it("returns the parsed lockfile contents when present", async () => {
		await fs.writeFile(lockPath, JSON.stringify({ pid: 42, port: 5555, token: "tok" }));
		expect(await readLockfile()).toEqual({ pid: 42, port: 5555, token: "tok" });
	});

	it("returns null when the lockfile contains invalid JSON", async () => {
		await fs.writeFile(lockPath, "not json");
		expect(await readLockfile()).toBeNull();
	});
});

describe("isProcessAlive", () => {
	it("returns true for the current process", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
	});

	it("returns false for a pid that almost certainly does not exist", () => {
		expect(isProcessAlive(999_999)).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/lockfile.test.ts`
Expected: FAIL with "Cannot find module './lockfile'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// mcp-server/src/lockfile.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/lockfile.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/lockfile.ts mcp-server/src/lockfile.test.ts
git commit -m "feat: read and validate the Recordly automation lockfile"
```

---

### Task 7: `mcp-server` RPC client + attach-or-launch connection orchestration

**Files:**
- Create: `mcp-server/src/rpcClient.ts`
- Create: `mcp-server/src/connection.ts`
- Create: `mcp-server/src/connection.test.ts`

**Interfaces:**
- Consumes: `readLockfile`, `isProcessAlive` from `./lockfile` (Task 6).
- Produces (`rpcClient.ts`): `class RpcClient { constructor(port: number, token: string); call(method: string, params?: Record<string, unknown>): Promise<unknown>; close(): void }` — opens a `ws://127.0.0.1:{port}/?token={token}` connection, sends `{jsonrpc:"2.0", id, method, params}`, resolves/rejects the matching pending call by `id` when a response arrives, rejects with the JSON-RPC error message on an error envelope, and rejects with a timeout error if no response arrives within 15000ms.
- Produces (`connection.ts`): `getOrCreateConnection(options: { repoDir: string; spawnTimeoutMs?: number }): Promise<RpcClient>` — attaches to a live instance found via the lockfile, or spawns `npm run dev` in `repoDir` with `RECORDLY_MCP_TOKEN`/`RECORDLY_MCP_PORT` unset (the automation server always picks a random free port) and polls the lockfile until it appears or `spawnTimeoutMs` (default 60000) elapses.

- [ ] **Step 1: Write the failing test for connection orchestration**

`connection.ts`'s spawn path is integration-level (covered by the Task 9 manual smoke test); the attach path is pure logic and unit-testable by mocking `./lockfile`.

```typescript
// mcp-server/src/connection.test.ts
import { describe, expect, it, vi } from "vitest";

const mockReadLockfile = vi.fn();
const mockIsProcessAlive = vi.fn();

vi.mock("./lockfile", () => ({
	readLockfile: () => mockReadLockfile(),
	isProcessAlive: (pid: number) => mockIsProcessAlive(pid),
}));

vi.mock("./rpcClient", () => ({
	RpcClient: vi.fn().mockImplementation((port: number, token: string) => ({
		port,
		token,
	})),
}));

import { getOrCreateConnection } from "./connection";
import { RpcClient } from "./rpcClient";

describe("getOrCreateConnection", () => {
	it("attaches to a live instance instead of spawning when the lockfile is valid", async () => {
		mockReadLockfile.mockResolvedValue({ pid: 111, port: 5000, token: "tok" });
		mockIsProcessAlive.mockReturnValue(true);

		const client = await getOrCreateConnection({ repoDir: "/does/not/matter" });

		expect(RpcClient).toHaveBeenCalledWith(5000, "tok");
		expect(client).toEqual({ port: 5000, token: "tok" });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/connection.test.ts`
Expected: FAIL with "Cannot find module './connection'".

- [ ] **Step 3: Write the RPC client**

```typescript
// mcp-server/src/rpcClient.ts
import WebSocket from "ws";

interface PendingCall {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	timeout: NodeJS.Timeout;
}

const CALL_TIMEOUT_MS = 15_000;

export class RpcClient {
	private socket: WebSocket;
	private nextId = 1;
	private pending = new Map<number, PendingCall>();
	private ready: Promise<void>;

	constructor(port: number, token: string) {
		this.socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
		this.ready = new Promise((resolve, reject) => {
			this.socket.once("open", () => resolve());
			this.socket.once("error", (error) => reject(error));
		});
		this.socket.on("message", (data) => this.handleMessage(data.toString()));
	}

	private handleMessage(raw: string) {
		let message: { id: number; result?: unknown; error?: { message: string } };
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		this.pending.delete(message.id);
		clearTimeout(pending.timeout);
		if (message.error) {
			pending.reject(new Error(message.error.message));
		} else {
			pending.resolve(message.result);
		}
	}

	async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
		await this.ready;
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC call "${method}" timed out after ${CALL_TIMEOUT_MS}ms`));
			}, CALL_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, timeout });
			this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
		});
	}

	close(): void {
		this.socket.close();
	}
}
```

- [ ] **Step 4: Write the connection orchestration**

```typescript
// mcp-server/src/connection.ts
import { spawn } from "node:child_process";
import { isProcessAlive, readLockfile } from "./lockfile";
import { RpcClient } from "./rpcClient";

const POLL_INTERVAL_MS = 500;
const DEFAULT_SPAWN_TIMEOUT_MS = 60_000;

async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getOrCreateConnection(options: {
	repoDir: string;
	spawnTimeoutMs?: number;
}): Promise<RpcClient> {
	const existing = await readLockfile();
	if (existing && isProcessAlive(existing.pid)) {
		return new RpcClient(existing.port, existing.token);
	}

	const token = crypto.randomUUID();
	spawn("npm", ["run", "dev"], {
		cwd: options.repoDir,
		env: { ...process.env, RECORDLY_MCP_TOKEN: token },
		detached: true,
		stdio: "ignore",
	}).unref();

	const deadline = Date.now() + (options.spawnTimeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS);
	while (Date.now() < deadline) {
		const lockfile = await readLockfile();
		if (lockfile && lockfile.token === token && isProcessAlive(lockfile.pid)) {
			return new RpcClient(lockfile.port, lockfile.token);
		}
		await delay(POLL_INTERVAL_MS);
	}

	throw new Error(
		"Timed out waiting for Recordly to start. Check that `npm run dev` succeeds in the Recordly repo.",
	);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/connection.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/rpcClient.ts mcp-server/src/connection.ts mcp-server/src/connection.test.ts
git commit -m "feat: add RPC client and attach-or-launch connection orchestration"
```

---

### Task 8: MCP tools + entrypoint

**Files:**
- Create: `mcp-server/src/tools.ts`
- Create: `mcp-server/src/tools.test.ts`
- Create: `mcp-server/src/index.ts`

**Interfaces:**
- Consumes: `getOrCreateConnection` from `./connection` (Task 7), `RpcClient` from `./rpcClient` (Task 7).
- Produces: `buildToolHandlers(client: RpcClient): Record<string, (args: Record<string, unknown>) => Promise<unknown>>` — one entry per tool name below, each calling the right RPC method(s) on `client` and shaping the result into `{ success, ... }` or throwing an `Error` with a clear message on failure.
- Tool catalog (matches the design doc's Phase 1 scope): `get_app_status`, `list_capture_sources`, `start_recording`, `pause_recording`, `resume_recording`, `stop_recording`, `get_recording_status`, `list_projects`, `read_project`.

- [ ] **Step 1: Write the failing test**

```typescript
// mcp-server/src/tools.test.ts
import { describe, expect, it, vi } from "vitest";
import { buildToolHandlers } from "./tools";

function fakeClient(responses: Record<string, unknown>) {
	return {
		call: vi.fn(async (method: string) => {
			if (!(method in responses)) {
				throw new Error(`unexpected method: ${method}`);
			}
			return responses[method];
		}),
	} as unknown as import("./rpcClient").RpcClient;
}

describe("buildToolHandlers", () => {
	it("get_app_status calls app.status", async () => {
		const client = fakeClient({ "app.status": { recording: false, platform: "darwin" } });
		const handlers = buildToolHandlers(client);
		expect(await handlers.get_app_status({})).toEqual({ recording: false, platform: "darwin" });
	});

	it("list_capture_sources calls sources.list", async () => {
		const client = fakeClient({ "sources.list": [{ id: "screen:0:0", name: "Screen 1" }] });
		const handlers = buildToolHandlers(client);
		expect(await handlers.list_capture_sources({})).toEqual([{ id: "screen:0:0", name: "Screen 1" }]);
	});

	it("start_recording picks recording.startNative on darwin", async () => {
		const originalPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "darwin" });
		try {
			const client = fakeClient({ "recording.startNative": { success: true } });
			const handlers = buildToolHandlers(client);
			const result = await handlers.start_recording({ sourceId: "screen:0:0", sourceType: "screen" });
			expect(result).toEqual({ success: true });
			expect(client.call).toHaveBeenCalledWith("recording.startNative", {
				arg: { id: "screen:0:0", sourceType: "screen" },
			});
		} finally {
			Object.defineProperty(process, "platform", { value: originalPlatform });
		}
	});

	it("start_recording picks recording.startFfmpeg on linux", async () => {
		const originalPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "linux" });
		try {
			const client = fakeClient({ "recording.startFfmpeg": { success: true } });
			const handlers = buildToolHandlers(client);
			await handlers.start_recording({ sourceId: "screen:0:0", sourceType: "screen" });
			expect(client.call).toHaveBeenCalledWith("recording.startFfmpeg", {
				arg: { id: "screen:0:0", sourceType: "screen" },
			});
		} finally {
			Object.defineProperty(process, "platform", { value: originalPlatform });
		}
	});

	it("stop_recording throws a clear error when nothing is recording", async () => {
		const client = fakeClient({ "app.status": { recording: false, platform: "darwin" } });
		const handlers = buildToolHandlers(client);
		await expect(handlers.stop_recording({})).rejects.toThrow("No recording is currently active.");
	});

	it("list_projects calls project.list", async () => {
		const client = fakeClient({
			"project.list": { success: true, projectsDir: "/tmp", entries: [] },
		});
		const handlers = buildToolHandlers(client);
		expect(await handlers.list_projects({})).toEqual({
			success: true,
			projectsDir: "/tmp",
			entries: [],
		});
	});

	it("read_project calls project.read with the given path", async () => {
		const client = fakeClient({ "project.read": { success: true, projectData: {} } });
		const handlers = buildToolHandlers(client);
		await handlers.read_project({ filePath: "/tmp/foo.recordly" });
		expect(client.call).toHaveBeenCalledWith("project.read", { arg: "/tmp/foo.recordly" });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/tools.test.ts`
Expected: FAIL with "Cannot find module './tools'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// mcp-server/src/tools.ts
import type { RpcClient } from "./rpcClient";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export function buildToolHandlers(client: RpcClient): Record<string, ToolHandler> {
	return {
		async get_app_status() {
			return client.call("app.status");
		},

		async list_capture_sources() {
			return client.call("sources.list", { arg: { types: ["screen", "window"] } });
		},

		async start_recording(args) {
			const source = {
				id: args.sourceId,
				sourceType: args.sourceType,
				...(args.displayId !== undefined ? { display_id: args.displayId } : {}),
			};
			const method = process.platform === "linux" ? "recording.startFfmpeg" : "recording.startNative";
			return client.call(method, { arg: source });
		},

		async pause_recording() {
			return client.call("recording.pause");
		},

		async resume_recording() {
			return client.call("recording.resume");
		},

		async stop_recording() {
			const status = (await client.call("app.status")) as { recording: boolean };
			if (!status.recording) {
				throw new Error("No recording is currently active.");
			}
			const method = process.platform === "linux" ? "recording.stopFfmpeg" : "recording.stopNative";
			return client.call(method);
		},

		async get_recording_status() {
			return client.call("app.status");
		},

		async list_projects() {
			return client.call("project.list");
		},

		async read_project(args) {
			return client.call("project.read", { arg: args.filePath });
		},
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/tools.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Write the entrypoint**

```typescript
// mcp-server/src/index.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getOrCreateConnection } from "./connection";
import { buildToolHandlers } from "./tools";

const REPO_DIR = path.resolve(fileURLToPath(import.meta.url), "../../..");

async function main() {
	const client = await getOrCreateConnection({ repoDir: REPO_DIR });
	const handlers = buildToolHandlers(client);

	const server = new McpServer({ name: "recordly", version: "0.1.0" });

	server.tool("get_app_status", "Get whether Recordly is currently recording and its platform.", {}, async () =>
		toContent(await handlers.get_app_status({})),
	);

	server.tool(
		"list_capture_sources",
		"List available screen/window capture sources.",
		{},
		async () => toContent(await handlers.list_capture_sources({})),
	);

	server.tool(
		"start_recording",
		"Start a screen recording of the given source.",
		{
			sourceId: z.string(),
			sourceType: z.enum(["screen", "window"]),
			displayId: z.string().optional(),
			capturesSystemAudio: z.boolean().optional(),
			capturesMicrophone: z.boolean().optional(),
		},
		async (args) => toContent(await handlers.start_recording(args)),
	);

	server.tool("pause_recording", "Pause the active recording.", {}, async () =>
		toContent(await handlers.pause_recording({})),
	);

	server.tool("resume_recording", "Resume a paused recording.", {}, async () =>
		toContent(await handlers.resume_recording({})),
	);

	server.tool("stop_recording", "Stop the active recording and finalize the video file.", {}, async () =>
		toContent(await handlers.stop_recording({})),
	);

	server.tool("get_recording_status", "Get current recording status.", {}, async () =>
		toContent(await handlers.get_recording_status({})),
	);

	server.tool("list_projects", "List saved .recordly project files.", {}, async () =>
		toContent(await handlers.list_projects({})),
	);

	server.tool(
		"read_project",
		"Read a .recordly project file's contents by path.",
		{ filePath: z.string() },
		async (args) => toContent(await handlers.read_project(args)),
	);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

function toContent(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

main().catch((error) => {
	console.error("[recordly-mcp] Fatal error:", error);
	process.exit(1);
});
```

- [ ] **Step 6: Add `zod` dependency (required by the MCP SDK's tool schema API)**

```bash
cd mcp-server && npm install zod@^3.23.8
```

- [ ] **Step 7: Build to confirm the entrypoint typechecks**

Run: `cd mcp-server && npm run build`
Expected: compiles with no errors, `dist/index.js` is produced.

- [ ] **Step 8: Commit**

```bash
git add mcp-server/src/tools.ts mcp-server/src/tools.test.ts mcp-server/src/index.ts mcp-server/package.json mcp-server/package-lock.json
git commit -m "feat: add MCP tool handlers and stdio entrypoint"
```

---

### Task 9: End-to-end smoke test

**Files:**
- Create: `mcp-server/SMOKE_TEST.md`

**Interfaces:**
- None — this is a manual verification procedure, not code. This is the primary verification for this phase per the design doc: the automation server and MCP server are fundamentally an integration surface across two processes and a real OS-level recording pipeline, which unit tests with mocked handlers cannot substitute for.

- [ ] **Step 1: Write the smoke test procedure**

```markdown
<!-- mcp-server/SMOKE_TEST.md -->
# Recordly MCP — Phase 1 Smoke Test

Run this manually after Tasks 1-8 are complete, on each platform you can access.

## Attach-to-existing-instance path

1. In the Recordly repo root, run `RECORDLY_MCP_TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))") npm run dev` and wait for the app window to appear.
2. Confirm a lockfile now exists: macOS `~/Library/Application Support/Recordly-dev/mcp.lock.json` (adjust root per `mcp-server/src/paths.ts` for other platforms), containing `{"pid":...,"port":...,"token":...}`.
3. In a second terminal, in `mcp-server/`, run `npx tsx src/index.ts` (or `npm run build && npm start`) with no special env vars.
4. Confirm the MCP server logs that it attached (no second Recordly window should appear).
5. Using an MCP inspector (`npx @modelcontextprotocol/inspector node dist/index.js` from `mcp-server/`) or a configured Claude Code/Desktop MCP connection pointed at `mcp-server/dist/index.js`, call tools in this order and confirm each succeeds:
   - `get_app_status` → `{ recording: false, platform: "<your platform>" }`
   - `list_capture_sources` → non-empty array including at least one `screen` source
   - `start_recording` with `{ sourceId: "<a screen id from the previous call>", sourceType: "screen" }` → `{ success: true, ... }`; confirm the Recordly HUD shows recording is active
   - `get_recording_status` → `{ recording: true, ... }`
   - `pause_recording` → `{ success: true }` (macOS/Windows only — expected to fail with a clear "No native screen recording is active" style message on Linux, since ffmpeg capture has no pause)
   - `resume_recording` → `{ success: true }` (macOS/Windows only)
   - `stop_recording` → `{ success: true, path: "<mp4 path>" }`; confirm the file exists on disk and plays back correctly
   - `list_projects` → `{ success: true, projectsDir: "...", entries: [...] }`
   - `read_project` with a `filePath` from `list_projects`'s entries → the parsed project JSON

## Spawn-a-fresh-instance path

1. Quit Recordly completely and confirm no lockfile remains (delete it manually if the previous run left a stale one from a crash).
2. In `mcp-server/`, run the MCP server the same way as step 3 above, but with no Recordly instance running first.
3. Call `get_app_status` as the first tool call and confirm the MCP server spawns `npm run dev` in the Recordly repo, waits for the lockfile, and the call eventually succeeds (a visible Recordly window should appear during the wait).
4. Repeat the full tool sequence from the attach-path section above against this freshly spawned instance.

## Record any deviations

If any platform-specific behavior differs from what's documented here (e.g. ffmpeg pause/resume unavailability on Linux), note it in this file so it's not re-discovered on the next run.
```

- [ ] **Step 2: Execute the smoke test**

Follow the procedure above on at least one platform (whichever you're developing on). Record the actual results by editing `mcp-server/SMOKE_TEST.md` with a "Last run" section (date, platform, pass/fail per step).

- [ ] **Step 3: Fix any issues found, re-run affected unit tests, then commit**

```bash
git add mcp-server/SMOKE_TEST.md
git commit -m "docs: add Phase 1 MCP smoke test procedure and results"
```

---

## What's deliberately out of scope for this plan

- **Editing tools** (`trim_clip`, `add_zoom_region`, `add_speed_region`, `set_webcam_overlay`, `set_frame_style`, `add_annotation`, `generate_captions`, `edit_caption`) — these mutate renderer-side editor state and require a new main↔renderer request/response bridge plus a deep read of `src/components/video-editor`'s state management, which this plan intentionally did not undertake. Plan as a Phase 2 follow-up once this phase is verified working end-to-end.
- **Export tools** (`export_video`, `get_export_status`) and **`save_project`** — `electron/ipc/register/export.ts` handlers use `event.sender` for progress streaming (unlike every handler wired up in this phase), and `save_project` needs live in-memory project data from the renderer, so both need the same renderer bridge as editing tools. Plan as a Phase 3 follow-up alongside or after Phase 2.
