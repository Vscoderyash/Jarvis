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


def _distance(a, b, width, height):
    return math.hypot((a.x - b.x) * width, (a.y - b.y) * height)


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

    def __init__(self, on_state=None, log=print, camera_index=0):
        self.on_state = on_state
        self.log = log
        self.camera_index = int(camera_index or 0)
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._thread = None
        self._active = False
        self._last_message = ""

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
                return True, "Virtual Reality is already active. Move your index finger; pinch and release to click."
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._run, name="JARVIS-Hand-Control", daemon=True)
            self._thread.start()
        return True, "Starting Virtual Reality camera control. Keep one hand in view."

    def stop(self):
        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=2.5)
        return True, "Virtual Reality stopped."

    def _run(self):
        cap = detector = cv2 = pyautogui = None
        mouse_down = False
        old_pause = None
        end_message = "Virtual Reality is off."
        last_status_at = 0.0
        smooth_x = smooth_y = None
        pinching = False
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
                min_hand_detection_confidence=0.55,
                min_hand_presence_confidence=0.5,
                min_tracking_confidence=0.5,
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
            self._set_state(True, "Virtual Reality is on. Move your index finger; pinch and release to click. Press Q in the camera preview or say ‘stop virtual reality’ to exit.")

            while not self._stop_event.is_set():
                ok, frame = cap.read()
                if not ok or frame is None:
                    time.sleep(0.03)
                    continue
                frame = cv2.flip(frame, 1)
                height, width = frame.shape[:2]
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
                    smooth_x = x if smooth_x is None else smooth_x + (x - smooth_x) * 0.38
                    smooth_y = y if smooth_y is None else smooth_y + (y - smooth_y) * 0.38
                    pyautogui.moveTo(int(smooth_x * (screen_width - 1)), int(smooth_y * (screen_height - 1)))

                    palm = max(1.0, _distance(hand[0], hand[9], width, height))
                    pinch_ratio = _distance(hand[4], hand[8], width, height) / palm
                    if not pinching and pinch_ratio < 0.30:
                        pinching = True
                        mouse_down = True
                        pyautogui.mouseDown()
                        self._set_state(True, "Pinch detected. Release to click; keep pinching and move to drag.")
                    elif pinching and pinch_ratio > 0.48:
                        pinching = False
                        if mouse_down:
                            pyautogui.mouseUp()
                            mouse_down = False
                        self._set_state(True, "Virtual Reality is on. Move your index finger; pinch and release to click.")
                    elif now - last_status_at > 3:
                        self._set_state(True, "Hand tracked. Move your index finger; pinch and release to click.")
                        last_status_at = now

                    points = []
                    for landmark in hand:
                        point = (int(landmark.x * width), int(landmark.y * height))
                        points.append(point)
                    for start, end in CONNECTIONS:
                        cv2.line(frame, points[start], points[end], (91, 145, 255), 2)
                    for index, point in enumerate(points):
                        cv2.circle(frame, point, 5 if index in (4, 8) else 3, (88, 255, 230) if pinching else (230, 240, 255), -1)
                    cursor_text = "PINCH · CLICK / DRAG" if pinching else "POINT · PINCH TO CLICK"
                else:
                    if mouse_down:
                        pyautogui.mouseUp()
                        mouse_down = pinching = False
                    smooth_x = smooth_y = None
                    cursor_text = "SHOW ONE HAND"
                    if now - last_status_at > 1.5:
                        self._set_state(True, "Camera is on. Show one hand, palm facing the camera.")
                        last_status_at = now

                cv2.putText(frame, "JARVIS VIRTUAL REALITY  |  " + cursor_text, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (235, 240, 255), 2, cv2.LINE_AA)
                cv2.putText(frame, "Q: stop  |  say: stop virtual reality", (12, height - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 210, 230), 1, cv2.LINE_AA)
                cv2.imshow("JARVIS Virtual Reality", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    self._stop_event.set()

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
