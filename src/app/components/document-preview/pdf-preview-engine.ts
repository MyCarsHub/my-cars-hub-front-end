import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/** Tamanho de uma página na escala 1 do pdf.js (1 unidade = 1px CSS a 72dpi). */
export interface PdfPageSize {
  readonly width: number;
  readonly height: number;
}

/** Um PDF aberto. Feche com `destroy()` — o worker segura memória até lá. */
export interface PdfHandle {
  readonly numPages: number;
  pageSizes(): Promise<PdfPageSize[]>;
  /**
   * Desenha a página `pageNumber` (1-based) em `canvas` para ocupar `cssWidth` pixels CSS.
   * Um render anterior no MESMO canvas é cancelado. Resolve `false` quando foi cancelado.
   */
  render(pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number): Promise<boolean>;
  /**
   * Devolve a memória de um canvas que saiu da janela de rolagem: cancela o render em voo
   * e zera o bitmap (`width`/`height` = 0). Um PDF longo no celular acumularia dezenas de
   * bitmaps de página até a aba morrer. Redesenhe com `render()` quando a página voltar.
   */
  release(canvas: HTMLCanvasElement): void;
  destroy(): void;
}

/**
 * Teto de pixels por canvas. O iOS Safari recusa (canvas em branco) acima de ~16,7M px por
 * canvas e derruba a aba quando a soma passa do limite de memória; 3:1 de folga.
 */
const MAX_CANVAS_PIXELS = 5_500_000;
/** Telas 3x desenham a 2x: o ganho visual não paga o triplo de memória por página. */
const MAX_DEVICE_PIXEL_RATIO = 2;

/**
 * Fronteira de carregamento do pdf.js — o mesmo desenho do `DocxPreviewEngine`:
 *
 * 1. **Bundle.** `pdfjs-dist` (~520 kB) só entra quando alguém abre um PDF. Este arquivo é
 *    o ÚNICO importador, e por `import()` dinâmico; o guard
 *    `scripts/assert-initial-bundle.mjs` reprova o build se ele aparecer no grafo inicial.
 * 2. **Testabilidade.** O spec do visualizador troca esta classe por DI.
 *
 * POR QUE pdf.js E NÃO `<iframe src=pdf>`: o Chrome do Android não renderiza PDF em
 * iframe (baixa o arquivo) e o Safari do iOS mostra só a primeira página. O build
 * `legacy` cobre iPhones mais antigos que o build moderno deixaria em branco.
 *
 * O worker, as fontes padrão e os decodificadores wasm são copiados para
 * `assets/pdfjs/` pelo `angular.json` (mesma versão do pacote, por construção). O wasm
 * depende de `'wasm-unsafe-eval'`, que a CSP do app NÃO concede: o pdf.js cai sozinho no
 * fallback em JS (`*_nowasm_fallback.js`), que também está lá.
 */
@Injectable({ providedIn: 'root' })
export class PdfPreviewEngine {
  private readonly document = inject(DOCUMENT);

  async open(data: ArrayBuffer): Promise<PdfHandle> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const base = new URL('assets/pdfjs/', this.document.baseURI).href;
    pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;

    const task = pdfjs.getDocument({
      data: new Uint8Array(data),
      // Sem `isEvalSupported`: o pdf.js 6 não tem mais caminho de `eval`/`new Function`
      // (o vetor do CVE-2024-4367) — conferido no worker empacotado, zero ocorrências.
      enableXfa: false,
      standardFontDataUrl: `${base}standard_fonts/`,
      wasmUrl: `${base}wasm/`,
    });
    const doc = await task.promise;
    const running = new Map<HTMLCanvasElement, { cancel(): void }>();

    return {
      numPages: doc.numPages,
      async pageSizes() {
        const sizes: PdfPageSize[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale: 1 });
          sizes.push({ width: viewport.width, height: viewport.height });
        }
        return sizes;
      },
      async render(pageNumber, canvas, cssWidth) {
        running.get(canvas)?.cancel();
        const page = await doc.getPage(pageNumber);
        const base1 = page.getViewport({ scale: 1 });
        const dpr = Math.min(globalThis.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
        let scale = (cssWidth / base1.width) * dpr;
        const pixels = base1.width * base1.height * scale * scale;
        if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
        const viewport = page.getViewport({ scale });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const task = page.render({ canvas, viewport });
        running.set(canvas, task);
        try {
          await task.promise;
          return true;
        } catch (err) {
          if (err instanceof Error && err.name === 'RenderingCancelledException') return false;
          throw err;
        } finally {
          if (running.get(canvas) === task) running.delete(canvas);
        }
      },
      release(canvas) {
        running.get(canvas)?.cancel();
        running.delete(canvas);
        canvas.width = 0;
        canvas.height = 0;
      },
      destroy() {
        for (const task of running.values()) task.cancel();
        running.clear();
        void task.destroy();
      },
    };
  }
}

/** `true` quando o pdf.js recusou por senha — a cópia muda ("baixe para abrir"). */
export function isPdfPasswordError(err: unknown): boolean {
  return err instanceof Error && err.name === 'PasswordException';
}
