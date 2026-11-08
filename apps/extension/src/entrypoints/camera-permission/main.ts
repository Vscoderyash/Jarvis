const enable = document.querySelector<HTMLButtonElement>('#enable')!;
const closeButton = document.querySelector<HTMLButtonElement>('#close')!;
const settingsButton = document.querySelector<HTMLButtonElement>('#settings')!;
const status = document.querySelector<HTMLElement>('#status')!;

enable.addEventListener('click', async () => {
  enable.disabled = true;
  status.dataset.error = 'false';
  status.textContent = 'Waiting for Chrome camera permission…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is unavailable in this Chrome window.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach((track) => track.stop());
    status.textContent = 'Camera permission is ready. Return to the JARVIS side panel and press Start camera.';
    enable.textContent = 'Camera ready';
    enable.disabled = true;
  } catch (error) {
    status.dataset.error = 'true';
    const name = error instanceof DOMException ? error.name : '';
    const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
    status.textContent = name === 'NotFoundError' || name === 'DevicesNotFoundError'
      ? 'Chrome could not find a camera. Connect or enable a webcam, then retry.'
      : name === 'NotReadableError' || name === 'TrackStartError'
        ? 'The camera is busy or blocked by another app. Close Camera, Teams, or Meet, then retry.'
        : name === 'NotAllowedError' || name === 'SecurityError'
          ? `Chrome or Windows denied camera access${detail}. Open Chrome camera settings, change JARVIS to Allow, then retry. Also check Windows camera privacy for desktop apps.`
        : error instanceof Error ? error.message : 'Chrome did not grant camera access.';
    enable.disabled = false;
  }
});

settingsButton.addEventListener('click', async () => {
  try {
    await chrome.tabs.create({ url: 'chrome://settings/content/camera', active: true });
  } catch {
    status.dataset.error = 'true';
    status.textContent = 'Open chrome://settings/content/camera in the address bar, then allow camera access for JARVIS.';
  }
});

closeButton.addEventListener('click', async () => {
  const tab = await chrome.tabs.getCurrent();
  if (typeof tab?.id === 'number') await chrome.tabs.remove(tab.id);
  else window.close();
});
