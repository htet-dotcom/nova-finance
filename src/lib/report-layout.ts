// Pure pagination/layout for report pages. Produces draw operations; painting
// happens in report-render.ts (canvas). Measuring is injected so this module is
// testable without a browser and never drops or clips a transaction.

import { activeDays, money, rowAmountText, type Report, type ReportFormatters, type ReportLabels } from './report';

export interface Font {
  size: number;
  weight: 400 | 700;
}

export type Op =
  | { kind: 'text'; x: number; y: number; text: string; font: Font; color: string; align: 'left' | 'right' }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string };

export interface Page {
  width: number;
  height: number;
  ops: Op[];
  /** Report row keys whose full entry is drawn on this page. */
  rowKeys: string[];
}

export interface Geometry {
  width: number;
  height: number;
  margin: number;
  /** Base font size in px. */
  base: number;
  /** Shrink the last page to its content (PNG) instead of keeping a fixed size (PDF). */
  trimLast: boolean;
}

export const PDF_GEOMETRY: Geometry = { width: 1240, height: 1754, margin: 88, base: 22, trimLast: false }; // A4 @150dpi
export const PNG_GEOMETRY: Geometry = { width: 1080, height: 1920, margin: 64, base: 28, trimLast: true };

export type Measure = (text: string, font: Font) => number;

const C = {
  text: '#0f172a',
  muted: '#64748b',
  income: '#15803d',
  expense: '#b45309',
  rule: '#e2e8f0',
  band: '#f1f5f9',
  accent: '#0f766e',
  warn: '#b45309',
};

// ---------------------------------------------------------------------------
// Text wrapping (Myanmar has no spaces between words; use Intl.Segmenter when available)
// ---------------------------------------------------------------------------

function segments(text: string, granularity: 'word' | 'grapheme'): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return Array.from(new Seg('my', { granularity }).segment(text), (s) => s.segment);
  return granularity === 'word' ? text.split(/(\s+)/).filter(Boolean) : Array.from(text);
}

