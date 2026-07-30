/**
 * Global Vitest setup (registered in `angular.json` → `test.options.setupFiles`).
 *
 * JSDOM's `Blob` does not implement `arrayBuffer()`. Production code relies on
 * it (e.g. `pages/rentals/inspection-pdf.service.ts`), so we back-fill it with a
 * real `FileReader`-based read — the bytes returned are the Blob's actual bytes,
 * never a stub. Installed only when the runtime lacks its own implementation, so
 * a browser/Node environment that already provides one keeps it.
 */
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value(this: Blob): Promise<ArrayBuffer> {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () =>
          reject(reader.error ?? new Error('Failed to read Blob as an ArrayBuffer.'));
        reader.readAsArrayBuffer(this);
      });
    },
  });
}
