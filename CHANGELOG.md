# Changelog

Notable product changes and releases in **CoWork**.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-08-15

### Added
- Stop individual in-turn subagents from the web and mobile thread UI, with a dedicated `cancelled` status.
- Live tool traces (`shell`, `write_file`, connectors, and other tools) in the chat timeline.
- Memory inspector/editor overlay for bot and user markdown notes.
- Mid-run follow-up messages: send stays available while a run is in progress; stop sits beside it.
- Mobile sign-up and a stop control on the thread composer.
- Shared `createRuntimeStack` used by the API and worker, plus a single `loadRootEnv` in `@cowork/core`.

### Fixed
- Failed and cancelled runs now clear streaming state instead of leaving a stuck Stop button.
- `threads.stop` emits `run.cancelled` instead of a mislabeled `run.completed`.
- Capability installs store a real SHA-256 digest of the source instead of a placeholder.
- Plugin catalog errors surface instead of silently returning an empty list.
- Duplicate in-process wakeup handler registration in the API.
- Preferences Smooth/Turbo pacing buttons now show a clear selected state, persist immediately, and update stream animation in the open chat.
- The Ollama connection error no longer appears on other Settings tabs (it stays on Local Ollama).
- The Completion Chime control is a real switch (correct knob travel) and plays a preview when turned on.
- The sidebar New bot control is labeled and visible.
- Sandbox-host buttons surface errors instead of failing silently.

### Changed
- Completion chime and stream pacing persist in localStorage and actually drive the UI.
- Memory search scores documents by term frequency instead of a constant `1`.
- Web icons use lucide-react with aligned navigation slots.

## [1.0.0] - 2026-08-14

### Added
- Complete open-source autonomous AI coworker platform created by **Suryanshu Nabheet**.
- Cross-platform clients: Modern React 19 web app, Electron desktop shell, and Expo mobile app.
- Autonomous bot runtime with dedicated threads, sandboxed desktop computers (X11/Fluxbox/noVNC/Chromium), persistent homes, and markdown memory.
- Subagent spawning (in-turn parallel helpers) and peer child-bot creation.
- Multiple sandbox providers: Docker (default local), E2B (cloud isolated), and "This Mac" desktop host.
- Device-code OAuth login for OpenAI Codex, GitHub Copilot, and xAI / SuperGrok via Pi runtime.
- Background routine scheduling in plain language with cron engines.
- Composio app connectors for Slack, Gmail, GitHub, Linear, Notion, and more.
- Dual-mode verification test suite and complete backup/restore automation scripts.
- MIT License release.
