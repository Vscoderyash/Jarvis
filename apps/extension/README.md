# JARVIS browser extension

The extension is built with WXT and TypeScript. WXT produces the Chromium MV3 extension in `.output/chrome-mv3/`.

```sh
npm ci
npm run dev --workspace @jarvis/extension
npm run build --workspace @jarvis/extension
```

For a local install, use Chrome/Edge/Brave's extension page with Developer mode enabled and choose **Load unpacked**, then select `.output/chrome-mv3/`.

On normal `http` and `https` pages, JARVIS can target semantic controls, custom controls, visible text, CSS selectors, and the element under the hand cursor. Browser protected pages such as `chrome://`, the Chrome Web Store, and built-in PDF viewer pages do not allow content scripts. Pinch clicks ask before high impact form actions; typing into password and payment fields remains disabled.

The companion website is responsive and can be added to a phone home screen. Chrome for Android does not install desktop Chrome extensions. On mobile, open the JARVIS website instead. Saved JARVIS memory stays in that browser's local storage; selected notes are sent as reference context when you chat with a provider.
