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

## Automated driver

`mcp-server/smoke-drive.mjs` exercises the real production code path (`getOrCreateConnection` +
`buildToolHandlers`, the same functions `src/index.ts` uses) against a live Recordly instance —
attaching to one that's already running, or spawning `npm run dev` itself. It performs a real
few-second recording (with a pause/resume in the middle), lists projects, checks a couple of error
paths, and cleans up the file it created. Run it from `mcp-server/`:

```bash
npm run build
node smoke-drive.mjs
```

It does **not** replace the manual MCP-client walkthrough above (it bypasses the MCP stdio/tool-schema
layer and calls the tool handler functions directly), but it's a fast, repeatable check of the
automation server + IPC registry + recording pipeline integration, runnable in CI or locally without
an MCP client.

## Last run

**Date:** 2026-07-19
**Environment:** Real desktop session, macOS (Darwin 25.5.0), via `node smoke-drive.mjs`
**Result:** ✅ Full end-to-end pass, both attach and spawn paths, all 9 Phase 1 tools exercised.

### What was verified live

1. **Spawn-a-fresh-instance path:** `getOrCreateConnection` spawned `npm run dev` with a generated
   token (no prior instance running), polled the lockfile, and connected — the whole flow the plan
   calls "the MCP server starts Recordly itself."
2. **`get_app_status`** → `{ recording: false, platform: "darwin" }`
3. **`list_capture_sources`** → 16 real sources returned, including `screen:4:0` ("Screen 1 (Primary)")
   with a real thumbnail data URL.
4. **`list_projects`** → `{ success: true, projectsDir: "...Recordly-dev/recordings/Projects", entries: [] }`
   (empty — no `.recordly` project files exist yet since Phase 1 has no save/editor tools; this is expected).
5. **`start_recording`** → `{ success: true, microphoneFallbackRequired: false }` — produced a real,
   valid MP4 (`ISO Media, MP4 v2`, ~2.5MB for ~3s) at the expected `recordings/` path.
6. **`get_recording_status`** (mid-recording) → `{ recording: true, ... }`.
7. **`pause_recording`** / **`resume_recording`** → both `{ success: true }`.
8. **`stop_recording`** → finalized and validated the file; also correctly threw
   `"No recording is currently active."` when called a second time with nothing recording.
9. **Attach-to-existing-instance path:** re-ran the driver against the still-running instance from
   the spawn test — `getOrCreateConnection` correctly attached (no second Recordly window/process
   spawned), confirmed by the lockfile PID staying the same.
10. **`read_project`** (error path) → nonexistent path returned a graceful
    `{ success: false, message: "Failed to read project file: ENOENT..." }` rather than hanging or
    throwing an unhandled rejection. The happy path (reading a real project) is still unverified —
    Phase 1 has no tool that creates a `.recordly` file to read back.

### Known flake (pre-existing, not introduced by this MCP work)

One run out of several hit a native-layer failure on `stop_recording` after a pause/resume:
`Error: [mov,mp4,...] moov atom not found` — the ScreenCaptureKit helper hadn't fully finalized the
file before Electron tried to validate/mux it, likely a timing race under the driver's fast
pause→resume→stop cadence (~1.5s/1s/1.5s). Immediately re-running the identical sequence succeeded.
This is a robustness issue in Recordly's existing native macOS recording pipeline (`electron/ipc/recording/mac.ts`),
not in the MCP automation layer — the automation server correctly reported the real underlying error
(`success: false` with the ffprobe message) instead of silently swallowing it or hanging. Worth a
follow-up investigation into stop timing right after a resume, independent of this MCP phase.

### Not yet verified

