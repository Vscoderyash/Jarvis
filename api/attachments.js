const MAX_ATTACHMENTS = 8;
// Keep base64 JSON requests safely below Vercel Functions' 4.5 MB request limit.
const MAX_TOTAL_BYTES = 3_300_000;
const MAX_EXTRACTED_CHARS = 80_000;
const MAX_PDF_PAGES = 100;
const MAX_DOCX_UNCOMPRESSED_BYTES = 20_000_000;
const { inflateRawSync } = require('node:zlib');

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.mdx', '.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.ipynb', '.xml', '.html', '.htm', '.svg', '.css', '.js', '.mjs', '.cjs',
  '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.go', '.rs', '.rb', '.php', '.sql',
  '.sh', '.bat', '.ps1', '.yml', '.yaml', '.toml', '.ini', '.log', '.diff', '.patch', '.env.example', '.ipynb',
  '.rtf', '.rst', '.properties', '.tex', '.lua', '.swift', '.kt', '.scala', '.dart', '.vue', '.svelte', '.astro', '.graphql',
  '.proto', '.gradle', '.dockerfile', '.makefile', '.readme', '.license', '.notice', '.procfile', '.justfile', '.gitignore', '.npmrc', '.nvmrc', '.editorconfig', '.conf', '.lock',
]);
const NAMED_TEXT_FILES = new Map([
  ['dockerfile', '.dockerfile'], ['makefile', '.makefile'], ['readme', '.readme'], ['license', '.license'], ['notice', '.notice'],
  ['procfile', '.procfile'], ['justfile', '.justfile'], ['.gitignore', '.gitignore'], ['.npmrc', '.npmrc'], ['.nvmrc', '.nvmrc'], ['.editorconfig', '.editorconfig'],
]);
const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function safeName(value) {
  const name = String(value || 'attachment').replace(/\\/g, '/').split('/').pop().replace(/[\r\n\0]/g, '').trim();
  return name.slice(0, 120) || 'attachment';
}

function extensionForName(value) {
  const base = String(value || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
  if (base.endsWith('.env.example')) return '.env.example';
  return NAMED_TEXT_FILES.get(base) || require('node:path').extname(base);
}

function hasMagic(ext, buffer) {
  if (ext === '.pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (ext === '.docx') return buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
  if (ext === '.png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === '.jpg' || ext === '.jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (ext === '.webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (ext === '.gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (ext === '.pptx' || ext === '.xlsx' || ext === '.zip') return buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
  return true;
}

function readZipDirectory(buffer) {
  const min = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = Math.max(0, buffer.length - 22); offset >= min; offset--) {
    if (offset + 22 <= buffer.length && buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { eocd = offset; break; }
  }
  if (eocd < 0) throw badRequest('The DOCX file is not a valid Word document.');
  const count = buffer.readUInt16LE(eocd + 10), directorySize = buffer.readUInt32LE(eocd + 12), directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (count > 5000) throw badRequest('The Office document contains too many items to read safely.');
  if (directorySize === 0xffffffff || directoryOffset === 0xffffffff || directoryOffset + directorySize > eocd) throw badRequest('The DOCX file uses an unsupported ZIP layout.');
  let offset = directoryOffset, total = 0;
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > directoryOffset + directorySize || buffer.readUInt32LE(offset) !== 0x02014b50) throw badRequest('The Office file is not a valid document.');
    const compressed = buffer.readUInt32LE(offset + 20), expanded = buffer.readUInt32LE(offset + 24);
    if (expanded === 0xffffffff) throw badRequest('The DOCX file uses an unsupported ZIP64 layout.');
    total += expanded;
    if (total > MAX_DOCX_UNCOMPRESSED_BYTES) throw badRequest('The uncompressed DOCX content is too large to read safely.');
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > directoryOffset + directorySize) throw badRequest('The Office file is not a valid document.');
    entries.push({
      name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'),
      method: buffer.readUInt16LE(offset + 10),
      flags: buffer.readUInt16LE(offset + 8),
      compressed,
      expanded,
      localOffset: buffer.readUInt32LE(offset + 42),
    });
    offset = next;
  }
  return entries;
}

function readZipText(buffer, entry) {
  if (!entry || entry.expanded > MAX_DOCX_UNCOMPRESSED_BYTES || entry.flags & 1) return '';
  const offset = entry.localOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) return '';
  const dataOffset = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
  if (dataOffset + entry.compressed > buffer.length) return '';
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressed);
  let bytes;
  if (entry.method === 0) bytes = compressed;
  else if (entry.method === 8) bytes = inflateRawSync(compressed, { maxOutputLength: MAX_DOCX_UNCOMPRESSED_BYTES });
  else return '';
  return bytes.length === entry.expanded ? bytes.toString('utf8') : '';
}

function decodeXml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, key) => {
    if (key === 'amp') return '&';
    if (key === 'lt') return '<';
    if (key === 'gt') return '>';
    if (key === 'quot') return '"';
    if (key === 'apos') return "'";
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

function xmlTags(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(xml.matchAll(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'g')), match => decodeXml(match[1].replace(/<[^>]*>/g, '')).trim());
}

