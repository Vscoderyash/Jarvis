JARVIS Browser Agent v3 (Chrome / Edge / Brave)
New: plans before acting, checks each step and changes tactics, natural male voice (pick "Natural" voices in Edge, or run JARVIS Desktop), size setting, links to JARVIS Desktop for the whole computer.

Install / update:
1. Unzip this folder (replace the old one).
2. chrome://extensions -> Developer mode -> "Load unpacked" (or press the reload arrow if already loaded).
3. Click the JARVIS toolbar icon. The extension is already connected to the JARVIS service; there is no site address to enter. If your deployment uses `JARVIS_ACCESS_TOKEN`, paste that server access token in the password field (never enter a provider API key), press Save token, then Test connection. It should report "Agent mode works."

Use: click Pip or press Alt+J. Type or press the mic and describe browser goals naturally; there is no fixed list of phrases you must memorize. The extension fetches the active NVIDIA model list and selects a fast model for browser actions. The popup's “Open Virtual Reality controls” button opens the persistent side panel. Open it once and grant camera access; then say “virtual reality” to start hand tracking and “stop virtual reality” to stop it. The panel must stay open because Chrome only allows extensions to open it after a user interaction. Camera input is opt-in, previewed, processed on-device, and stops when you press Stop or close the panel. If Chrome dismisses the camera prompt in the side panel, JARVIS opens the full-page camera setup automatically. Press “Enable camera” there, then return to the side panel and press Start. If Chrome has already blocked access, open Chrome camera settings from that page and allow JARVIS; check Windows camera privacy for desktop apps too. Gesture controls work on normal http/https pages in Chrome 116+: point to move, pinch/release to click, pinch/drag to scroll, or switch to Air keyboard to type into a focused regular text field. Air typing never presses Enter or submits a form.
Direct commands (instant, no AI): open sites, search, click (even "click the second video"), type, scroll, tabs (next, previous, switch to X, tab 3, new, duplicate, pin, mute, close, close others, reopen, new window), video (pause, play, mute, volume up/down/40, skip 30 seconds, rewind, faster, fullscreen, next video), zoom in/out, dark mode, read this page, find X on page, copy link, summarize this page, calculate 12 times 5, what time is it, help. Chain them: "go to youtube and search lo-fi then click the first video".
"go to youtube.com", "open youtube and search for lo-fi music", "search cats on youtube", "back", "reload",
"next tab", "previous tab", "switch to github tab", "new tab", "close this tab", "list tabs", "stop".
Anything else goes to the AI. Fast mode skips the separate planning call and long orb animations; Smart mode plans first. Point at a page link or button and say "click that", "open that", or "open that in a new tab".

Safety: never fills passwords or payment fields; asks before risky clicks or form submissions; stops at login pages for you to sign in. Press Escape or Stop to cancel a running AI request.
Mic: the browser asks for microphone permission once per site; allow it. Hands-free listening follows you to the active tab.
If an already-open tab has no orb after updating, the toolbar popup "Wake JARVIS" button injects it. Also check chrome://extensions -> Details -> Site access = On all sites.
Pages Chrome blocks (chrome://, Web Store, PDF viewer) cannot show the orb.

TRAINING (v3.1): JARVIS learns from you and keeps it between sessions (stored on your computer).
 Shortcuts:   "when I say good morning, open gmail then open youtube"      -> then just say "good morning"
 Voice fixes: "when you hear gmale I mean gmail"                          -> fixes words the microphone gets wrong
 Facts:       "remember that I like jazz" / "remember that my name is Yash" (never passwords or card numbers)
 Feedback:    after a task say "good job" (it repeats that approach) or "that was wrong" then tell it what to do instead
 Manage:      "what have you learned", "forget good morning", "forget everything"; popup: Export / Import / Reset training
 Brain:       popup > Brain: Fast or Smart (Smart uses the stronger model for every step)
