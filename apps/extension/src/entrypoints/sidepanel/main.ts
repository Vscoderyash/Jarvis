import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

type Point = { x: number; y: number };
type PinchKind = 'left' | 'right' | 'double';
type Key = { label: string; value: string; kind?: 'shift' | 'backspace' };
type GestureMode = 'browse' | 'keyboard';
type TrackingSettings = { response: number; cursorGain: number; pinchSensitivity: number; scrollSpeed: number; handConfidence: number; cameraDeviceId: string };
const DEFAULT_TRACKING_SETTINGS: TrackingSettings = { response: 0.42, cursorGain: 1, pinchSensitivity: 1, scrollSpeed: 1, handConfidence: 0.55, cameraDeviceId: '' };

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing side panel control: ${id}`);
  return element as T;
};

const video = $('video') as HTMLVideoElement;
const preview = $('preview');
const cursor = $('cameraCursor');
const keysElement = $('airKeys');
const statusElement = $('status');
const startButton = $('start') as HTMLButtonElement;
const stopButton = $('stop') as HTMLButtonElement;
const pauseButton = $('pause') as HTMLButtonElement;
const permissionHelpButton = $('permissionHelp') as HTMLButtonElement;
const cameraDevice = $('cameraDevice') as HTMLSelectElement;
const centerCursorButton = $('centerCursor') as HTMLButtonElement;
const trackingBadge = $('trackingBadge');
const extensionManifest = chrome.runtime.getManifest();
const extensionVersion = extensionManifest.version;
$('buildVersion').textContent = `Hand control for the active tab · v${extensionVersion}`;
let trackingSettings: TrackingSettings = { ...DEFAULT_TRACKING_SETTINGS };
const trackingSettingsReady = chrome.storage.local.get('gestureSettings').then((values) => {
  const saved = values.gestureSettings as Partial<TrackingSettings> | undefined;
  if (!saved || typeof saved !== 'object') return;
  trackingSettings = {
    response: clamp(Number(saved.response) || DEFAULT_TRACKING_SETTINGS.response, 0.15, 0.8),
    cursorGain: clamp(Number(saved.cursorGain) || 1, 0.75, 1.4),
    pinchSensitivity: clamp(Number(saved.pinchSensitivity) || 1, 0.7, 1.35),
    scrollSpeed: clamp(Number(saved.scrollSpeed) || 1, 0.6, 2),
    handConfidence: clamp(Number(saved.handConfidence) || 0.55, 0.4, 0.8),
    cameraDeviceId: typeof saved.cameraDeviceId === 'string' ? saved.cameraDeviceId : '',
  };
}).catch(() => {});
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const rows: Key[][] = [
  [...'1234567890'].map((value) => ({ label: value, value })),
  [...'QWERTYUIOP'].map((value) => ({ label: value, value: value.toLowerCase() })),
  [...'ASDFGHJKL'].map((value) => ({ label: value, value: value.toLowerCase() })),
  [{ label: '⇧', value: '', kind: 'shift' }, ...[...'ZXCVBNM'].map((value) => ({ label: value, value: value.toLowerCase() })), { label: '⌫', value: '', kind: 'backspace' }],
  [{ label: 'SPACE', value: ' ' }, ...[...'. , - @ :'.replaceAll(' ', '')].map((value) => ({ label: value, value }))],
];

let mode: GestureMode = 'browse';
let stream: MediaStream | null = null;
let cameraStarting = false;
let cameraStartId = 0;
let landmarker: HandLandmarker | null = null;
let animationFrame = 0;
let running = false;
let activeTabId: number | null = null;
let lastFrame = 0;
let lastCursor = 0;
let lastStatus = 0;
let pinchWasDown = false;
let pinchGesture: PinchKind | null = null;
let pinchCandidate: PinchKind | null = null;
let pinchStableFrames = 0;
let pinchStart: Point | null = null;
let previousPinch: Point | null = null;
let dragDistance = 0;
let scrollRemainder = 0;
let lastScroll = 0;
let lastClickAt = 0;
let lastTypedAt = 0;
let smoothedPoint: Point | null = null;
let scrollSignPoint: Point | null = null;
let latestRawPoint: Point | null = null;
let cursorOffset: Point = { x: 0, y: 0 };
let trackingPaused = false;
let handVisible = false;
let airShift = false;
let activeKey: { row: number; col: number } | null = null;

function setStatus(message: string, error = false): void {
  statusElement.textContent = message;
  statusElement.dataset.kind = error ? 'error' : 'normal';
}

function syncTrackingControls(): void {
  ($('responseSpeed') as HTMLInputElement).value = String(Math.round(trackingSettings.response * 100));
  $('responseValue').textContent = `${Math.round(trackingSettings.response * 100)}%`;
  ($('cursorGain') as HTMLInputElement).value = String(Math.round(trackingSettings.cursorGain * 100));
  $('cursorGainValue').textContent = `${Math.round(trackingSettings.cursorGain * 100)}%`;
  ($('pinchSensitivity') as HTMLInputElement).value = String(Math.round(trackingSettings.pinchSensitivity * 100));
  $('pinchValue').textContent = `${Math.round(trackingSettings.pinchSensitivity * 100)}%`;
  ($('scrollSpeed') as HTMLInputElement).value = String(Math.round(trackingSettings.scrollSpeed * 100));
  $('scrollValue').textContent = `${Math.round(trackingSettings.scrollSpeed * 100)}%`;
  ($('handConfidence') as HTMLInputElement).value = String(Math.round(trackingSettings.handConfidence * 100));
  $('confidenceValue').textContent = `${Math.round(trackingSettings.handConfidence * 100)}%`;
}

function persistTrackingSettings(): void {
  void chrome.storage.local.set({ gestureSettings: trackingSettings });
}

void trackingSettingsReady.then(() => {
  syncTrackingControls();
  void refreshCameras(trackingSettings.cameraDeviceId);
});

function bindTrackingSlider(id: string, outputId: string, field: keyof Omit<TrackingSettings, 'cameraDeviceId'>): void {
  const input = $(id) as HTMLInputElement;
  input.addEventListener('input', () => {
    const value = Number(input.value);
    if (field === 'response') trackingSettings.response = value / 100;
    else if (field === 'cursorGain') trackingSettings.cursorGain = value / 100;
    else if (field === 'pinchSensitivity') trackingSettings.pinchSensitivity = value / 100;
    else if (field === 'scrollSpeed') trackingSettings.scrollSpeed = value / 100;
    else trackingSettings.handConfidence = value / 100;
    $(outputId).textContent = `${value}%`;
    persistTrackingSettings();
    if (field === 'handConfidence' && running) setStatus('Detection confidence saved. Stop and restart the camera to apply it.');
  });
}

bindTrackingSlider('responseSpeed', 'responseValue', 'response');
bindTrackingSlider('cursorGain', 'cursorGainValue', 'cursorGain');
bindTrackingSlider('pinchSensitivity', 'pinchValue', 'pinchSensitivity');
bindTrackingSlider('scrollSpeed', 'scrollValue', 'scrollSpeed');
bindTrackingSlider('handConfidence', 'confidenceValue', 'handConfidence');

async function refreshCameras(preferredId = ''): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
    const previous = preferredId || cameraDevice.value || trackingSettings.cameraDeviceId;
    cameraDevice.replaceChildren(new Option('Default camera', ''));
    cameras.forEach((device, index) => cameraDevice.add(new Option(device.label || `Camera ${index + 1}`, device.deviceId)));
    cameraDevice.value = cameras.some((device) => device.deviceId === previous) ? previous : '';
    trackingSettings.cameraDeviceId = cameraDevice.value;
    cameraDevice.disabled = running || cameras.length < 2;
    persistTrackingSettings();
  } catch {
    cameraDevice.disabled = true;
  }
}

cameraDevice.addEventListener('change', () => {
  trackingSettings.cameraDeviceId = cameraDevice.value;
  persistTrackingSettings();
});

function renderKeys(): void {
  keysElement.replaceChildren();
  for (const row of rows) {
    const rowElement = document.createElement('div');
    rowElement.className = 'key-row';
    for (const key of row) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `air-key${key.kind ? ' special' : ''}`;
      button.textContent = key.label;
      button.setAttribute('aria-label', key.kind === 'backspace' ? 'Backspace' : key.kind === 'shift' ? 'Shift' : key.label);
      button.addEventListener('click', () => { void pressAirKey({ row: rows.indexOf(row), col: row.indexOf(key) }); });
      rowElement.appendChild(button);
    }
    keysElement.appendChild(rowElement);
  }
}
renderKeys();

function setMode(next: GestureMode): void {
  mode = next;
  $('browseMode').classList.toggle('selected', mode === 'browse');
  $('typeMode').classList.toggle('selected', mode === 'keyboard');
  $('browseHelp').toggleAttribute('hidden', mode !== 'browse');
  $('typeHelp').toggleAttribute('hidden', mode !== 'keyboard');
  keysElement.hidden = mode !== 'keyboard' || !running;
  if (mode === 'browse' && running) setStatus('Browse: point to move; thumb-index clicks, thumb-middle opens the page menu, thumb-ring double-clicks.');
  if (mode === 'keyboard' && running) setStatus('Air keyboard ready. Focus a text field, then point at a key and thumb-index pinch.');
  activeKey = null;
  airShift = false;
  pinchWasDown = false;
  pinchGesture = null;
  pinchCandidate = null;
  pinchStableFrames = 0;
  pinchStart = null;
  previousPinch = null;
  scrollSignPoint = null;
  updateKeyHighlight(null);
  if (mode === 'keyboard') cursor.style.display = 'none';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function updateKeyHighlight(next: { row: number; col: number } | null): void {
  const previous = activeKey;
  if (previous) keysElement.children[previous.row]?.children[previous.col]?.classList.remove('hover');
  activeKey = next;
  if (next) keysElement.children[next.row]?.children[next.col]?.classList.add('hover');
}

async function sendToActivePage(message: Record<string, unknown>): Promise<any> {
  if (activeTabId === null) return null;
  try {
    return await chrome.tabs.sendMessage(activeTabId, message);
  } catch {
    return null;
  }
}

async function selectActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const next = typeof tab?.id === 'number' && /^https?:\/\//i.test(tab.url || '') ? tab.id : null;
  if (next === activeTabId) return;
  if (activeTabId !== null) void chrome.tabs.sendMessage(activeTabId, { type: 'gesture:off' }).catch(() => {});
  activeTabId = next;
  if (next === null) {
    setStatus('Switch to a normal website tab to use hand controls.', true);
    return;
  }
  try {
    await chrome.tabs.sendMessage(next, { type: 'gesture:ready' });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: next }, files: ['content-scripts/content.js'] });
      await chrome.tabs.sendMessage(next, { type: 'gesture:ready' });
    } catch {
      setStatus('Chrome blocked page access. Use a normal website tab, set JARVIS Site access to “On all sites”, then refresh the tab.', true);
      return;
    }
  }
  if (running && mode === 'browse') setStatus(`Hand controls ready on ${tab.title || 'the active tab'}.`);
}

chrome.tabs.onActivated.addListener(() => { void selectActiveTab(); });
chrome.windows.onFocusChanged.addListener(() => { void selectActiveTab(); });

function keyAt(point: Point): { row: number; col: number } | null {
  if (point.y < 0.42) return null;
  const row = clamp(Math.floor(((point.y - 0.42) / 0.56) * rows.length), 0, rows.length - 1);
  const col = clamp(Math.floor(point.x * rows[row].length), 0, rows[row].length - 1);
  return { row, col };
}

async function pressAirKey(position: { row: number; col: number }): Promise<void> {
  const key = rows[position.row]?.[position.col];
  if (!key) return;
  if (key.kind === 'shift') {
    airShift = !airShift;
    setStatus(airShift ? 'Shift is on. Pinch a letter to type it in uppercase.' : 'Shift is off.');
    return;
  }
  const value = key.kind === 'backspace' ? '\b' : key.value === ' ' ? ' ' : airShift ? key.value.toUpperCase() : key.value;
  airShift = false;
  if (key.kind === 'backspace') setStatus('Backspace sent to the focused page field.');
  else if (value === ' ') setStatus('Space sent to the focused page field.');
  else setStatus(`Typed ${value.toUpperCase()} into the focused page field.`);
  const result = await sendToActivePage({ type: 'gesture:type', value });
  if (result && result.ok === false) setStatus(String(result.message || 'Focus a regular text field first.'), true);
}

function updateCameraPoint(point: Point): void {
  cursor.style.left = `${point.x * 100}%`;
  cursor.style.top = `${point.y * 100}%`;
  cursor.style.display = mode === 'browse' ? 'block' : 'none';
}

function setCameraStatus(message: string, now: number): void {
  if (now - lastStatus < 900) return;
  lastStatus = now;
  setStatus(message);
}

function processHand(result: ReturnType<HandLandmarker['detectForVideo']>, now: number): void {
  const hand = result.landmarks?.[0];
  if (!hand || hand.length < 9) {
    if (handVisible && mode === 'browse') void sendToActivePage({ type: 'gesture:off' });
    handVisible = false;
    pinchWasDown = false;
    pinchGesture = null;
    pinchCandidate = null;
    pinchStableFrames = 0;
    pinchStart = null;
    previousPinch = null;
    scrollSignPoint = null;
    dragDistance = 0;
    scrollRemainder = 0;
    smoothedPoint = null;
    latestRawPoint = null;
    airShift = false;
    centerCursorButton.disabled = true;
    trackingBadge.textContent = 'Hand: not found';
    updateKeyHighlight(null);
  if (mode === 'browse') cursor.style.display = 'none';
    setCameraStatus('Show one hand to the camera, palm facing toward you.', now);
    return;
  }

  handVisible = true;
  centerCursorButton.disabled = trackingPaused;
  trackingBadge.textContent = 'Hand: tracking';
  // Mirror the normalized camera coordinates so movement matches the mirrored preview.
  const rawPoint = { x: clamp(1 - hand[8].x, 0, 1), y: clamp(hand[8].y, 0, 1) };
  latestRawPoint = rawPoint;
  const mappedPoint = {
    x: clamp(0.5 + (rawPoint.x - 0.5) * trackingSettings.cursorGain + cursorOffset.x, 0, 1),
    y: clamp(0.5 + (rawPoint.y - 0.5) * trackingSettings.cursorGain + cursorOffset.y, 0, 1),
  };
  const point = smoothedPoint
    ? { x: smoothedPoint.x + (mappedPoint.x - smoothedPoint.x) * trackingSettings.response, y: smoothedPoint.y + (mappedPoint.y - smoothedPoint.y) * trackingSettings.response }
    : mappedPoint;
  smoothedPoint = point;
  const palmScale = Math.max(0.08, Math.hypot(hand[0].x - hand[9].x, hand[0].y - hand[9].y));
  const pinchRatios: Record<PinchKind, number> = {
    left: Math.hypot(hand[4].x - hand[8].x, hand[4].y - hand[8].y) / palmScale,
    right: Math.hypot(hand[4].x - hand[12].x, hand[4].y - hand[12].y) / palmScale,
    double: Math.hypot(hand[4].x - hand[16].x, hand[4].y - hand[16].y) / palmScale,
  };
  const wasPinching = pinchWasDown;
  const previousGesture = pinchGesture;
  const rawGesture = previousGesture
    ? pinchRatios[previousGesture] < 0.42 * trackingSettings.pinchSensitivity ? previousGesture : null
    : (['left', 'right', 'double'] as PinchKind[]).find((kind) => pinchRatios[kind] < 0.27 * trackingSettings.pinchSensitivity) || null;
  if (rawGesture !== previousGesture) {
    if (rawGesture === pinchCandidate) pinchStableFrames += 1;
    else { pinchCandidate = rawGesture; pinchStableFrames = 1; }
    if (pinchStableFrames >= 2) {
      pinchGesture = rawGesture;
      pinchWasDown = rawGesture !== null;
      pinchCandidate = null;
      pinchStableFrames = 0;
    }
  } else { pinchCandidate = null; pinchStableFrames = 0; }
  const pinching = pinchGesture !== null;
  const startedGesture = !wasPinching && pinching ? pinchGesture : null;
  const releasedGesture = wasPinching && !pinching ? previousGesture : null;

  if (mode === 'keyboard') {
    const hovered = keyAt(point);
    updateKeyHighlight(hovered);
    if (startedGesture === 'left' && hovered && now - lastTypedAt > 180) { lastTypedAt = now; void pressAirKey(hovered); }
    return;
  }

  if (now - lastCursor > 75) {
    lastCursor = now;
    updateCameraPoint(point);
    void sendToActivePage({ type: 'gesture:cursor', nx: point.x, ny: point.y });
  }

  const scrollSign = !pinching && hand[8].y < hand[6].y && hand[12].y < hand[10].y && hand[16].y > hand[14].y && hand[20].y > hand[18].y;
  if (scrollSign) {
    if (scrollSignPoint && now - lastScroll > 80) {
      const delta = point.y - scrollSignPoint.y;
      if (Math.abs(delta) > 0.003) {
        lastScroll = now;
        void sendToActivePage({ type: 'gesture:scroll', nx: point.x, ny: point.y, delta: -delta * 1.25 * trackingSettings.scrollSpeed });
      }
    }
    scrollSignPoint = point;
    return;
  }
  scrollSignPoint = null;

  if (pinching && !wasPinching) {
    pinchStart = point;
    previousPinch = point;
    dragDistance = 0;
    scrollRemainder = 0;
  } else if (pinching && wasPinching && previousPinch && pinchStart && pinchGesture === 'left') {
    const dy = point.y - previousPinch.y;
    scrollRemainder += dy;
    dragDistance += Math.abs(dy);
    if (dragDistance > 0.035 && Math.abs(scrollRemainder) > 0.008 && now - lastScroll > 80) {
      lastScroll = now;
      void sendToActivePage({ type: 'gesture:scroll', nx: point.x, ny: point.y, delta: -scrollRemainder * 1.25 * trackingSettings.scrollSpeed });
      scrollRemainder = 0;
    }
    previousPinch = point;
  } else if (!pinching && wasPinching && pinchStart) {
    if (dragDistance <= 0.035 && now - lastClickAt > 350) {
      lastClickAt = now;
      const button = releasedGesture || 'left';
      void sendToActivePage({ type: 'gesture:click', nx: point.x, ny: point.y, button }).then((result) => {
        if (result?.ok === false) setStatus(String(result.message || 'Pinch action was not accepted.'), true);
        else if (result?.ok) setStatus(button === 'right' ? 'Page context click sent.' : button === 'double' ? 'Double-click sent.' : 'Pinch click sent to the active page.');
      });
    }
    pinchStart = null;
    previousPinch = null;
    dragDistance = 0;
    scrollRemainder = 0;
  }
}

function frame(now: number): void {
  if (!running) return;
  if (!trackingPaused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastFrame > 75 && landmarker) {
    lastFrame = now;
    try {
      const result = landmarker.detectForVideo(video, now);
      processHand(result, now);
    } catch {
      setStatus('Hand tracking paused. Stop the camera and try again.', true);
    }
  }
  animationFrame = requestAnimationFrame(frame);
}

function setTrackingPaused(next: boolean): void {
  if (!running) return;
  trackingPaused = next;
  pauseButton.textContent = next ? 'Resume' : 'Pause';
  trackingBadge.textContent = next ? 'Tracking: paused' : handVisible ? 'Hand: tracking' : 'Hand: waiting';
  centerCursorButton.disabled = next || !latestRawPoint;
  if (next) {
    pinchWasDown = false;
    pinchGesture = null;
    pinchCandidate = null;
    pinchStableFrames = 0;
    pinchStart = null;
    previousPinch = null;
    dragDistance = 0;
    scrollRemainder = 0;
    scrollSignPoint = null;
    cursor.style.display = 'none';
    if (activeTabId !== null) void chrome.tabs.sendMessage(activeTabId, { type: 'gesture:off' }).catch(() => {});
    setStatus('Hand tracking paused. Camera preview remains on; resume when ready.');
  } else {
    setStatus('Hand tracking resumed. Point to move, pinch and release to click.');
  }
}

centerCursorButton.addEventListener('click', () => {
  if (!latestRawPoint) return;
  const centeredX = 0.5 + (latestRawPoint.x - 0.5) * trackingSettings.cursorGain;
  const centeredY = 0.5 + (latestRawPoint.y - 0.5) * trackingSettings.cursorGain;
  cursorOffset = { x: 0.5 - centeredX, y: 0.5 - centeredY };
  smoothedPoint = null;
  setStatus('Cursor centered on your current hand position.');
});

async function startCamera(): Promise<void> {
  if (cameraStarting || running || stream) {
    setStatus('Virtual Reality camera is already on or starting.');
    return;
  }
  cameraStarting = true;
  const requestId = ++cameraStartId;
  startButton.disabled = true;
  permissionHelpButton.hidden = true;
  setStatus('Requesting camera permission…');
  let stage: 'permission' | 'page' | 'model' = 'permission';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Chrome does not expose camera access here. Update Chrome and reopen the JARVIS extension side panel.');
    // Request permission synchronously from the Start button before awaiting tab lookup.
    const requestedDeviceId = cameraDevice.value;
    const videoConstraints: MediaTrackConstraints = { width: { ideal: 640 }, height: { ideal: 480 }, ...(requestedDeviceId ? { deviceId: { exact: requestedDeviceId } } : {}) };
    const cameraRequest = navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    let cameraStream: MediaStream;
    try {
      cameraStream = await cameraRequest;
    } catch (error) {
      if (!requestedDeviceId || !(error instanceof DOMException) || !['OverconstrainedError', 'NotFoundError'].includes(error.name)) throw error;
      cameraDevice.value = '';
      trackingSettings.cameraDeviceId = '';
      persistTrackingSettings();
      setStatus('Saved camera was unavailable. Trying the default camera…');
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    }
    if (requestId !== cameraStartId) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStarting = false;
      return;
    }
    stream = cameraStream;
    video.srcObject = stream;
    await video.play();
    preview.classList.add('active');
    const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId || '';
    await refreshCameras(activeDeviceId);
    await trackingSettingsReady;
    stage = 'page';
    if (activeTabId === null) await selectActiveTab();
    if (activeTabId === null) throw new Error('Camera is ready. Switch to a normal http/https website tab, then start hand control again.');
    stage = 'model';
    setStatus('Loading the on-device hand tracking model. First use downloads the model from Google…');
    const vision = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('mediapipe/wasm/'));
    const nextLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: trackingSettings.handConfidence,
      minHandPresenceConfidence: Math.max(0.4, trackingSettings.handConfidence - 0.05),
      minTrackingConfidence: Math.max(0.4, trackingSettings.handConfidence - 0.1),
    });
    if (requestId !== cameraStartId) {
      nextLandmarker.close();
      cameraStarting = false;
      return;
    }
    landmarker = nextLandmarker;
    running = true;
    trackingPaused = false;
    cameraStarting = false;
    stopButton.disabled = false;
    pauseButton.disabled = false;
    pauseButton.textContent = 'Pause';
    cameraDevice.disabled = true;
    keysElement.hidden = mode !== 'keyboard';
    setStatus(mode === 'browse' ? 'Camera is on. Point to move; pinch and release to click, pinch and drag to scroll.' : 'Camera is on. Focus a page text field, then point at an air key and pinch.');
    animationFrame = requestAnimationFrame(frame);
  } catch (error) {
    if (requestId !== cameraStartId) {
      cameraStarting = false;
      return;
    }
    await stopCamera(false);
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      permissionHelpButton.hidden = false;
      setStatus('Chrome did not allow the camera prompt in the side panel. Opening JARVIS camera setup in a full tab…', true);
      void openCameraPermissionSetup();
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      setStatus('No camera was found. Connect or enable a webcam, then retry.', true);
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      setStatus('The camera is busy or blocked by another app. Close Camera, Teams, or Meet, then retry.', true);
    } else if (name === 'OverconstrainedError') {
      setStatus('The selected camera is no longer available. Choose Default camera and retry.', true);
    } else if (stage === 'model') {
      const detail = error instanceof Error ? error.message : String(error);
      if (/content security policy|wasm-(?:unsafe-)?eval|script-src/i.test(detail)) {
        const policy = typeof extensionManifest.content_security_policy === 'string'
          ? extensionManifest.content_security_policy
          : extensionManifest.content_security_policy?.extension_pages ?? '';
        if (!/'wasm-unsafe-eval'/.test(policy)) {
          setStatus(`JARVIS extension v${extensionVersion} is missing WebAssembly permission. Reload or replace it with v${extensionVersion} at chrome://extensions, then reopen Virtual Reality controls.`, true);
        } else {
          setStatus(`JARVIS v${extensionVersion} includes WebAssembly permission, but Chrome blocked it in this session. Reload JARVIS at chrome://extensions, close this panel, and reopen it.`, true);
        }
      } else {
        setStatus(`Camera opened, but the hand model could not load: ${detail}. Check your internet connection and retry.`, true);
      }
    } else {
      setStatus(error instanceof Error ? error.message : 'Could not start hand controls.', true);
    }
    cameraStarting = false;
    startButton.disabled = false;
  }
}