function officeText(ext, buffer, entries) {
  if (ext === '.zip') {
    return entries.filter(entry => {
      const path = entry.name.toLowerCase();
      return !path.endsWith('/') && !/(^|\/)(node_modules|\.git|dist|build)\//.test(path) && TEXT_EXTENSIONS.has(extensionForName(path));
    }).slice(0, 300).map(entry => `--- ${entry.name} ---\n${readZipText(buffer, entry)}`).join('\n\n');
  }
  if (ext === '.pptx') {
    return entries.filter(entry => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((entry, index) => `Slide ${index + 1}: ${xmlTags(readZipText(buffer, entry), 'a:t').join(' ')}`)
      .join('\n\n');
  }
  const shared = entries.find(entry => entry.name === 'xl/sharedStrings.xml');
  const strings = shared ? Array.from(readZipText(buffer, shared).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), match => xmlTags(match[1], 't').join('')) : [];
  return entries.filter(entry => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((entry, index) => {
      const xml = readZipText(buffer, entry);
      const rows = Array.from(xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g), row => Array.from(row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g), cell => {
        const type = cell[1].match(/\bt="([^"]+)"/), value = cell[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        if (type && type[1] === 'inlineStr') return xmlTags(cell[2], 't').join('');
        if (!value) return '';
        const raw = decodeXml(value[1]);
        return type && type[1] === 's' ? (strings[Number(raw)] || '') : raw;
      }).filter(Boolean).join(' | '));
      return `Sheet ${index + 1}:\n${rows.join('\n')}`;
    }).join('\n\n');
}

function decodeAttachment(input) {
  if (!input || typeof input !== 'object' || typeof input.data !== 'string') throw badRequest('Each attachment must include base64 file data.');
  const name = safeName(input.name);
  const lower = name.toLowerCase();
  const ext = extensionForName(lower);
  const allowed = TEXT_EXTENSIONS.has(ext) || IMAGE_TYPES.has(ext) || ['.pdf', '.docx', '.pptx', '.xlsx', '.zip'].includes(ext);
  if (!allowed) throw badRequest(`Unsupported file type: ${name}`);
  if (!input.data || input.data.length > Math.ceil(MAX_TOTAL_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data) || input.data.length % 4 !== 0) {
    throw badRequest(`Invalid or oversized file data: ${name}`);
  }
  const buffer = Buffer.from(input.data, 'base64');
  const mime = IMAGE_TYPES.get(ext) || (ext === '.pdf' ? 'application/pdf' : ext === '.docx' ? DOCX_TYPE : 'text/plain');
  if (buffer.length === 0) throw badRequest(`The file is empty: ${name}`);
  if (!hasMagic(ext, buffer)) throw badRequest(`The file contents do not match its file type: ${name}`);
  const zipEntries = ['.docx', '.pptx', '.xlsx', '.zip'].includes(ext) ? readZipDirectory(buffer) : null;
  if (zipEntries && !zipEntries.length) throw badRequest(`The file is not a valid ZIP or Office document: ${name}`);
  return { name, ext, mime, buffer, zipEntries };
}

async function extractPdf(buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PDF_PAGES) throw badRequest(`PDF has more than ${MAX_PDF_PAGES} pages.`);
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => typeof item.str === 'string' ? item.str : '').join(' '));
      page.cleanup();
    }
    return pages.join('\n\n').trim();
  } finally {
    await task.destroy();
  }
}

async function readAttachments(inputs) {
  if (inputs === undefined) return { documents: [], images: [] };
  if (!Array.isArray(inputs) || inputs.length > MAX_ATTACHMENTS) throw badRequest(`Attach up to ${MAX_ATTACHMENTS} files at a time.`);
  const decoded = inputs.map(decodeAttachment);
  const totalBytes = decoded.reduce((sum, file) => sum + file.buffer.length, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw badRequest('Attachments exceed the 3.3 MB total size limit.');

  const documents = [];
  const images = [];
  let remaining = MAX_EXTRACTED_CHARS;
  for (const file of decoded) {
    if (IMAGE_TYPES.has(file.ext)) {
      images.push({ name: file.name, mime: file.mime, data: file.buffer.toString('base64') });
      continue;
    }
    let text;
    try {
      if (file.ext === '.pdf') text = await extractPdf(file.buffer);
      else if (file.ext === '.docx') text = (await require('mammoth').extractRawText({ buffer: file.buffer })).value;
      else if (['.pptx', '.xlsx', '.zip'].includes(file.ext)) text = officeText(file.ext, file.buffer, file.zipEntries);
      else text = new TextDecoder('utf-8').decode(file.buffer);
    } catch (error) {
      if (error && error.statusCode === 400) throw error;
      throw badRequest(`Could not read ${file.name}. Check that it is a valid PDF, Word, PowerPoint, Excel, or text file.`);
    }
    text = String(text || '').replace(/\0/g, '').trim();
    if (!text) throw badRequest(`${file.name} has no readable text. Scanned PDFs need OCR before JARVIS can read them.`);
    const excerpt = text.slice(0, Math.max(0, remaining));
    const note = remaining <= 0 ? '[Text omitted because the combined file text limit was reached.]' : text.length > excerpt.length ? '\n[Text truncated to stay within the request limit.]' : '';
    documents.push({ name: file.name, text: excerpt + note });
    remaining -= excerpt.length;
  }
  return { documents, images };
}

module.exports = { MAX_ATTACHMENTS, MAX_TOTAL_BYTES, MAX_EXTRACTED_CHARS, readAttachments };
