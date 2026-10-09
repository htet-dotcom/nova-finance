// Browser-side report file generation (canvas → PNG / PDF, plus TXT).
// Runs fully offline: fonts are bundled and precached by the service worker.

import myanmar400 from '@fontsource/noto-sans-myanmar/files/noto-sans-myanmar-myanmar-400-normal.woff2?url';
import myanmar700 from '@fontsource/noto-sans-myanmar/files/noto-sans-myanmar-myanmar-700-normal.woff2?url';
import latin400 from '@fontsource/noto-sans-myanmar/files/noto-sans-myanmar-latin-400-normal.woff2?url';
import latin700 from '@fontsource/noto-sans-myanmar/files/noto-sans-myanmar-latin-700-normal.woff2?url';
import { buildPdf, canDeflate, deflate, rgbaToRgb, type PdfImage } from './pdf';
import { buildReportText, type Report, type ReportFormatters, type ReportLabels } from './report';
import { layoutReport, PDF_GEOMETRY, PNG_GEOMETRY, type Font, type Geometry, type Page } from './report-layout';

export type ReportFormat = 'pdf' | 'txt' | 'png';

export const REPORT_FONT_FAMILY = 'Nova Report';
const MYANMAR_RANGE = 'U+1000-109F, U+200C-200D, U+25CC, U+A9E0-A9FF, U+AA60-AA7F';
const LATIN_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

let fontsReady: Promise<void> | null = null;

/** Load the bundled Myanmar + Latin report fonts (never relies on system fonts for Myanmar). */
export function loadReportFonts(): Promise<void> {
  if (!fontsReady) {
    const faces = [
      new FontFace(REPORT_FONT_FAMILY, `url(${myanmar400}) format('woff2')`, { weight: '400', unicodeRange: MYANMAR_RANGE }),
      new FontFace(REPORT_FONT_FAMILY, `url(${myanmar700}) format('woff2')`, { weight: '700', unicodeRange: MYANMAR_RANGE }),
      new FontFace(REPORT_FONT_FAMILY, `url(${latin400}) format('woff2')`, { weight: '400', unicodeRange: LATIN_RANGE }),
      new FontFace(REPORT_FONT_FAMILY, `url(${latin700}) format('woff2')`, { weight: '700', unicodeRange: LATIN_RANGE }),
    ];
    fontsReady = Promise.all(
      faces.map(async (f) => {
        await f.load();
        document.fonts.add(f);
      }),
    ).then(
      () => undefined,
      (e) => {
        fontsReady = null; // allow a retry
        throw e;
      },
    );
  }
  return fontsReady;
}

export const cssFont = (f: Font) => `${f.weight} ${f.size}px "${REPORT_FONT_FAMILY}", "Noto Sans", "Segoe UI", Roboto, sans-serif`;

function makeMeasure() {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const cache = new Map<string, number>();
  return (text: string, font: Font) => {
    const k = `${font.weight}/${font.size}/${text}`;
    let w = cache.get(k);
    if (w === undefined) {
      ctx.font = cssFont(font);
      w = ctx.measureText(text).width;
      cache.set(k, w);
    }
    return w;
  };
}

export function paintPage(page: Page): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = page.width;
  canvas.height = page.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, page.width, page.height);
  ctx.textBaseline = 'alphabetic';
  for (const op of page.ops) {
    if (op.kind === 'rect') {
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else if (op.kind === 'line') {
      ctx.strokeStyle = op.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.stroke();
    } else {
      ctx.font = cssFont(op.font);
      ctx.fillStyle = op.color;
      ctx.textAlign = op.align;
      // Ops use a top-left origin per 1.75× line box; the baseline sits ~1.2em down,
      // leaving room for Myanmar marks stacked above and below.
      ctx.fillText(op.text, op.x, op.y + op.font.size * 1.2);
    }
  }
  return canvas;
}

export function layoutFor(report: Report, labels: ReportLabels, f: ReportFormatters, g: Geometry): Page[] {
  return layoutReport(report, labels, f, g, makeMeasure());
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Canvas export failed'))), type, q));

export function reportBaseName(r: Report): string {
  return r.kind === 'daily' ? `nova-finance-daily-${r.range.start}` : `nova-finance-monthly-${r.range.start.slice(0, 7)}`;
}

export async function generateReportFiles(report: Report, labels: ReportLabels, f: ReportFormatters, format: ReportFormat): Promise<File[]> {
  const base = reportBaseName(report);
  if (format === 'txt') {
    const text = buildReportText(report, labels, f);
    // UTF-8 with BOM so older editors detect the encoding of Myanmar text.
    return [new File(['﻿', text], `${base}.txt`, { type: 'text/plain;charset=utf-8' })];
  }
  await loadReportFonts();
  if (format === 'png') {
    const pages = layoutFor(report, labels, f, PNG_GEOMETRY);
    const files: File[] = [];
    for (let i = 0; i < pages.length; i++) {
      const blob = await toBlob(paintPage(pages[i]), 'image/png');
      const suffix = pages.length > 1 ? `-p${i + 1}of${pages.length}` : '';
      files.push(new File([blob], `${base}${suffix}.png`, { type: 'image/png' }));
    }
    return files;
  }
  // PDF
  const pages = layoutFor(report, labels, f, PDF_GEOMETRY);
  const pdfPages = [];
  for (const page of pages) {
    const canvas = paintPage(page);
    let image: PdfImage;
    if (canDeflate()) {
      const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      image = { width: canvas.width, height: canvas.height, data: await deflate(rgbaToRgb(rgba)), filter: 'FlateDecode' };
    } else {
      // Old browsers without CompressionStream: high-quality JPEG (slightly lossy, still readable).
      const jpg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.95)).arrayBuffer());
      image = { width: canvas.width, height: canvas.height, data: jpg, filter: 'DCTDecode' };
    }
    pdfPages.push({ image, widthPt: (page.width * 72) / 150, heightPt: (page.height * 72) / 150 });
  }
  const title = `${labels.appName} — ${report.kind === 'daily' ? labels.dailyTitle : labels.monthlyTitle}`;
  const bytes = buildPdf(pdfPages, { title });
  return [new File([bytes as BlobPart], `${base}.pdf`, { type: 'application/pdf' })];
}