async function stopCamera(showMessage = true): Promise<void> {
  cameraStartId += 1;
  cameraStarting = false;
  running = false;
  cancelAnimationFrame(animationFrame);
  landmarker?.close();
  landmarker = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  preview.classList.remove('active');
  keysElement.hidden = true;
  cursor.style.display = 'none';
  if (activeTabId !== null) void chrome.tabs.sendMessage(activeTabId, { type: 'gesture:off' }).catch(() => {});
  pinchWasDown = false;
  pinchGesture = null;
  pinchCandidate = null;
  pinchStableFrames = 0;
  pinchStart = null;
  previousPinch = null;
  dragDistance = 0;
  scrollRemainder = 0;
  scrollSignPoint = null;
  smoothedPoint = null;
  latestRawPoint = null;
  cursorOffset = { x: 0, y: 0 };
  handVisible = false;
  trackingPaused = false;
  trackingBadge.textContent = 'Hand: waiting';
  centerCursorButton.disabled = true;
  startButton.disabled = false;
  stopButton.disabled = true;
  pauseButton.disabled = true;
  pauseButton.textContent = 'Pause';
  void refreshCameras(trackingSettings.cameraDeviceId);
  if (showMessage) setStatus('Camera is off. Hand tracking has stopped.');
}

$('browseMode').addEventListener('click', () => setMode('browse'));
$('typeMode').addEventListener('click', () => setMode('keyboard'));
startButton.addEventListener('click', () => { void startCamera(); });
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!['vr:start', 'vr:stop', 'vr:pause', 'vr:resume'].includes(message?.type) || typeof sender.tab?.windowId !== 'number') return;
  void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
    if (tab?.windowId !== sender.tab?.windowId) return;
    if (message.type === 'vr:start') {
      setMode('browse');
      if (running) setTrackingPaused(false);
      else void startCamera();
    } else if (message.type === 'vr:stop') {
      void stopCamera();
    } else setTrackingPaused(message.type === 'vr:pause');
  });
});
permissionHelpButton.addEventListener('click', () => {
  void openCameraPermissionSetup();
});

async function openCameraPermissionSetup(): Promise<void> {
  const url = chrome.runtime.getURL('camera-permission.html');
  try {
    const [existing] = await chrome.tabs.query({ url });
    if (typeof existing?.id === 'number') {
      await chrome.tabs.update(existing.id, { active: true });
      if (typeof existing.windowId === 'number') await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
    await chrome.tabs.create({ url, active: true });
  } catch {
    permissionHelpButton.hidden = false;
    setStatus('Could not open camera setup automatically. Use the camera setup button, then allow camera access for JARVIS.', true);
  }
}
stopButton.addEventListener('click', () => { void stopCamera(); });
pauseButton.addEventListener('click', () => setTrackingPaused(!trackingPaused));
document.addEventListener('visibilitychange', () => { if (document.hidden && running) void stopCamera(); });
window.addEventListener('beforeunload', () => { void stopCamera(false); });
void selectActiveTab();
