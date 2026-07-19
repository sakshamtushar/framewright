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

## Last run

**Date:** 2026-07-19  
**Environment:** Headless sandboxed agent environment (no display server, no screen-recording OS permissions)  
**Platform:** macOS (Darwin 25.5.0)  

### What was attempted

1. **MCP server build:** ✓ Success
   - `cd mcp-server && npm run build` completed without errors
   - `dist/index.js` (2.5 KB) built and verified to exist

2. **Recordly app startup (Attach-to-existing-instance path, Step 1):** ✗ Failed
   - Attempted: `RECORDLY_MCP_TOKEN=<random> npm run dev` in repo root
   - Result: Electron app build succeeded, but runtime failed with dependency error:
     ```
     Error: Could not resolve "bufferutil" imported by "ws". Is it installed?
     ```
   - This is a missing optional dependency issue in the Recordly build, not a display/environment issue
   - Status: Prerequisite failure — Recordly itself cannot start due to this unresolved dependency

3. **MCP server startup:** ✓ Process starts
   - `npm start` from `mcp-server/` begins successfully
   - Awaits Recordly app connection (expected behavior when no app is running)
   - Cannot proceed further without a working Recordly instance

### What could NOT be verified in this environment

- **Full attach-to-existing-instance flow (steps 2-5):** Cannot proceed due to Recordly app startup failure
- **Tool calls via MCP inspector or Claude Code connector:** Cannot execute without a running app
- **Screen recording functionality (`start_recording`, `pause_recording`, `stop_recording`):** Would require functional Recordly app and OS-level screen-recording permissions (TCC grant on macOS)
- **Spawn-a-fresh-instance path:** Blocked by same Recordly startup issue
- **HUD visibility during recording:** Would require interactive display and working Recordly UI

### Conclusion

**Full end-to-end smoke test cannot be completed in this sandboxed environment.** A human developer must run this procedure on a real desktop with:
- A working Recordly build (resolve the "bufferutil" dependency issue first)
- A display server or graphical environment
- Screen-recording OS permissions granted (macOS TCC approval)
- MCP inspector or Claude Code/Desktop with MCP support configured

The MCP server code itself appears ready (builds cleanly), but integration verification requires the full application stack to be functional and interactive.

**Addendum:** The `bufferutil` startup blocker described above was subsequently fixed later on this branch (`vite.config.ts` now externalizes `ws`/`bufferutil`/`utf-8-validate`). The full smoke test should be re-attempted now that this prerequisite failure is resolved.
