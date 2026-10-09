/** Save a Blob/File to the device via a temporary object URL (never leaves the device). */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(name: string, content: string, type: string) {
  downloadBlob(new Blob([content], { type }), name);
}

/** Download several files one after another (browsers may ask once to allow multiple downloads). */
export async function downloadFiles(files: File[]) {
  for (let i = 0; i < files.length; i++) {
    downloadBlob(files[i], files[i].name);
    if (i < files.length - 1) await new Promise((r) => window.setTimeout(r, 250));
  }
}