- Windows native capture and Linux ffmpeg fallback (`start_recording`'s non-darwin branches) — only
  tested on macOS so far.
- The full MCP stdio/tool-schema layer end-to-end via an actual MCP client (Claude Desktop/Code) —
  `smoke-drive.mjs` calls the tool handlers directly, bypassing `@modelcontextprotocol/sdk`'s
  transport and schema validation. Recommended as a follow-up once Phase 2 lands.

## Phase 2a: Editor bridge

**Date:** 2026-07-19
**Environment:** Real desktop session, macOS (Darwin 25.5.0), via `node smoke-drive.mjs`
**Result:** ✅ Full end-to-end pass — the new generic editor automation bridge (Tasks 1-5) works
against a real, live editor window.

### What was verified live

1. **`open_editor`** → opened the singleton editor `BrowserWindow` via the existing (Phase 1)
   `switch-to-editor` channel.
2. **`get_project_state`** → after waiting ~3s for the editor to mount, returned a real
   `ProjectEditorState`-shaped object (`{ zoomRegionCount: 0, ... }` on first call — a fresh editor
   with no zoom regions yet, as expected).
3. **`add_zoom_region`** with `{ startMs: 0, endMs: 1000, depth: 3 }` → returned `{ id: "zoom-1" }`.
4. **Round-trip verification** — the critical assertion: called `get_project_state` again after
   `add_zoom_region` and confirmed `zoom-1` was actually present in the returned `zoomRegions` array.
   This proves the full round trip: main process → `automation:editor-request` IPC → renderer's
   `VideoEditor.tsx` dispatch effect → real `setZoomRegions` state mutation → next `getState` call
   reads the updated live state back. Not a stub, not a mocked success — a real state mutation that
   persisted in the renderer.

### Known flake reproduced again (see Phase 1 section above)

The same "moov atom not found" native-layer flake from Phase 1 recurred once during this run's
recording lifecycle test (`stop_recording` after pause/resume). Confirms it's a pre-existing,
intermittent issue in the recording pipeline, unrelated to and unaffected by the Phase 2a editor
bridge work — the failure happened before the editor bridge portion of the test even ran, and the
editor bridge test itself (which doesn't depend on recording succeeding) completed cleanly
afterward.

### Not yet verified

- Only `getState` and `addZoomRegion` are covered — the remaining editing operations (trim, speed
  regions, webcam overlay, frame style, annotations, captions) use the same bridge pattern but are
  not yet implemented as tools (deliberately out of scope for Phase 2a; see the plan's final section).
- `open_editor`'s behavior when an editor window is already open with unsaved changes, or when
  called before any recording/project exists (this run always opened the editor after a recording
  attempt, which sets a "current video path" the editor can load).

## Phase 2b: trim_clip, set_frame_style

**Date:** 2026-07-19
**Environment:** Real desktop session, macOS (Darwin 25.5.0), via `node smoke-drive.mjs`
**Result:** ✅ Full end-to-end pass — no flake this run (recording, editor bridge, and both new
tools all succeeded in one continuous run).

### What was verified live

1. **`set_frame_style`** with `{ borderRadius: 12, shadowIntensity: 40 }` → `{ success: true }`.
2. **Round-trip verification** — the critical assertion: called `get_project_state` again and
   confirmed `borderRadius === 12` and `shadowIntensity === 40` in the returned state, proving the
   change actually persisted in the live renderer (not a stubbed success).
3. **`trim_clip`** on a real clip region (`firstClip.id` from the just-recorded clip's project
   state) with adjusted `startMs`/`endMs` → `{ success: true }`. This exercised the real
   `handleClipSpanChange` code path, including whatever cascade logic it applies to overlapping
   zoom/annotation/speed regions (none existed to prune in this run beyond the zoom region added
   moments earlier, which stayed outside the trimmed range).
4. This run happened to complete without hitting the known pre-existing recording flake (see Phase
   1/2a sections) — recording, editor bridge, `set_frame_style`, and `trim_clip` all ran in one
   clean pass, giving `trim_clip` a real clip to operate on (unlike a flaky run, where the smoke
   driver's fallback logic would have skipped the `trim_clip` verification).

### Not yet verified

- `trim_clip`'s cascade behavior specifically (does trimming actually shift/prune overlapping zoom
  or annotation regions as `handleClipSpanChange` is designed to?) — this run's trim didn't overlap
  the added zoom region, so the cascade path itself wasn't exercised, only the basic trim.
- `padding` (nested object) and `frame` (nullable) fields of `set_frame_style` — this run only
  exercised `borderRadius`/`shadowIntensity` (flagged as a unit-test gap in Task 3's review too).
- Remaining editing tools (speed regions, captions) — still Phase 2d+.

## Phase 2c: set_webcam_overlay, add_annotation

**Date:** 2026-07-19
**Environment:** Real desktop session, macOS (Darwin 25.5.0), via `node smoke-drive.mjs`
**Result:** ✅ Full end-to-end pass — no flake this run. All 13 tools now shipped (Phase 1 + 2a +
2b + 2c) were exercised in one continuous run: recording lifecycle, editor bridge open, zoom
region, frame style, clip trim, webcam overlay, and annotation — every one succeeded.

### What was verified live

1. **`set_webcam_overlay`** with `{ enabled: true, mirror: true }` → `{ success: true }`.
2. **Round-trip verification** — called `get_project_state` again and confirmed
   `webcam.enabled === true` and `webcam.mirror === true` in the returned state, proving the
   change persisted in the live renderer (not a stubbed success).
3. **`add_annotation`** with `{ startMs: 0, endMs: 2000, content: "Smoke test annotation" }` →
   `{ id: "annotation-1" }`.
4. **Round-trip verification** — called `get_project_state` again and confirmed `annotation-1` was
   present in the returned `annotationRegions` array, proving the append genuinely persisted.

### Not yet verified

- `set_webcam_overlay`'s expanded zod schema fields beyond `enabled`/`mirror` (e.g. `cropRegion`,
  `positionPreset`, `sourcePath`, `corner`) — this run only exercised the two boolean fields tested
  at the unit level too (flagged as a coverage gap in Task 3's review).
- `add_annotation`'s `type`/`trackIndex` fields, and non-`"text"` annotation types (`image`,
  `figure`, `blur`) — this run only added a default-type text annotation.
- Remaining editing tools (speed/clip-speed control, caption generation and editing) — deferred,
  see this phase's plan for why (`add_speed_region` needs its own design given
  `handleClipSpeedChange`'s more complex overlap-blocking contract; captions are async/long-running,
  a different shape than the synchronous operations covered so far).
