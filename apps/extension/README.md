# JARVIS browser extension

The extension is built with WXT and TypeScript. WXT produces the Chromium MV3 extension in `.output/chrome-mv3/`.

```sh
npm ci
npm run dev --workspace @jarvis/extension
npm run build --workspace @jarvis/extension
```

For a local install, use Chrome/Edge/Brave's extension page with Developer mode enabled and choose **Load unpacked**, then select `.output/chrome-mv3/`.

The extension runs independently from the website UI and calls its own JARVIS API for complex agent tasks. Common actions such as opening pages, switching tabs, clicking labels or screen regions, typing into regular fields, and camera cursor clicks are handled locally for faster response. It can target semantic controls, custom controls, visible text, CSS selectors, and the element under the hand cursor. Click **Open site access settings** and set Chrome's **Site access** to **On all sites** to keep JARVIS available across sites. **Wake JARVIS** grants temporary access to the current site when Chrome is set to “On click”. Refresh tabs after installing or updating the extension. Browser protected pages such as `chrome://`, the Chrome Web Store, and built-in PDF viewer pages do not allow content scripts. JARVIS still asks before high impact form actions; typing into password and payment fields remains disabled.

Hand control is available in the side panel on the active website tab: thumb-index pinch clicks, thumb-middle pinch sends a page context click, thumb-ring pinch double-clicks, a V sign scrolls, and Air keyboard types numbers, letters, punctuation, space, and backspace into a focused regular text field. Air typing never presses Enter. JARVIS Desktop uses OS-level mouse and keyboard input for the active application across the laptop, not only browser pages.

The companion website is responsive and can be added to a phone home screen. Chrome for Android does not install desktop Chrome extensions. On mobile, open the JARVIS website instead. Saved JARVIS memory stays in that browser's local storage; selected notes are sent as reference context when you chat with a provider.
