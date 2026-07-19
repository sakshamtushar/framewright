# Recordly MCP — Phase 2b (trim_clip, set_frame_style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two more editing tools on top of Phase 2a's generic editor automation bridge: `trim_clip` (resize/move an existing clip region's boundaries) and `set_frame_style` (wallpaper, frame preset, padding, border radius, shadow, background blur).

**Architecture:** Same bridge as Phase 2a (`electron/automation/editorBridge.ts` → `automation:editor-request`/`automation:editor-response` → `VideoEditor.tsx`'s dispatch effect → `electron/automation/server.ts`'s `EDITOR_BRIDGE_METHODS` → `mcp-server` tools). The key design choice for this phase: **the renderer dispatch cases call VideoEditor.tsx's existing handler functions directly** (`handleClipSpanChange` for trim, the raw `useState` setters for frame style) rather than reimplementing their logic — this reuses the exact cascade behavior `handleClipSpanChange` already has (shifting/pruning overlapping zoom/annotation/speed regions when a clip is trimmed), which would be risky and redundant to hand-duplicate.

**Tech Stack:** Same as Phase 1/2a.

## Global Constraints

- Follow the exact conventions established in Phase 2a's `VideoEditor.tsx` dispatch effect (already shipped, in `src/components/video-editor/VideoEditor.tsx` — search for `onAutomationEditorRequest` to find it): a `switch (type)` inside a `try`/`catch`, each case builds `result`, falls through to a shared `sendAutomationEditorResponse` call, unknown types throw.
- All relative imports in `mcp-server/src/*.ts` need explicit `.js` extensions.
- Tabs, Biome-formatted, `noUnusedLocals`/`noUnusedParameters`.
- This phase MODIFIES the existing dispatch effect and `EDITOR_BRIDGE_METHODS` map from Phase 2a (adding cases/entries), not creating new files for the bridge itself.

---

### Task 1: Renderer dispatch — add `trimClip` and `setFrameStyle` cases

**Files:**
- Modify: `src/components/video-editor/VideoEditor.tsx` (the existing automation dispatch `useEffect` added in Phase 2a)

**Interfaces:**
- Consumes: existing `handleClipSpanChange(id: string, span: Span)` callback (already defined in this file, `Span = {start: number; end: number}`), existing raw setters `setWallpaper`, `setFrame`, `setPadding`, `setBorderRadius`, `setShadowIntensity`, `setBackgroundBlur` (all already defined and already used as direct props elsewhere in this file — confirm their exact names by reading the file before editing, do not guess).
- Produces: handles `type: "trimClip"` (payload `{ clipId: string; startMs: number; endMs: number }`, returns `{ success: true }`) and `type: "setFrameStyle"` (payload `{ wallpaper?: string; frame?: string | null; padding?: Partial<Padding>; borderRadius?: number; shadowIntensity?: number; backgroundBlur?: number }`, returns `{ success: true }`).

- [ ] **Step 1: Read the current dispatch effect**

Read the existing automation dispatch `useEffect` in `src/components/video-editor/VideoEditor.tsx` (added in Phase 2a — search for `onAutomationEditorRequest`). Confirm its current `switch` structure (currently has `case "getState"` and `case "addZoomRegion"`), and confirm the exact real signatures of `handleClipSpanChange` and the frame-style setters by reading their definitions/usages directly in this file — do not assume the brief's paraphrase is byte-perfect.

- [ ] **Step 2: Add the two new cases**

Add to the existing `switch (type)` block, before the `default` case:

```typescript
					case "trimClip": {
						const params = payload as { clipId?: string; startMs?: number; endMs?: number };
						if (
							typeof params.clipId !== "string" ||
							typeof params.startMs !== "number" ||
							typeof params.endMs !== "number" ||
							params.endMs <= params.startMs
						) {
							throw new Error(
								"trimClip requires clipId (string) and numeric startMs/endMs with endMs > startMs",
							);
						}
						handleClipSpanChange(params.clipId, { start: params.startMs, end: params.endMs });
						result = { success: true };
						break;
					}
					case "setFrameStyle": {
						const params = payload as {
							wallpaper?: string;
							frame?: string | null;
							padding?: Partial<Padding>;
							borderRadius?: number;
							shadowIntensity?: number;
							backgroundBlur?: number;
						};
						if (typeof params.wallpaper === "string") {
							setWallpaper(params.wallpaper);
						}
						if (params.frame !== undefined) {
							setFrame(params.frame);
						}
						if (params.padding) {
							setPadding((prev) => ({ ...prev, ...params.padding }));
						}
						if (typeof params.borderRadius === "number") {
							setBorderRadius(params.borderRadius);
						}
						if (typeof params.shadowIntensity === "number") {
							setShadowIntensity(params.shadowIntensity);
						}
						if (typeof params.backgroundBlur === "number") {
							setBackgroundBlur(params.backgroundBlur);
						}
						result = { success: true };
						break;
					}
```

