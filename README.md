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

Import this repository into Vercel with Framework set to **Other**. Keep the repository root as the project root and set provider secrets in Vercel's server environment: `NVIDIA_API_KEY` is required for NVIDIA; `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY` are optional. Set `JARVIS_ACCESS_TOKEN` to gate all API providers (it is also required before enabling OpenRouter or Anthropic), then enter that access token with the Providers button in the site or the extension popup. If the token is set, the Desktop app also needs the same value in the computer's `JARVIS_ACCESS_TOKEN` environment variable; see the Desktop README. Never put provider API keys in browser storage, Desktop config, or source files. The static site and `/api/chat` remain at their existing paths.

The Codex-inspired composer includes Chat/Code/Translate modes, provider/model selection, Quick/Balanced/Deep response power, microphone dictation, input and reply language selection, searchable chat history, conversation export, and drag-and-drop attachments. Code mode works from supplied project files and can return complete changed files for the website's ZIP export. Translation mode honors the selected output language. Provider model lists are fetched by the server; keys stay server-side. It accepts common text/code formats, PDF, DOCX, PPTX, XLSX, ZIP, and PNG/JPG/WebP/GIF images (up to eight files and 3.15 MB combined). PDF, Word, PowerPoint, and Excel text is extracted by the API; images are sent to the selected provider. Vercel Functions cap request bodies at 4.5 MB, so the base64 request remains below that limit. File bytes stay in the current browser tab's memory and are not written into saved chat history. Reattach files after reloading the page.

Pip is the blue pixel companion in the website and the browser extension. In the extension, Pip is the draggable JARVIS launcher: click it or press Alt+J to open the Codex-inspired voice, chat, and page controls. Pip stays where you place it and gently floats, blinks, waves when opened, and types while JARVIS works; browser actions do not send Pip flying around the page. The extension is preconnected to the deployed JARVIS API, so its popup does not ask you for a site address. The extension's hand-controls side panel offers opt-in webcam gestures for cursor movement, pinch-click, pinch-drag scrolling, and an air keyboard. Keep that panel open, grant camera permission once, then say “virtual reality” to start or “stop virtual reality” to stop. Camera frames stay on-device. The desktop app also supports the same voice toggle for a system-wide pointer, with an on-device preview window. If Chrome blocks the side-panel camera prompt, use its full-page camera permission setup. Hand controls require Chrome 116 or newer. In the extension popup, choose the language you speak for speech recognition, choose a reply/translation language, and select a system voice. Smart browser tasks use a dedicated planning request before page actions, and spoken commands wait for final recognition results before acting.

## Desktop app

Follow [the Desktop README](apps/desktop/README.txt) for Windows or macOS/Linux setup. The Desktop app keeps its existing Python version guards and speech-engine fallback rules.

## Current milestone

The current build keeps the root Vercel site compatible while adding project-file code workflows, larger bounded attachments, searchable/exportable chats, a Codex-inspired extension and desktop companion, and opt-in webcam hand controls. The original workspace architecture and milestone notes are in [docs/foundation.md](docs/foundation.md).
