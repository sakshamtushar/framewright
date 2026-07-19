# Recordly MCP — Phase 2c (set_webcam_overlay, add_annotation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `set_webcam_overlay` and `add_annotation` on top of the Phase 2a/2b editor automation bridge.

**Research finding that shaped this plan's scope:** `add_speed_region` (originally planned as part of Phase 2b's follow-ups) was investigated and dropped from this phase — `speedRegions` in `VideoEditor.tsx` is a DERIVED value computed from `clipRegions[].speed` (see the `speedRegions: (() => { const clipDerived = clipRegions.map(...) ... })()` block around line 1186), not an independently-addable region with its own "add" handler. There is no `handleSpeedRegionAdded` anywhere in the file. Setting a clip's speed goes through `handleClipSpeedChange`, which delegates to `planClipSpeedChange` (in `clipSpeedChange.ts`) and can return a `blockedReason` (`"clip-overlap"` or `"zoom-overlap"`) instead of succeeding — this is a more complex contract than a simple append/set and deserves its own focused design pass. Deferred to a future phase; not part of this one.

**Architecture:** Same bridge as Phase 2a/2b. Design choice per operation, consistent with prior phases' precedent:
- `set_webcam_overlay` → raw `setWebcam((prev) => ({...prev, ...providedFields}))` functional merge (same pattern as Phase 2b's `set_frame_style` raw setters) — safe, no cascading logic.
- `add_annotation` → constructs a new `AnnotationRegion` directly and appends it (same pattern as Phase 2a's `add_zoom_region` — an "append new entity" operation reimplements the append with sensible defaults, since the existing `handleAnnotationAdded` only creates a placeholder "text" annotation from a `Span` and doesn't accept the annotation's actual type/content/position up front; building the desired annotation immediately avoids needing several follow-up round trips).

**Tech Stack:** Same as prior phases.

## Global Constraints

- Same conventions as Phase 2a/2b: tabs, Biome, `.js` extensions in mcp-server, dispatch effect in `VideoEditor.tsx` (search `onAutomationEditorRequest`), `EDITOR_BRIDGE_METHODS` map in `electron/automation/server.ts`.
- `set_webcam_overlay` must only mutate fields actually provided in the payload (partial update onto the PREVIOUS `webcam` state), matching `set_frame_style`'s established pattern — do not force-default unprovided fields.
- `add_annotation` must reuse the SAME `nextAnnotationIdRef`/`nextAnnotationZIndexRef` counters `handleAnnotationAdded` uses (read the real file to find them), so automation-created and UI-created annotation IDs/z-indices never collide — same discipline as Phase 2a's zoom region ID reuse.
- Before writing code, read `handleAnnotationAdded`'s real body in `VideoEditor.tsx` (search for it) to confirm the exact `AnnotationRegion` shape, default constants (`DEFAULT_ANNOTATION_POSITION`, `DEFAULT_ANNOTATION_SIZE`, `DEFAULT_ANNOTATION_STYLE`), and the `WebcamOverlaySettings` interface in `src/components/video-editor/types.ts` for `set_webcam_overlay`'s exact field set — do not guess field names from this plan's paraphrase alone.

---

### Task 1: Renderer dispatch — add `setWebcamOverlay` and `addAnnotation` cases

**Files:**
- Modify: `src/components/video-editor/VideoEditor.tsx` (the existing automation dispatch `useEffect`)

**Interfaces:**
- Produces: handles `type: "setWebcamOverlay"` (payload: `Partial<WebcamOverlaySettings>`, merges onto previous `webcam` state, returns `{ success: true }`) and `type: "addAnnotation"` (payload `{ startMs: number; endMs: number; type?: "text" | "image" | "figure" | "blur"; content?: string; trackIndex?: number }`, returns `{ id: string }`).

- [ ] **Step 1: Read the current dispatch effect and the real handler/type definitions**

Read the existing dispatch effect (search `onAutomationEditorRequest` in `VideoEditor.tsx`), `handleAnnotationAdded`'s real body (search for it — confirm `nextAnnotationIdRef`, `nextAnnotationZIndexRef`, `DEFAULT_ANNOTATION_POSITION`/`SIZE`/`STYLE` are the real names), and `WebcamOverlaySettings` in `src/components/video-editor/types.ts`. Confirm `setWebcam` is a raw `useState` setter used elsewhere as a functional-update pattern (e.g. `setWebcam((prev) => ({...prev, enabled: true, ...}))`, as seen in `handleUploadWebcam`/`handleClearWebcam`).

- [ ] **Step 2: Add the two new cases**

Add to the existing `switch (type)` block, before `default`, matching the file's real control-flow pattern (shared `result` variable, per Phase 2b's established structure):

```typescript
					case "setWebcamOverlay": {
						const params = payload as Partial<WebcamOverlaySettings>;
						setWebcam((prev) => ({ ...prev, ...params }));
						result = { success: true };
						break;
					}
					case "addAnnotation": {
						const params = payload as {
							startMs?: number;
							endMs?: number;
							type?: AnnotationType;
							content?: string;
							trackIndex?: number;
						};
						if (
							typeof params.startMs !== "number" ||
							typeof params.endMs !== "number" ||
							params.endMs <= params.startMs
						) {
							throw new Error(
								"addAnnotation requires numeric startMs/endMs with endMs > startMs",
							);
						}
						const id = `annotation-${nextAnnotationIdRef.current++}`;
						const zIndex = nextAnnotationZIndexRef.current++;
						const newRegion: AnnotationRegion = {
							id,
							startMs: Math.round(params.startMs),
							endMs: Math.round(params.endMs),
							type: params.type ?? "text",
							content: params.content ?? "Enter text...",
							position: { ...DEFAULT_ANNOTATION_POSITION },
							size: { ...DEFAULT_ANNOTATION_SIZE },
							style: { ...DEFAULT_ANNOTATION_STYLE },
							zIndex,
							trackIndex: params.trackIndex ?? 0,
						};
						setAnnotationRegions((prev) => [...prev, newRegion]);
						result = { id };
						break;
					}
```

Adjust to the REAL file's exact identifiers and control flow found in Step 1 — this is a target shape, not a guaranteed-verbatim match. Add `WebcamOverlaySettings`/`AnnotationType`/`AnnotationRegion` to the existing `./types` import if any aren't already imported (check first — most are very likely already imported given they're used elsewhere in this file).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: all existing tests pass (no dedicated unit test for this file, per established convention — verified by typecheck + Task 4's live smoke test).

- [ ] **Step 5: Commit**

```bash
git add src/components/video-editor/VideoEditor.tsx
git commit -m "feat: dispatch setWebcamOverlay and addAnnotation automation editor requests"
```

---

### Task 2: Wire `editor.setWebcamOverlay` and `editor.addAnnotation` into the automation server

**Files:**
- Modify: `electron/automation/server.ts`
- Modify: `electron/automation/server.test.ts`

**Interfaces:**
- Produces: `EDITOR_BRIDGE_METHODS` gains `"editor.setWebcamOverlay": "setWebcamOverlay"` and `"editor.addAnnotation": "addAnnotation"`.

- [ ] **Step 1: Write the failing tests**

Add to `electron/automation/server.test.ts`, following the exact pattern of the existing `editor.trimClip`/`editor.setFrameStyle` tests (read them first to match style):

```typescript
	it("editor.setWebcamOverlay forwards params directly as the payload", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ success: true });
		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 30,
			method: "editor.setWebcamOverlay",
			params: { enabled: true, mirror: true },
		});
		expect(spy).toHaveBeenCalledWith("setWebcamOverlay", { enabled: true, mirror: true });
		expect(response).toEqual({ jsonrpc: "2.0", id: 30, result: { success: true } });
		spy.mockRestore();
	});

	it("editor.addAnnotation forwards params directly as the payload", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ id: "annotation-1" });
		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 31,
			method: "editor.addAnnotation",
			params: { startMs: 0, endMs: 2000, content: "Hello" },
		});
		expect(spy).toHaveBeenCalledWith("addAnnotation", { startMs: 0, endMs: 2000, content: "Hello" });
		expect(response).toEqual({ jsonrpc: "2.0", id: 31, result: { id: "annotation-1" } });
		spy.mockRestore();
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/automation/server.test.ts`
Expected: FAIL — both methods unknown.

- [ ] **Step 3: Implement**

Add to the existing `EDITOR_BRIDGE_METHODS` map:

```typescript
			"editor.setWebcamOverlay": "setWebcamOverlay",
			"editor.addAnnotation": "addAnnotation",
```

- [ ] **Step 4: Run test to verify it passes, run full suite, typecheck**

Run: `npx vitest run electron/automation/server.test.ts`, then `npm test`, then `npx tsc --noEmit -p tsconfig.json`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add electron/automation/server.ts electron/automation/server.test.ts
git commit -m "feat: route editor.setWebcamOverlay and editor.addAnnotation through the editor bridge"
```

---

### Task 3: MCP tools — `set_webcam_overlay`, `add_annotation`

**Files:**
- Modify: `mcp-server/src/tools.ts`
- Modify: `mcp-server/src/tools.test.ts`
- Modify: `mcp-server/src/index.ts`

**Interfaces:**
- Produces: `set_webcam_overlay(args)` → `client.call("editor.setWebcamOverlay", args)` (whole-object passthrough, all fields optional, same pattern as `set_frame_style`); `add_annotation({startMs, endMs, type?, content?, trackIndex?})` → `client.call("editor.addAnnotation", args)`.

- [ ] **Step 1: Write the failing tests**

Add to `mcp-server/src/tools.test.ts`:

```typescript
	it("set_webcam_overlay forwards args directly to editor.setWebcamOverlay", async () => {
		const client = fakeClient({ "editor.setWebcamOverlay": { success: true } });
		const handlers = buildToolHandlers(client);
		const result = await handlers.set_webcam_overlay({ enabled: true, mirror: true });
		expect(result).toEqual({ success: true });
		expect(client.call).toHaveBeenCalledWith("editor.setWebcamOverlay", { enabled: true, mirror: true });
	});

	it("add_annotation forwards args directly to editor.addAnnotation", async () => {
		const client = fakeClient({ "editor.addAnnotation": { id: "annotation-1" } });
		const handlers = buildToolHandlers(client);
		const result = await handlers.add_annotation({ startMs: 0, endMs: 2000, content: "Hello" });
		expect(result).toEqual({ id: "annotation-1" });
		expect(client.call).toHaveBeenCalledWith("editor.addAnnotation", { startMs: 0, endMs: 2000, content: "Hello" });
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/tools.test.ts`

- [ ] **Step 3: Implement**

```typescript
		async set_webcam_overlay(args) {
			return client.call("editor.setWebcamOverlay", args);
		},

		async add_annotation(args) {
			return client.call("editor.addAnnotation", args);
		},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/tools.test.ts`

- [ ] **Step 5: Register the tools in the MCP entrypoint**

In `mcp-server/src/index.ts`:

```typescript
	server.tool(
		"set_webcam_overlay",
		"Set webcam overlay properties on the currently open editor: enabled, source path, position, size, crop, mirror, corner radius, shadow, etc. All fields optional — only provided fields are changed.",
		{
			enabled: z.boolean().optional(),
			mirror: z.boolean().optional(),
			reactToZoom: z.boolean().optional(),
			positionX: z.number().min(0).max(1).optional(),
			positionY: z.number().min(0).max(1).optional(),
			size: z.number().optional(),
			cornerRadius: z.number().optional(),
			shadow: z.number().optional(),
			margin: z.number().optional(),
		},
		async (args) => toContent(await handlers.set_webcam_overlay(args)),
	);

	server.tool(
		"add_annotation",
		"Add a text/image/figure/blur annotation to the currently open editor's timeline.",
		{
			startMs: z.number(),
			endMs: z.number(),
			type: z.enum(["text", "image", "figure", "blur"]).optional(),
			content: z.string().optional(),
			trackIndex: z.number().optional(),
		},
		async (args) => toContent(await handlers.add_annotation(args)),
	);
```

Note: the zod schema for `set_webcam_overlay` intentionally covers a useful subset of `WebcamOverlaySettings` (not every field, e.g. `sourcePath`/`cropRegion`/`corner`/`positionPreset`/`width`/`height` are omitted) — confirm this subset against the real `WebcamOverlaySettings` interface read in Task 1 and adjust field names if they don't match exactly. Expanding to the full field set is fine if straightforward, but do not invent field names that don't exist on the real interface.

- [ ] **Step 6: Build and run full mcp-server suite**

Run: `cd mcp-server && npm run build && npm test`

- [ ] **Step 7: Commit**

```bash
git add mcp-server/src/tools.ts mcp-server/src/tools.test.ts mcp-server/src/index.ts
git commit -m "feat: add set_webcam_overlay and add_annotation MCP tools"
```

---

### Task 4: Live smoke test

**Files:**
- Modify: `mcp-server/smoke-drive.mjs`
- Modify: `mcp-server/SMOKE_TEST.md`

- [ ] **Step 1: Extend `smoke-drive.mjs`**

After the existing `trim_clip` block in the "Editor bridge test" section, add:

```javascript
		const webcamResult = await handlers.set_webcam_overlay({ enabled: true, mirror: true });
		log("set_webcam_overlay", webcamResult);
		const stateAfterWebcam = await handlers.get_project_state({});
		if (stateAfterWebcam.webcam?.enabled !== true || stateAfterWebcam.webcam?.mirror !== true) {
			throw new Error(
				`set_webcam_overlay did not persist: got webcam=${JSON.stringify(stateAfterWebcam.webcam)}`,
			);
		}
		console.log("\nVerified: webcam overlay change persisted in project state.");

		const annotationResult = await handlers.add_annotation({ startMs: 0, endMs: 2000, content: "Smoke test annotation" });
		log("add_annotation", annotationResult);
		const stateAfterAnnotation = await handlers.get_project_state({});
		const annotations = stateAfterAnnotation?.annotationRegions ?? [];
		if (!annotations.find((a) => a.id === annotationResult.id)) {
			throw new Error(
				`add_annotation reported id ${annotationResult.id} but it's not in project state: ${JSON.stringify(annotations)}`,
			);
		}
		console.log(`\nVerified: annotation ${annotationResult.id} is present in project state after adding it.`);
```

Read the current file first to place this correctly relative to the existing sections.

- [ ] **Step 2: Run the live smoke test**

Run: `cd mcp-server && npm run smoke`
Confirm both round-trip verifications pass against a real editor window.

- [ ] **Step 3: Update `SMOKE_TEST.md`**

Add a `## Phase 2c: set_webcam_overlay, add_annotation` section with real results.

- [ ] **Step 4: Commit**

```bash
git add mcp-server/smoke-drive.mjs mcp-server/SMOKE_TEST.md
git commit -m "test: extend smoke driver to verify set_webcam_overlay and add_annotation live"
```

## What's deliberately out of scope for this plan

- `add_speed_region`/clip speed control — needs its own design given `handleClipSpeedChange`'s more complex `blockedReason` contract (see this plan's opening research note).
- `generate_captions`/`edit_caption` — deferred to a follow-up phase (captions generation is an async, potentially long-running Whisper transcription call, a different shape than the synchronous operations in this plan).
- Export tools — still Phase 3.
