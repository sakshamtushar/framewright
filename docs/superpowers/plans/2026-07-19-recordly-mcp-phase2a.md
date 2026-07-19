# Recordly MCP — Phase 2a (Editor Automation Bridge + First Editing Tools) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the generic main↔renderer request/response bridge editor automation needs (none exists today — the only precedent is fire-and-ack, not data pull), and prove it end-to-end with two real tools: `get_project_state` (read) and `add_zoom_region` (write). This is the foundation the rest of Phase 2 (trim, webcam, frame style, annotations, captions) builds on incrementally.

**Architecture:** Main process sends `automation:editor-request {requestId, type, payload}` to the (singleton) editor `BrowserWindow`; a new listener inside `VideoEditor.tsx` dispatches on `type`, mutates/reads state via existing hooks, and replies via `automation:editor-response`. `electron/automation/editorBridge.ts` wraps the round trip as `requestEditorState(type, payload): Promise<unknown>` with a 10s timeout, and errors clearly if no editor window is open (editor window lifecycle confirmed singleton by prior research). The automation server (`electron/automation/server.ts`, from Phase 1) routes `editor.*` RPC methods through this bridge instead of the `ipcHandlerRegistry`/`FAKE_EVENT` path, since editor state doesn't live in main.

**Tech Stack:** Same as Phase 1 — TypeScript, Electron 43, `ws`, `@modelcontextprotocol/sdk`, Vitest, Biome (tabs).

## Global Constraints

