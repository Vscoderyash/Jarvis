import { access, copyFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'apps/extension/.output');
const extensionPackage = JSON.parse(await readFile(resolve(root, 'apps/extension/package.json'), 'utf8'));
const archive = `jarvisextension-${extensionPackage.version}-chrome.zip`;
const archivePath = resolve(output, archive);

await access(archivePath).catch(() => {
  throw new Error(`Expected the current WXT Chromium archive at ${archivePath}.`);
});

const destination = resolve(root, 'jarvis-extension.zip');
await copyFile(archivePath, destination);
console.log(`Updated ${destination}`);