export function wrapText(text: string, maxWidth: number, font: Font, measure: Measure): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const seg of segments(para, 'word')) {
      if (measure(line + seg, font) <= maxWidth) {
        line += seg;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = '';
      const piece = seg.trimStart();
      if (measure(piece, font) <= maxWidth) {
        line = piece;
        continue;
      }
      // A single segment wider than the line: break by grapheme cluster (keeps Myanmar syllables intact).
      for (const g of segments(piece, 'grapheme')) {
        if (measure(line + g, font) > maxWidth && line) {
          lines.push(line);
          line = '';
        }
        line += g;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface Block {
  height: number;
  draw: (y: number, ops: Op[]) => void;
  rowKey?: string;
  /** Re-emitted at the top of a continuation page (table headers). */
  repeatable?: Block;
  keepWithNext?: boolean;
}

export function layoutReport(r: Report, L: ReportLabels, f: ReportFormatters, g: Geometry, measure: Measure): Page[] {
  const B = g.base;
  const font = {
    title: { size: Math.round(B * 1.6), weight: 700 } as Font,
    h2: { size: Math.round(B * 1.1), weight: 700 } as Font,
    body: { size: B, weight: 400 } as Font,
    bold: { size: B, weight: 700 } as Font,
    small: { size: Math.round(B * 0.82), weight: 400 } as Font,
    big: { size: Math.round(B * 1.35), weight: 700 } as Font,
  };
  const lh = (fnt: Font) => Math.round(fnt.size * 1.75); // generous: Myanmar stacks above/below
  const left = g.margin;
  const right = g.width - g.margin;
  const contentW = right - left;
  const blocks: Block[] = [];
  const s = r.summary;

  const textBlock = (text: string, fnt: Font, color = C.text, gapAfter = 0): Block => {
    const lines = wrapText(text, contentW, fnt, measure);
    return {
      height: lines.length * lh(fnt) + gapAfter,
      draw: (y, ops) => lines.forEach((t, i) => ops.push({ kind: 'text', x: left, y: y + i * lh(fnt), text: t, font: fnt, color, align: 'left' })),
    };
  };
  const spacer = (h: number): Block => ({ height: h, draw: () => {} });
  const kvLine = (label: string, value: string, color = C.text, fnt = font.body): Block => {
    const valW = Math.min(measure(value, fnt), contentW * 0.6);
    const labelLines = wrapText(label, contentW - valW - B, fnt, measure);
    return {
      height: labelLines.length * lh(fnt),
      draw: (y, ops) => {
        labelLines.forEach((t, i) => ops.push({ kind: 'text', x: left, y: y + i * lh(fnt), text: t, font: fnt, color: C.muted, align: 'left' }));
        ops.push({ kind: 'text', x: right, y, text: value, font: fnt, color, align: 'right' });
      },
    };
  };
  const heading = (text: string): Block => {
    const inner = textBlock(text, font.h2, C.accent);
    return {
      height: inner.height + Math.round(B * 0.6),
      keepWithNext: true,
      draw: (y, ops) => {
        inner.draw(y, ops);
        const ly = y + inner.height + Math.round(B * 0.2);
        ops.push({ kind: 'line', x1: left, y1: ly, x2: right, y2: ly, color: C.rule });
      },
    };
  };

  // --- header -------------------------------------------------------------------
  blocks.push(textBlock(`${L.appName} — ${r.kind === 'daily' ? L.dailyTitle : L.monthlyTitle}`, font.title, C.text));
  blocks.push(textBlock(`${L.period}: ${f.periodLabel(r)}`, font.bold));
  blocks.push(textBlock(`${L.generated}: ${f.dateTime(r.generatedAt)} · ${L.currencyNote(r.currency)}`, font.small, C.muted, B));

  // --- totals band ----------------------------------------------------------------
  const totals: [string, string, string][] = [
    [L.totalIncome, money(r, s.totalIncome), C.income],
    [L.totalExpense, money(r, s.totalExpense), C.expense],
    [L.net, money(r, s.net), s.net < 0 ? C.expense : C.text],
  ];
  const colW = contentW / 3;
  const labelLines = totals.map(([l]) => wrapText(l, colW - B, font.small, measure));
  const maxLabel = Math.max(...labelLines.map((x) => x.length));
  const bandH = Math.round(B * 0.8) * 2 + maxLabel * lh(font.small) + lh(font.big);
  blocks.push({
    height: bandH + B,
    draw: (y, ops) => {
      ops.push({ kind: 'rect', x: left, y, w: contentW, h: bandH, color: C.band });
      totals.forEach(([, value, color], i) => {
        const x = left + i * colW + Math.round(B * 0.8);
        labelLines[i].forEach((t, j) => ops.push({ kind: 'text', x, y: y + Math.round(B * 0.8) + j * lh(font.small), text: t, font: font.small, color: C.muted, align: 'left' }));
        ops.push({ kind: 'text', x, y: y + Math.round(B * 0.8) + maxLabel * lh(font.small), text: value, font: font.big, color, align: 'left' });
      });
    },
  });
  if (r.kind === 'monthly') blocks.push(kvLine(L.averageDaily, money(r, s.averageDailySpending)));
  blocks.push(kvLine(L.transactions, L.count(r.rows.length)));
  if (s.missingRateCurrencies.length) blocks.push(textBlock(`⚠ ${L.missingRates(s.missingRateCurrencies.join(', '))}`, font.small, C.warn));
  if (r.upcomingExcluded) blocks.push(textBlock(`ℹ ${L.upcomingExcluded(r.upcomingExcluded)}`, font.small, C.muted));
  blocks.push(spacer(B));

  // --- category breakdowns ------------------------------------------------------------
  const catSection = (title: string, lines: Report['expenseByCategory'], color: string) => {
    if (!lines.length) return;
    blocks.push(heading(title));
    for (const c of lines) {
      const kv = kvLine(`${c.name} · ${Math.round(c.share * 100)}% · ${L.count(c.count)}`, money(r, c.amount), color);
      const barH = Math.max(4, Math.round(B * 0.25));
      blocks.push({
        height: kv.height + barH + Math.round(B * 0.5),
        draw: (y, ops) => {
          kv.draw(y, ops);
          const by = y + kv.height;
          ops.push({ kind: 'rect', x: left, y: by, w: contentW, h: barH, color: C.band });
          ops.push({ kind: 'rect', x: left, y: by, w: Math.max(2, contentW * Math.min(1, c.share)), h: barH, color });
        },
      });
    }
    blocks.push(spacer(B));
  };
  catSection(L.expenseByCategory, r.expenseByCategory, C.expense);
  catSection(L.incomeByCategory, r.incomeByCategory, C.income);

  // --- daily totals (monthly) ----------------------------------------------------------
  if (r.kind === 'monthly') {
    const days = activeDays(r);
    if (days.length) {
      blocks.push(heading(L.dailyTotals));
      for (const d of days) blocks.push(kvLine(f.date(d.date), `+${money(r, d.income)}  /  -${money(r, d.expense)}`));
      blocks.push(spacer(B));
    }
  }

  // --- transactions ------------------------------------------------------------------
  const txHeading = heading(L.transactions);
  const amountColW = Math.round(contentW * 0.42);
  const leftColW = contentW - amountColW - B;
  const tableHead: Block = {
    height: lh(font.small),
    keepWithNext: true,
    draw: (y, ops) => {
      ops.push({ kind: 'text', x: left, y, text: `${L.category} / ${L.note}`, font: font.small, color: C.muted, align: 'left' });
      ops.push({ kind: 'text', x: right, y, text: L.amount, font: font.small, color: C.muted, align: 'right' });
    },
  };
  txHeading.repeatable = tableHead;
  blocks.push(txHeading);
  blocks.push({ ...tableHead });
  if (!r.rows.length) blocks.push(textBlock(L.noTransactions, font.body, C.muted));
  let lastDate = '';
  for (const row of r.rows) {
    if (r.kind === 'monthly' && row.date !== lastDate) {
      const dh = textBlock(f.date(row.date), font.bold, C.text);
      blocks.push({ ...dh, height: dh.height + Math.round(B * 0.2), keepWithNext: true, repeatable: tableHead });
      lastDate = row.date;
    }
    const kind = row.type === 'income' ? L.income : L.expense;
    const missing = row.currency !== r.currency && row.primaryAmount === null ? ` · ${L.noRate}` : '';
    const title = wrapText(`${row.categoryName} · ${kind}${row.recurring ? ` · ↻ ${L.recurring}` : ''}${missing}`, leftColW, font.bold, measure);
    const note = row.note ? wrapText(row.note, leftColW, font.small, measure) : [];
    const amount = wrapText(rowAmountText(r, row), amountColW, font.bold, measure);
    const color = row.type === 'income' ? C.income : C.text;
    const contentH = Math.max(title.length * lh(font.bold) + note.length * lh(font.small), amount.length * lh(font.bold));
    const pad = Math.round(B * 0.35);
    blocks.push({
      height: contentH + pad * 2,
      rowKey: row.key,
      repeatable: tableHead,
      draw: (y, ops) => {
        let yy = y + pad;
        title.forEach((t) => {
          ops.push({ kind: 'text', x: left, y: yy, text: t, font: font.bold, color: C.text, align: 'left' });
          yy += lh(font.bold);
        });
        note.forEach((t) => {
          ops.push({ kind: 'text', x: left, y: yy, text: t, font: font.small, color: C.muted, align: 'left' });
          yy += lh(font.small);
        });
        amount.forEach((t, i) => ops.push({ kind: 'text', x: right, y: y + pad + i * lh(font.bold), text: t, font: font.bold, color, align: 'right' }));
        ops.push({ kind: 'line', x1: left, y1: y + contentH + pad * 2, x2: right, y2: y + contentH + pad * 2, color: C.rule });
      },
    });
  }
  return paginate(blocks, g, font.small, lh(font.small), L, f, r);
}

function paginate(blocks: Block[], g: Geometry, footFont: Font, footH: number, L: ReportLabels, f: ReportFormatters, r: Report): Page[] {
  const top = g.margin;
  const bottom = g.height - g.margin - footH - Math.round(g.base * 0.8); // reserve footer
  const pages: Page[] = [];
  let page: Page = { width: g.width, height: g.height, ops: [], rowKeys: [] };
  let y = top;
  let lastY = top;

  const newPage = (repeat?: Block) => {
    pages.push(page);
    page = { width: g.width, height: g.height, ops: [], rowKeys: [] };
    y = top;
    // Running header so loose pages stay identifiable.
    const header = `${L.appName} — ${r.kind === 'daily' ? L.dailyTitle : L.monthlyTitle} · ${f.periodLabel(r)}`;
    page.ops.push({ kind: 'text', x: g.margin, y, text: header, font: footFont, color: C.muted, align: 'left' });
    y += footH + Math.round(g.base * 0.4);
    if (repeat) {
      repeat.draw(y, page.ops);
      y += repeat.height;
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // Keep headings with the following block.
    const need = b.keepWithNext && blocks[i + 1] ? b.height + Math.min(blocks[i + 1].height, bottom - top) : b.height;
    if (y + need > bottom && y > top + footH * 2) newPage(b.repeatable && !b.keepWithNext ? b.repeatable : undefined);
    // A block taller than a whole page cannot occur for valid data (notes are capped at 500
    // characters); if it ever did, it is still drawn rather than dropped.
    b.draw(y, page.ops);
    if (b.rowKey) page.rowKeys.push(b.rowKey);
    y += b.height;
    lastY = y;
  }
  pages.push(page);
  if (g.trimLast) {
    const last = pages[pages.length - 1];
    last.height = Math.min(g.height, Math.max(lastY + footH * 2 + g.margin, Math.round(g.height * 0.3)));
  }
  // Footer with page numbers, inside the reserved strip below `bottom`.
  pages.forEach((p, i) => {
    const fy = p.height - g.margin - footH;
    p.ops.push({ kind: 'line', x1: g.margin, y1: fy - Math.round(g.base * 0.3), x2: g.width - g.margin, y2: fy - Math.round(g.base * 0.3), color: C.rule });
    p.ops.push({ kind: 'text', x: g.margin, y: fy, text: L.footer, font: footFont, color: C.muted, align: 'left' });
    p.ops.push({ kind: 'text', x: g.width - g.margin, y: fy, text: L.page(i + 1, pages.length), font: footFont, color: C.muted, align: 'right' });
  });
  return pages;
}