- Tools operate on **the currently open editor window only** — no "open project X into the editor" in this phase (that needs a new "editor ready with project loaded" signal that doesn't exist yet; out of scope here).
- All relative imports in `mcp-server/src/*.ts` need explicit `.js` extensions (NodeNext moduleResolution).
- `electron/ipc/registry.ts`'s `handle()` pattern from Phase 1 does NOT apply here — editor state lives in the renderer, not main, so this uses a parallel bridge, not the registry.
- Follow existing repo conventions: tabs, Biome-formatted, `noUnusedLocals`/`noUnusedParameters`.
- `switch-to-editor` (channel in `electron/ipc/register/sources.ts`, already wired through Phase 1's registry) opens/reuses the singleton editor `BrowserWindow` — reuse it for a new `lifecycle.openEditor` tool rather than duplicating window-creation logic.

---

### Task 1: Preload bridge methods

**Files:**
- Modify: `electron/preload.ts` (add two methods to the exported `electronAPI` object, alongside `onRequestSaveBeforeClose` around line 950)

**Interfaces:**
- Produces: `window.electronAPI.onAutomationEditorRequest(callback: (request: { requestId: string; type: string; payload: unknown }) => void | Promise<void>): () => void` — subscribes, returns an unsubscribe function (same shape as `onRequestSaveBeforeClose`/`onMenuLoadProject`).
- Produces: `window.electronAPI.sendAutomationEditorResponse(requestId: string, response: { success: true; result: unknown } | { success: false; error: string }): void`.

- [ ] **Step 1: Add the two methods**

In `electron/preload.ts`, immediately after the existing `onRequestSaveBeforeClose` method (the block ending `return () => ipcRenderer.removeListener("request-save-before-close", listener);\n\t},`), add:

```typescript
	onAutomationEditorRequest: (
		callback: (request: { requestId: string; type: string; payload: unknown }) => void | Promise<void>,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			request: { requestId: string; type: string; payload: unknown },
		) => {
			void callback(request);
		};
		ipcRenderer.on("automation:editor-request", listener);
		return () => ipcRenderer.removeListener("automation:editor-request", listener);
	},
	sendAutomationEditorResponse: (
		requestId: string,
		response: { success: true; result: unknown } | { success: false; error: string },
	) => {
		ipcRenderer.send("automation:editor-response", requestId, response);
	},
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: all existing tests still pass (this is additive, no behavior change to existing code).

- [ ] **Step 4: Commit**

```bash
git add electron/preload.ts
git commit -m "feat: add preload bridge for editor automation requests"
```

---

### Task 2: Main-process editor bridge (`electron/automation/editorBridge.ts`)

**Files:**
- Create: `electron/automation/editorBridge.ts`
- Create: `electron/automation/editorBridge.test.ts`

**Interfaces:**
- Produces: `requestEditorState(type: string, payload: unknown): Promise<unknown>` — rejects with `"No editor window is open."` if no window matches the editor URL pattern; rejects with a timeout error if the renderer doesn't respond within 10s; resolves with `response.result` on `{success:true}`, rejects with `response.error` on `{success:false}`.

- [ ] **Step 1: Write the failing test**

```typescript
// electron/automation/editorBridge.test.ts
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const mockWindows: Array<{
	isDestroyed: () => boolean;
	webContents: { getURL: () => string; send: (channel: string, payload: unknown) => void };
}> = [];

vi.mock("electron", () => ({
	BrowserWindow: {
		getAllWindows: () => mockWindows,
	},
	ipcMain: new EventEmitter(),
}));

import { ipcMain } from "electron";
import { requestEditorState } from "./editorBridge";

function makeEditorWindow(send: (channel: string, payload: unknown) => void) {
	return {
		isDestroyed: () => false,
		webContents: {
			getURL: () => "file:///index.html?windowType=editor",
			send,
		},
	};
}

describe("requestEditorState", () => {
	it("rejects when no editor window is open", async () => {
		mockWindows.length = 0;
		await expect(requestEditorState("getState", {})).rejects.toThrow("No editor window is open.");
	});

	it("sends a request to the editor window and resolves with the response result", async () => {
		mockWindows.length = 0;
		const send = vi.fn((_channel: string, payload: { requestId: string }) => {
			queueMicrotask(() => {
				(ipcMain as unknown as EventEmitter).emit("automation:editor-response", {}, payload.requestId, {
					success: true,
					result: { zoomRegions: [] },
				});
			});
		});
		mockWindows.push(makeEditorWindow(send));

		const result = await requestEditorState("getState", { some: "payload" });

		expect(result).toEqual({ zoomRegions: [] });
		expect(send).toHaveBeenCalledWith(
			"automation:editor-request",
			expect.objectContaining({ type: "getState", payload: { some: "payload" } }),
		);
	});

	it("rejects with the response error when the renderer reports failure", async () => {
		mockWindows.length = 0;
		const send = vi.fn((_channel: string, payload: { requestId: string }) => {
			queueMicrotask(() => {
				(ipcMain as unknown as EventEmitter).emit("automation:editor-response", {}, payload.requestId, {
					success: false,
					error: "invalid payload",
				});
			});
		});
		mockWindows.push(makeEditorWindow(send));

		await expect(requestEditorState("addZoomRegion", {})).rejects.toThrow("invalid payload");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/automation/editorBridge.test.ts`
Expected: FAIL with "Cannot find module './editorBridge'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// electron/automation/editorBridge.ts
import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";

const REQUEST_TIMEOUT_MS = 10_000;

function getEditorWindow(): Electron.BrowserWindow | null {
	return (
		BrowserWindow.getAllWindows().find(
			(window) => !window.isDestroyed() && window.webContents.getURL().includes("windowType=editor"),
		) ?? null
	);
}

interface EditorResponse {
	success: boolean;
	result?: unknown;
	error?: string;
}

export async function requestEditorState(type: string, payload: unknown): Promise<unknown> {
	const editorWindow = getEditorWindow();
	if (!editorWindow) {
		throw new Error("No editor window is open.");
	}

	const requestId = randomUUID();

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			ipcMain.removeListener("automation:editor-response", onResponse);
			reject(new Error(`Editor did not respond to "${type}" within ${REQUEST_TIMEOUT_MS}ms`));
		}, REQUEST_TIMEOUT_MS);

		function onResponse(_event: Electron.IpcMainEvent, responseId: string, response: EditorResponse) {
			if (responseId !== requestId) {
				return;
			}
			clearTimeout(timeout);
			ipcMain.removeListener("automation:editor-response", onResponse);
			if (response.success) {
				resolve(response.result);
			} else {
				reject(new Error(response.error ?? "Editor request failed"));
			}
		}

		ipcMain.on("automation:editor-response", onResponse);
		editorWindow.webContents.send("automation:editor-request", { requestId, type, payload });
	});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/automation/editorBridge.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/automation/editorBridge.ts electron/automation/editorBridge.test.ts
git commit -m "feat: add main-process editor automation request/response bridge"
```

---

### Task 3: Renderer-side dispatch in VideoEditor.tsx

**Files:**
- Modify: `src/components/video-editor/VideoEditor.tsx`

**Interfaces:**
- Consumes: `window.electronAPI.onAutomationEditorRequest`/`sendAutomationEditorResponse` (Task 1), `currentPersistedEditorState` (existing `useMemo`, ~line 1816), `setZoomRegions`/`setSelectedZoomId`/`nextZoomIdRef`/`clampFocusToDepth` (existing, used by `handleZoomAdded` ~line 3823), `ZoomDepth`/`ZoomRegion`/`ZoomFocus` types from `./types`.
- Produces: handles `type: "getState"` (returns `currentPersistedEditorState`) and `type: "addZoomRegion"` (payload `{ startMs: number; endMs: number; depth?: ZoomDepth; focus?: { cx: number; cy: number } }`, appends a new `ZoomRegion` and returns `{ id: string }`).

- [ ] **Step 1: Add the dispatch effect**

In `src/components/video-editor/VideoEditor.tsx`, immediately after the existing `onRequestSaveBeforeClose` effect (the block ending `return () => cleanup?.();\n\t}, [saveProject]);` around line 3057), add:

```typescript
	useEffect(() => {
		const cleanup = window.electronAPI.onAutomationEditorRequest(async ({ requestId, type, payload }) => {
			try {
				let result: unknown;
				switch (type) {
					case "getState": {
						result = currentPersistedEditorState;
						break;
					}
					case "addZoomRegion": {
						const params = payload as {
							startMs?: number;
							endMs?: number;
							depth?: ZoomDepth;
							focus?: { cx: number; cy: number };
						};
						if (
							typeof params.startMs !== "number" ||
							typeof params.endMs !== "number" ||
							params.endMs <= params.startMs
						) {
							throw new Error(
								"addZoomRegion requires numeric startMs/endMs with endMs > startMs",
							);
						}
						const id = `zoom-${nextZoomIdRef.current++}`;
						const depth: ZoomDepth = params.depth ?? 2;
						const newRegion: ZoomRegion = {
							id,
							startMs: Math.round(params.startMs),
							endMs: Math.round(params.endMs),
							depth,
							focus: clampFocusToDepth(params.focus ?? { cx: 0.5, cy: 0.5 }, depth),
							mode: "auto",
						};
						setZoomRegions((prev) => [...prev, newRegion]);
						setSelectedZoomId(id);
						result = { id };
						break;
					}
					default:
						throw new Error(`Unknown automation editor request type: ${type}`);
				}
				window.electronAPI.sendAutomationEditorResponse(requestId, { success: true, result });
			} catch (error) {
				window.electronAPI.sendAutomationEditorResponse(requestId, {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		});

		return () => cleanup?.();
	}, [currentPersistedEditorState, clampFocusToDepth]);
```

Note: `nextZoomIdRef`, `setZoomRegions`, and `setSelectedZoomId` are refs/setters (stable identities) already in scope in this component and do not need to be listed in the dependency array, matching how `handleZoomAdded` itself is defined nearby — confirm this against the actual `handleZoomAdded` `useCallback` dependency array in the file (~line 3823) and mirror its convention exactly rather than guessing.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. If `ZoomDepth`/`ZoomRegion`/`clampFocusToDepth` aren't already imported at the top of `VideoEditor.tsx`, add them to the existing `from "./types"` import statement (check first — they are very likely already imported, since `handleZoomAdded` already uses all three in this same file).

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: all existing tests pass. There is no existing unit test harness for `VideoEditor.tsx` itself (it's a top-level React component, not unit-tested in isolation per the existing codebase's patterns) — this task's correctness is verified by typecheck plus the Task 6 live smoke test, not a new unit test file. Do not invent a shallow-render test for this file; it would not follow existing conventions.

- [ ] **Step 4: Commit**

```bash
git add src/components/video-editor/VideoEditor.tsx
git commit -m "feat: dispatch automation editor requests (getState, addZoomRegion)"
```

---

### Task 4: Wire `editor.*` methods and `lifecycle.openEditor` into the automation server

**Files:**
- Modify: `electron/automation/server.ts`
- Modify: `electron/automation/server.test.ts`

**Interfaces:**
- Consumes: `requestEditorState` from `./editorBridge` (Task 2).
- Produces: `dispatchRpcRequest` now handles `"editor.getState"` and `"editor.addZoomRegion"` by calling `requestEditorState("getState"|"addZoomRegion", request.params)` (note: unlike `callChannel`, this passes `request.params` directly as the payload, not wrapped in `{arg: ...}` — the editor bridge protocol is new and doesn't need to match the `ipcHandlerRegistry` calling convention). Also adds `"lifecycle.openEditor"` to the existing `METHOD_TO_CHANNEL` map, routed to the already-registered `"switch-to-editor"` channel via the existing `callChannel` path (no payload needed).

- [ ] **Step 1: Write the failing test**

Add to `electron/automation/server.test.ts` (alongside the existing `dispatchRpcRequest` tests):

```typescript
import * as editorBridge from "./editorBridge";

// ... inside the existing describe("dispatchRpcRequest", ...) block, add:

	it("editor.getState calls requestEditorState with the request's params as payload", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ zoomRegions: [] });

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 10,
			method: "editor.getState",
			params: {},
		});

		expect(spy).toHaveBeenCalledWith("getState", {});
		expect(response).toEqual({ jsonrpc: "2.0", id: 10, result: { zoomRegions: [] } });
		spy.mockRestore();
	});

	it("editor.addZoomRegion forwards params directly as the payload (not wrapped in arg)", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ id: "zoom-1" });

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 11,
			method: "editor.addZoomRegion",
			params: { startMs: 0, endMs: 1000, depth: 3 },
		});

		expect(spy).toHaveBeenCalledWith("addZoomRegion", { startMs: 0, endMs: 1000, depth: 3 });
		expect(response).toEqual({ jsonrpc: "2.0", id: 11, result: { id: "zoom-1" } });
		spy.mockRestore();
	});

	it("editor.getState returns a JSON-RPC error envelope when the editor bridge rejects", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockRejectedValue(new Error("No editor window is open."));

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 12,
			method: "editor.getState",
			params: {},
		});

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: 12,
			error: { code: -32000, message: "No editor window is open." },
		});
		spy.mockRestore();
	});

	it("lifecycle.openEditor routes to the switch-to-editor channel", async () => {
		ipcHandlerRegistry.set("switch-to-editor", async () => undefined);

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 13,
			method: "lifecycle.openEditor",
			params: {},
		});

		expect(response).toEqual({ jsonrpc: "2.0", id: 13, result: undefined });
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/automation/server.test.ts`
Expected: FAIL — `editor.getState`/`editor.addZoomRegion`/`lifecycle.openEditor` are unknown methods (`-32601` errors), not what the new tests expect.

- [ ] **Step 3: Write the implementation**

In `electron/automation/server.ts`:

1. Add the import: `import { requestEditorState } from "./editorBridge";`
2. Add `"lifecycle.openEditor": "switch-to-editor"` to the existing `METHOD_TO_CHANNEL` map.
3. In `dispatchRpcRequest`, before the existing `const channel = METHOD_TO_CHANNEL[request.method];` line, add a branch for editor-bridge methods:

```typescript
		const EDITOR_BRIDGE_METHODS: Record<string, string> = {
			"editor.getState": "getState",
			"editor.addZoomRegion": "addZoomRegion",
		};
		const editorBridgeType = EDITOR_BRIDGE_METHODS[request.method];
		if (editorBridgeType) {
			const result = await requestEditorState(editorBridgeType, request.params ?? {});
			return { jsonrpc: "2.0", id: request.id, result };
		}
```

(This sits inside the existing top-level `try` block in `dispatchRpcRequest`, so a thrown/rejected `requestEditorState` call is caught by the same existing `catch` block that already produces the `-32000` error envelope — no new error handling needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/automation/server.test.ts`
Expected: PASS (all tests, existing + 4 new)

- [ ] **Step 5: Run full suite and typecheck**

Run: `npm test` and `npx tsc --noEmit -p tsconfig.json`
Expected: all pass, no errors.

- [ ] **Step 6: Commit**

```bash
git add electron/automation/server.ts electron/automation/server.test.ts
git commit -m "feat: route editor.* methods through the editor bridge, add lifecycle.openEditor"
```

---

### Task 5: MCP tools — `open_editor`, `get_project_state`, `add_zoom_region`

**Files:**
- Modify: `mcp-server/src/tools.ts`
- Modify: `mcp-server/src/tools.test.ts`
- Modify: `mcp-server/src/index.ts`

**Interfaces:**
- Produces three new tool handlers in `buildToolHandlers`: `open_editor()` → `client.call("lifecycle.openEditor")`; `get_project_state()` → `client.call("editor.getState")`; `add_zoom_region({ startMs, endMs, depth?, focusX?, focusY? })` → `client.call("editor.addZoomRegion", { startMs, endMs, depth, focus: focusX !== undefined && focusY !== undefined ? { cx: focusX, cy: focusY } : undefined })`.

- [ ] **Step 1: Write the failing tests**

Add to `mcp-server/src/tools.test.ts`:

```typescript
	it("open_editor calls lifecycle.openEditor with no params", async () => {
		const client = fakeClient({ "lifecycle.openEditor": undefined });
		const handlers = buildToolHandlers(client);
		await handlers.open_editor({});
		expect(client.call).toHaveBeenCalledWith("lifecycle.openEditor");
	});

	it("get_project_state calls editor.getState", async () => {
		const client = fakeClient({ "editor.getState": { zoomRegions: [] } });
		const handlers = buildToolHandlers(client);
		expect(await handlers.get_project_state({})).toEqual({ zoomRegions: [] });
	});

	it("add_zoom_region forwards startMs/endMs/depth and combines focusX/focusY into a focus object", async () => {
		const client = fakeClient({ "editor.addZoomRegion": { id: "zoom-1" } });
		const handlers = buildToolHandlers(client);
		const result = await handlers.add_zoom_region({ startMs: 0, endMs: 1000, depth: 3, focusX: 0.3, focusY: 0.7 });
		expect(result).toEqual({ id: "zoom-1" });
		expect(client.call).toHaveBeenCalledWith("editor.addZoomRegion", {
			startMs: 0,
			endMs: 1000,
			depth: 3,
			focus: { cx: 0.3, cy: 0.7 },
		});
	});

	it("add_zoom_region omits focus when focusX/focusY are not both provided", async () => {
		const client = fakeClient({ "editor.addZoomRegion": { id: "zoom-2" } });
		const handlers = buildToolHandlers(client);
		await handlers.add_zoom_region({ startMs: 0, endMs: 1000 });
		expect(client.call).toHaveBeenCalledWith("editor.addZoomRegion", {
			startMs: 0,
			endMs: 1000,
			depth: undefined,
			focus: undefined,
		});
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/tools.test.ts`
Expected: FAIL — `handlers.open_editor`/`get_project_state`/`add_zoom_region` are undefined.

- [ ] **Step 3: Write the implementation**

In `mcp-server/src/tools.ts`, inside the returned object from `buildToolHandlers`, add:

```typescript
		async open_editor() {
			return client.call("lifecycle.openEditor");
		},

		async get_project_state() {
			return client.call("editor.getState");
		},

		async add_zoom_region(args) {
			const focus =
				typeof args.focusX === "number" && typeof args.focusY === "number"
					? { cx: args.focusX, cy: args.focusY }
					: undefined;
			return client.call("editor.addZoomRegion", {
				startMs: args.startMs,
				endMs: args.endMs,
				depth: args.depth,
				focus,
			});
		},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/tools.test.ts`
Expected: PASS (all tests, existing + 4 new)

- [ ] **Step 5: Register the tools in the MCP entrypoint**

In `mcp-server/src/index.ts`, add three `server.tool(...)` registrations following the existing pattern (see `pause_recording` for a zero-arg example, `start_recording` for an args example):

```typescript
	server.tool("open_editor", "Open (or focus) Recordly's editor window.", {}, async () =>
		toContent(await handlers.open_editor({})),
	);

	server.tool(
		"get_project_state",
		"Get the currently open editor's full project state (zoom regions, trim, webcam, frame style, captions, etc.).",
		{},
		async () => toContent(await handlers.get_project_state({})),
	);

	server.tool(
		"add_zoom_region",
		"Add a zoom-in region to the currently open editor's timeline.",
		{
			startMs: z.number(),
			endMs: z.number(),
			depth: z.number().min(1).max(6).optional(),
			focusX: z.number().min(0).max(1).optional(),
			focusY: z.number().min(0).max(1).optional(),
		},
		async (args) => toContent(await handlers.add_zoom_region(args)),
	);
```

- [ ] **Step 6: Build and run full mcp-server suite**

Run: `cd mcp-server && npm run build && npm test`
Expected: build succeeds, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add mcp-server/src/tools.ts mcp-server/src/tools.test.ts mcp-server/src/index.ts
git commit -m "feat: add open_editor, get_project_state, add_zoom_region MCP tools"
```

---

### Task 6: Live smoke test — real editor bridge round trip

**Files:**
- Modify: `mcp-server/smoke-drive.mjs`
- Modify: `mcp-server/SMOKE_TEST.md`

**Interfaces:**
- None — extends the existing manual/automated smoke procedure with the Phase 2a bridge.

- [ ] **Step 1: Extend `smoke-drive.mjs`**

After the existing recording lifecycle test block (pause/resume/stop) and before the error-path checks, add:

```javascript
		console.log("\n--- Editor bridge test ---");
		log("open_editor", await handlers.open_editor({}));
		await new Promise((r) => setTimeout(r, 3000)); // give the editor window time to mount

		const state = await handlers.get_project_state({});
		log("get_project_state", { zoomRegionCount: state?.zoomRegions?.length ?? 0 });

		const zoomResult = await handlers.add_zoom_region({ startMs: 0, endMs: 1000, depth: 3 });
		log("add_zoom_region", zoomResult);

		const stateAfterZoom = await handlers.get_project_state({});
		const zoomRegions = stateAfterZoom?.zoomRegions ?? [];
		const addedRegion = zoomRegions.find((r) => r.id === zoomResult.id);
		if (!addedRegion) {
			throw new Error(
				`add_zoom_region reported id ${zoomResult.id} but get_project_state's zoomRegions does not contain it: ${JSON.stringify(zoomRegions)}`,
			);
		}
		console.log(`\nVerified: zoom region ${zoomResult.id} is present in project state after adding it.`);
```

Adjust the surrounding `try`/`finally` structure only as needed to keep this inside the same error-handling scope as the rest of the script — read the current file before editing to place this correctly relative to the existing recording/error-path sections.

- [ ] **Step 2: Run the live smoke test**

Run: `cd mcp-server && npm run smoke`

This requires a real desktop session (the same environment Phase 1's live verification used). Confirm:
- `open_editor` succeeds (opens or focuses the editor window)
- `get_project_state` returns a well-formed state object
- `add_zoom_region` returns `{ id: "zoom-N" }`
- The follow-up `get_project_state` call shows the new region present — this is the critical assertion that the bridge's write path actually persists into the renderer's live state, not just returns a fake success

If this fails, debug via the actual error message (e.g. "No editor window is open" means `open_editor`/`switch-to-editor` didn't work as expected, a timeout means the renderer-side listener from Task 3 isn't wired correctly, a mismatched zoom region means the state shapes don't line up) — do not mark this task done without a real passing run.

- [ ] **Step 3: Update `SMOKE_TEST.md`**

Add a new `## Phase 2a: Editor bridge` section documenting what was verified, following the same style as the existing "Last run" section (real date, real output, honest about what wasn't covered — e.g. only `getState`/`addZoomRegion` are covered by this phase, not the full editing tool catalog).

- [ ] **Step 4: Commit**

```bash
git add mcp-server/smoke-drive.mjs mcp-server/SMOKE_TEST.md
git commit -m "test: extend smoke driver to verify the editor automation bridge live"
```

## What's deliberately out of scope for this plan

- **Remaining editing tools** (`trim_clip`, `add_speed_region`, `set_webcam_overlay`, `set_frame_style`, `add_annotation`, `generate_captions`, `edit_caption`) — same bridge pattern, each its own small follow-up task once this foundation is verified working live.
- **Opening a specific project by path into the editor** — needs a new "editor ready with project X loaded" signal that doesn't exist in Recordly today.
- **Export tools** — `export.ts`/`captions.ts` IPC handlers use `event.sender`, which breaks the Phase 1 `FAKE_EVENT` dispatch trick; needs its own design (likely reusing this same editor-bridge pattern, since export also runs client-side).
