import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

type Point = { x: number; y: number };
type Key = { label: string; value: string; kind?: 'shift' | 'backspace' };
type GestureMode = 'browse' | 'keyboard';

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
const permissionHelpButton = $('permissionHelp') as HTMLButtonElement;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const rows: Key[][] = [
  [...'QWERTYUIOP'].map((value) => ({ label: value, value: value.toLowerCase() })),
  [...'ASDFGHJKL'].map((value) => ({ label: value, value: value.toLowerCase() })),
  [{ label: '⇧', value: '', kind: 'shift' }, ...[...'ZXCVBNM'].map((value) => ({ label: value, value: value.toLowerCase() })), { label: '⌫', value: '', kind: 'backspace' }],
  [{ label: 'SPACE', value: ' ' }],
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
let pinchStart: Point | null = null;
let previousPinch: Point | null = null;
let dragDistance = 0;
let scrollRemainder = 0;
let lastScroll = 0;
let airShift = false;
let activeKey: { row: number; col: number } | null = null;

function setStatus(message: string, error = false): void {
  statusElement.textContent = message;
  statusElement.dataset.kind = error ? 'error' : 'normal';
}

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
  if (mode === 'browse' && running) setStatus('Browse mode: point to move, pinch and release to click, pinch and drag to scroll.');
  if (mode === 'keyboard' && running) setStatus('Air keyboard ready. Focus a text box on the page, then point at a key and pinch.');
  activeKey = null;
  airShift = false;
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
      setStatus('JARVIS cannot control this protected browser page. Try a normal website tab.', true);
      return;
    }
  }
  if (running && mode === 'browse') setStatus(`Hand controls ready on ${tab.title || 'the active tab'}.`);
}

chrome.tabs.onActivated.addListener(() => { void selectActiveTab(); });
chrome.windows.onFocusChanged.addListener(() => { void selectActiveTab(); });

function keyAt(point: Point): { row: number; col: number } | null {
  if (point.y < 0.47) return null;
  const row = clamp(Math.floor(((point.y - 0.47) / 0.49) * rows.length), 0, rows.length - 1);
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
    pinchWasDown = false;
    pinchStart = null;
    previousPinch = null;
    dragDistance = 0;
    scrollRemainder = 0;
    updateKeyHighlight(null);
    if (mode === 'browse') cursor.style.display = 'none';
    setCameraStatus('Show one hand to the camera, palm facing toward you.', now);
    return;
  }

  // Mirror the normalized camera coordinates so movement matches the mirrored preview.
  const point = { x: clamp(1 - hand[8].x, 0, 1), y: clamp(hand[8].y, 0, 1) };
  const pinchDistance = Math.hypot(hand[4].x - hand[8].x, hand[4].y - hand[8].y);
  const pinching = pinchWasDown ? pinchDistance < 0.075 : pinchDistance < 0.052;

  if (mode === 'keyboard') {
    const hovered = keyAt(point);
    updateKeyHighlight(hovered);
    if (pinching && !pinchWasDown && hovered) void pressAirKey(hovered);
    pinchWasDown = pinching;
    return;
  }

  if (now - lastCursor > 75) {
    lastCursor = now;
    updateCameraPoint(point);
    void sendToActivePage({ type: 'gesture:cursor', nx: point.x, ny: point.y });
  }

  if (pinching && !pinchWasDown) {
    pinchStart = point;
    previousPinch = point;
    dragDistance = 0;
    scrollRemainder = 0;
  } else if (pinching && pinchWasDown && previousPinch && pinchStart) {
    const dy = point.y - previousPinch.y;
    scrollRemainder += dy;
    dragDistance += Math.abs(dy);
    if (dragDistance > 0.035 && Math.abs(scrollRemainder) > 0.008 && now - lastScroll > 80) {
      lastScroll = now;
      void sendToActivePage({ type: 'gesture:scroll', nx: point.x, ny: point.y, delta: -scrollRemainder * 1.25 });
      scrollRemainder = 0;
    }
    previousPinch = point;
  } else if (!pinching && pinchWasDown && pinchStart) {
    if (dragDistance <= 0.035) {
      void sendToActivePage({ type: 'gesture:click', nx: point.x, ny: point.y }).then((result) => {
        if (result?.ok === false) setStatus(String(result.message || 'Pinch click was not accepted.'), true);
        else if (result?.ok) setStatus('Pinch click sent to the active page.');
      });
    }
    pinchStart = null;
    previousPinch = null;
    dragDistance = 0;
    scrollRemainder = 0;
  }
  pinchWasDown = pinching;
}

function frame(now: number): void {
  if (!running) return;
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastFrame > 75 && landmarker) {
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
    const cameraRequest = navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    const cameraStream = await cameraRequest;
    if (requestId !== cameraStartId) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStarting = false;
      return;
    }
    stream = cameraStream;
    video.srcObject = stream;
    await video.play();
    preview.classList.add('active');
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
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.55,
    });
    if (requestId !== cameraStartId) {
      nextLandmarker.close();
      cameraStarting = false;
      return;
    }
    landmarker = nextLandmarker;
    running = true;
    cameraStarting = false;
    stopButton.disabled = false;
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
    } else if (stage === 'model') {
      setStatus(`Camera opened, but the hand model could not load: ${error instanceof Error ? error.message : String(error)}. Check your internet connection and retry.`, true);
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
  pinchStart = null;
  previousPinch = null;
  startButton.disabled = false;
  stopButton.disabled = true;
  if (showMessage) setStatus('Camera is off. Hand tracking has stopped.');
}

$('browseMode').addEventListener('click', () => setMode('browse'));
$('typeMode').addEventListener('click', () => setMode('keyboard'));
startButton.addEventListener('click', () => { void startCamera(); });
chrome.runtime.onMessage.addListener((message, sender) => {
  if ((message?.type !== 'vr:start' && message?.type !== 'vr:stop') || typeof sender.tab?.windowId !== 'number') return;
  void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
    if (tab?.windowId !== sender.tab?.windowId) return;
    if (message.type === 'vr:start') {
      setMode('browse');
      void startCamera();
    } else {
      void stopCamera();
    }
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
document.addEventListener('visibilitychange', () => { if (document.hidden && running) void stopCamera(); });
window.addEventListener('beforeunload', () => { void stopCamera(false); });
void selectActiveTab();
