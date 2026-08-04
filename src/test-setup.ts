/**
 * Global Vitest setup (registered in `angular.json` → `test.options.setupFiles`).
 *
 * JSDOM's `Blob` does not implement `arrayBuffer()`. Production code relies on
 * it (e.g. `pages/rentals/inspection-pdf.service.ts`), so we back-fill it with a
 * real `FileReader`-based read — the bytes returned are the Blob's actual bytes,
 * never a stub. Installed only when the runtime lacks its own implementation, so
 * a browser/Node environment that already provides one keeps it.
 */
/**
 * JSDOM não implementa `Element.prototype.scrollIntoView` (é layout, e JSDOM não
 * faz layout). Código de produção usa (`pages/rentals/rental-detail.ts` traz o
 * banner de erro de ativação pro campo de visão), então o stub mora AQUI — no
 * setup de teste — e não como um `typeof === 'function'` no componente. É no-op
 * de propósito: sem layout não há o que rolar; specs que precisam observar a
 * chamada usam `vi.spyOn(Element.prototype, 'scrollIntoView')`.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value(): void {
      /* no-op: JSDOM não faz layout */
    },
  });
}

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
