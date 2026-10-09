import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { buildPdf, deflate, pdfString, rgbaToRgb } from '../../src/lib/pdf';

async function page(w: number, h: number, rgb: [number, number, number]) {
  const raw = new Uint8Array(w * h * 3);
  for (let i = 0; i < raw.length; i += 3) raw.set(rgb, i);
  return { image: { width: w, height: h, data: await deflate(raw), filter: 'FlateDecode' as const }, widthPt: 595.28, heightPt: 841.89 };
}

describe('PDF writer', () => {
  it('produces a valid multi-page PDF that pdf.js can open', async () => {
    const bytes = buildPdf([await page(40, 56, [255, 255, 255]), await page(40, 56, [10, 20, 30]), await page(40, 56, [200, 0, 0])], {
      title: 'Nova Finance — လစဉ် စာရင်းချုပ်',
    });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.4');
    expect(new TextDecoder('latin1').decode(bytes.slice(-6))).toBe('%%EOF\n');
    const doc = await getDocument({ data: bytes.slice() }).promise;
    expect(doc.numPages).toBe(3);
    const p1 = await doc.getPage(1);
    const vp = p1.getViewport({ scale: 1 });
    expect(Math.round(vp.width)).toBe(595);
    expect(Math.round(vp.height)).toBe(842);
    const ops = await p1.getOperatorList();
    expect(ops.fnArray).toContain(OPS.paintImageXObject);
    const meta = await doc.getMetadata();
    expect((meta.info as { Title: string }).Title).toBe('Nova Finance — လစဉ် စာရင်းချုပ်');
  });

  it('xref offsets point at the right objects', async () => {
    const bytes = buildPdf([await page(4, 4, [0, 0, 0])], { title: 'x' });
    const text = new TextDecoder('latin1').decode(bytes);
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = text.slice(startxref).split('\n').slice(3).filter((l) => / n $/.test(l));
    entries.forEach((e, i) => expect(text.slice(Number(e.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it('rejects an empty document', () => {
    expect(() => buildPdf([], { title: '' })).toThrow();
  });

  it('encodes non-ASCII titles as UTF-16BE', () => {
    expect(pdfString('Report (1)')).toBe('(Report \\(1\\))');
    expect(pdfString('ကျပ်')).toBe('<FEFF1000103B1015103A>');
  });

  it('composites transparent pixels onto white', () => {
    expect([...rgbaToRgb(new Uint8Array([0, 0, 0, 0, 10, 20, 30, 255]))]).toEqual([255, 255, 255, 10, 20, 30]);
  });
});
