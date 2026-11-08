"""JARVIS Desktop: hears you anywhere on your computer, thinks, acts, and answers in a natural male voice."""
import json, os, re, sys, threading, time, pathlib

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
def _check_deps():
    import importlib.util
    need = {"requests": "requests", "websockets": "websockets", "numpy": "numpy", "sounddevice": "sounddevice",
            "pyautogui": "pyautogui", "pyperclip": "pyperclip", "psutil": "psutil"}
    missing = [pkg for mod, pkg in need.items() if importlib.util.find_spec(mod) is None]
    if importlib.util.find_spec("faster_whisper") is None and importlib.util.find_spec("vosk") is None: missing.append("vosk")
    if missing:
        print("\nJARVIS is missing these packages: " + ", ".join(missing))
        print("Fix: double-click install_windows.bat (Windows) or run install_mac_linux.sh, then start JARVIS again.")
        print("(If you did run the installer, start JARVIS with start_jarvis.bat, not by running main.py directly.)")
        input("\nPress Enter to close...")
        raise SystemExit(1)


if __name__ == "__main__" and "--skip-check" not in sys.argv:
    _check_deps()

from commands import parse, split, norm            # noqa: E402
from tools import Tools                            # noqa: E402
from brain import Brain                            # noqa: E402
from mouth import Mouth                            # noqa: E402
from bridge import Bridge                          # noqa: E402
from memory import Memory                          # noqa: E402
from handcontrol import HandController              # noqa: E402

DEFAULTS = {"api_url": "https://jarvisv02.vercel.app/api/chat", "address": "sir", "voice": "en-GB-RyanNeural", "speak": True, "speech_rate": "+0%", "system_speech_rate": 165, "whisper_model": "small",
            "language": "auto", "wake_word": "jarvis", "wake_required": True, "active_seconds": 12, "mic_device": None, "bridge_port": 8765, "ui_scale": 1.0, "max_steps": 12, "brain": "fast",
            "vr_response": 0.4, "vr_deadzone": 0.003, "vr_pinch_press_ratio": 0.30, "vr_pinch_release_ratio": 0.48, "vr_stable_frames": 2, "vr_detection_confidence": 0.55, "vr_presence_confidence": 0.5, "vr_tracking_confidence": 0.5}
WAKE_WORDS = ["jarvis", "jarvas", "jarves", "jervis", "javis", "jar vis", "jar this", "jar is", "garvis", "gar vis", "charvis", "travis", "service", "java is", "jarvic"]


def make_wake(cfg):
    words = sorted(set(WAKE_WORDS + [cfg.get("wake_word", "jarvis").lower()] + [w.lower() for w in cfg.get("wake_aliases", [])]), key=len, reverse=True)
    return re.compile(r"^\W*(?:hey |ok |okay )?(?:" + "|".join(re.escape(w) for w in words) + r")\b[\s,.:!?-]*", re.I)
YES = re.compile(r"\b(yes|yeah|yep|sure|go ahead|do it|confirm|proceed|okay|ok)\b", re.I)
ACK = {"volume", "media", "scroll", "press_keys", "type_text", "window", "open_app", "open_url", "search_web", "lock_screen", "browser", "take_note", "set_timer", "open_folder"}


def load_cfg():
    cfg = dict(DEFAULTS)
    p = HERE / "config.json"
    if p.exists():
        try: cfg.update(json.loads(p.read_text(encoding="utf-8")))
        except ValueError: print("config.json is not valid JSON; using defaults")
    return cfg


