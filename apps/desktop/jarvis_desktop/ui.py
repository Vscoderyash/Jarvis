"""A small Codex-inspired desktop companion card. Drag to move, double-click to stop, right-click to quit."""
import math, queue, time

COLORS = {
    "idle": "#a5a5a5",
    "listening": "#9bb7ff",
    "thinking": "#a8b9ff",
    "speaking": "#8bd2a7",
    "busy": "#d8c18a",
    "vr": "#50d9ff",
}


class UI:
    def __init__(self, scale=1.0, on_stop=None, on_quit=None):
        import tkinter as tk
        self.tk, self.q, self.state, self.on_stop, self.on_quit = tk, queue.Queue(), "idle", on_stop, on_quit
        self.scale = max(0.5, min(2.5, float(scale)))
        self.width, self.height = int(360 * self.scale), int(148 * self.scale)
        self.root = tk.Tk()
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        try:
            self.root.attributes("-alpha", 0.96)
        except Exception:
            pass
        x = self.root.winfo_screenwidth() - self.width - 24
        y = self.root.winfo_screenheight() - self.height - 72
        self.root.geometry(f"{self.width}x{self.height}+{x}+{y}")
        self.root.configure(bg="#202123")
        self.canvas = tk.Canvas(self.root, width=self.width, height=self.height, bg="#202123", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        for widget in (self.canvas, self.root):
            widget.bind("<ButtonPress-1>", self._down)
            widget.bind("<B1-Motion>", self._move)
            widget.bind("<Double-Button-1>", lambda _event: on_stop and on_stop())
            widget.bind("<Button-3>", lambda _event: on_quit and on_quit())
        self._t0 = time.time()
        self.root.after(80, self._tick)

    def _down(self, event):
        self._dx, self._dy = event.x_root - self.root.winfo_x(), event.y_root - self.root.winfo_y()

    def _move(self, event):
        self.root.geometry(f"+{event.x_root - self._dx}+{event.y_root - self._dy}")

    def set_state(self, state, text=None):
        self.q.put((state, text))

    def close(self):
        self.root.after(0, self.root.destroy)

    def _pixel_pet(self, cx, cy, bob):
        c, s = self.canvas, self.scale

        def block(x, y, w, h, color):
            c.create_rectangle(cx + x * s, cy + y * s + bob, cx + (x + w) * s, cy + (y + h) * s + bob, fill=color, outline=color)

        # A compact blue Pip, drawn from pixel blocks to match the web and extension companion.
        block(-18, -17, 36, 21, "#3266ef")
        block(-14, -21, 28, 5, "#75a5ff")
        block(-22, -12, 5, 12, "#75a5ff")
        block(17, -12, 5, 12, "#75a5ff")
        block(-12, -13, 24, 15, "#101b38")
        block(-8, -7, 5, 2, "#8efff3")
        block(4, -7, 5, 2, "#8efff3")
        block(-14, 5, 28, 8, "#3266ef")
        block(-10, 12, 8, 4, "#2f5ed0")
        block(3, 12, 8, 4, "#2f5ed0")
        block(1, 0, 23, 17, "#101b38")
        block(3, 2, 19, 12, "#263d82")
        block(9, 5, 3, 6, "#9ffcff")
        block(-5, 17, 32, 2, "#86b5ff")

    def _tick(self):
        try:
            while True:
                state, text = self.q.get_nowait()
                self.state = state
                if text is not None:
                    self.message = str(text)[:180]
        except queue.Empty:
            pass

        c, s, w, h = self.canvas, self.scale, self.width, self.height
        t = time.time() - self._t0
        color = COLORS.get(self.state, COLORS["idle"])
        bob = round(math.sin(t * 2.2) * 2 * s)
        pulse = 0.5 + 0.5 * math.sin(t * (7 if self.state in ("thinking", "busy") else 3))
        c.delete("all")
        c.create_rectangle(1, 1, w - 1, h - 1, fill="#202123", outline="#3b3c40", width=max(1, round(s)))
        c.create_line(0, 45 * s, w, 45 * s, fill="#343538", width=max(1, s))
        c.create_text(16 * s, 17 * s, anchor="w", text="PIP  ·  JARVIS", fill="#ededed", font=("Segoe UI", max(9, int(11 * s)), "bold"))
        c.create_text(16 * s, 33 * s, anchor="w", text="DESKTOP ASSISTANT", fill="#929399", font=("Segoe UI", max(7, int(8 * s))))
        c.create_oval(w - 108 * s, 13 * s, w - 99 * s, 22 * s, fill=color, outline="")
        c.create_oval(w - 111 * s, 10 * s, w - 96 * s, 25 * s, outline=color, stipple="gray50", width=max(1, int(1 + pulse * s)))
        c.create_text(w - 16 * s, 17 * s, anchor="e", text=self.state.upper(), fill=color, font=("Segoe UI", max(8, int(9 * s)), "bold"))
        self._pixel_pet(44 * s, 78 * s, bob)
        message = getattr(self, "message", "Say ‘JARVIS’ to start")
        c.create_text(82 * s, 76 * s, anchor="w", width=w - 100 * s, text=message, fill="#e5e5e5", font=("Segoe UI", max(8, int(10 * s))), justify="left")
        c.create_line(14 * s, h - 24 * s, w - 14 * s, h - 24 * s, fill="#343538", width=max(1, s))
        c.create_text(16 * s, h - 12 * s, anchor="w", text="Double-click to stop  ·  Right-click to quit", fill="#8d8e93", font=("Segoe UI", max(7, int(8 * s))))
        self.root.after(80, self._tick)

    def run(self):
        self.root.mainloop()
