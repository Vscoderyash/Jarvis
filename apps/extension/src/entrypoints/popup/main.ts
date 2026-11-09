/// <reference types="chrome" />

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element #${id}`);
  return element as T;
};

const accessInput = byId<HTMLInputElement>('a');
const message = byId<HTMLElement>('m');
byId<HTMLElement>('version').textContent = `Extension v${chrome.runtime.getManifest().version}`;
const language = byId<HTMLSelectElement>('l');
const replyLanguage = byId<HTMLSelectElement>('rl');
const voice = byId<HTMLSelectElement>('v');
const size = byId<HTMLSelectElement>('z');
const brain = byId<HTMLSelectElement>('br');
const trainingFile = byId<HTMLInputElement>('fi');
let activeWindowId: number | null = null;
const handControls = byId<HTMLButtonElement>('handControls');
handControls.disabled = true;
void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => { activeWindowId = typeof tab?.windowId === 'number' ? tab.windowId : null; handControls.disabled = activeWindowId === null; });
handControls.onclick = () => {
  if (activeWindowId === null || !chrome.sidePanel) { message.textContent = 'Camera controls need Chrome 116 or newer.'; return; }
  void chrome.sidePanel.open({ windowId: activeWindowId }).then(() => window.close()).catch(() => { message.textContent = 'Could not open the Virtual Reality side panel. Try from a normal website tab.'; });
};
byId<HTMLButtonElement>('siteHelp').onclick = () => {
  void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
};
const trainingKeys = ['skills', 'facts', 'aliases', 'exp', 'lessons'];
const getStored = async (keys: string | string[]): Promise<Record<string, unknown>> =>
  await chrome.storage.local.get(keys) as Record<string, unknown>;
const countKeys = (value: unknown): number => value !== null && typeof value === 'object' ? Object.keys(value).length : 0;
const countItems = (value: unknown): number => Array.isArray(value) ? value.length : 0;

void getStored('accessToken').then((value) => { accessInput.value = typeof value.accessToken === 'string' ? value.accessToken : ''; });
byId<HTMLButtonElement>('s').onclick = () => chrome.storage.local.set({ accessToken: accessInput.value.trim() }).then(() => { message.textContent = 'Saved. Provider API keys stay on the server.'; });

byId<HTMLButtonElement>('t').onclick = async () => {
  message.textContent = 'Testing...';
  try {
    const response = await fetch('https://jarvisv02.vercel.app/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(accessInput.value.trim() ? { Authorization: `Bearer ${accessInput.value.trim()}` } : {}) },
      body: JSON.stringify({ mode: 'agent', messages: [{ role: 'user', content: JSON.stringify({ goal: 'say hello', url: 'about:blank', elements: [], history: [] }) }] }),
    });
    const text = await response.text();
    message.textContent = /\{[\s\S]*"action"/.test(text)
      ? 'Agent mode works.'
      : response.ok ? 'Server answered but is NOT in agent mode. Deploy the latest api/chat.js.' : `Error ${response.status}: ${text.slice(0, 120)}`;
  } catch (error) {
    message.textContent = `Cannot reach server: ${error instanceof Error ? error.message : String(error)}`;
  }
};

byId<HTMLButtonElement>('w').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined || !/^https?:/.test(tab.url || '')) {
    message.textContent = 'Open a normal website tab first (Chrome blocks chrome:// pages and the Web Store).';
    return;
  }
  const wake = () => chrome.tabs.sendMessage(tab.id!, { type: 'wake' });
  try {
    try { await wake(); }
    catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-scripts/content.js'] });
      await wake();
    }
    window.close();
  } catch (error) {
    message.textContent = `Chrome could not give JARVIS access to this tab. Open the JARVIS extension details, set Site access to “On all sites”, then refresh the page. Chrome blocks its own settings and store pages. ${error instanceof Error ? error.message : String(error)}`;
  }
};

void getStored('lang').then((value) => { language.value = typeof value.lang === 'string' ? value.lang : ''; });
language.onchange = () => chrome.storage.local.set({ lang: language.value }).then(() => { message.textContent = 'Voice language saved. Refresh your tabs.'; });
void getStored('replyLanguage').then((value) => { replyLanguage.value = typeof value.replyLanguage === 'string' ? value.replyLanguage : ''; });
replyLanguage.onchange = () => chrome.storage.local.set({ replyLanguage: replyLanguage.value }).then(() => { message.textContent = 'Reply and translation language saved.'; });

function fillVoices(): void {
  voice.textContent = '';
  const automatic = document.createElement('option');
  automatic.value = '';
  automatic.textContent = 'Auto (best male voice)';
  voice.appendChild(automatic);
  for (const item of speechSynthesis.getVoices()) {
    const option = document.createElement('option');
    option.value = item.name;
    option.textContent = `${item.name} (${item.lang})`;
    voice.appendChild(option);
  }
  void getStored('voiceName').then((value) => { voice.value = typeof value.voiceName === 'string' ? value.voiceName : ''; });
}

speechSynthesis.onvoiceschanged = fillVoices;
fillVoices();
voice.onchange = () => chrome.storage.local.set({ voiceName: voice.value });
void getStored('size').then((value) => { size.value = typeof value.size === 'string' ? value.size : 'auto'; });
size.onchange = () => chrome.storage.local.set({ size: size.value });
void getStored('companion').then((value) => { byId<HTMLElement>('c').textContent = value.companion ? 'Desktop JARVIS: connected ✓' : 'Desktop JARVIS: not running'; });

async function trainInfo(): Promise<void> {
  const data = await getStored(trainingKeys);
  byId<HTMLElement>('tr').textContent = `Learned: ${countKeys(data.skills)} shortcuts, ${countItems(data.facts)} facts, ${countKeys(data.aliases)} voice fixes, ${countItems(data.exp)} experiences, ${countItems(data.lessons)} lessons`;
}
void trainInfo();
chrome.storage.onChanged.addListener(() => { void trainInfo(); });
void getStored('brain').then((value) => { brain.value = typeof value.brain === 'string' ? value.brain : 'fast'; });
brain.onchange = () => chrome.storage.local.set({ brain: brain.value });

byId<HTMLButtonElement>('ex').onclick = async () => {
  const data = await getStored(trainingKeys);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  link.download = 'jarvis-training.json';
  link.click();
};
byId<HTMLButtonElement>('im').onclick = () => trainingFile.click();
trainingFile.onchange = async () => {
  try {
    const file = trainingFile.files?.[0];
    if (!file) return;
    const imported = JSON.parse(await file.text()) as Record<string, unknown>;
    const values: Record<string, unknown> = {};
    for (const key of trainingKeys) if (imported[key]) values[key] = imported[key];
    await chrome.storage.local.set(values);
    message.textContent = 'Training imported.';
  } catch {
    message.textContent = 'That file is not a JARVIS training file.';
  }
};
byId<HTMLButtonElement>('rs').onclick = async () => {
  if (confirm('Erase everything JARVIS has learned?')) {
    await chrome.storage.local.remove(trainingKeys);
    message.textContent = 'Training erased.';
  }
};
