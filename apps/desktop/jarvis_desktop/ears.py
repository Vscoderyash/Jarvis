"""Local microphone capture and speech recognition for JARVIS Desktop."""
import collections
import json
import queue
import time

import numpy as np

SR, FRAME_SECONDS = 16000, 0.03
JUNK = {"", ".", "the", "a", "huh", "you", "thank you", "thanks", "thanks for watching", "bye", "the end", "uh", "um", "hmm"}
PROMPT = "Jarvis. Virtual reality. Air keyboard. Browse mode. Stop virtual reality. Right click. Double click. Scroll with two fingers. Open Chrome, open Notepad, click, scroll down, type, volume up, next tab, YouTube, Spotify, screenshot, remind me, set a timer."


class Ears:
    def __init__(self, cfg, is_speaking, log=print):
        self.cfg, self.is_speaking, self.log = cfg, is_speaking, log
        self.q = queue.Queue(maxsize=400)
        self.model = None
        self.threshold = 180.0
        self.noise_rms = 60.0
        self.stream = None
        self.stream_rate = SR
        self.engine = None
        self.vosk_model = None
        self.vocab = []
        self._stream_warning_logged = False

    def start(self):
        import sounddevice as sd

        self._load_engine()
        device = self.cfg.get("mic_device")
        try:
            info = sd.query_devices(device, "input")
        except Exception as exc:
            raise RuntimeError(f"Could not open microphone {device!r}. Check mic_device or use the default microphone: {exc}") from exc

        preferred_rate = int(info.get("default_samplerate") or SR)
        for rate in dict.fromkeys((SR, preferred_rate, 48000, 44100)):
            try:
                sd.check_input_settings(device=device, samplerate=rate, channels=1, dtype="int16")
                self.stream_rate = rate
                break
            except Exception:
                continue
        else:
            raise RuntimeError(f"Microphone '{info.get('name', device)}' has no usable mono input rate. Choose another microphone with mic_device.")

        if self.stream_rate != SR:
            self.log(f"Microphone runs at {self.stream_rate} Hz; converting locally to {SR} Hz for speech recognition.")
        blocksize = max(1, round(self.stream_rate * FRAME_SECONDS))
        self.stream = sd.InputStream(
            samplerate=self.stream_rate,
            channels=1,
            dtype="int16",
            blocksize=blocksize,
            device=device,
            callback=self._audio_callback,
        )
        self.stream.start()
        self.calibrate()

    def _audio_callback(self, data, _frames, _time_info, status):
        if status and not self._stream_warning_logged:
            self._stream_warning_logged = True
            self.log(f"[mic] Audio input warning: {status}. If words are clipped, try another microphone or a USB headset.")
        if self.q.full():
            return
        try:
            self.q.put_nowait(data[:, 0].copy())
        except queue.Full:
            pass

    def _load_engine(self):
        want = str(self.cfg.get("stt", "auto")).lower()
        if want in ("auto", "whisper"):
            try:
                from faster_whisper import WhisperModel

                model_name = self.cfg.get("whisper_model", "small")
                self.log(f"Loading Whisper speech model '{model_name}' (first run downloads it)...")
                self.model = WhisperModel(model_name, device="cpu", compute_type="int8")
                self.engine = "whisper"
                language = str(self.cfg.get("language", "auto")).strip().lower()
                self.log(f"Whisper is ready; input language: {language if language not in ('', 'auto', 'detect') else 'automatic detection'}.")
                return
            except Exception as exc:
                if want == "whisper":
                    raise
                self.log(f"Whisper is unavailable ({type(exc).__name__}); using Vosk. For better multilingual accuracy, install Python 3.11 or 3.12 and rerun install_windows.bat.")

        from vosk import Model, SetLogLevel

        SetLogLevel(-1)
        name = self.cfg.get("vosk_model", "vosk-model-en-us-0.22-lgraph")
        self.log(f"Loading Vosk English speech model '{name}' (first run downloads it, about 130 MB)...")
        self.vosk_model = Model(model_name=name)
        self.engine = "vosk"

    def calibrate(self, seconds=1.5):
        self.log("Measuring room noise for a moment; keep quiet, then speak normally.")
        values, end = [], time.time() + seconds
        while time.time() < end:
            try:
                values.append(self._rms(self.q.get(timeout=0.5)))
            except queue.Empty:
                pass
        self.noise_rms = float(np.median(values)) if values else 50.0
        self.threshold = min(5000.0, max(100.0, self.noise_rms * 2.2))
        self.log(f"Room noise {self.noise_rms:.0f}, voice trigger {self.threshold:.0f}.")

    @staticmethod
    def _rms(frame):
        return float(np.sqrt(np.mean(frame.astype(np.float32) ** 2)))

    def _capture(self, timeout):
        pre = collections.deque(maxlen=10)  # 300 ms pre-roll keeps the first word
        voiced, silent, started, frames, t0 = 0, 0, False, [], time.time()
        while True:
            if timeout and not started and time.time() - t0 > timeout:
                return None
            try:
                frame = self.q.get(timeout=0.3)
            except queue.Empty:
                continue
            if self.is_speaking():  # do not feed JARVIS's own voice back into ASR
                pre.clear()
                voiced = silent = 0
                started = False
                frames = []
                continue

            rms = self._rms(frame)
            if not started:
                pre.append(frame)
                voiced = voiced + 1 if rms > self.threshold else 0
                if voiced >= 2:
                    started, frames, silent = True, list(pre), 0
                elif rms < self.threshold * 0.65:
                    self.noise_rms = self.noise_rms * 0.995 + rms * 0.005
                    self.threshold = min(5000.0, max(100.0, self.noise_rms * 2.2))
            else:
                frames.append(frame)
                loud = rms > max(65.0, self.threshold * 0.5)
                silent = 0 if loud else silent + 1
                if silent >= 25 or len(frames) > 667:  # 750 ms quiet ends a phrase; cap at 20 seconds
                    return np.concatenate(frames) if len(frames) > 14 else None

    def _to_asr_audio(self, audio):
        if self.stream_rate != SR and len(audio):
            output_count = max(1, round(len(audio) * SR / self.stream_rate))
            positions = np.arange(output_count, dtype=np.float64) * self.stream_rate / SR
            audio = np.interp(positions, np.arange(len(audio), dtype=np.float64), audio.astype(np.float64))
        audio = audio.astype(np.float32)
        audio -= float(np.mean(audio))  # remove microphone DC offset
        level = float(np.percentile(np.abs(audio), 95)) if len(audio) else 0.0
        if level > 1.0:
            audio *= min(4.0, 12000.0 / level)  # capped gain helps quiet laptop microphones
        return np.clip(audio, -32768.0, 32767.0).astype(np.int16)

    def transcribe(self, audio):
        audio = self._to_asr_audio(audio)
        if self.engine == "vosk":
            from vosk import KaldiRecognizer

            recognizer = KaldiRecognizer(self.vosk_model, SR)
            data = audio.tobytes()
            for offset in range(0, len(data), 8000):
                recognizer.AcceptWaveform(data[offset:offset + 8000])
            text = json.loads(recognizer.FinalResult()).get("text", "").strip()
            return "" if text.lower().strip(" .!?") in JUNK else text

        samples = audio.astype(np.float32) / 32768.0
        language = str(self.cfg.get("language", "auto")).strip().lower()
        if language in ("", "auto", "detect"):
            language = None
        vocabulary = (", ".join(self.vocab)[:300]) if self.vocab else ""
        if language == "en":
            prompt = PROMPT + ((" " + vocabulary) if vocabulary else "")
        elif language is None:
            prompt = ("Jarvis. " + vocabulary).strip() or None
        else:
            prompt = vocabulary or None
        segments, info = self.model.transcribe(
            samples,
            language=language,
            beam_size=5,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 450, "speech_pad_ms": 250},
            initial_prompt=prompt,
            condition_on_previous_text=False,
        )
        parts = []
        for segment in segments:
            # Do not discard uncertain words by either score alone; that clipped quiet parts of real phrases.
            if segment.no_speech_prob > 0.6 and segment.avg_logprob < -1.0:
                continue
            parts.append(segment.text.strip())
        text = " ".join(parts).strip()
        if getattr(info, "language_probability", 1.0) < 0.55:
            self.log("Speech language was uncertain. Set config.json 'language' to 'en' or 'hi' to improve recognition.")
        return "" if text.lower().strip(" .!?") in JUNK else text

    def hear(self, timeout=None):
        audio = self._capture(timeout)
        return self.transcribe(audio) if audio is not None else ""
