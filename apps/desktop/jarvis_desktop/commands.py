"""Instant (no-AI) command understanding. Returns {"tool":..., "args":{...}} or None (=> ask the planner)."""
import re

SITES = {
    "youtube": "https://www.youtube.com", "google": "https://www.google.com", "gmail": "https://mail.google.com",
    "github": "https://github.com", "facebook": "https://www.facebook.com", "instagram": "https://www.instagram.com",
    "twitter": "https://x.com", "x": "https://x.com", "whatsapp": "https://web.whatsapp.com", "amazon": "https://www.amazon.in",
    "netflix": "https://www.netflix.com", "linkedin": "https://www.linkedin.com", "reddit": "https://www.reddit.com",
    "wikipedia": "https://www.wikipedia.org", "chatgpt": "https://chatgpt.com", "maps": "https://maps.google.com",
}
HEARD = [(r"\byou tube\b", "youtube"), (r"\bface book\b", "facebook"), (r"\bg ?mail\b", "gmail"), (r"\bwhat'?s ?app\b", "whatsapp"),
         (r"\b(next|new|this|previous|close) tap\b", r"\1 tab"), (r"\bfull screen\b", "fullscreen")]
KEYS = {"enter": "enter", "return": "enter", "escape": "esc", "esc": "esc", "tab": "tab", "space": "space", "backspace": "backspace",
        "delete": "delete", "up": "up", "down": "down", "left": "left", "right": "right", "control": "ctrl", "ctrl": "ctrl",
        "alt": "alt", "shift": "shift", "windows": "win", "win": "win", "home": "home", "end": "end", "page up": "pageup", "page down": "pagedown"}
BROWSER_HINT = re.compile(r"^(click|tap|select the|choose|play the (first|second|third|fourth|fifth|last)|open the (first|second|third|last))\b|\btab\b|\bon (this )?page\b|"
                          r"\b(fullscreen|skip|rewind|zoom|dark mode|summari[sz]e|read this)\b|\bthis (page|video|website|site)\b|\bscroll to\b|^find .+ on ", re.I)
DURATION = re.compile(r"(\d+(?:\.\d+)?)\s*(second|sec|minute|min|hour|hr)s?", re.I)


def norm(t: str) -> str:
    t = t.strip().rstrip(".!?").strip()
    for pat, rep in HEARD:
        t = re.sub(pat, rep, t, flags=re.I)
    return t


def seconds(text: str):
    total = 0.0
    for n, unit in DURATION.findall(text):
        u = unit.lower()
        total += float(n) * (3600 if u.startswith("h") else 60 if u.startswith("m") else 1)
    return int(total) or None


def keys_from(text: str):
    t = text.lower().replace(" plus ", " ").replace("+", " ")
    for k in ("page up", "page down"):
        t = t.replace(k, k.replace(" ", "_"))
    out = []
    for w in t.split():
        w = w.replace("_", " ")
        out.append(KEYS.get(w, w if len(w) == 1 or re.fullmatch(r"f\d{1,2}", w) else None))
    return out if out and None not in out else None


