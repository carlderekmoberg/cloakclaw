import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Try extracting PDF text via poppler's pdftotext (much better quality).
 * Falls back to pdfjs-dist if pdftotext isn't installed.
 */
async function extractPDF(buffer) {
  // Try pdftotext first (poppler)
  try {
    const tmp = join(tmpdir(), `cloakclaw-${Date.now()}.pdf`);
    writeFileSync(tmp, buffer);
    const text = execFileSync('pdftotext', ['-layout', tmp, '-'], {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
    });
    try { unlinkSync(tmp); } catch {}
    if (text.trim().length > 0) return text;
  } catch {
    // pdftotext not available, fall through
  }

  // Fallback: pdfjs-dist
  const uint8 = new Uint8Array(buffer);
  const doc = await getDocument({ data: uint8, useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return pages.join('\n\n');
}

/**
 * Extract text from a file buffer based on MIME type.
 * @param {Buffer} buffer - file contents
 * @param {string} filename - original filename
 * @returns {Promise<string>} extracted text
 */
export async function extractText(buffer, filename) {
  const ext = filename.toLowerCase().split('.').pop();

  switch (ext) {
    case 'pdf':
      return extractPDF(buffer);

    case 'txt':
    case 'md':
    case 'csv':
    case 'json':
    case 'xml':
    case 'html':
    case 'htm':
    case 'log':
    case 'env':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'js':
    case 'ts':
    case 'py':
    case 'rb':
    case 'go':
    case 'rs':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'sh':
    case 'sql':
      return buffer.toString('utf-8');

    case 'doc':
    case 'docx': {
      const mammoth = await import('mammoth');
      const result = await mammoth.default.extractRawText({ buffer });
      if (!result.value.trim()) throw new Error('Could not extract text from Word document');
      return result.value;
    }

    default:
      // Try as plain text
      return buffer.toString('utf-8');
  }
}

export const SUPPORTED_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'json', 'xml', 'html', 'log',
  'yaml', 'yml', 'env', 'toml', 'ini', 'js', 'ts', 'py', 'sh', 'sql',
];
