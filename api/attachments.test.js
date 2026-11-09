import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAX_TOTAL_BYTES, readAttachments } from './attachments.js';

const base64 = value => Buffer.from(value).toString('base64');

function makePdf(text) {
  const stream = `BT /F1 18 Tf 20 200 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  const parts = ['%PDF-1.4\n'];
  const offsets = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(parts.join('')));
    parts.push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
  }
  const xref = Buffer.byteLength(parts.join(''));
  parts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  parts.push(offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join(''));
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return Buffer.from(parts.join(''), 'binary');
}

function makeZip(files) {
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const { name, text } of files) {
    const filename = Buffer.from(name), data = Buffer.from(text), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, data);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

describe('uploaded attachments', () => {
  it('extracts UTF-8 text without persisting it elsewhere', async () => {
    const result = await readAttachments([{ name: 'notes.txt', data: base64('Hello JARVIS') }]);
    expect(result.documents).toEqual([{ name: 'notes.txt', text: 'Hello JARVIS' }]);
    expect(result.images).toEqual([]);
  });

  it('accepts common extensionless project files', async () => {
    const result = await readAttachments([{ name: 'Dockerfile', data: base64('FROM node:22') }]);
    expect(result.documents[0]).toEqual({ name: 'Dockerfile', text: 'FROM node:22' });
  });

  it('extracts nested source files and extensionless config from a ZIP project bundle', async () => {
    const bundle = makeZip([
      { name: 'demo/src/index.ts', text: 'export const answer = 42;' },
      { name: 'demo/Dockerfile', text: 'FROM node:22' },
    ]);
    const result = await readAttachments([{ name: 'demo-folder.zip', data: bundle.toString('base64') }]);
    expect(result.documents[0].text).toContain('--- demo/src/index.ts ---\nexport const answer = 42;');
    expect(result.documents[0].text).toContain('--- demo/Dockerfile ---\nFROM node:22');
  });

  it('extracts readable PDF text', async () => {
    const result = await readAttachments([{ name: 'report.pdf', data: makePdf('Jarvis PDF test').toString('base64') }]);
    expect(result.documents[0].text).toContain('Jarvis PDF test');
  });

  it('extracts Word document text', async () => {
    const docx = readFileSync(new URL('./test/fixtures/minimal.docx', import.meta.url)).toString('base64');
    const result = await readAttachments([{ name: 'notes.docx', data: docx }]);
    expect(result.documents[0].text).toContain('JARVIS DOCX extraction test');
  });

  it('passes image bytes through with an extension-derived safe MIME type', async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
    const result = await readAttachments([{ name: 'screen.png', mime: 'text/plain', data: png }]);
    expect(result.images).toEqual([{ name: 'screen.png', mime: 'image/png', data: png }]);
  });

  it('rejects unsupported file types and oversized uploads', async () => {
    await expect(readAttachments([{ name: 'program.exe', data: base64('no') }])).rejects.toThrow('Unsupported file type');
    const tooLarge = Buffer.alloc(MAX_TOTAL_BYTES + 1).toString('base64');
    await expect(readAttachments([{ name: 'large.txt', data: tooLarge }])).rejects.toThrow('Attachments exceed the 3.3 MB total size limit');
  });
});
