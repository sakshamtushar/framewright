# Framewright MCP Server

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server that lets an AI harness (Claude, or any MCP-compatible client) control Framewright (a Recordly-derived screen recorder/editor) — screen recording, editor state, and (eventually) export — end to end.

This package is the **client half** of a two-part system:

1. **Automation Server** (`electron/automation/`, lives in the main Framewright repo) — a localhost-only, token-authed WebSocket JSON-RPC server that runs *inside* Framewright's Electron main process. It's opt-in only: a normal manual `npm run dev`/packaged launch never starts it. It only activates when `FRAMEWRIGHT_MCP_TOKEN` is set.
2. **This package** — a standalone MCP stdio server. It either attaches to an already-running Framewright instance (via a lockfile) or spawns one itself (`npm run dev` in the Framewright repo, with a generated token), then translates MCP tool calls into JSON-RPC calls against the automation server.

See the root repo's `docs/superpowers/plans/2026-07-19-recordly-mcp-phase*.md` for the full design rationale and implementation history, phase by phase.

## Quick start

```bash
npm install
npm run build
npm start   # runs dist/index.js as an MCP stdio server
```

Point an MCP client (Claude Code, Claude Desktop, or the [MCP inspector](https://github.com/modelcontextprotocol/inspector)) at `node <path-to-this-repo>/mcp-server/dist/index.js`. On first tool call it will either attach to a Framewright instance you already have running, or launch one itself.

## Live verification

`npm run smoke` builds and runs `smoke-drive.mjs` — a script that exercises the *real* production code path (`getOrCreateConnection` + `buildToolHandlers`, the same functions the MCP entrypoint uses) against a live Framewright instance on your actual desktop. It performs a real few-second screen recording, opens the real editor window, and mutates real project state, asserting each change round-trips correctly. This is the primary verification for this integration — see `SMOKE_TEST.md` for every phase's real run results.

```bash
npm run smoke
```

Requires a real desktop session (not a headless CI environment) since screen recording and the editor UI need an actual display.

## Tool catalog

| Tool | What it does |
|---|---|
| `get_app_status` | Whether Framewright is currently recording, and the platform |
| `list_capture_sources` | Available screen/window capture sources |
| `start_recording` | Start a screen recording |
| `pause_recording` / `resume_recording` | Pause/resume the active recording |
| `stop_recording` | Stop and finalize the recording into an MP4 |
| `get_recording_status` | Current recording status |
| `list_projects` | List saved project files |
| `read_project` | Read a project file's contents |
| `open_editor` | Open (or focus) Framewright's editor window |
| `get_project_state` | Get the currently open editor's full project state |
| `add_zoom_region` | Add a zoom-in region to the timeline |
| `trim_clip` | Resize/move a clip's boundaries |
| `set_frame_style` | Set wallpaper, frame preset, padding, border radius, shadow, background blur |
| `set_webcam_overlay` | Set webcam overlay position, size, crop, mirror, etc. |
| `add_annotation` | Add a text annotation to the timeline |
| `generate_captions` | Transcribe a video's audio into caption cues (local Whisper model) and apply them to the open editor |
| `edit_caption` | Edit an existing caption cue: set text, retime, split, merge, or delete |

All editor tools (`open_editor` onward) operate on **the currently open editor window** — there's no "open project X into the editor" tool yet (see Known Limitations).

## Architecture

```
MCP client (Claude, etc.)
   │  stdio, MCP protocol
   ▼
mcp-server/src/index.ts  (this package's entrypoint)
   │  tool call → RpcClient.call(method, params)
   ▼
mcp-server/src/connection.ts  (attach-or-launch)
   │  WebSocket JSON-RPC, localhost only, token-authed
   ▼
electron/automation/server.ts  (inside Framewright's Electron main process)
   │
   ├─ recording/source/project tools → electron/ipc/registry.ts
   │    (invokes existing IPC handlers directly, no real IPC event needed)
   │
   └─ editor tools (get/add/trim/set*) → electron/automation/editorBridge.ts
        (round-trips through IPC to the renderer's VideoEditor.tsx, since
        editor state lives only in renderer React state, not in main)
```

Two different bridging mechanisms exist because Framewright's own architecture has two different places state can live:
- Recording/project-file/caption-generation operations are handled entirely in the **main process** (native capture helpers, Whisper, filesystem), so the automation server can call the same internal handler functions directly.
- Editor operations (zoom regions, trim, frame style, webcam, annotations, caption editing) mutate state that only exists in the **renderer's React component tree** (`VideoEditor.tsx` — no store, ~90 `useState` hooks). There was no existing way for main to read or mutate that state before this project; `editorBridge.ts` + a dispatch effect in `VideoEditor.tsx` is the mechanism this project built for it.

`generate_captions` composes both: it calls `captions.generate` (registry-routed, wrapped as `{ arg: ... }`) to run the transcription in the main process, then `editor.setCaptions` (editor-bridge-routed, flat params) to apply the resulting cues to the open editor. See `mcp-server/src/tools.ts` and `electron/automation/server.ts`'s `callChannel` comment for the two calling conventions.

## Security model

- The automation server binds `127.0.0.1` only — never reachable over the network.
- A random port and random token are generated per launch; the token is required on every WebSocket connection.
- The automation server **never starts** unless `FRAMEWRIGHT_MCP_TOKEN` is explicitly set — a normal manual Framewright launch is completely unaffected.
- This package and Framewright must run on the same machine. There is no remote-control mode.

## Known limitations

- **No export tools yet.** Export's IPC handlers (`electron/ipc/register/export.ts`) use `event.sender` for progress streaming, which the automation server's simple registry-dispatch trick can't handle — needs its own design (likely the same editor-bridge pattern, since export also runs client-side).
- **No `download_whisper_model`/`delete_whisper_model` tools.** Those handlers use `event.sender` for download-progress streaming, same shape problem as export.
- **No standalone speed-region tool.** Speed is derived from clip data (`ClipRegion.speed`) and set via `handleClipSpeedChange`, which has a more complex overlap-blocking contract than a simple add/set — needs its own design.
- **Can't open a specific project by path into the editor.** There's no "editor ready with project X loaded" signal in Framewright yet; tools assume you're operating on whatever's already open.
- **macOS-only live verification so far.** Windows native capture and Linux ffmpeg fallback paths are implemented but not yet live-tested.
- **A pre-existing, intermittent native recording flake** ("moov atom not found" on `stop_recording` right after a pause→resume) has been observed a few times during live testing — it's in Framewright's existing ScreenCaptureKit pipeline, unrelated to this MCP work. See `SMOKE_TEST.md` for details.

## License

This package is part of the Framewright repository (a Recordly-derived fork) and inherits its **AGPL-3.0** license (see the root `LICENSE.md`). If you fork or redistribute this work, the same reciprocal-source and attribution terms apply. Framewright is a separately-named project per the AGPL's no-endorsement/no-branding terms and is not affiliated with or endorsed by the original Recordly project.


