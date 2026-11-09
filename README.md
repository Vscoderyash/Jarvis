# JARVIS

JARVIS is Yash Raj's voice-enabled AI assistant. This repository keeps the existing Vercel chat site at its original root paths and adds the browser extension, Desktop app, shared schemas, and command grammar as workspaces.

## Repository layout

- `index.html` and `api/chat.js`: the existing Vercel chat site and streaming API.
- `apps/extension`: the Chromium extension, built with WXT and TypeScript.
- `apps/desktop`: the existing Python Desktop companion.
- `packages/grammar`: the instant command parser, spoken-word normalizer, fuzzy matcher, splitter, and golden tests.
- `packages/schema`: PageModel, Action, and bridge JSON Schemas with TypeScript contracts.

## Build and verify

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run check
```

`npm run check` runs type checks, grammar/schema tests, and a Chromium extension build. To load the extension, open `apps/extension/.output/chrome-mv3/` from `chrome://extensions` with Developer mode enabled. Run `npm run package:extension` to refresh the root `jarvis-extension.zip` download and `npm run package:desktop` to refresh `JARVIS-Desktop.zip`.

WXT is the extension build tool; Vitest runs the golden tests; Ajv validates the shared JSON Schemas. Their versions are pinned in the workspace lockfile.

## Website deployment

Import this repository into Vercel with Framework set to **Other**. Keep the repository root as the project root and set provider secrets in Vercel's server environment: `NVIDIA_API_KEY` is required for public NVIDIA chat; `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY` are optional. Visitors can use NVIDIA without a JARVIS token. Set `JARVIS_ACCESS_TOKEN` to protect Anthropic and OpenRouter, then share it only with users you trust; never put provider API keys in browser storage, Desktop config, or source files. The static site and `/api/chat` remain at their existing paths.

The responsive, installable website includes Chat/Code/Translate/Research modes, provider/model selection, Quick/Balanced/Deep response power, microphone dictation, language selection, searchable chat history, conversation export, and file attachments. Choose multiple files or select a folder, which JARVIS packages locally as a ZIP preserving relative paths and skips unsupported file types. Research mode uses Anthropic's live web search and returns source links; Anthropic charges separately for searches. Chat memory is saved locally in each browser, can be exported/imported, and relevant notes are sent to the selected AI provider as reference context. It does not train the provider's model or write to a Claude account. Chats can be pinned, renamed, duplicated, and backed up to or restored from JSON. Unsent drafts recover per chat, responses can be stopped, and keyboard shortcuts speed up common actions. Code mode works from supplied project files and can return complete changed files for the website's ZIP export. Translation mode honors the selected output language. Provider model lists are fetched by the server; keys stay server-side. It accepts common text/code formats, PDF, DOCX, PPTX, XLSX, ZIP, and PNG/JPG/WebP/GIF images (up to eight attachments and 3.3 MB combined). PDF, Word, PowerPoint, Excel, and ZIP contents are extracted by the API; images are sent to the selected provider. Vercel Functions cap request bodies at 4.5 MB, so the base64 request remains below that limit. File bytes stay in the current browser tab's memory and are not written into saved chat history or backups. Reattach files after reloading the page.

The website has no floating Pip overlay and works on phones as an installable home-screen app; desktop Chrome extensions do not install in Chrome for Android. The desktop extension is a separate product, with Pip as its draggable launcher: click it or press Alt+J to open voice, chat, and page controls. Common actions and camera clicks run locally; complex multi-step requests call the extension's API. JARVIS can click page controls and custom elements by spoken label, CSS selector, screen region, or hand cursor. The browser retains native restrictions on protected pages. The extension is preconnected to the deployed JARVIS API. Its hand-controls side panel offers opt-in webcam gestures for cursor movement, pinch-click, pinch-drag scrolling, and an air keyboard. It remembers camera choice and tracking preferences, lets you tune cursor response/range, pinch sensitivity, scroll speed, and detection confidence, and adds pause/resume and hand-centering controls. Say “virtual reality” to start, “pause virtual reality” to pause, “resume virtual reality” to continue, or “stop virtual reality” to stop. Camera frames stay on-device. The desktop app offers matching voice pause/resume commands, configurable adaptive smoothing and detection confidence, and a P hotkey in its preview window. If Chrome blocks the side-panel camera prompt, use its full-page camera permission setup. Hand controls require Chrome 116 or newer. In the extension popup, choose the language you speak for speech recognition, choose a reply/translation language, and select a system voice. Smart browser tasks use a dedicated planning request before page actions, and spoken commands wait for final recognition results before acting.

## Desktop app

Follow [the Desktop README](apps/desktop/README.txt) for Windows or macOS/Linux setup. The Desktop app keeps its existing Python version guards and speech-engine fallback rules.

## Current milestone

The current build keeps the root Vercel site compatible while adding project-file code workflows, larger bounded attachments, searchable/exportable chats, a Codex-inspired extension and desktop companion, and opt-in webcam hand controls. The original workspace architecture and milestone notes are in [docs/foundation.md](docs/foundation.md).
