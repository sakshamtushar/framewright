Language: EN | [简中](README.zh-CN.md)

<p align="center">
  <img width="220" alt="Framewright Logo" src="branding/framewright/logo-mark-draft-v1.png" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-111827?style=for-the-badge" alt="macOS Windows Linux" />
  <img src="https://img.shields.io/badge/open%20source-AGPL3.0-e5af89?style=for-the-badge" alt="AGPL 3.0 license" />
</p>

### The screen recorder an AI agent can actually drive
[Framewright](https://www.framewright.dev) is an **open-source, AI-native screen recorder and editor**. Starting and stopping a recording, adding zooms, trimming clips, styling the frame, overlaying a webcam, generating and editing captions: each of these is exposed as an [MCP](https://modelcontextprotocol.io) tool, so an AI harness like Claude can drive the whole pipeline end to end. Point it at Framewright and ask for a polished demo video, and it can record, edit, and produce one without you touching the timeline.
**Accepting PRs.**

<img width="1280" height="720" alt="MP4 to GIF export (4)" src="https://github.com/user-attachments/assets/e6d68606-5fc0-4f70-99cd-7521982dc13b" />

## Why Framewright?

Plenty of screen recorders can add a zoom or a webcam bubble. In Framewright, none of that only lives behind a mouse click. It's reachable through a real, local MCP server:

- **A full MCP control surface, not a demo integration.** 18 tools today: recording lifecycle, zoom/trim/frame-style/webcam/annotation editing, caption generation and editing. Export control is next on the roadmap. See [`mcp-server/README.md`](mcp-server/README.md) for the full catalog.
- **Local, opt-in, and auditable.** The automation server only starts when you explicitly set a token env var. It binds to `127.0.0.1` only, and every tool call goes through the same code path the UI itself uses, so there's no separate "AI mode" logic to trust.
- **Still a complete editor by hand.** Everything the MCP layer can do, you can also do yourself: auto-zoom suggestions, cursor polish, styled frames, timeline editing, webcam overlays, MP4/GIF export.

Jump to [AI / MCP Control](#ai--mcp-control) for how to connect an agent, or keep reading for the full feature set.

---

## What is Framewright?

Framewright is a desktop app for recording and editing screen captures. The whole workflow (capture, zoom, cursor polish, frame styling, captions, export) can be driven either by hand in the editor or programmatically by an AI agent through MCP. Neither path needs a motion designer or manual timeline work.

Framewright runs on:

- **macOS** 14.0+
- **Windows** 10 Build 19041+
- **Linux** on modern distros

Platform notes:

- **macOS** uses native ScreenCaptureKit-based capture helpers.
- **Windows** uses a native Windows Graphics Capture (WGC) helper on supported builds, with native WASAPI audio support.
- **Linux** records through Electron capture APIs. Cursor hiding is not supported on Linux today.

---

# AI / MCP Control

This is why Framewright is its own project instead of just Recordly under a new name.

Framewright ships a built-in [MCP](https://modelcontextprotocol.io) server (`mcp-server/`) that lets an AI harness, Claude or any MCP-compatible client, drive the app the same way a person would: pick a source, start recording, pause, resume, stop, jump into the editor, add zoom regions, trim clips, style the frame, position a webcam overlay, drop in annotations, generate captions from the recording's audio, and edit them. 18 tools today, with export control next on the roadmap.

```
"Record my screen for the next demo, then add a zoom on the button click, add a
subtle webcam bubble in the corner, generate captions, and export it."
```

That's the workflow this is built for: an agent running the recording-to-polished-video pipeline, not just triggering a single "record" button.

**How it works, briefly:**

A localhost-only WebSocket JSON-RPC server runs inside Framewright's Electron main process. It only starts when you explicitly set `FRAMEWRIGHT_MCP_TOKEN`, so a normal manual launch is unaffected. A separate `mcp-server/` Node package is the actual MCP stdio server your AI client talks to; it either attaches to a Framewright instance you already have running or launches one itself. Every MCP tool call goes through the same internal code paths the UI uses, so there's no parallel "AI mode" implementation to trust on its own. The server binds to `127.0.0.1` only, with a random port and token per launch, and is never reachable over the network.

See [`mcp-server/README.md`](mcp-server/README.md) for setup steps (Claude Code, Claude Desktop, Codex CLI, or any other MCP client), the full tool catalog, architecture, and security model, and the [Roadmap](#roadmap) below for what's built versus still in progress. Export control is the biggest current gap.

---

# Core Features

## Auto-zooms, cursor polish, and styled frames
Framewright can automatically emphasize activity with zoom suggestions, smooth cursor movement, add motion effects, and place the final composition inside a styled frame with wallpapers, colors, gradients, blur, padding, and shadows.

<p>
  <img src="./docs/media/feature1.gif" width="450" alt="Framewright cursor and zoom demo video">
</p>

## Dynamic webcam bubble overlays
Add webcam footage as an overlay bubble, position it with presets or custom coordinates, mirror it, control shadow and roundness, and optionally make it react to zoom so it stays visually balanced during motion.

<p>
  <img src="./docs/media/feature2.gif" width="450" alt="Framewright webcam overlay demo video">
</p>

## Timeline editing built for demos
Use drag-and-drop timeline tools for zooms, trims, speed regions, annotations, extra audio regions, and crop-aware edits. Save and reopen work as `.framewright` project files (`.recordly` files from the original project still open too).

<p>
  <img width="450" alt="timeline editor" src="https://github.com/user-attachments/assets/3692bd8f-7b8d-4a93-b696-d17c828487ea" />
</p>

## Extensions & Marketplace

Framewright has a community-driven extension system. Anyone can build and publish extensions that add new capabilities: cursor click sounds, device frames, browser mockups, wallpapers, render hooks, settings panels, and more.

Browse and install community extensions from the [Framewright Marketplace](https://marketplace.framewright.dev/extensions).

---

## All Features

### Recording

- Record an entire display or a single app window
- Jump directly from recording into the editor
- Capture microphone audio and system audio
- Use native capture backends where supported
- Resume editing from saved `.framewright` project files
- Open existing recordings or existing project files from the app

### Timeline and Editing

- Drag-and-drop timeline editing
- Trim unwanted sections
- Add manual zoom regions
- Use automatic zoom suggestions based on cursor activity
- Add speed-up and slow-down regions
- Add text, image, and figure annotations
- Add extra audio regions on the timeline
- Crop the recorded frame
- Save and reopen projects with editor state preserved

### Cursor Controls

- Show or hide the rendered cursor overlay
- Cursor size adjustment
- Cursor smoothing
- Cursor motion blur
- Cursor click bounce
- Cursor sway
- Cursor loop mode for cleaner looping exports
- macOS-style cursor assets for the rendered overlay

### Webcam Overlay

- Enable or disable webcam overlay footage
- Upload, replace, or remove webcam footage
- Mirror webcam footage
- Size control
- Preset positions and custom X/Y placement
- Margin control
- Roundness control
- Shadow control
- Optional zoom-reactive webcam scaling

### Frame Styling and Backgrounds

- Built-in wallpapers
- Runtime wallpaper discovery from the wallpapers directory
- Custom uploaded backgrounds
- Solid color backgrounds
- Gradient backgrounds
- Frame padding
- Rounded corners
- Background blur
- Drop shadows
- Aspect ratio presets for the final frame

### Export

- MP4 export
- GIF export
- Export quality selection
- GIF frame-rate selection
- GIF loop toggle
- GIF size presets
- Aspect ratio and output dimension controls
- Reveal exported files in the system file manager

### Workflow and Usability

- Customizable keyboard shortcuts
- In-app shortcut reference
- Feedback and issue links from the editor
- Project persistence for editor preferences
- Faster preview recovery after export
---

# Screenshots

> [!NOTE]
> The screenshots below are inherited from the original Recordly project and still show its blue theme. Updated Framewright screenshots are pending.

<p align="center">
  <img src="https://i.postimg.cc/8CrQtGJf/Screenshot-2026-04-30-at-5-11-52-pm.png" width="700" alt="Framewright recording interface screenshot">
</p>

<p align="center">
  <img src="https://i.postimg.cc/pLSMfrTM/Screenshot-2026-04-30-at-5-11-45-pm.png" width="700" alt="Framewright editor screenshot">
</p>

<p align="center">
  <img src="https://i.postimg.cc/Zn9VY6bg/Screenshot-2026-03-18-at-6-32-59-pm.png" width="700" alt="Framewright timeline screenshot">
</p>

---

# Installation

## Download a build

Prebuilt releases are available at:

https://github.com/sakshamtushar/framewright/releases

---

## Arch Linux / Manjaro

Arch packaging (AUR) hasn't been set up for Framewright yet. The original Recordly project's AUR package (`recordly-bin`) is maintained in a separate repo and does not track this fork. Use [Build from source](#build-from-source) below in the meantime, or open an issue if you'd like to help set up a Framewright AUR package.

---

## Build from source

### Prerequisites

**macOS:** Xcode Command Line Tools (`xcode-select --install`).

**Linux (Ubuntu/Debian):**

```bash
sudo apt install build-essential cmake libx11-dev libxtst-dev libxrandr-dev libxt-dev
```

**Windows:** Visual Studio 2022 (or Build Tools) with the C++ workload and CMake.

### Steps

```bash
git clone https://github.com/sakshamtushar/framewright.git
cd framewright
npm install
npm run dev
```

For packaged builds:

```bash
npm run build
```

Target-specific build commands are also available:

- `npm run build:mac`
- `npm run build:win`
- `npm run build:linux`

---

## macOS: "App cannot be opened"

Locally built apps may be quarantined by macOS.

Remove the quarantine flag with:

```bash
xattr -rd com.apple.quarantine /Applications/Framewright.app
```

---

# System Requirements

| Platform | Minimum version | Notes |
|---|---|---|
| **macOS** | macOS 14.0 (Sonoma) | Required for ScreenCaptureKit audio and microphone capture. |
| **Windows** | Windows 10 20H1 (Build 19041, May 2020) | Required for the native Windows Graphics Capture (WGC) helper and best cursor-hiding behavior. |
| **Linux** | Any modern distro | Recording works through Electron capture. System audio generally requires PipeWire. |

> [!IMPORTANT]
> On Windows builds older than 19041, recording can still work through fallback capture, but the real OS cursor may remain visible in recordings.

---

# Usage

## Record

1. Launch Framewright.
2. Select a screen or window.
3. Choose microphone and system-audio options.
4. Start recording.
5. Stop recording to open the editor.

## Edit

Inside the editor you can:

- add trims, zooms, speed regions, and annotations
- tune cursor behavior and preview volume
- style the frame with wallpapers, colors, gradients, blur, padding, and corners
- add or adjust webcam overlay footage
- add extra audio regions
- crop the frame and choose an aspect ratio

Save your work anytime as a `.framewright` project.

## Export

Export options include:

- **MP4** for standard video output
- **GIF** for lightweight sharing and loops

You can adjust format-specific settings such as quality, GIF frame rate, GIF looping, and output size before export.

---

# Limitations

### Cursor capture

Framewright renders a polished cursor overlay on top of the recording. Platform cursor-hiding behavior still depends on OS support.

**macOS**
- ScreenCaptureKit can exclude the real cursor cleanly.

**Windows**
- Best results require Windows 10 Build 19041+ and the native capture helper.
- Older builds fall back to Electron capture, so the real cursor may remain visible.

**Linux**
- Electron desktop capture does not currently support cursor hiding.
- If you also enable the rendered cursor overlay, exports may show both the real cursor and the styled cursor.

### System audio

System audio support varies by platform.

**Windows**
- Native WASAPI support

**Linux**
- Usually requires PipeWire

**macOS**
- Requires macOS 14.0+ and the ScreenCaptureKit-based workflow

---

# How It Works

Framewright combines a platform-specific capture layer with a renderer-driven editor and export pipeline.

**Capture**
- Electron coordinates recording and application flow
- macOS uses native ScreenCaptureKit helpers
- Windows uses a native Windows Graphics Capture (WGC) helper and native audio helpers where available

**Editing**
- Timeline regions define zooms, trims, speed changes, audio overlays, and annotations
- Cursor and webcam styling are applied in the editor state

**Rendering**
- Scene composition is handled by **PixiJS**

**Export**
- The same scene logic used in preview is rendered into exported MP4 or GIF output

**Projects**
- `.framewright` files store the source media path plus editor state so work can be reopened later. Legacy `.recordly` files remain fully readable.

---

# Roadmap

**Shipped**

- Full app rebrand from Recordly to Framewright (identity, theme, docs, icons, extension system, settings migration)
- MCP automation layer: 18 tools covering the recording lifecycle, editor bridge (zoom, trim, frame style, webcam overlay, annotations), and caption generation/editing
- Live-verified on macOS, with a full test suite (1000+ tests) and CI (typecheck, lint, tests) green on every push

**Not built yet**

- **Export control via MCP.** There's no `export_video` tool. Export's IPC handlers stream progress via `event.sender`, which the automation server's current registry-dispatch approach can't handle. This needs its own design, likely the editor-bridge pattern, since export also runs client-side. It's the largest remaining gap if the goal is control over every feature via MCP.
- **A standalone speed/clip-speed MCP tool.** Speed is derived from clip data with a more complex overlap-blocking contract than a simple add/set call, so this needs its own design.
- **`download_whisper_model`/`delete_whisper_model` MCP tools.** Same `event.sender` progress-streaming shape problem as export.

**Known gaps and things that need verification**

- **Windows and Linux are unverified for the whole MCP layer.** Only macOS has ever been live-tested, despite the code branching on all three platforms.
- **`generate_captions`'s real Whisper transcription path has never been live-tested end to end**, and the MCP client's flat 15-second RPC timeout has not been confirmed safe for a real, potentially multi-minute, transcription.
- **The real MCP protocol transport has never been exercised by an actual client** such as Claude Desktop or Claude Code. All verification so far calls the underlying connection/tool-handler code directly, bypassing the stdio transport and zod schema validation a real client would go through.
- No WebSocket close-handler on the MCP client. If Framewright quits mid-call, the caller waits out the full timeout instead of failing fast.
- No tagged release has been cut yet, so the Homebrew/WinGet release-automation workflows are fixed but untested end to end.

See [`mcp-server/README.md`](mcp-server/README.md#known-limitations) for the MCP-specific limitations in more detail.

---

# Contribution

Contributions are welcome.

Areas where help is especially useful:

- Linux capture and cursor behavior
- Export performance and stability
- UI and UX refinement
- Localisation work
- Additional editor tools and workflow polish

Please keep pull requests focused, test recording/edit/export flows, and avoid unrelated refactors.

See `CONTRIBUTING.md` for guidelines.

---

# Community

Bug reports and feature requests:

https://github.com/sakshamtushar/framewright/issues

Pull requests are welcome.

---

# License

Framewright is licensed under the **AGPL 3.0**. See [LICENSE.md](LICENSE.md) and [NOTICE.md](NOTICE.md).

---

# Credits

## Acknowledgements

Framewright is a fork of [Recordly](https://github.com/webadderallorg/Recordly) (by [@webadderall](https://x.com/webadderall)), rebranded and maintained independently under the AGPLv3's reciprocal-licensing terms. Recordly itself originally started as a fork of [OpenScreen](https://github.com/siddharthvaddem/openscreen); many of its core features, such as zoom animations, trace back to that lineage. See [NOTICE.md](NOTICE.md) for the full chain.

Recordly's original supporters and community are acknowledged in [Recordly's own README](https://github.com/webadderallorg/Recordly#hall-of-supporters). Framewright is a separate, independently maintained fork and does not claim their support for itself.

---