class App:
    def __init__(self, use_ui=True):
        self.cfg = load_cfg()
        self.running, self.active_until = True, 0.0
        self.wake = make_wake(self.cfg)
        self.mouth = Mouth(self.cfg, self.log)
        self.bridge = Bridge(self.cfg["bridge_port"], on_say=self.mouth.say, log=self.log)
        self.tools = Tools(say=self.say, bridge=self.bridge, confirm=self.confirm, log=self.log)
        self.memory = Memory()
        self.brain = Brain(self.cfg, self.tools, self.say, self.ask_user, self.log, memory=self.memory)
        self.hand_control = HandController(
            on_state=lambda active, text: self.state("vr" if active else "idle", text),
            log=self.log,
            camera_index=self.cfg.get("camera_index", 0),
            settings=self.cfg,
        )
        self.awaiting_lesson, self.hints = False, 0
        self.ears = None
        self.ui = None
        if use_ui:
            try:
                from ui import UI
                self.ui = UI(self.cfg["ui_scale"], on_stop=self.stop_task, on_quit=self.quit)
            except Exception as e:
                self.log(f"(no window UI: {e})")

    # ---- plumbing ----
    def log(self, msg): print(msg, flush=True)
    def state(self, st, text=None):
        if self.ui: self.ui.set_state(st, text)
    def say(self, text):
        self.log("JARVIS: " + text); self.state("speaking", text); self.mouth.say(text)
    def stop_task(self):
        self.brain.cancelled = True; self.mouth.stop(); self.state("idle", "Stopped.")
    def quit(self):
        self.running = False
        self.hand_control.stop()
        if self.ui: self.ui.close()
    def wait_quiet(self):
        while self.mouth.busy(): time.sleep(0.05)
    def ask_user(self, q):
        self.say(q); self.wait_quiet(); self.state("listening", q)
        t = self.ears.hear(timeout=12); self.log("YOU: " + t); return t
    def confirm(self, q):
        self.say(q); self.wait_quiet(); self.state("listening", q)
        return bool(YES.search(self.ears.hear(timeout=8).lower()))

    # ---- understanding ----
    def handle(self, text):
        text = norm(self.memory.fix(text))
        self.log("YOU: " + text); self.state("busy", text)
        if self.awaiting_lesson:
            self.awaiting_lesson = False
            if not re.fullmatch(r"(cancel|never mind|stop)\W*", text, re.I):
                self.memory.add_lesson(text); self.say("Understood. I will do it that way next time.")
            return
        if not parse(text): text = self.memory.expand(text)
        for part in split(text):
            cmd = parse(part)
            if cmd: self.run_tool(cmd["tool"], cmd["args"], part)
            else:
                self.state("thinking", "Thinking: " + part)
                try: reply = self.brain.run(part)
                except Exception as e: reply = f"I could not reach my brain: {e}"
                self.say(reply)
                if self.hints < 3 and self.memory.last_goal == part: self.hints += 1; self.log("(say 'good job' or 'that was wrong' and I will learn from it)")
        self.state("idle", "Listening for “" + self.cfg["wake_word"].title() + "”")

    def run_tool(self, tool, args, original):
        if tool == "_stop": self.stop_task(); return
        if tool == "_vr_start":
            _started, message = self.hand_control.start(); self.say(message); return
        if tool == "_vr_stop":
            _stopped, message = self.hand_control.stop(); self.say(message); return
        if tool == "_vr_pause":
            _paused, message = self.hand_control.pause(); self.say(message); return
        if tool == "_vr_resume":
            _resumed, message = self.hand_control.resume(); self.say(message); return
        if tool.startswith("_") and tool not in ("_exit",): self.learn(tool, args); return
        if tool == "_exit": self.say(f"Goodbye, {self.cfg['address']}."); self.wait_quiet(); self.quit(); return
        if tool in ("open_url", "search_web") and self.bridge.connected and tool == "open_url":
            self.say("Right away."); self.bridge.send_command("go to " + args["url"]); return
        if tool == "search_web" and self.bridge.connected:
            self.say("Searching."); self.bridge.send_command("search " + args["query"]); return
        result = self.tools.execute(tool, args)
        self.log(f"{tool} -> {result}")
        if tool in ("system_info", "find_file", "screenshot"): self.say(result)
        elif tool == "browser": self.say("Done." if "sent" in result else result)
        elif tool in ACK: self.say(result if re.search(r"failed|could not|unknown|blocked|cancelled|not connected|no such", result, re.I) else "Done.")
        else: self.say(result)

    def learn(self, tool, a):
        m = self.memory
        if tool == "_teach":
            if m.teach(a["phrase"], a["action"]): self.say(f"Learned. When you say {a['phrase']}, I will {a['action']}.")
        elif tool == "_alias": m.alias(a["frm"], a["to"]); self.say(f"Got it. When I hear {a['frm']}, I will read it as {a['to']}.")
        elif tool == "_fact": self.say("I will remember that." if m.fact(a["text"]) else "I will not store passwords, PINs or card details.")
        elif tool == "_forget":
            if a["q"] == "*":
                if not self.confirm("Shall I erase everything I have learned?"): self.say("Cancelled."); return
                m.forget_all(); self.say("Memory cleared.")
            else:
                n = m.forget(a["q"]); self.say(f"Forgot {n} item{'s' if n != 1 else ''}." if n else f"I have nothing learned about {a['q']}.")
        elif tool == "_list":
            items = m.listing(); self.log("LEARNED:\n" + "\n".join(items)); self.say(f"I have learned {len(items)} things. They are listed in the window and in the log." if items else "Nothing yet.")
        elif tool == "_good": m.mark_good(); self.say("Glad that worked. I will repeat that approach.")
        elif tool == "_bad": self.awaiting_lesson = True; self.say("Sorry about that. What should I have done instead?")
        if self.ears: self.ears.vocab = m.vocab()

    # ---- main loop ----
    def listen_loop(self):
        from ears import Ears
        self.ears = Ears(self.cfg, self.mouth.busy, self.log)
        self.state("busy", "Loading…")
        self.ears.vocab = self.memory.vocab()
        try: self.ears.start()
        except Exception as e:
            self.log(f"Could not start the microphone or speech model: {e}"); self.state("idle", "Mic error"); return
        self.say(f"Good day, {self.cfg['address']}. JARVIS online.")
        self.wait_quiet()
        while self.running:
            self.state("listening" if time.time() < self.active_until else "idle", "Listening…" if time.time() < self.active_until else f"Say “{self.cfg['wake_word'].title()}”")
            text = self.ears.hear()
            if not text: continue
            self.log("HEARD: " + text)
            self.state("listening", "Heard: " + text[:120])
            if self.cfg["wake_required"]:
                m = self.wake.match(text)
                parsed = parse(text)
                direct_vr = bool(parsed and parsed.get("tool") in ("_vr_start", "_vr_stop", "_vr_pause", "_vr_resume"))
                if m:
                    rest = text[m.end():].strip()
                    self.active_until = time.time() + self.cfg["active_seconds"]
                    if not rest: self.say(f"Yes, {self.cfg['address']}?"); continue
                    text = rest
                elif time.time() > self.active_until and not direct_vr: continue
            self.handle(text)
            self.active_until = time.time() + self.cfg["active_seconds"]

    def run(self):
        self.bridge.start()
        t = threading.Thread(target=self.listen_loop, daemon=True); t.start()
        if self.ui: self.ui.run()
        else:
            while self.running and t.is_alive(): time.sleep(0.3)


if __name__ == "__main__":
    App(use_ui="--no-ui" not in sys.argv).run()
