// P11-24: 내장 문서 파서. P11-33이 외부 파서 계층(`parsers/index.ts`)으로
// 감싸고, DocumentViewerTab의 인라인 파싱도 여기로 통합할 예정이다.
import * as pdfjs from 'pdfjs-dist';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { fcReadFileBytes } from '@/lib/commander/ipc';
import { extOf } from '@/lib/commander/openFile';

export const MAX_PARSE_CHARS = 100_000;
const MAX_PDF_PAGES = 20;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function cap(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_PARSE_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_PARSE_CHARS), truncated: true };
}

async function parsePdf(bytes: Uint8Array): Promise<{ text: string; truncated: boolean }> {
  const task = pdfjs.getDocument({ data: toArrayBuffer(bytes) });
  const doc = await task.promise;
  try {
    const parts: string[] = [];
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const line = content.items
        .map((it) => ('str' in it ? (it.str as string) : ''))
        .join(' ');
      parts.push(`[page ${i}]\n${line}`);
      if (parts.join('\n').length > MAX_PARSE_CHARS) break;
    }
    const out = parts.join('\n');
    return {
      ...cap(out),
      truncated: out.length > MAX_PARSE_CHARS || doc.numPages > pages,
    };
  } finally {
    await task.destroy().catch(() => {});
  }
}

async function parseDocx(bytes: Uint8Array): Promise<{ text: string; truncated: boolean }> {
  const out = await mammoth.extractRawText({ arrayBuffer: toArrayBuffer(bytes) });
  return cap(out.value);
}

function parseWorkbook(bytes: Uint8Array): { text: string; truncated: boolean } {
  const wb = XLSX.read(toArrayBuffer(bytes), { type: 'array' });
  const parts: string[] = [];
  for (const name of wb.SheetNames.slice(0, 10)) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
    const lines = rows
      .slice(0, 500)
      .map((r) => (r as unknown[]).slice(0, 50).map((c) => String(c ?? '')).join(' | '));
    parts.push(`[sheet: ${name}]\n${lines.join('\n')}`);
    if (parts.join('\n').length > MAX_PARSE_CHARS) break;
  }
  const out = parts.join('\n\n');
  return {
    ...cap(out),
    truncated: out.length > MAX_PARSE_CHARS || wb.SheetNames.length > 10,
  };
}

async function parsePptx(bytes: Uint8Array): Promise<{ text: string; truncated: boolean }> {
  const zip = await JSZip.loadAsync(toArrayBuffer(bytes));
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return na - nb;
    });
  const parts: string[] = [];
  for (const [idx, name] of slideNames.slice(0, 50).entries()) {
    const xml = await zip.files[name].async('text');
    const texts = Array.from(xml.matchAll(/<a:t>([^<]*)<\/a:t>/g))
      .map((m) => m[1].trim())
      .filter((s) => s.length > 0);
    parts.push(`[slide ${idx + 1}]\n${texts.join('\n')}`);
  }
  const out = parts.join('\n\n');
  return { ...cap(out), truncated: out.length > MAX_PARSE_CHARS };
}

export interface ParsedDocument {
  text: string;
  truncated: boolean;
  method: string;
}

export async function parseDocument(path: string): Promise<ParsedDocument> {
  const ext = extOf(path.split(/[\\/]/).pop() ?? path);
  const res = await fcReadFileBytes(path);
  const raw = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
  switch (ext) {
    case 'pdf': {
      const r = await parsePdf(raw);
      return { ...r, method: 'pdfjs' };
    }
    case 'docx': {
      const r = await parseDocx(raw);
      return { ...r, method: 'mammoth' };
    }
    case 'xlsx':
    case 'xls':
    case 'csv': {
      const r = parseWorkbook(raw);
      return { ...r, method: 'sheetjs' };
    }
    case 'pptx': {
      const r = await parsePptx(raw);
      return { ...r, method: 'pptx-outline' };
    }
    default: {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
      return { ...cap(text), method: 'text' };
    }
  }
}
