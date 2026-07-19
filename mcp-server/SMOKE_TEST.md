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
- `read_project`'s happy path (needs a real `.recordly` file, which requires Phase 2's editor/save tools).
- The full MCP stdio/tool-schema layer end-to-end via an actual MCP client (Claude Desktop/Code) —
  `smoke-drive.mjs` calls the tool handlers directly, bypassing `@modelcontextprotocol/sdk`'s
  transport and schema validation. Recommended as a follow-up once Phase 2 lands.