Note: this brief shows the target shape assuming the existing switch uses a `result` variable set per-case before a shared response send (matching Phase 2a's actual structure) — adjust to match the REAL existing code's exact control flow (e.g. if Phase 2a's cases `return` a value directly rather than assigning to a shared `result` variable, follow that real pattern instead; read the file first, per Step 1).

Add `Padding` to the existing `./types` import if not already imported (it's very likely already imported, since `padding` state uses this type elsewhere in the file).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: all existing tests pass (no dedicated unit test for this file, per established convention — verified by typecheck + Task 4's live smoke test).

- [ ] **Step 5: Commit**

```bash
git add src/components/video-editor/VideoEditor.tsx
git commit -m "feat: dispatch trimClip and setFrameStyle automation editor requests"
```

---

### Task 2: Wire `editor.trimClip` and `editor.setFrameStyle` into the automation server

**Files:**
- Modify: `electron/automation/server.ts`
- Modify: `electron/automation/server.test.ts`

**Interfaces:**
- Produces: `dispatchRpcRequest` handles `"editor.trimClip"` and `"editor.setFrameStyle"` by adding them to the existing `EDITOR_BRIDGE_METHODS` map (`"editor.trimClip": "trimClip"`, `"editor.setFrameStyle": "setFrameStyle"`), routed through the same `requestEditorState` call already used for `editor.getState`/`editor.addZoomRegion`.

- [ ] **Step 1: Write the failing tests**

Add to `electron/automation/server.test.ts` (following the exact pattern of the existing `editor.getState`/`editor.addZoomRegion` tests — read them first to match style):

```typescript
	it("editor.trimClip forwards params directly as the payload", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ success: true });

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 20,
			method: "editor.trimClip",
			params: { clipId: "clip-1", startMs: 0, endMs: 5000 },
		});

		expect(spy).toHaveBeenCalledWith("trimClip", { clipId: "clip-1", startMs: 0, endMs: 5000 });
		expect(response).toEqual({ jsonrpc: "2.0", id: 20, result: { success: true } });
		spy.mockRestore();
	});

	it("editor.setFrameStyle forwards params directly as the payload", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ success: true });

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 21,
			method: "editor.setFrameStyle",
			params: { wallpaper: "gradient-1", borderRadius: 12 },
		});

		expect(spy).toHaveBeenCalledWith("setFrameStyle", { wallpaper: "gradient-1", borderRadius: 12 });
		expect(response).toEqual({ jsonrpc: "2.0", id: 21, result: { success: true } });
		spy.mockRestore();
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/automation/server.test.ts`
Expected: FAIL — both methods unknown (`-32601`).

- [ ] **Step 3: Implement**

In `electron/automation/server.ts`, add to the existing `EDITOR_BRIDGE_METHODS` map:

```typescript
			"editor.trimClip": "trimClip",
			"editor.setFrameStyle": "setFrameStyle",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/automation/server.test.ts`
Expected: PASS (all tests, existing + 2 new)

- [ ] **Step 5: Run full suite and typecheck**

Run: `npm test` and `npx tsc --noEmit -p tsconfig.json`
Expected: all pass, no errors.

- [ ] **Step 6: Commit**

```bash
git add electron/automation/server.ts electron/automation/server.test.ts
git commit -m "feat: route editor.trimClip and editor.setFrameStyle through the editor bridge"
```

---

### Task 3: MCP tools — `trim_clip`, `set_frame_style`

**Files:**
- Modify: `mcp-server/src/tools.ts`
- Modify: `mcp-server/src/tools.test.ts`
- Modify: `mcp-server/src/index.ts`

**Interfaces:**
- Produces: `trim_clip({ clipId, startMs, endMs })` → `client.call("editor.trimClip", { clipId, startMs, endMs })`; `set_frame_style({ wallpaper?, frame?, padding?, borderRadius?, shadowIntensity?, backgroundBlur? })` → `client.call("editor.setFrameStyle", args)` (forward the whole args object, since all fields are optional passthrough).

- [ ] **Step 1: Write the failing tests**

Add to `mcp-server/src/tools.test.ts`:

```typescript
	it("trim_clip calls editor.trimClip with clipId/startMs/endMs", async () => {
		const client = fakeClient({ "editor.trimClip": { success: true } });
		const handlers = buildToolHandlers(client);
		const result = await handlers.trim_clip({ clipId: "clip-1", startMs: 0, endMs: 5000 });
		expect(result).toEqual({ success: true });
		expect(client.call).toHaveBeenCalledWith("editor.trimClip", { clipId: "clip-1", startMs: 0, endMs: 5000 });
	});

	it("set_frame_style forwards args directly to editor.setFrameStyle", async () => {
		const client = fakeClient({ "editor.setFrameStyle": { success: true } });
		const handlers = buildToolHandlers(client);
		const result = await handlers.set_frame_style({ wallpaper: "gradient-1", borderRadius: 12 });
		expect(result).toEqual({ success: true });
		expect(client.call).toHaveBeenCalledWith("editor.setFrameStyle", { wallpaper: "gradient-1", borderRadius: 12 });
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/tools.test.ts`
Expected: FAIL — `handlers.trim_clip`/`set_frame_style` undefined.

- [ ] **Step 3: Implement**

In `mcp-server/src/tools.ts`, add to `buildToolHandlers`'s returned object:

```typescript
		async trim_clip(args) {
			return client.call("editor.trimClip", {
				clipId: args.clipId,
				startMs: args.startMs,
				endMs: args.endMs,
			});
		},

		async set_frame_style(args) {
			return client.call("editor.setFrameStyle", args);
		},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/tools.test.ts`
Expected: PASS (all tests, existing + 2 new)

- [ ] **Step 5: Register the tools in the MCP entrypoint**

In `mcp-server/src/index.ts`, add:

```typescript
	server.tool(
		"trim_clip",
		"Resize or move a clip's boundaries on the currently open editor's timeline.",
		{ clipId: z.string(), startMs: z.number(), endMs: z.number() },
		async (args) => toContent(await handlers.trim_clip(args)),
	);

	server.tool(
		"set_frame_style",
		"Set the currently open editor's frame style: wallpaper, frame preset, padding, border radius, shadow, background blur. All fields optional — only provided fields are changed.",
		{
			wallpaper: z.string().optional(),
			frame: z.string().nullable().optional(),
			padding: z
				.object({
					top: z.number().optional(),
					bottom: z.number().optional(),
					left: z.number().optional(),
					right: z.number().optional(),
				})
				.optional(),
			borderRadius: z.number().optional(),
			shadowIntensity: z.number().optional(),
			backgroundBlur: z.number().optional(),
		},
		async (args) => toContent(await handlers.set_frame_style(args)),
	);
```

- [ ] **Step 6: Build and run full mcp-server suite**

Run: `cd mcp-server && npm run build && npm test`
Expected: build succeeds, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add mcp-server/src/tools.ts mcp-server/src/tools.test.ts mcp-server/src/index.ts
git commit -m "feat: add trim_clip and set_frame_style MCP tools"
```

---

### Task 4: Live smoke test

**Files:**
- Modify: `mcp-server/smoke-drive.mjs`
- Modify: `mcp-server/SMOKE_TEST.md`

- [ ] **Step 1: Extend `smoke-drive.mjs`**

After the existing `add_zoom_region` round-trip verification block (inside the "Editor bridge test" section), add:

```javascript
		const frameResult = await handlers.set_frame_style({ borderRadius: 12, shadowIntensity: 40 });
		log("set_frame_style", frameResult);
		const stateAfterFrame = await handlers.get_project_state({});
		if (stateAfterFrame.borderRadius !== 12 || stateAfterFrame.shadowIntensity !== 40) {
			throw new Error(
				`set_frame_style did not persist: expected borderRadius=12/shadowIntensity=40, got borderRadius=${stateAfterFrame.borderRadius}/shadowIntensity=${stateAfterFrame.shadowIntensity}`,
			);
		}
		console.log("\nVerified: frame style change persisted in project state.");

		const clips = stateAfterFrame?.clipRegions ?? [];
		if (clips.length > 0) {
			const firstClip = clips[0];
			const trimResult = await handlers.trim_clip({
				clipId: firstClip.id,
				startMs: firstClip.startMs,
				endMs: Math.max(firstClip.startMs + 500, firstClip.endMs - 200),
			});
			log("trim_clip", trimResult);
			console.log("\nVerified: trim_clip call succeeded (clip existed to trim).");
		} else {
			console.log("\nNo clip regions in project state — skipping trim_clip live verification (recording may have failed this run; not a Phase 2b regression).");
		}
```

Place this after the existing zoom-region verification and before the "Error-path checks" section — read the current file first to confirm exact placement.

- [ ] **Step 2: Run the live smoke test**

Run: `cd mcp-server && npm run smoke`

Confirm `set_frame_style`'s change is actually reflected in a subsequent `get_project_state` call (the critical assertion — proves the write persisted in live renderer state, not just returned a fake success). `trim_clip` verification depends on a clip region existing, which depends on the recording lifecycle test succeeding earlier in the same run (subject to the known pre-existing recording flake documented in `SMOKE_TEST.md` — if it flakes, re-run rather than treating it as a Phase 2b failure, per that doc's existing guidance).

- [ ] **Step 3: Update `SMOKE_TEST.md`**

Add a `## Phase 2b: trim_clip, set_frame_style` section with real results, following the same style as the Phase 1 and Phase 2a sections.

- [ ] **Step 4: Commit**

```bash
git add mcp-server/smoke-drive.mjs mcp-server/SMOKE_TEST.md
git commit -m "test: extend smoke driver to verify trim_clip and set_frame_style live"
```

## What's deliberately out of scope for this plan

- `add_speed_region`, `set_webcam_overlay`, `add_annotation`, `generate_captions`, `edit_caption` — same bridge pattern, each its own small follow-up once this lands. Speed regions in particular need more research into whether there's a dedicated "add a standalone speed region" UI flow or whether speed is only ever set via `handleClipSpeedChange` on an existing clip (`ClipRegion.speed`) — worth clarifying before designing that tool's exact contract.
- Export tools — still Phase 3, separate design (event.sender-based progress streaming).
