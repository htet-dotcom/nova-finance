import { isNative, nativeSaveFile, nativeShare } from './native';

/**
 * Save a Blob/File on the device (never uploaded).
 * Web: browser download. Android app: Documents/NovaFinance, or the share sheet if
 * the device refuses. Returns the folder it was saved to (app only), else null.
 */
export async function downloadBlob(blob: Blob, name: string): Promise<string | null> {
  if (isNative) {
    const where = await nativeSaveFile(blob, name);
    if (where) return where;
    await nativeShare({ files: [new File([blob], name, { type: blob.type })], title: name }).catch(() => undefined);
    return null;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return null;
}

export function downloadText(name: string, content: string, type: string) {
  return downloadBlob(new Blob([content], { type }), name);
}

/** Download several files one after another (browsers may ask once to allow multiple downloads). */
export async function downloadFiles(files: File[]): Promise<string | null> {
  let where: string | null = null;
  for (let i = 0; i < files.length; i++) {
    where = (await downloadBlob(files[i], files[i].name)) ?? where;
    if (i < files.length - 1 && !isNative) await new Promise((r) => window.setTimeout(r, 250));
  }
  return where;
}
