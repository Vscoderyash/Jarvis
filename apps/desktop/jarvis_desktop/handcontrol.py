"""Optional on-device camera hand tracking for desktop mouse control."""
import math
import os
import pathlib
import threading
import time
import urllib.request


MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
MODEL_PATH = pathlib.Path.home() / ".jarvis" / "models" / "hand_landmarker.task"
CONNECTIONS = (
    (0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12), (9, 13), (13, 14), (14, 15),
    (15, 16), (13, 17), (17, 18), (18, 19), (19, 20), (0, 17),
)
AIR_KEY_ROWS = (
    tuple((key, key) for key in "1234567890"),
    tuple((key.upper(), key) for key in "qwertyuiop"),
    tuple((key.upper(), key) for key in "asdfghjkl"),
    (("SHIFT", "__shift"),) + tuple((key.upper(), key) for key in "zxcvbnm") + (("BKSP", "__backspace"),),
    (("SPACE", " "), (".", "."), (",", ","), ("-", "-"), ("@", "@")),
)


def _distance(a, b, width, height):
    return math.hypot((a.x - b.x) * width, (a.y - b.y) * height)


def _bounded(value, default, low, high):
    try:
        return min(high, max(low, float(value)))
    except (TypeError, ValueError):
        return default


def _key_at(x, y):
    if y < 0.42:
        return None
    row_index = min(len(AIR_KEY_ROWS) - 1, max(0, int((y - 0.42) / 0.56 * len(AIR_KEY_ROWS))))
    row = AIR_KEY_ROWS[row_index]
    column = min(len(row) - 1, max(0, int(x * len(row))))
    return row_index, column, row[column][1]


def _is_up(hand, tip, joint):
    return hand[tip].y + 0.015 < hand[joint].y


