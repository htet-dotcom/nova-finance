// Minimal PDF 1.4 writer: one full-page raster image per page.
//
// Why raster: Myanmar script needs complex text shaping (reordering, stacked
// medials) that PDF text operators do not perform. Pages are rendered by the
// browser's own shaper onto a canvas with a bundled Myanmar font, then embedded
// losslessly (FlateDecode). Nothing leaves the device.

export interface PdfImage {
  /** Pixel dimensions. */
  width: number;
  height: number;
  /** Zlib-compressed 8-bit RGB samples (FlateDecode) or a JPEG file (DCTDecode). */
  data: Uint8Array;
  filter: 'FlateDecode' | 'DCTDecode';
}

export interface PdfPage {
  image: PdfImage;
  /** Page size in PDF points (1/72 inch). */
  widthPt: number;
  heightPt: number;
}

const enc = new TextEncoder();

/** PDF text string; non-ASCII uses UTF-16BE with BOM (hex) so Myanmar titles survive. */
export function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/([\\()])/g, '\\$1')})`;
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

export function buildPdf(pages: PdfPage[], meta: { title: string; creationDate?: Date } = { title: '' }): Uint8Array {
  if (!pages.length) throw new Error('PDF needs at least one page');
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (id: number, body: () => void) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  // Object ids: 1 catalog, 2 pages, 3 info, then 3 per page (page, content, image).
  const pageId = (i: number) => 4 + i * 3;
  const total = 3 + pages.length * 3;

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary-file marker comment

  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`));
  const d = meta.creationDate ?? new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const date = `D:${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
  obj(3, () => push(`<< /Title ${pdfString(meta.title)} /Producer (Nova Finance) /CreationDate (${date}) >>`));

  pages.forEach((p, i) => {
    const id = pageId(i);
    obj(id, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(p.widthPt)} ${fmt(p.heightPt)}] ` +
          `/Resources << /XObject << /Im${i} ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
      ),
    );
    const content = `q ${fmt(p.widthPt)} 0 0 ${fmt(p.heightPt)} 0 0 cm /Im${i} Do Q`;
    obj(id + 1, () => push(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`));
    obj(id + 2, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${p.image.width} /Height ${p.image.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${p.image.filter} /Length ${p.image.data.length} >>\nstream\n`,
      );
      push(p.image.data);
      push('\nendstream');
    });
  });

  const xref = length;
  let table = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= total; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Zlib-compress bytes with the platform CompressionStream (browsers & Node ≥ 18). */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function canDeflate(): boolean {
  return typeof CompressionStream !== 'undefined';
}

/** RGBA (canvas ImageData) → packed RGB, compositing onto white. */
export function rgbaToRgb(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const a = rgba[i + 3] / 255;
    out[j] = Math.round(rgba[i] * a + 255 * (1 - a));
    out[j + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
    out[j + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
  }
  return out;
}
