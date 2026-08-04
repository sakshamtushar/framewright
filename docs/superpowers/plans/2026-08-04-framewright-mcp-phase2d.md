# Framewright MCP — Phase 2d (Captions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `generate_captions` and `edit_caption` MCP tools. Captions are architecturally different from every editing tool shipped so far: transcription (`generate-auto-captions`) is a **main-process-only** operation (runs Whisper via a child process, no renderer state involved) — but the existing `electron/ipc/register/captions.ts` was never wired through the Phase 1 IPC registry, so its handler is currently unreachable by the automation server. Applying the generated cues to the editor, and all subsequent caption editing (retime/split/merge/delete/text-edit), *is* renderer state, going through the Phase 2a-2c editor bridge as usual.

**Architecture:**
- `captions.generate` RPC method → routes through the **registry** path (like Phase 1's recording/sources/project tools), not the editor bridge, since `generate-auto-captions` doesn't touch renderer state and doesn't use `event.sender` (confirmed by reading the file — unlike its sibling `download-whisper-small-model` handler in the same file, which does and is correctly left alone/out of scope).
- `editor.setCaptions` / `editor.editCaption` RPC methods → route through the **editor bridge** (like Phase 2a-2c), since applying cues and editing them mutates `autoCaptions`/`autoCaptionSettings` renderer state.
- The `generate_captions` MCP tool composes both: call `captions.generate` to transcribe, then call `editor.setCaptions` to apply the result to the open editor.

**Tech Stack:** Same as prior phases.

## Global Constraints

- Follow the exact conventions established in Phases 1-2c: `handle()` registry wrapper for main-process-only channels, the existing `VideoEditor.tsx` automation dispatch effect's `switch`/shared-`result` pattern for editor-bridge cases, `.js` extensions in `mcp-server/src`.
- `generate_captions` requires a Whisper model to already be downloaded on the machine (`electron/ipc/captions/whisper.ts`'s `WHISPER_SMALL_MODEL_PATH` must exist) — this plan does NOT add a `download_whisper_model` tool (that handler uses `event.sender` for download-progress streaming, out of scope, same category of exclusion as export). If the model isn't downloaded, `generate_captions` must fail with a clear, actionable error message (not a generic crash), not attempt to trigger a download.
- `edit_caption`'s text-edit action must reuse the exact logic `handleCaptionTextEdit` already uses (handle both the empty-words case, e.g. a caption added manually with no Whisper-derived word timings, and the normal case via `updateCaptionCuesForEditedTarget`) — do not write a simplified version that only handles one case.

---

### Task 1: Wire `generate-auto-captions` through the IPC registry, route `captions.generate`

**Files:**
- Modify: `electron/ipc/register/captions.ts`
- Modify: `electron/automation/server.ts`
- Modify: `electron/automation/server.test.ts`

**Interfaces:**
- Produces: `generate-auto-captions` is now registered via `handle()` (populates `ipcHandlerRegistry`), not raw `ipcMain.handle`.
- Produces: automation server's `METHOD_TO_CHANNEL` map gains `"captions.generate": "generate-auto-captions"`, routed through the existing `callChannel`/registry path (same as `recording.startNative` etc. from Phase 1) — NOT the editor bridge.

- [ ] **Step 1: Convert the one handler**

In `electron/ipc/register/captions.ts`, add the import `import { handle } from "../registry";` (check it isn't already imported), and change ONLY the `generate-auto-captions` registration from `ipcMain.handle(` to `handle(` — leave every other handler in this file (`download-whisper-small-model`, `delete-whisper-small-model`, `get-whisper-small-model-status`, the `open-*-picker` handlers) exactly as `ipcMain.handle`, unchanged. Do not touch the `event.sender`-using handlers (`download-whisper-small-model`) — converting those to the registry's `FAKE_EVENT` pattern would break them, and they're intentionally out of scope for this plan.

Confirm `ipcMain` is still used elsewhere in this file after this one conversion (it registers ~6+ other handlers) — do NOT remove the `ipcMain` import, unlike Phase 1's `recording.ts`/`sources.ts` conversions where every single handler in the file was converted.

- [ ] **Step 2: Typecheck and run full suite**

Run: `npx tsc --noEmit -p tsconfig.json` and `npm test`.
Expected: no errors, no regressions.

- [ ] **Step 3: Write the failing test for the server route**

Add to `electron/automation/server.test.ts`:

```typescript
	it("captions.generate routes through the registry to generate-auto-captions", async () => {
		ipcHandlerRegistry.set("generate-auto-captions", async (_event, options) => ({
			success: true,
			cues: [],
			message: "ok",
			receivedOptions: options,
		}));

		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 40,
			method: "captions.generate",
			params: { videoPath: "/tmp/video.mp4", whisperModelPath: "/tmp/model.bin" },
		});

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: 40,
			result: {
				success: true,
				cues: [],
				message: "ok",
				receivedOptions: { videoPath: "/tmp/video.mp4", whisperModelPath: "/tmp/model.bin" },
			},
		});
	});
```

- [ ] **Step 4: Run test to verify it fails, then implement**

Run: `npx vitest run electron/automation/server.test.ts` — expect FAIL (`captions.generate` unknown method).

In `electron/automation/server.ts`, add `"captions.generate": "generate-auto-captions"` to the existing `METHOD_TO_CHANNEL` map. (Note: this is the `callChannel`/registry path, which wraps the single positional arg as `{arg: params}` when calling — confirm this by reading `callChannel`'s implementation; the test above should reflect whatever the real wrapping behavior is. Adjust the test's `receivedOptions` expectation to match reality rather than assuming — read `electron/automation/server.ts`'s `callChannel` function first.)

- [ ] **Step 5: Run test to verify it passes, run full suite, typecheck**

Run: `npx vitest run electron/automation/server.test.ts`, `npm test`, `npx tsc --noEmit -p tsconfig.json`.
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/register/captions.ts electron/automation/server.ts electron/automation/server.test.ts
git commit -m "feat: route caption generation through the IPC registry, add captions.generate RPC method"
```

---

### Task 2: Renderer dispatch — `setCaptions` and `editCaption` cases

**Files:**
- Modify: `src/components/video-editor/VideoEditor.tsx`

**Interfaces:**
- Produces: `type: "setCaptions"` (payload `{ cues: CaptionCue[] }`, calls `setAutoCaptions(payload.cues)` and, if `payload.cues.length > 0`, `setAutoCaptionSettings((prev) => ({...prev, enabled: true}))` — mirroring `handleGenerateAutoCaptions`'s existing side effect. Returns `{ success: true, count: payload.cues.length }`.)
- Produces: `type: "editCaption"` (payload `{ action: "setText" | "retime" | "split" | "merge" | "delete"; id: string; text?: string; startMs?: number; endMs?: number; atMs?: number; mergeWithId?: string }`, dispatches to the appropriate existing pure function from `captionOps.ts`/`captionEditing.ts`. Returns `{ success: true }`.)

- [ ] **Step 1: Read the current dispatch effect and the real caption editing functions**

Read the existing automation dispatch effect in `VideoEditor.tsx` (search `onAutomationEditorRequest`), and read `handleCaptionTextEdit` (search for it, ~line 3866) to see the EXACT logic for both the empty-words and normal text-edit cases — this must be replicated faithfully for the `"setText"` action, not simplified. Also confirm the real imports already present at the top of `VideoEditor.tsx` for `retimeCue`, `splitCue`, `mergeCues`, `deleteCue`, `updateCaptionCuesForEditedTarget`, `normalizeCaptionWords`, `normalizeCaptionEditText`, `CaptionEditTarget`, `CaptionRetimeSpan`, `CaptionCue` (all should already be imported since the existing UI handlers use them — do not add duplicate imports if already present).

- [ ] **Step 2: Add the two new cases**

Add to the existing `switch (type)` block, before `default`:

```typescript
					case "setCaptions": {
						const params = payload as { cues?: CaptionCue[] };
						if (!Array.isArray(params.cues)) {
							throw new Error("setCaptions requires a cues array");
						}
						setAutoCaptions(params.cues);
						if (params.cues.length > 0) {
							setAutoCaptionSettings((prev) => ({ ...prev, enabled: true }));
						}
						result = { success: true, count: params.cues.length };
						break;
					}
					case "editCaption": {
						const params = payload as {
							action?: string;
							id?: string;
							text?: string;
							startMs?: number;
							endMs?: number;
							atMs?: number;
							mergeWithId?: string;
						};
						if (typeof params.id !== "string") {
							throw new Error("editCaption requires an id");
						}
						switch (params.action) {
							case "setText": {
								if (typeof params.text !== "string") {
									throw new Error("editCaption action 'setText' requires text");
								}
								const targetId = params.id;
								const editText = params.text;
								setAutoCaptions((captions) => {
									const cue = captions.find((value) => value.id === targetId);
									if (!cue) {
										return captions;
									}
									const words = normalizeCaptionWords(cue);
									if (words.length === 0) {
										const normalized = normalizeCaptionEditText(editText);
										return captions.map((value) =>
											value.id === targetId ? { ...value, text: normalized } : value,
										);
									}
									const target: CaptionEditTarget = {
										id: cue.id,
										startMs: cue.startMs,
										endMs: cue.endMs,
										text: cue.text,
										words: words.map((word, index) => ({
											cueId: cue.id,
											cueWordIndex: index,
											startMs: word.startMs,
											endMs: word.endMs,
											text: word.text,
											leadingSpace: Boolean(word.leadingSpace),
										})),
									};
									return updateCaptionCuesForEditedTarget(captions, target, editText);
								});
								break;
							}
							case "retime": {
								if (typeof params.startMs !== "number" || typeof params.endMs !== "number") {
									throw new Error("editCaption action 'retime' requires numeric startMs/endMs");
								}
								const span: CaptionRetimeSpan = { startMs: params.startMs, endMs: params.endMs };
								setAutoCaptions((captions) => retimeCue(captions, params.id as string, span));
								break;
							}
							case "split": {
								if (typeof params.atMs !== "number") {
									throw new Error("editCaption action 'split' requires numeric atMs");
								}
								setAutoCaptions((captions) => splitCue(captions, params.id as string, params.atMs as number));
								break;
							}
							case "merge": {
								if (typeof params.mergeWithId !== "string") {
									throw new Error("editCaption action 'merge' requires mergeWithId");
								}
								setAutoCaptions((captions) =>
									mergeCues(captions, params.id as string, params.mergeWithId as string),
								);
								break;
							}
							case "delete": {
								setAutoCaptions((captions) => deleteCue(captions, params.id as string));
								break;
							}
							default:
								throw new Error(`Unknown editCaption action: ${params.action}`);
						}
						result = { success: true };
						break;
					}
```

Match the file's REAL existing switch structure (shared `result` variable pattern, confirmed already in place since Phase 2b/2c) — read it first per Step 1, adjust if it's structured differently than assumed here.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. If any of the referenced functions/types aren't already imported at the top of the file, add them to the existing `./captionOps`/`./captionEditing`/`./types` import statements (check each one individually before assuming it's missing).

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/video-editor/VideoEditor.tsx
git commit -m "feat: dispatch setCaptions and editCaption automation editor requests"
```

---

### Task 3: Wire `editor.setCaptions` and `editor.editCaption` into the automation server

**Files:**
- Modify: `electron/automation/server.ts`
- Modify: `electron/automation/server.test.ts`

**Interfaces:**
- Produces: `EDITOR_BRIDGE_METHODS` gains `"editor.setCaptions": "setCaptions"` and `"editor.editCaption": "editCaption"`.

- [ ] **Step 1: Write the failing tests**

Add to `electron/automation/server.test.ts`, following the exact pattern of the existing `editor.setWebcamOverlay`/`editor.addAnnotation` tests:

```typescript
	it("editor.setCaptions forwards params directly as the payload", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ success: true, count: 2 });
		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 41,
			method: "editor.setCaptions",
			params: { cues: [{ id: "c1", startMs: 0, endMs: 500, text: "Hi" }] },
		});
		expect(spy).toHaveBeenCalledWith("setCaptions", { cues: [{ id: "c1", startMs: 0, endMs: 500, text: "Hi" }] });
		expect(response).toEqual({ jsonrpc: "2.0", id: 41, result: { success: true, count: 2 } });
		spy.mockRestore();
	});

	it("editor.editCaption forwards params directly as the payload", async () => {
		const spy = vi.spyOn(editorBridge, "requestEditorState").mockResolvedValue({ success: true });
		const response = await dispatchRpcRequest({
			jsonrpc: "2.0",
			id: 42,
			method: "editor.editCaption",
			params: { action: "delete", id: "c1" },
		});
		expect(spy).toHaveBeenCalledWith("editCaption", { action: "delete", id: "c1" });
		expect(response).toEqual({ jsonrpc: "2.0", id: 42, result: { success: true } });
		spy.mockRestore();
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/automation/server.test.ts`
Expected: FAIL — both methods unknown.

- [ ] **Step 3: Implement**

Add to the existing `EDITOR_BRIDGE_METHODS` map:

```typescript
			"editor.setCaptions": "setCaptions",
			"editor.editCaption": "editCaption",
```

- [ ] **Step 4: Run test to verify it passes, run full suite, typecheck**

Run: `npx vitest run electron/automation/server.test.ts`, `npm test`, `npx tsc --noEmit -p tsconfig.json`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add electron/automation/server.ts electron/automation/server.test.ts
git commit -m "feat: route editor.setCaptions and editor.editCaption through the editor bridge"
```

---

### Task 4: MCP tools — `generate_captions`, `edit_caption`

**Files:**
- Modify: `mcp-server/src/tools.ts`
- Modify: `mcp-server/src/tools.test.ts`
- Modify: `mcp-server/src/index.ts`

**Interfaces:**
- Produces: `generate_captions({ videoPath, language? })` — calls `client.call("captions.generate", { videoPath, whisperModelPath: WHISPER_SMALL_MODEL_PATH_EQUIVALENT, language })`, then if `success`, calls `client.call("editor.setCaptions", { cues: result.cues })`, returning a combined result. If `captions.generate` fails (e.g. model not downloaded), returns/throws its error directly WITHOUT attempting the `setCaptions` call.
- Produces: `edit_caption({ action, id, text?, startMs?, endMs?, atMs?, mergeWithId? })` → `client.call("editor.editCaption", args)` (whole-object passthrough).

**Important — resolving `whisperModelPath` without an Electron import:** `mcp-server` cannot import Electron's `app.getPath`. The brief's earlier research found `WHISPER_SMALL_MODEL_PATH = path.join(WHISPER_MODEL_DIR, "ggml-small.bin")` where `WHISPER_MODEL_DIR = path.join(USER_DATA_PATH, "whisper")` in `electron/ipc/constants.ts` — i.e., it's under the same dev userData path (`Framewright-dev`) that `mcp-server/src/paths.ts` already independently reconstructs via `getFramewrightDevUserDataPath()`. Reuse that existing function: `whisperModelPath = path.join(getFramewrightDevUserDataPath(), "whisper", "ggml-small.bin")`.

- [ ] **Step 1: Write the failing tests**

Add to `mcp-server/src/tools.test.ts`:

```typescript
	it("generate_captions calls captions.generate then editor.setCaptions on success", async () => {
		const client = fakeClient({
			"captions.generate": { success: true, cues: [{ id: "c1", startMs: 0, endMs: 500, text: "Hi" }], message: "ok" },
			"editor.setCaptions": { success: true, count: 1 },
		});
		const handlers = buildToolHandlers(client);
		const result = await handlers.generate_captions({ videoPath: "/tmp/video.mp4" });
		expect(result).toEqual({ success: true, count: 1 });
		expect(client.call).toHaveBeenCalledWith(
			"captions.generate",
			expect.objectContaining({ videoPath: "/tmp/video.mp4" }),
		);
		expect(client.call).toHaveBeenCalledWith("editor.setCaptions", {
			cues: [{ id: "c1", startMs: 0, endMs: 500, text: "Hi" }],
		});
	});

	it("generate_captions does not call editor.setCaptions when transcription fails", async () => {
		const client = fakeClient({
			"captions.generate": { success: false, error: "model not found", message: "Failed to generate auto captions" },
		});
		const handlers = buildToolHandlers(client);
		await expect(handlers.generate_captions({ videoPath: "/tmp/video.mp4" })).rejects.toThrow();
		expect(client.call).not.toHaveBeenCalledWith("editor.setCaptions", expect.anything());
	});

	it("edit_caption forwards args directly to editor.editCaption", async () => {
		const client = fakeClient({ "editor.editCaption": { success: true } });
		const handlers = buildToolHandlers(client);
		const result = await handlers.edit_caption({ action: "delete", id: "c1" });
		expect(result).toEqual({ success: true });
		expect(client.call).toHaveBeenCalledWith("editor.editCaption", { action: "delete", id: "c1" });
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/tools.test.ts`

- [ ] **Step 3: Implement**

In `mcp-server/src/tools.ts`, add the import (near the top, with `.js` extension) `import { getFramewrightDevUserDataPath } from "./paths.js";` and `import path from "node:path";`, and add to `buildToolHandlers`'s returned object:

```typescript
		async generate_captions(args) {
			const whisperModelPath = path.join(getFramewrightDevUserDataPath(), "whisper", "ggml-small.bin");
			const genResult = (await client.call("captions.generate", {
				videoPath: args.videoPath,
				whisperModelPath,
				language: args.language,
			})) as { success: boolean; cues?: unknown[]; error?: string; message?: string };
			if (!genResult.success) {
				throw new Error(genResult.error ?? genResult.message ?? "Caption generation failed");
			}
			return client.call("editor.setCaptions", { cues: genResult.cues });
		},

		async edit_caption(args) {
			return client.call("editor.editCaption", args);
		},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/tools.test.ts`

- [ ] **Step 5: Register the tools in the MCP entrypoint**

In `mcp-server/src/index.ts`, add:

```typescript
	server.tool(
		"generate_captions",
		"Transcribe a video's audio into caption cues using the locally downloaded Whisper model, and apply them to the currently open editor. Requires the small Whisper model to already be downloaded (via the Recordly/Framewright app's caption settings UI) — fails with a clear error otherwise.",
		{ videoPath: z.string(), language: z.string().optional() },
		async (args) => toContent(await handlers.generate_captions(args)),
	);

	server.tool(
		"edit_caption",
		"Edit an existing caption cue on the currently open editor's timeline: change its text, retime it, split it, merge it with another cue, or delete it.",
		{
			action: z.enum(["setText", "retime", "split", "merge", "delete"]),
			id: z.string(),
			text: z.string().optional(),
			startMs: z.number().optional(),
			endMs: z.number().optional(),
			atMs: z.number().optional(),
			mergeWithId: z.string().optional(),
		},
		async (args) => toContent(await handlers.edit_caption(args)),
	);
```

- [ ] **Step 6: Build and run full mcp-server suite**

Run: `cd mcp-server && npm run build && npm test`

- [ ] **Step 7: Commit**

```bash
git add mcp-server/src/tools.ts mcp-server/src/tools.test.ts mcp-server/src/index.ts
git commit -m "feat: add generate_captions and edit_caption MCP tools"
```

---

### Task 5: Live smoke test

**Files:**
- Modify: `mcp-server/smoke-drive.mjs`
- Modify: `mcp-server/SMOKE_TEST.md`

- [ ] **Step 1: Extend `smoke-drive.mjs`**

After the existing `add_annotation` block, add a captions section. Since a real Whisper model may not be downloaded in the test environment, structure this so a "model not downloaded" failure is treated as an expected, documented outcome (not a smoke-test failure), while still exercising `edit_caption` independently by seeding a caption directly via a low-level approach:

```javascript
		console.log("\n--- Captions test ---");
		let captionGenerated = false;
		try {
			const capResult = await handlers.generate_captions({ videoPath: stopResult?.path ?? "/tmp/does-not-exist.mp4" });
			log("generate_captions", capResult);
			captionGenerated = true;
		} catch (err) {
			console.log(`\ngenerate_captions failed (expected if the Whisper model isn't downloaded on this machine): ${err.message}`);
		}

		if (captionGenerated) {
			const stateAfterCaptions = await handlers.get_project_state({});
			const captions = stateAfterCaptions?.autoCaptions ?? [];
			if (captions.length > 0) {
				const editResult = await handlers.edit_caption({ action: "setText", id: captions[0].id, text: "Edited via MCP" });
				log("edit_caption (setText)", editResult);
				console.log("\nVerified: edit_caption call succeeded on a real generated cue.");
			} else {
				console.log("\ngenerate_captions succeeded but produced zero cues — skipping edit_caption live verification.");
			}
		} else {
			console.log("\nSkipping edit_caption live verification — no captions were generated this run.");
		}
```

Place this after the existing `add_annotation` verification and before the "Error-path checks" section — read the current file first to confirm exact placement.

- [ ] **Step 2: Run the live smoke test**

Run: `cd mcp-server && npm run smoke`

If the Whisper model isn't downloaded on this machine, `generate_captions` failing with a clear, expected error IS an acceptable outcome for this task — do not treat it as a blocker, but DO confirm the error message is clear and actionable (not a stack trace or generic crash), and document in `SMOKE_TEST.md` that this specific path couldn't be exercised in this environment. If the model IS available, confirm the full generate → edit round trip works and the edited text is reflected in `get_project_state`.

- [ ] **Step 3: Update `SMOKE_TEST.md`**

Add a `## Phase 2d: Captions` section with real results, being explicit about which paths were/weren't actually exercised.

- [ ] **Step 4: Commit**

```bash
git add mcp-server/smoke-drive.mjs mcp-server/SMOKE_TEST.md
git commit -m "test: extend smoke driver to verify caption generation and editing live"
```

## What's deliberately out of scope for this plan

- `download_whisper_model` / `delete_whisper_model` tools — their IPC handlers use `event.sender` for download-progress streaming, same category of exclusion as export tools.
- Word-level caption editing (editing individual words within a cue rather than the whole cue's text) — `edit_caption`'s `"setText"` action replaces a whole cue's text, matching the simpler half of `handleCaptionTextEdit`'s behavior.
- Export tools — still Phase 3.
- Speed/clip-speed control — still needs its own design (see Phase 2c's plan).