def parse(text: str):
    s = norm(text)
    low = s.lower()
    m = None
    if re.fullmatch(r"(?:pause|suspend|freeze) (?:the )?(?:virtual reality|vr)(?: mode)?", low): return {"tool": "_vr_pause", "args": {}}
    if re.fullmatch(r"(?:resume|continue) (?:the )?(?:virtual reality|vr)(?: mode)?", low): return {"tool": "_vr_resume", "args": {}}
    if re.fullmatch(r"(?:virtual reality|vr(?: mode)?|(?:start|enable|activate|turn on) (?:virtual reality|vr)(?: mode)?)", low): return {"tool": "_vr_start", "args": {}}
    if re.fullmatch(r"(?:stop|disable|turn off|close) (?:virtual reality|vr)(?: mode)?", low): return {"tool": "_vr_stop", "args": {}}
    if re.fullmatch(r"(stop|cancel|quiet|be quiet|shut up|never mind|enough|abort)", low): return {"tool": "_stop", "args": {}}
    if re.fullmatch(r"(exit|quit|goodbye|good night|go to sleep|shut down jarvis|close jarvis)", low): return {"tool": "_exit", "args": {}}
    if (m := re.match(r"(?:(?:remember|teach|learn)\s+)?(?:jarvis\s+)?(?:that\s+)?when i say\s+[\"“']?(.+?)[\"”']?[,:]?\s+(?:then\s+|you\s+)?(?:please\s+)?((?:open|go|click|search|play|scroll|type|run|do|set|take|press|volume|mute|lock|launch|start|close|pause|next|find|remind|what)\b.+)$", s, re.I)): return {"tool": "_teach", "args": {"phrase": m[1], "action": m[2]}}
    if (m := re.match(r"(?:teach|learn)(?:\s+jarvis)?(?:\s+that)?[:,]?\s*[\"“']?(.+?)[\"”']?\s+(?:means|mean|equals|is)\s+(.+)$", s, re.I)): return {"tool": "_teach", "args": {"phrase": m[1], "action": m[2]}}
    if (m := re.match(r"when you hear\s+[\"“']?(.+?)[\"”']?\s+(?:i mean|it means|means|understand|write)\s+[\"“']?(.+?)[\"”']?$", s, re.I)): return {"tool": "_alias", "args": {"frm": m[1], "to": m[2]}}
    if re.fullmatch(r"(forget everything|reset (your )?(memory|training)|clear (your )?(memory|training))", low): return {"tool": "_forget", "args": {"q": "*"}}
    if (m := re.match(r"forget\s+(?:about\s+|that\s+|the shortcut\s+)?(.+)$", s, re.I)): return {"tool": "_forget", "args": {"q": m[1]}}
    if re.fullmatch(r"(what have you learned|what do you know( about me)?|show (my )?(skills|shortcuts|training|memory)|list (my )?(skills|shortcuts))", low): return {"tool": "_list", "args": {}}
    if (m := re.match(r"remember\s+(?:that\s+)?(.+)$", s, re.I)): return {"tool": "_fact", "args": {"text": m[1]}}
    if re.fullmatch(r"(good job|well done|great job|that(('?s)| is| was)? (right|correct|perfect|good)|nice work|perfect)", low): return {"tool": "_good", "args": {}}
    if re.fullmatch(r"(that(('?s)| is| was)? (wrong|not right|incorrect|bad)|wrong|bad job|no,? (not that|that'?s wrong))", low): return {"tool": "_bad", "args": {}}
    if re.fullmatch(r"(volume up|louder|turn it up|increase (the )?volume)", low): return {"tool": "volume", "args": {"op": "up"}}
    if re.fullmatch(r"(volume down|quieter|turn it down|decrease (the )?volume|lower (the )?volume)", low): return {"tool": "volume", "args": {"op": "down"}}
    if re.fullmatch(r"(mute|mute (the )?(sound|volume|computer))", low): return {"tool": "volume", "args": {"op": "mute"}}
    if re.fullmatch(r"unmute( (the )?(sound|volume|computer))?", low): return {"tool": "volume", "args": {"op": "mute"}}
    if re.fullmatch(r"(pause|play|resume|pause (the )?(music|song|video)|play (the )?(music|song)|play/pause)", low): return {"tool": "media", "args": {"op": "playpause"}}
    if re.fullmatch(r"(next|skip)( (song|track|video))?", low): return {"tool": "media", "args": {"op": "next"}}
    if re.fullmatch(r"(previous|last|back)( (song|track))", low): return {"tool": "media", "args": {"op": "prev"}}
    if re.fullmatch(r"(take (a )?screenshot|screenshot|capture (the )?screen)", low): return {"tool": "screenshot", "args": {}}
    if re.fullmatch(r"lock (the )?(screen|computer|pc|laptop)", low): return {"tool": "lock_screen", "args": {}}
    if re.fullmatch(r"(what('s| is) )?(the )?(time|time now)( is it)?|what time is it", low): return {"tool": "system_info", "args": {"what": "time"}}
    if re.fullmatch(r"what('s| is) (the )?(date|day)( today)?", low): return {"tool": "system_info", "args": {"what": "date"}}
    if re.fullmatch(r"(what('s| is) )?(the )?battery( level| status)?( now)?", low): return {"tool": "system_info", "args": {"what": "battery"}}
    if re.fullmatch(r"(how('s| is) )?(the )?(cpu|memory|ram|system)( usage| status)?", low): return {"tool": "system_info", "args": {"what": "cpu"}}
    if (m := re.fullmatch(r"(?:set )?volume (?:to )?(\d{1,3})(?: percent|%)?", low)): return {"tool": "volume", "args": {"op": "set", "n": min(100, int(m[1]))}}
    if (m := re.match(r"(?:set (?:a )?)?timer (?:for )?(.+)$", low)) and seconds(m[1]): return {"tool": "set_timer", "args": {"seconds": seconds(m[1]), "label": "Timer"}}
    if (m := re.match(r"remind me (?:in|after) (.+?) (?:to|about) (.+)$", low)) and seconds(m[1]): return {"tool": "set_timer", "args": {"seconds": seconds(m[1]), "label": m[2]}}
    if (m := re.match(r"remind me (?:to|about) (.+?) (?:in|after) (.+)$", low)) and seconds(m[2]): return {"tool": "set_timer", "args": {"seconds": seconds(m[2]), "label": m[1]}}
    if (m := re.match(r"(?:take a note|note|write down|jot down)(?: that)?[: ]+(.+)$", s, re.I)): return {"tool": "take_note", "args": {"text": m[1]}}
    if (m := re.match(r"(?:find|locate|search for) (?:the )?file (.+)$", s, re.I)): return {"tool": "find_file", "args": {"name": m[1]}}
    if (m := re.match(r"open (?:my |the )?(downloads|documents|desktop|pictures|music|videos|home)(?: folder)?$", low)): return {"tool": "open_folder", "args": {"name": m[1]}}
    if BROWSER_HINT.search(low): return {"tool": "browser", "args": {"text": s}}
    if re.fullmatch(r"(show desktop|minimi[sz]e( (this |the )?(window|all))?)", low): return {"tool": "window", "args": {"op": "minimize" if "desktop" not in low else "desktop"}}
    if re.fullmatch(r"maxim[ia][sz]e( (this |the )?window)?", low): return {"tool": "window", "args": {"op": "maximize"}}
    if re.fullmatch(r"close (this |the |current )?(window|app|program|application)", low): return {"tool": "window", "args": {"op": "close"}}
    if re.fullmatch(r"(switch|next|change) (window|app|program)s?|alt tab", low): return {"tool": "window", "args": {"op": "switch"}}
    if (m := re.fullmatch(r"scroll (up|down)(?: a (?:lot|bit))?", low)): return {"tool": "scroll", "args": {"dir": m[1]}}
    if re.fullmatch(r"(select all|copy( that| this| it)?|paste( it| here)?|cut( that| this| it)?|undo( that)?|redo( that)?|save( it| this| file)?)", low):
        mapped = {"select": "a", "copy": "c", "paste": "v", "cut": "x", "undo": "z", "redo": "y", "save": "s"}[low.split()[0]]
        return {"tool": "press_keys", "args": {"keys": ["ctrl", mapped]}}
    if (m := re.match(r"(?:type|dictate)\s+(.+)$", s, re.I)) and not re.search(r"\b(in|into|on) the\b", low): return {"tool": "type_text", "args": {"text": m[1]}}
    if (m := re.match(r"press\s+(.+)$", low)) and (k := keys_from(m[1])): return {"tool": "press_keys", "args": {"keys": k}}
    if (m := re.match(r"(?:open|go to|visit)\s+(.+)$", s, re.I)):
        target = m[1].strip()
        if re.search(r"\.(com|org|net|in|io|ai|co|dev|app|edu|gov)\b", target, re.I): return {"tool": "open_url", "args": {"url": target}}
        if target.lower() in SITES: return {"tool": "open_url", "args": {"url": SITES[target.lower()]}}
        return {"tool": "open_app", "args": {"name": target}}
    if (m := re.match(r"(?:launch|start|run)\s+(.+)$", s, re.I)): return {"tool": "open_app", "args": {"name": m[1].strip()}}
    if (m := re.match(r"(?:search|google|look up)\s+(?:for\s+)?(.+)$", s, re.I)): return {"tool": "search_web", "args": {"query": m[1]}}
    return None


def split(text: str):
    """'open notepad and type hello then press enter' -> separate commands (only if each part is understood)."""
    if re.match(r"(?:(?:remember|teach|learn)\s+)?(?:jarvis\s+)?(?:that\s+)?when i say\b|(?:teach|learn)\b|when you hear\b", text.strip(), re.I): return [text.strip()]
    parts = [p.strip() for p in re.split(r"\s+(?:and then|then|and|after that|also)\s+", text.strip(), flags=re.I) if p.strip()]
    if len(parts) > 1 and all(parse(p) for p in parts):
        return parts
    return [text.strip()]
