import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoggerService } from '../../services/logger.service';
import { DocumentPreviewViewer } from './document-preview-viewer';
import type { DocumentPreviewGallery, DocumentPreviewItem } from './document-preview.types';
import { DocxPreviewEngine } from './docx-preview-engine';
import { PdfHandle, PdfPreviewEngine } from './pdf-preview-engine';

/**
 * O sujeito é o visualizador DE VERDADE: só as duas fronteiras de biblioteca (pdf.js e
 * docx-preview, ambas atrás de `import()` dinâmico, que não resolve no runner) são
 * trocadas por DI (`PdfPreviewEngine`, `DocxPreviewEngine`).
 */
describe('DocumentPreviewViewer', () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  let fixture: ComponentFixture<DocumentPreviewViewer>;
  let pdfHandle: PdfHandle & {
    render: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  let pdfOpen: ReturnType<typeof vi.fn>;
  let docxToSafeHtml: ReturnType<typeof vi.fn>;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let anchorClicks: HTMLAnchorElement[];
  let closed: number;

  const el = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement | null;

  async function settle(): Promise<void> {
    for (let i = 0; i < 8; i++) {
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  async function open(request: DocumentPreviewGallery | DocumentPreviewItem): Promise<void> {
    fixture = TestBed.createComponent(DocumentPreviewViewer);
    const gallery = 'items' in request ? request : { items: [request] };
    fixture.componentRef.setInput('request', gallery);
    closed = 0;
    fixture.componentInstance.closeRequested.subscribe(() => closed++);
    fixture.detectChanges();
    await settle();
  }

  function key(k: string, opts: KeyboardEventInit = {}): void {
    el('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));
    fixture.detectChanges();
  }

  beforeEach(() => {
    pdfHandle = {
      numPages: 3,
      pageSizes: vi.fn().mockResolvedValue([
        { width: 595, height: 842 },
        { width: 595, height: 842 },
        { width: 595, height: 842 },
      ]),
      render: vi.fn().mockResolvedValue(true),
      release: vi.fn((canvas: HTMLCanvasElement) => {
        canvas.width = 0;
        canvas.height = 0;
      }),
      destroy: vi.fn(),
    } as never;
    pdfOpen = vi.fn().mockResolvedValue(pdfHandle);
    docxToSafeHtml = vi.fn().mockResolvedValue('<div class="docx-wrapper"><p>Cláusula 1ª</p></div>');
    let n = 0;
    createObjectURL = vi.fn(() => `blob:test/${++n}`);
    revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    anchorClicks = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      anchorClicks.push(this);
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: PdfPreviewEngine, useValue: { open: pdfOpen } },
        { provide: DocxPreviewEngine, useValue: { toSafeHtml: docxToSafeHtml } },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  describe('abrir e fechar', () => {
    it('é um diálogo modal com título, e o painel recebe o foco', async () => {
      await open({ source: new Blob([PDF]), fileName: 'Laudo', title: 'Laudo de vistoria' });

      const dialog = el('[role="dialog"]')!;
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      const titleId = dialog.getAttribute('aria-labelledby')!;
      expect(fixture.nativeElement.querySelector(`#${titleId}`).textContent).toContain(
        'Laudo de vistoria',
      );
      expect(document.activeElement).toBe(dialog);
    });

    it('fecha pelo X, pelo Esc e pelo clique no fundo', async () => {
      await open({ source: new Blob([PDF]), fileName: 'Laudo' });

      el('[data-preview-close]')!.click();
      key('Escape');
      el('[data-preview-backdrop]')!.click();

      expect(closed).toBe(3);
    });

    it('prende o Tab dentro do modal (último → primeiro, Shift+Tab no primeiro → último)', async () => {
      await open({ source: new Blob([PNG]), fileName: 'Foto' });
      const focusables = Array.from(
        el('[role="dialog"]')!.querySelectorAll<HTMLElement>('button:not([disabled])'),
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      last.focus();
      key('Tab');
      expect(document.activeElement).toBe(first);

      first.focus();
      key('Tab', { shiftKey: true });
      expect(document.activeElement).toBe(last);
    });

    /** Decisão do dono (FEAT-0358): o modal é o único jeito de ver; nada de aba nova. */
    it('não oferece "abrir em nova aba" em nenhum formato e nunca chama window.open', async () => {
      const windowOpen = vi.spyOn(window, 'open');
      for (const bytes of [PDF, PNG, DOCX]) {
        await open({ source: new Blob([bytes]), fileName: 'Arquivo' });
        const labels = Array.from(
          el('[role="dialog"]')!.querySelectorAll<HTMLElement>('button, a'),
        ).map((b) => `${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`.toLowerCase());
        expect(labels.some((l) => l.includes('nova aba'))).toBe(false);
        for (const button of Array.from(
          el('[role="dialog"]')!.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
        )) {
          if (button.hasAttribute('data-preview-close')) continue;
          button.click();
        }
        fixture.destroy();
      }
      expect(windowOpen).not.toHaveBeenCalled();
    });

    it('trava a rolagem do body e devolve no destroy; revoga os object URLs', async () => {
      document.body.style.overflow = 'auto';
      await open({ source: new Blob([PNG]), fileName: 'Foto' });
      expect(document.body.style.overflow).toBe('hidden');
      const created = createObjectURL.mock.results.map((r) => r.value);
      expect(created.length).toBeGreaterThan(0);

      fixture.destroy();

      expect(document.body.style.overflow).toBe('auto');
      for (const url of created) expect(revokeObjectURL).toHaveBeenCalledWith(url);
    });
  });

  describe('PDF', () => {
    it('renderiza com pdf.js página a página e mostra "1 de 3"', async () => {
      await open({ source: () => Promise.resolve(new Blob([PDF])), fileName: 'Laudo' });

      expect(pdfOpen).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.querySelectorAll('[data-preview-pdf] canvas').length).toBe(3);
      expect(el('[data-preview-page]')!.textContent).toContain('1 de 3');
      // Sem IntersectionObserver no JSDOM: as primeiras páginas são desenhadas direto.
      expect(pdfHandle.render).toHaveBeenCalled();
      expect(pdfHandle.render.mock.calls[0][0]).toBe(1);
    });

    it('página que sai da janela libera o canvas e é redesenhada quando volta', async () => {
      // IntersectionObserver controlado: o JSDOM não tem layout para decidir sozinho.
      let notify: (entries: Partial<IntersectionObserverEntry>[]) => void = () => undefined;
      class FakeObserver {
        constructor(cb: (entries: Partial<IntersectionObserverEntry>[]) => void) {
          notify = cb;
        }
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      }
      vi.stubGlobal('IntersectionObserver', FakeObserver);
      try {
        await open({ source: new Blob([PDF]), fileName: 'Laudo' });
        const canvases = Array.from(
          fixture.nativeElement.querySelectorAll('[data-preview-pdf] canvas'),
        ) as HTMLCanvasElement[];
        const page3 = canvases[2];

        notify([{ target: page3, isIntersecting: true }]);
        await settle();
        const rendersOfPage3 = () => pdfHandle.render.mock.calls.filter((c) => c[0] === 3).length;
        expect(rendersOfPage3()).toBe(1);
        page3.width = 800;
        page3.height = 1100;

        notify([{ target: page3, isIntersecting: false }]);
        expect(pdfHandle.release).toHaveBeenCalledWith(page3);
        expect(page3.width).toBe(0);
        expect(page3.height).toBe(0);

        notify([{ target: page3, isIntersecting: true }]);
        await settle();
        expect(rendersOfPage3()).toBe(2);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('zoom pelos botões muda a largura da página e respeita os limites', async () => {
      await open({ source: new Blob([PDF]), fileName: 'Laudo' });
      const page = () => (fixture.nativeElement.querySelector('.dp-page') as HTMLElement).style.width;
      const before = parseFloat(page());

      el('[data-preview-zoom-in]')!.click();
      fixture.detectChanges();
      expect(parseFloat(page())).toBeGreaterThan(before);
      expect(el('[data-preview-zoom-reset]')!.textContent).toContain('125%');

      el('[data-preview-zoom-reset]')!.click();
      fixture.detectChanges();
      expect(el('[data-preview-zoom-reset]')!.textContent).toContain('100%');

      for (let i = 0; i < 10; i++) el('[data-preview-zoom-out]')!.click();
      fixture.detectChanges();
      expect((el('[data-preview-zoom-out]') as HTMLButtonElement).disabled).toBe(true);
    });

    it('PDF que o pdf.js recusa cai no erro com "Baixar arquivo"', async () => {
      pdfOpen.mockRejectedValue(new Error('Invalid PDF structure'));
      await open({ source: new Blob([PDF]), fileName: 'Laudo' });

      expect(el('[data-preview-state="error"]')).not.toBeNull();
      expect(el('[data-preview-download-alt]')).not.toBeNull();
    });

    it('fechar destrói o documento do pdf.js', async () => {
      await open({ source: new Blob([PDF]), fileName: 'Laudo' });
      fixture.destroy();
      expect(pdfHandle.destroy).toHaveBeenCalled();
    });
  });

  describe('baixar', () => {
    it('a extensão vem dos BYTES: PDF declarado como .docx sai .pdf', async () => {
      await open({
        source: new Blob([PDF]),
        fileName: 'Contrato-r1.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      el('[data-preview-download]')!.click();

      expect(anchorClicks).toHaveLength(1);
      expect(anchorClicks[0].download).toBe('Contrato-r1.pdf');
      expect(anchorClicks[0].href).toMatch(/^blob:/);
    });

    it('revoga o object URL do download logo depois do clique, sem esperar o fechar', async () => {
      await open({ source: new Blob([PDF]), fileName: 'Laudo' });
      vi.useFakeTimers();
      try {
        el('[data-preview-download]')!.click();
        const url = anchorClicks[0].href;
        expect(revokeObjectURL).not.toHaveBeenCalledWith(url);

        vi.advanceTimersByTime(1000);

        expect(revokeObjectURL).toHaveBeenCalledWith(url);
        // O PDF em exibição não usa object URL; o do download não é revogado de novo.
        revokeObjectURL.mockClear();
        fixture.destroy();
        expect(revokeObjectURL).not.toHaveBeenCalledWith(url);
      } finally {
        vi.useRealTimers();
      }
    });

    it('DOCX de verdade sai .docx', async () => {
      await open({ source: new Blob([DOCX]), fileName: 'Contrato-r1' });
      el('[data-preview-download]')!.click();
      expect(anchorClicks[0].download).toBe('Contrato-r1.docx');
    });

    it('fica desabilitado enquanto não há bytes', async () => {
      await open({ source: () => new Promise<Blob>(() => undefined), fileName: 'CNH' });
      expect((el('[data-preview-download]') as HTMLButtonElement).disabled).toBe(true);
      expect(el('[data-preview-state="loading"]')).not.toBeNull();
    });
  });

  describe('DOCX', () => {
    it('vai SANEADO para um iframe sandbox vazio com CSP no srcdoc', async () => {
      await open({ source: new Blob([DOCX]), fileName: 'Contrato' });

      const frame = el('[data-preview-docx]') as HTMLIFrameElement;
      expect(frame).not.toBeNull();
      expect(frame.getAttribute('sandbox')).toBe('');
      expect(frame.srcdoc).toContain('Content-Security-Policy');
      expect(frame.srcdoc).toContain('Cláusula 1ª');
      expect(docxToSafeHtml).toHaveBeenCalledTimes(1);
    });

    it('foco dentro do iframe volta ao painel: Esc e o Tab preso continuam funcionando', async () => {
      await open({ source: new Blob([DOCX]), fileName: 'Contrato' });
      const frame = el('[data-preview-docx]') as HTMLIFrameElement;
      const dialog = el('[role="dialog"]')!;

      expect(frame.getAttribute('tabindex')).toBe('-1');
      frame.focus();
      frame.dispatchEvent(new FocusEvent('focus'));

      expect(document.activeElement).toBe(dialog);
      key('Escape');
      expect(closed).toBe(1);
    });

    it('acima do teto de render vira "arquivo grande" só com Baixar', async () => {
      const big = new Blob([DOCX]);
      Object.defineProperty(big, 'size', { value: 9 * 1024 * 1024 });
      await open({ source: big, fileName: 'Contrato' });

      expect(el('[data-preview-state="large"]')).not.toBeNull();
      expect(el('[data-preview-force]')).toBeNull();
      expect(docxToSafeHtml).not.toHaveBeenCalled();
    });
  });

  describe('estados', () => {
    it('erro do carregador mostra a mensagem do servidor e "Tentar de novo" recarrega', async () => {
      const loader = vi
        .fn()
        .mockReturnValueOnce(
          throwError(() => new HttpErrorResponse({ status: 500, statusText: 'x' })),
        )
        .mockReturnValueOnce(Promise.resolve({ url: 'https://storage.test/ok.pdf' }));
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(PDF, { status: 200 }));

      await open({ source: loader, fileName: 'CNH', errorMessage: 'Não foi possível abrir o documento.' });
      expect(el('[data-preview-state="error"]')!.textContent).toContain(
        'Não foi possível abrir o documento.',
      );

      el('[data-preview-retry]')!.click();
      await settle();

      expect(loader).toHaveBeenCalledTimes(2);
      // A signed URL é buscada SEM credenciais do app.
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://storage.test/ok.pdf',
        expect.objectContaining({ credentials: 'omit' }),
      );
      expect(el('[data-preview-state="error"]')).toBeNull();
      expect(fixture.nativeElement.querySelectorAll('[data-preview-pdf] canvas').length).toBe(3);
    });

    it('signed URL expirada (403 do storage) diz para tentar de novo', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 403 }));
      await open({ source: 'https://storage.test/expirado.pdf', fileName: 'Apólice' });
      expect(el('[data-preview-state="error"]')!.textContent).toContain('expirou');
    });

    it('PDF grande avisa e deixa visualizar mesmo assim', async () => {
      const big = new Blob([PDF]);
      Object.defineProperty(big, 'size', { value: 30 * 1024 * 1024 });
      await open({ source: big, fileName: 'Laudo' });
      expect(el('[data-preview-state="large"]')!.textContent).toContain('30 MB');

      el('[data-preview-force]')!.click();
      await settle();

      expect(el('[data-preview-state="large"]')).toBeNull();
      expect(pdfOpen).toHaveBeenCalledTimes(1);
    });

    it('formato desconhecido não tenta renderizar e oferece Baixar', async () => {
      await open({ source: new Blob(['texto']), fileName: 'notas.txt' });
      expect(el('[data-preview-state="unsupported"]')).not.toBeNull();
      expect(pdfOpen).not.toHaveBeenCalled();
      expect(docxToSafeHtml).not.toHaveBeenCalled();
    });
  });

  describe('galeria', () => {
    const photos: DocumentPreviewItem[] = ['Frente', 'Traseira', 'Lateral', 'Painel'].map((t) => ({
      source: new Blob([PNG]),
      fileName: t,
      title: t,
    }));

    it('começa no índice pedido e navega por botão e por seta (circular)', async () => {
      await open({ items: photos, startIndex: 1, title: 'Vistoria de retirada' });
      expect(el('[data-preview-position]')!.textContent).toContain('2 de 4');
      expect(el('[data-preview-title]')!.textContent).toContain('Vistoria de retirada');

      el('[data-preview-next]')!.click();
      fixture.detectChanges();
      expect(el('[data-preview-position]')!.textContent).toContain('3 de 4');

      key('ArrowLeft');
      key('ArrowLeft');
      key('ArrowLeft');
      expect(el('[data-preview-position]')!.textContent).toContain('4 de 4');
    });

    it('swipe para a esquerda passa para a próxima foto', async () => {
      await open({ items: photos });
      const stage = el('[data-preview-stage]')!;
      const touch = (x: number) => ({ clientX: x, clientY: 300 }) as Touch;
      stage.dispatchEvent(
        Object.assign(new Event('touchstart'), { touches: [touch(300)], changedTouches: [touch(300)] }),
      );
      stage.dispatchEvent(
        Object.assign(new Event('touchend'), { touches: [], changedTouches: [touch(150)] }),
      );
      fixture.detectChanges();

      expect(el('[data-preview-position]')!.textContent).toContain('2 de 4');
    });

    it('a imagem é um <img> do blob local, com legenda acessível', async () => {
      await open({ items: photos });
      const img = el('[data-preview-image]') as HTMLImageElement;
      expect(img.getAttribute('src')).toMatch(/^blob:test\//);
      expect(img.alt).toBe('Frente');
    });
  });
});