def _draw_air_keyboard(cv2, frame, x, y, shift):
    height, width = frame.shape[:2]
    left, right, top = int(width * 0.04), int(width * 0.96), int(height * 0.42)
    row_height = int(height * 0.55 / len(AIR_KEY_ROWS))
    hovered = _key_at(x, y)
    cv2.rectangle(frame, (left - 4, top - 5), (right + 4, min(height - 4, top + row_height * len(AIR_KEY_ROWS) + 4)), (22, 24, 29), -1)
    for row_index, row in enumerate(AIR_KEY_ROWS):
        key_width = (right - left) / len(row)
        y0 = top + row_index * row_height
        for column, (label, _value) in enumerate(row):
            x0 = int(left + column * key_width)
            x1 = int(left + (column + 1) * key_width - 3)
            active = hovered is not None and hovered[:2] == (row_index, column)
            color = (183, 197, 255) if active else (62, 66, 77)
            cv2.rectangle(frame, (x0, y0), (x1, y0 + row_height - 4), color, -1)
            text = "SHIFT*" if label == "SHIFT" and shift else label
            scale = 0.42 if len(text) > 4 else 0.52
            size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)[0]
            cv2.putText(frame, text, (x0 + max(3, (x1 - x0 - size[0]) // 2), y0 + row_height // 2 + size[1] // 2), cv2.FONT_HERSHEY_SIMPLEX, scale, (20, 22, 28) if active else (235, 239, 250), 1, cv2.LINE_AA)


def _download_model():
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    if MODEL_PATH.exists() and MODEL_PATH.stat().st_size > 1_000_000:
        return MODEL_PATH
    temporary = MODEL_PATH.with_suffix(".task.part")
    request = urllib.request.Request(MODEL_URL, headers={"User-Agent": "JARVIS-Desktop/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response, temporary.open("wb") as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
    if temporary.stat().st_size < 1_000_000:
        temporary.unlink(missing_ok=True)
        raise RuntimeError("The hand tracking model download was incomplete. Check your internet connection and retry.")
    os.replace(temporary, MODEL_PATH)
    return MODEL_PATH


class HandController:
    """Move the desktop pointer with the index tip; pinch and release to click."""

    def __init__(self, on_state=None, log=print, camera_index=0, settings=None):
        self.on_state = on_state
        self.log = log
        self.camera_index = int(camera_index or 0)
        settings = settings or {}
        self.response = _bounded(settings.get("vr_response"), 0.4, 0.12, 0.85)
        self.deadzone = _bounded(settings.get("vr_deadzone"), 0.003, 0.0, 0.03)
        self.scroll_speed = _bounded(settings.get("vr_scroll_speed"), 1.0, 0.4, 2.5)
        self.pinch_press_ratio = _bounded(settings.get("vr_pinch_press_ratio"), 0.30, 0.12, 0.48)
        self.pinch_release_ratio = max(self.pinch_press_ratio + 0.05, _bounded(settings.get("vr_pinch_release_ratio"), 0.48, 0.2, 0.9))
        self.stable_frames = int(_bounded(settings.get("vr_stable_frames"), 2, 1, 6))
        self.detection_confidence = _bounded(settings.get("vr_detection_confidence"), 0.55, 0.35, 0.9)
        self.presence_confidence = _bounded(settings.get("vr_presence_confidence"), 0.5, 0.35, 0.9)
        self.tracking_confidence = _bounded(settings.get("vr_tracking_confidence"), 0.5, 0.35, 0.9)
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._lock = threading.Lock()
        self._thread = None
        self._active = False
        self._last_message = ""
        self._keyboard_mode = False

    def _set_state(self, active, message):
        with self._lock:
            self._active = active
            changed = message != self._last_message
            self._last_message = message
        if changed:
            self.log("VR: " + message)
        if self.on_state:
            self.on_state(active, message)

    def start(self):
        with self._lock:
            if self._thread and self._thread.is_alive():
                if self._pause_event.is_set():
                    self._pause_event.clear()
                    return True, "Virtual Reality resumed. Release your fingers once before pinching to click."
                return True, "Virtual Reality is already active. Move your index finger; pinch and release to click."
            self._stop_event.clear()
            self._pause_event.clear()
            self._keyboard_mode = False
            self._thread = threading.Thread(target=self._run, name="JARVIS-Hand-Control", daemon=True)
            self._thread.start()
        return True, "Starting Virtual Reality camera control. Keep one hand in view."

    def pause(self):
        if not self._thread or not self._thread.is_alive():
            return False, "Virtual Reality is not running. Say ‘virtual reality’ to start it."
        self._pause_event.set()
        self._set_state(True, "Virtual Reality paused. Say ‘resume virtual reality’ or press P in the preview to continue.")
        return True, "Virtual Reality paused. Say ‘resume virtual reality’ or press P in the preview to continue."

    def resume(self):
        if not self._thread or not self._thread.is_alive():
            return False, "Virtual Reality is not running. Say ‘virtual reality’ to start it."
        self._pause_event.clear()
        self._set_state(True, "Virtual Reality resumed. Release your fingers once before pinching to click.")
        return True, "Virtual Reality resumed. Release your fingers once before pinching to click."

    def set_keyboard_mode(self, enabled):
        if not self._thread or not self._thread.is_alive():
            return False, "Start Virtual Reality before switching hand-control modes."
        self._keyboard_mode = bool(enabled)
        message = "Air keyboard on. Focus a text field in any app, then point and pinch a key." if enabled else "Desktop pointer mode on. Point to move and use hand gestures."
        self._set_state(True, message)
        return True, message

    def stop(self):
        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=2.5)
        return True, "Virtual Reality stopped."

    def _run(self):
        cap = detector = cv2 = pyautogui = None
        mouse_down = False
        pinch_kind = pinch_candidate = None
        pinch_stable_frames = 0
        air_keyboard = False
        air_shift = False
        last_scroll_y = scroll_remainder = None
        old_pause = None
        paused_state = False
        end_message = "Virtual Reality is off."
        last_status_at = 0.0
        smooth_x = smooth_y = None
        try:
            try:
                import cv2 as cv2_module
                import mediapipe as mp
                import pyautogui as pyautogui_module
                cv2, pyautogui = cv2_module, pyautogui_module
            except ImportError as error:
                raise RuntimeError("Virtual Reality needs OpenCV, MediaPipe, and PyAutoGUI. Run install_windows.bat again, or install apps/desktop/requirements-vr.txt in JARVIS's venv.") from error

            self._set_state(True, "Loading local hand tracking… first use downloads the model.")
            model_path = _download_model()
            if self._stop_event.is_set():
                return
            vision = mp.tasks.vision
            options = vision.HandLandmarkerOptions(
                base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
                running_mode=vision.RunningMode.VIDEO,
                num_hands=1,
                min_hand_detection_confidence=self.detection_confidence,
                min_hand_presence_confidence=self.presence_confidence,
                min_tracking_confidence=self.tracking_confidence,
            )
            detector = vision.HandLandmarker.create_from_options(options)
            if self._stop_event.is_set():
                return
            if os.name == "nt" and hasattr(cv2, "CAP_DSHOW"):
                cap = cv2.VideoCapture(self.camera_index, cv2.CAP_DSHOW)
                if not cap.isOpened():
                    cap.release()
                    cap = None
            if cap is None:
                cap = cv2.VideoCapture(self.camera_index)
            if not cap or not cap.isOpened():
                raise RuntimeError("Could not open the camera. Check Windows camera privacy settings and close apps already using the webcam.")
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            cap.set(cv2.CAP_PROP_FPS, 30)
            screen_width, screen_height = pyautogui.size()
            old_pause = pyautogui.PAUSE
            pyautogui.PAUSE = 0
            pyautogui.FAILSAFE = True
            self._set_state(True, "Desktop hand control is on. Move your index finger; pinch to click, V sign to scroll, K or voice for Air keyboard.")

            while not self._stop_event.is_set():
                requested_keyboard_mode = self._keyboard_mode
                if requested_keyboard_mode != air_keyboard:
                    if requested_keyboard_mode and mouse_down:
                        pyautogui.mouseUp(button="left")
                        mouse_down = False
                    pinch_kind = pinch_candidate = None
                    pinch_stable_frames = 0
                    air_shift = False
                    air_keyboard = requested_keyboard_mode
                ok, frame = cap.read()
                if not ok or frame is None:
                    time.sleep(0.03)
                    continue
                frame = cv2.flip(frame, 1)
                height, width = frame.shape[:2]
                if self._pause_event.is_set():
                    if not paused_state:
                        self._set_state(True, "Virtual Reality paused. Press P or say ‘resume virtual reality’ to continue.")
                        paused_state = True
                    if mouse_down:
                        pyautogui.mouseUp()
                        mouse_down = False
                    pinch_kind = pinch_candidate = None
                    pinch_stable_frames = 0
                    air_shift = False
                    smooth_x = smooth_y = None
                    cv2.putText(frame, "JARVIS VIRTUAL REALITY  |  PAUSED", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (235, 240, 255), 2, cv2.LINE_AA)
                    cv2.putText(frame, "P: resume  |  Q: stop  |  say: resume virtual reality", (12, height - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 210, 230), 1, cv2.LINE_AA)
                    cv2.imshow("JARVIS Virtual Reality", frame)
                    key = cv2.waitKey(1) & 0xFF
                    if key == ord("q"):
                        self._stop_event.set()
                    elif key == ord("p"):
                        self._pause_event.clear()
                    continue
                if paused_state:
                    paused_state = False
                    self._set_state(True, "Virtual Reality resumed. Release your fingers once before pinching to click.")
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = detector.detect_for_video(image, int(time.monotonic() * 1000))
                hands = result.hand_landmarks
                now = time.monotonic()

                if hands:
                    hand = hands[0]
                    tip = hand[8]
                    x = min(1.0, max(0.0, (tip.x - 0.06) / 0.88))
                    y = min(1.0, max(0.0, (tip.y - 0.08) / 0.84))
                    if smooth_x is None or smooth_y is None:
                        smooth_x, smooth_y = x, y
                    else:
                        dx, dy = x - smooth_x, y - smooth_y
                        movement = math.hypot(dx, dy)
                        if movement < self.deadzone:
                            x, y = smooth_x, smooth_y
                        alpha = min(0.9, self.response + movement * 1.8)
                        smooth_x += (x - smooth_x) * alpha
                        smooth_y += (y - smooth_y) * alpha
                    palm = max(1.0, _distance(hand[0], hand[9], width, height))
                    ratios = {
                        "left": _distance(hand[4], hand[8], width, height) / palm,
                        "right": _distance(hand[4], hand[12], width, height) / palm,
                        "double": _distance(hand[4], hand[16], width, height) / palm,
                    }
                    previous_kind = pinch_kind
                    if previous_kind:
                        raw_kind = previous_kind if ratios[previous_kind] < self.pinch_release_ratio else None
                    else:
                        raw_kind = next((kind for kind in ("left", "right", "double") if ratios[kind] < self.pinch_press_ratio), None)
                    if raw_kind != previous_kind:
                        if raw_kind == pinch_candidate:
                            pinch_stable_frames += 1
                        else:
                            pinch_candidate, pinch_stable_frames = raw_kind, 1
                        if pinch_stable_frames >= self.stable_frames:
                            pinch_kind = raw_kind
                            pinch_candidate, pinch_stable_frames = None, 0
                    else:
                        pinch_candidate, pinch_stable_frames = None, 0
                    started_kind = pinch_kind if previous_kind is None and pinch_kind is not None else None
                    released_kind = previous_kind if previous_kind is not None and pinch_kind is None else None
                    if not air_keyboard:
                        pyautogui.moveTo(int(smooth_x * (screen_width - 1)), int(smooth_y * (screen_height - 1)))
                    if air_keyboard:
                        hovered = _key_at(tip.x, tip.y)
                        if started_kind == "left" and hovered:
                            key = hovered[2]
                            if key == "__shift":
                                air_shift = not air_shift
                                self._set_state(True, "Air keyboard shift " + ("on." if air_shift else "off."))
                            elif key == "__backspace":
                                pyautogui.press("backspace")
                            elif key == " ":
                                pyautogui.press("space")
                                air_shift = False
                            else:
                                pyautogui.write(key.upper() if air_shift else key, interval=0)
                                air_shift = False
                    else:
                        v_scroll = not pinch_kind and _is_up(hand, 8, 6) and _is_up(hand, 12, 10) and not _is_up(hand, 16, 14) and not _is_up(hand, 20, 18)
                        if v_scroll:
                            if last_scroll_y is not None:
                                if scroll_remainder is None:
                                    scroll_remainder = 0.0
                                scroll_remainder += (last_scroll_y - tip.y) * 700 * self.scroll_speed
                                steps = int(scroll_remainder / 40)
                                if steps:
                                    pyautogui.scroll(steps)
                                    scroll_remainder -= steps * 40
                            last_scroll_y = tip.y
                            if mouse_down:
                                pyautogui.mouseUp(button="left")
                                mouse_down = False
                        else:
                            last_scroll_y = scroll_remainder = None
                            if started_kind == "left":
                                mouse_down = True
                                pyautogui.mouseDown(button="left")
                            elif released_kind == "left" and mouse_down:
                                pyautogui.mouseUp(button="left")
                                mouse_down = False
                            elif released_kind == "right":
                                pyautogui.click(button="right")
                            elif released_kind == "double":
                                pyautogui.doubleClick(interval=0.12)
                            if now - last_status_at > 3 and not started_kind and not released_kind:
                                self._set_state(True, "Desktop controls: index pinch click/drag, middle pinch right-click, ring pinch double-click, V sign scroll.")
                                last_status_at = now

                    points = []
                    for landmark in hand:
                        point = (int(landmark.x * width), int(landmark.y * height))
                        points.append(point)
                    for start, end in CONNECTIONS:
                        cv2.line(frame, points[start], points[end], (91, 145, 255), 2)
                    for index, point in enumerate(points):
                        cv2.circle(frame, point, 5 if index in (4, 8) else 3, (88, 255, 230) if pinch_kind else (230, 240, 255), -1)
                    cursor_text = "AIR KEYBOARD · PINCH A KEY" if air_keyboard else "V SCROLL · MOVE UP / DOWN" if v_scroll else {"left": "PINCH · CLICK / DRAG", "right": "THUMB-MIDDLE · RIGHT CLICK", "double": "THUMB-RING · DOUBLE CLICK"}.get(pinch_kind, "POINT · PINCH TO CLICK")
                    if air_keyboard:
                        _draw_air_keyboard(cv2, frame, tip.x, tip.y, air_shift)
                else:
                    if mouse_down:
                        pyautogui.mouseUp(button="left")
                        mouse_down = False
                    pinch_kind = pinch_candidate = None
                    pinch_stable_frames = 0
                    air_shift = False
                    smooth_x = smooth_y = None
                    last_scroll_y = scroll_remainder = None
                    cursor_text = "SHOW ONE HAND"
                    if now - last_status_at > 1.5:
                        self._set_state(True, "Camera is on. Show one hand, palm facing the camera.")
                        last_status_at = now

                cv2.putText(frame, "JARVIS VIRTUAL REALITY  |  " + cursor_text, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (235, 240, 255), 2, cv2.LINE_AA)
                cv2.putText(frame, "P: pause  |  K: keyboard  |  Q: stop", (12, height - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 210, 230), 1, cv2.LINE_AA)
                cv2.imshow("JARVIS Virtual Reality", frame)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    self._stop_event.set()
                elif key == ord("p"):
                    self._pause_event.set()
                    pinch_kind = pinch_candidate = None
                elif key == ord("k"):
                    air_keyboard = not air_keyboard
                    self._keyboard_mode = air_keyboard
                    air_shift = False
                    if air_keyboard and mouse_down:
                        pyautogui.mouseUp(button="left")
                        mouse_down = False
                    pinch_kind = pinch_candidate = None
                    self._set_state(True, "Air keyboard on. Focus a text field, then point and pinch a key." if air_keyboard else "Desktop pointer mode on. Point and use hand gestures.")

        except Exception as error:
            message = str(error) or type(error).__name__
            if "FailSafeException" in type(error).__name__:
                message = "Virtual Reality stopped by the PyAutoGUI corner failsafe."
            end_message = message
        finally:
            if mouse_down and pyautogui:
                try:
                    pyautogui.mouseUp()
                except Exception:
                    pass
            if old_pause is not None and pyautogui:
                pyautogui.PAUSE = old_pause
            if cap:
                try:
                    cap.release()
                except Exception:
                    pass
            if detector:
                try:
                    detector.close()
                except Exception:
                    pass
            if cv2:
                try:
                    cv2.destroyWindow("JARVIS Virtual Reality")
                    cv2.waitKey(1)
                except Exception:
                    pass
            self._set_state(False, end_message)
