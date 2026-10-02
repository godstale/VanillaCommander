import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { fcOpenDefault, fcReadFileBytes } from '@/lib/commander/ipc';
import type { DocKind } from '@/lib/commander/openFile';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PDF_PAGES = 50;
const MAX_SHEET_ROWS = 500;
const MAX_SHEET_COLS = 50;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function PdfPage({ doc, pageNum }: { doc: pdfjs.PDFDocumentProxy; pageNum: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    void doc.getPage(pageNum).then(async (page) => {
      if (!active) return;
      const viewport = page.getViewport({ scale: 1.25 });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvas, viewport }).promise;
    });
    return () => {
      active = false;
    };
  }, [doc, pageNum]);

  return (
    <canvas
      ref={canvasRef}
      className="max-w-full h-auto border border-border bg-white shadow-xs"
    />
  );
}

interface SlideOutline {
  index: number;
  texts: string[];
}

function extractPptxOutline(bytes: Uint8Array): Promise<{ slides: SlideOutline[]; imageCount: number }> {
  return JSZip.loadAsync(toArrayBuffer(bytes)).then((zip) => {
    const slideNames = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => {
        const na = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0);
        const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0);
        return na - nb;
      });
    const imageCount = Object.keys(zip.files).filter((n) => n.startsWith('ppt/media/')).length;
    return Promise.all(
      slideNames.map(async (name, idx) => {
        const xml = await zip.files[name].async('text');
        const texts = Array.from(xml.matchAll(/<a:t>([^<]*)<\/a:t>/g))
          .map((m) => m[1].trim())
          .filter((s) => s.length > 0);
        return { index: idx + 1, texts } as SlideOutline;
      }),
    ).then((slides) => ({ slides, imageCount }));
  });
}

interface SheetData {
  name: string;
  rows: string[][];
}

function parseWorkbook(bytes: Uint8Array): SheetData[] {
  const wb = XLSX.read(toArrayBuffer(bytes), { type: 'array' });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
    return {
      name,
      rows: rows.slice(0, MAX_SHEET_ROWS).map((r) => r.slice(0, MAX_SHEET_COLS).map((c) => String(c ?? ''))),
    };
  });
}

function SheetTable({ sheet }: { sheet: SheetData }) {
  if (sheet.rows.length === 0) return null;
  return (
    <table className="w-full text-xs border-collapse">
      <tbody>
        {sheet.rows.map((row, i) => (
          <tr key={i} className="border-b border-border/50">
            {row.map((cell, j) => (
              <td key={j} className="px-2 py-1 border-r border-border/30 last:border-r-0 truncate max-w-64">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DocumentViewerTab({ tab }: { tab: WorkspaceTab }) {
  const { t } = useLanguage();
  const filePath = (tab.meta?.filePath as string) ?? '';
  const docKind = (tab.meta?.docKind as DocKind) ?? 'pdf';
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pdfPages, setPdfPages] = useState(0);
  const [html, setHtml] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [slides, setSlides] = useState<SlideOutline[]>([]);
  const [imageCount, setImageCount] = useState(0);

  useEffect(() => {
    let active = true;
    let loadTask: pdfjs.PDFDocumentLoadingTask | null = null;
    void fcReadFileBytes(filePath)
      .then(async (res) => {
        if (!active) return;
        setTruncated(res.truncated);
        const raw = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
        if (docKind === 'pdf') {
          loadTask = pdfjs.getDocument({ data: toArrayBuffer(raw) });
          const doc = await loadTask.promise;
          if (!active) {
            await loadTask.destroy();
            return;
          }
          setPdfDoc(doc);
          setPdfPages(doc.numPages);
        } else if (docKind === 'docx') {
          const out = await mammoth.convertToHtml({ arrayBuffer: toArrayBuffer(raw) });
          if (active) setHtml(out.value);
        } else if (docKind === 'xlsx' || docKind === 'csv') {
          if (active) setSheets(parseWorkbook(raw));
        } else if (docKind === 'pptx') {
          const outline = await extractPptxOutline(raw);
          if (active) {
            setSlides(outline.slides);
            setImageCount(outline.imageCount);
          }
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (loadTask) void loadTask.destroy();
    };
  }, [filePath, docKind]);

  const openExternal = () => {
    void fcOpenDefault(filePath).catch(() => {});
  };

  return (
    <div className="flex flex-col h-full w-full min-h-0 bg-editor">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
        <span className="text-xs font-medium truncate flex-1" title={filePath}>
          {fileName}
        </span>
        <Button variant="outline" size="sm" onClick={openExternal} className="text-xs h-7 gap-1.5">
          <ExternalLink className="h-3.5 w-3.5" />
          {t('viewers.openDefault')}
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {loading ? (
          <p className="text-xs text-muted-foreground">{t('explorer.loading')}</p>
        ) : error ? (
          <p className="text-xs text-destructive">{t('viewers.loadFailed', { err: error })}</p>
        ) : (
          <>
            {truncated && (
              <p className="text-xs text-warning mb-3">{t('viewers.tooLarge')}</p>
            )}
            {docKind === 'pdf' && pdfDoc && (
              <div className="flex flex-col gap-4 items-start">
                {Array.from({ length: Math.min(pdfPages, MAX_PDF_PAGES) }, (_, i) => (
                  <PdfPage key={i + 1} doc={pdfDoc} pageNum={i + 1} />
                ))}
                {pdfPages > MAX_PDF_PAGES && (
                  <p className="text-xs text-muted-foreground">
                    {t('viewers.pagesCapped', { shown: String(MAX_PDF_PAGES), total: String(pdfPages) })}
                  </p>
                )}
              </div>
            )}
            {docKind === 'docx' && html !== null && (
              <div
                className="prose prose-sm dark:prose-invert max-w-none text-sm"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
            {(docKind === 'xlsx' || docKind === 'csv') && (
              <div className="space-y-2">
                {sheets.length > 1 && (
                  <div className="flex gap-1 flex-wrap">
                    {sheets.map((s, i) => (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => setActiveSheet(i)}
                        className={
                          i === activeSheet
                            ? 'px-2 py-1 text-xs rounded bg-primary/15 text-foreground font-medium'
                            : 'px-2 py-1 text-xs rounded text-muted-foreground hover:bg-accent/40'
                        }
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
                {sheets[activeSheet] && <SheetTable sheet={sheets[activeSheet]} />}
              </div>
            )}
            {docKind === 'pptx' && (
              <div className="space-y-4">
                {imageCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('viewers.images', { n: String(imageCount) })}
                  </p>
                )}
                {slides.map((slide) => (
                  <div key={slide.index} className="rounded-lg border border-border p-3">
                    <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">
                      {t('viewers.slide', { n: String(slide.index) })}
                    </p>
                    {slide.texts.length === 0 ? (
                      <p className="text-xs text-muted-foreground/60">—</p>
                    ) : (
                      slide.texts.map((line, i) => (
                        <p key={i} className="text-sm mb-1">{line}</p>
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default DocumentViewerTab;
