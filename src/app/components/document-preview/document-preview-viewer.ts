import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiErrorService } from '../../services/api-error.service';
import { LoggerService } from '../../services/logger.service';
import {
  DOCX_RENDER_LIMIT_BYTES,
  FORMAT_LABEL,
  FORMAT_MIME,
  IMAGE_WARN_BYTES,
  PDF_WARN_BYTES,
  SNIFF_BYTES,
  downloadFileName,
  formatBytes,
  isImageFormat,
  sniffFormat,
} from './document-format';
import type {
  DocumentFormat,
  DocumentPreviewGallery,
  DocumentPreviewItem,
} from './document-preview.types';
import { DocumentLoadError, resolveToBlob } from './document-source';
import { DOCX_PAGE_WIDTH_PX, DocxPreviewEngine, buildDocxSrcdoc } from './docx-preview-engine';
import { PdfHandle, PdfPageSize, PdfPreviewEngine, isPdfPasswordError } from './pdf-preview-engine';

/** Bytes resolvidos + formato decidido por eles. */
interface LoadedFile {
  readonly blob: Blob;
  readonly format: DocumentFormat;
}

type ItemState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string; readonly file: LoadedFile | null }
  | { readonly kind: 'large'; readonly file: LoadedFile; readonly canForce: boolean }
  | { readonly kind: 'unsupported'; readonly file: LoadedFile }
  | { readonly kind: 'ready'; readonly file: LoadedFile };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
/** Respiro lateral da página/foto no palco, em px. */
const STAGE_GUTTER = 12;
/** Uma página de PDF nunca passa disto no desktop sem zoom do usuário. */
const MAX_FIT_SCALE = 1.6;
/** Arrasto horizontal mínimo para o swipe trocar de foto. */
const SWIPE_MIN_PX = 56;
/** Watchdog do render de DOCX — um arquivo patológico não prende o modal. */
const DOCX_RENDER_TIMEOUT_MS = 30_000;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let nextViewerId = 0;

/**
 * O modal de pré-visualização. Montado e desmontado SÓ pelo `DocumentPreviewService`
 * (histórico, foco de volta ao gatilho); este componente cuida do que se vê:
 *
 * - PDF → pdf.js em canvas, página por página sob demanda (IntersectionObserver),
 *   rolagem vertical, zoom por pinça/botões, "Página X de Y".
 * - DOCX → docx-preview SANEADO num iframe `sandbox=""` (ver `DocxPreviewEngine`).
 * - Imagem → ajuste à tela, zoom (pinça, botões, toque duplo) e, na galeria,
 *   anterior/próxima por botão, seta do teclado e swipe.
 *
 * Os object URLs criados aqui são revogados no `ngOnDestroy`.
 */
@Component({
  selector: 'app-document-preview-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  templateUrl: './document-preview-viewer.html',
  styleUrl: './document-preview-viewer.css',
})
export class DocumentPreviewViewer implements AfterViewInit, OnDestroy {
  private readonly document = inject(DOCUMENT);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly logger = inject(LoggerService);
  private readonly pdfEngine = inject(PdfPreviewEngine);
  private readonly docxEngine = inject(DocxPreviewEngine);

  readonly request = input.required<DocumentPreviewGallery>();
  /** X, Esc ou clique no fundo. Quem fecha de fato é o serviço. */
  readonly closeRequested = output<void>();

  protected readonly titleId = `document-preview-title-${++nextViewerId}`;
  protected readonly subtitleId = `document-preview-subtitle-${nextViewerId}`;

  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly pageCanvases = viewChildren<ElementRef<HTMLCanvasElement>>('pdfCanvas');

  // ------------------------------------------------------------------ estado
  protected readonly index = signal(0);
  private readonly states = signal<ReadonlyMap<number, ItemState>>(new Map());
  /** Itens grandes que o usuário mandou visualizar mesmo assim. */
  private readonly forced = signal<ReadonlySet<number>>(new Set());
  protected readonly zoom = signal(1);
  /** Escala TEMPORÁRIA durante a pinça (CSS transform); vira `zoom` no fim do gesto. */
  protected readonly pinchScale = signal(1);
  protected readonly pinchOrigin = signal('50% 0');
  protected readonly stageWidth = signal(0);
  protected readonly stageHeight = signal(0);

  protected readonly pdfPages = signal<readonly PdfPageSize[]>([]);
  protected readonly currentPage = signal(1);
  /** O conteúdo do item atual ainda está sendo desenhado (pdf.js / docx-preview). */
  protected readonly presenting = signal(false);
  private readonly docxHtml = signal<string | null>(null);
  protected readonly imageUrl = signal<string | null>(null);
  protected readonly imageNatural = signal<{ w: number; h: number } | null>(null);

  protected readonly items = computed(() => this.request().items);
  protected readonly isGallery = computed(() => this.items().length > 1);
  protected readonly item = computed<DocumentPreviewItem>(() => this.items()[this.index()]);
  protected readonly state = computed<ItemState>(
    () => this.states().get(this.index()) ?? { kind: 'loading' },
  );
  protected readonly file = computed<LoadedFile | null>(() => {
    const s = this.state();
    return 'file' in s ? s.file : null;
  });
  protected readonly errorMessage = computed(() => {
    const s = this.state();
    return s.kind === 'error' ? s.message : '';
  });
  protected readonly canForce = computed(() => {
    const s = this.state();
    return s.kind === 'large' && s.canForce;
  });
  protected readonly fileSize = computed(() => {
    const file = this.file();
    return file ? formatBytes(file.blob.size) : '';
  });
  protected readonly readyFormat = computed<DocumentFormat | null>(() => {
    const s = this.state();
    return s.kind === 'ready' ? s.file.format : null;
  });
  protected readonly isImage = computed(() => {
    const f = this.readyFormat();
    return f !== null && isImageFormat(f);
  });

  protected readonly title = computed(
    () => this.request().title ?? this.item().title ?? this.item().fileName,
  );
  protected readonly subtitle = computed(() => {
    const parts: string[] = [];
    if (this.request().title && this.item().title) parts.push(this.item().title as string);
    if (this.item().caption) parts.push(this.item().caption as string);
    const file = this.file();
    if (file) parts.push(`${FORMAT_LABEL[file.format]} · ${formatBytes(file.blob.size)}`);
    return parts.join(' · ');
  });
  protected readonly downloadLabel = computed(() => `Baixar ${this.item().fileName}`);
  /** Nova aba só para o que o navegador sabe mostrar sozinho. */
  protected readonly canOpenInTab = computed(() => {
    const f = this.readyFormat();
    return f === 'pdf' || (f !== null && isImageFormat(f) && f !== 'heic');
  });
  protected readonly showToolbar = computed(
    () => this.isGallery() || this.readyFormat() === 'pdf' || this.isImage() || this.readyFormat() === 'docx',
  );
  protected readonly zoomPercent = computed(() => `${Math.round(this.zoom() * 100)}%`);
  protected readonly canZoomIn = computed(() => this.zoom() < MAX_ZOOM - 0.001);
  protected readonly canZoomOut = computed(() => this.zoom() > MIN_ZOOM + 0.001);
  protected readonly galleryPosition = computed(
    () => `${this.index() + 1} de ${this.items().length}`,
  );
  protected readonly pageLabel = computed(() => `${this.currentPage()} de ${this.pdfPages().length}`);

  // ------------------------------------------------------------------ PDF
  /** px CSS por unidade do pdf.js para a página caber na largura do palco. */
  private readonly pdfFitScale = computed(() => {
    const widest = Math.max(1, ...this.pdfPages().map((p) => p.width));
    const room = Math.max(120, this.stageWidth() - STAGE_GUTTER * 2);
    return Math.min(room / widest, MAX_FIT_SCALE);
  });

  protected pageCssWidth(page: PdfPageSize): number {
    return Math.round(page.width * this.pdfFitScale() * this.zoom());
  }

  protected pageCssHeight(page: PdfPageSize): number {
    return Math.round(page.height * this.pdfFitScale() * this.zoom());
  }

  // ------------------------------------------------------------------ DOCX
  protected readonly docxSrcdoc = computed<SafeHtml | null>(() => {
    const html = this.docxHtml();
    if (html === null) return null;
    const fit = Math.min(1, (this.stageWidth() - STAGE_GUTTER) / DOCX_PAGE_WIDTH_PX);
    // Conteúdo JÁ saneado e confinado a um iframe `sandbox=""` com CSP — o bypass só
    // impede o Angular de esvaziar o srcdoc; não é ele que protege nada aqui.
    return this.sanitizer.bypassSecurityTrustHtml(
      buildDocxSrcdoc(html, Math.max(0.3, fit) * this.zoom()),
    );
  });

  // ------------------------------------------------------------------ imagem
  private readonly imageFit = computed(() => {
    const natural = this.imageNatural();
    if (!natural) return 1;
    const w = Math.max(1, this.stageWidth() - STAGE_GUTTER * 2);
    const h = Math.max(1, this.stageHeight() - STAGE_GUTTER * 2);
    return Math.min(w / natural.w, h / natural.h, 1);
  });
  protected readonly imageCssWidth = computed(() => {
    const natural = this.imageNatural();
    return natural ? Math.round(natural.w * this.imageFit() * this.zoom()) : null;
  });
  protected readonly imageCssHeight = computed(() => {
    const natural = this.imageNatural();
    return natural ? Math.round(natural.h * this.imageFit() * this.zoom()) : null;
  });

  /** Anúncio para leitor de tela (troca de foto, erro). */
  protected readonly liveMessage = signal('');

  // ------------------------------------------------------------------ internos
  private readonly aborts = new Map<number, AbortController>();
  private readonly objectUrls = new Set<string>();
  private pdf: PdfHandle | null = null;
  /** Invalida apresentações em voo quando o item muda. */
  private presentToken = 0;
  private observer: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly visiblePages = new Set<number>();
  private readonly renderedAt = new Map<number, number>();
  private rerenderTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollFrame = 0;
  private previousBodyOverflow: string | null = null;
  private touchStart: { x: number; y: number; t: number } | null = null;
  private pinch: { dist: number; zoom: number; midX: number; midY: number } | null = null;
  private lastTap = 0;
  private readonly cleanups: (() => void)[] = [];

  constructor() {
    // Pedido novo (ou troca pelo serviço): volta ao item inicial e esquece o cache.
    effect(() => {
      const req = this.request();
      untracked(() => {
        this.abortAll();
        this.states.set(new Map());
        this.forced.set(new Set());
        const start = Math.min(Math.max(req.startIndex ?? 0, 0), req.items.length - 1);
        this.index.set(start);
        this.load(start);
      });
    });

    // Item atual pronto → apresenta. Troca de item → limpa o que era do anterior.
    effect(() => {
      const i = this.index();
      const state = this.state();
      untracked(() => this.present(i, state));
    });

    // Zoom do PDF mudou → redesenha as páginas visíveis na resolução nova (com folga).
    effect(() => {
      this.zoom();
      this.pdfFitScale();
      untracked(() => this.scheduleRerender());
    });

    // Canvases (re)criados → observa quem entra na tela.
    effect(() => {
      const canvases = this.pageCanvases();
      untracked(() => this.observePages(canvases));
    });
  }

  ngAfterViewInit(): void {
    const body = this.document.body;
    this.previousBodyOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    // O painel, não o primeiro botão: o leitor de tela anuncia o título primeiro.
    this.panel().nativeElement.focus({ preventScroll: true });

    const stage = this.stage().nativeElement;
    this.measureStage();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.measureStage());
      this.resizeObserver.observe(stage);
    }
    // Não-passivos de propósito: a pinça precisa de `preventDefault` para o navegador
    // não dar zoom na PÁGINA inteira em vez de no documento.
    const onStart = (e: TouchEvent) => this.onTouchStart(e);
    const onMove = (e: TouchEvent) => this.onTouchMove(e);
    const onEnd = (e: TouchEvent) => this.onTouchEnd(e);
    const onGesture = (e: Event) => e.preventDefault();
    stage.addEventListener('touchstart', onStart, { passive: false });
    stage.addEventListener('touchmove', onMove, { passive: false });
    stage.addEventListener('touchend', onEnd);
    stage.addEventListener('touchcancel', onEnd);
    // Safari: o gesto de pinça nativo vem como `gesture*`, não só touch.
    stage.addEventListener('gesturestart', onGesture);
    this.cleanups.push(() => {
      stage.removeEventListener('touchstart', onStart);
      stage.removeEventListener('touchmove', onMove);
      stage.removeEventListener('touchend', onEnd);
      stage.removeEventListener('touchcancel', onEnd);
      stage.removeEventListener('gesturestart', onGesture);
    });
  }

  ngOnDestroy(): void {
    this.abortAll();
    this.presentToken++;
    this.pdf?.destroy();
    this.pdf = null;
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    if (this.rerenderTimer) clearTimeout(this.rerenderTimer);
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
    for (const fn of this.cleanups) fn();
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    if (this.previousBodyOverflow !== null) {
      this.document.body.style.overflow = this.previousBodyOverflow;
    }
  }

  // ================================================================ ações
  protected requestClose(): void {
    this.closeRequested.emit();
  }

  protected retry(): void {
    this.load(this.index(), true);
  }

  protected viewAnyway(): void {
    const i = this.index();
    const s = this.state();
    if (s.kind !== 'large') return;
    this.forced.update((set) => new Set(set).add(i));
    this.setState(i, { kind: 'ready', file: s.file });
  }

  /** Salva os bytes JÁ carregados com a extensão decidida por eles. */
  protected download(): void {
    const file = this.file();
    if (!file) return;
    const url = this.objectUrlFor(file.blob);
    const a = this.document.createElement('a');
    a.href = url;
    a.download = downloadFileName(this.item().fileName, file.format);
    a.rel = 'noopener';
    this.document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** Opção secundária: o arquivo (blob local, nunca a signed URL) numa aba nova. */
  protected openInNewTab(): void {
    const file = this.file();
    if (!file || !this.canOpenInTab()) return;
    const typed = new Blob([file.blob], { type: FORMAT_MIME[file.format] });
    this.document.defaultView?.open(this.objectUrlFor(typed), '_blank', 'noopener');
  }

  protected step(delta: number): void {
    const count = this.items().length;
    if (count < 2) return;
    const next = (this.index() + delta + count) % count;
    this.index.set(next);
    this.zoom.set(1);
    this.liveMessage.set(`Arquivo ${next + 1} de ${count}`);
    this.load(next);
  }

  protected zoomIn(): void {
    this.setZoom(this.zoom() * ZOOM_STEP);
  }

  protected zoomOut(): void {
    this.setZoom(this.zoom() / ZOOM_STEP);
  }

  protected resetZoom(): void {
    this.setZoom(1);
  }

  protected onImageLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    this.imageNatural.set({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    this.presenting.set(false);
  }

  /** O navegador não decodifica (HEIC fora do Safari, arquivo corrompido). */
  protected onImageError(): void {
    const i = this.index();
    const s = this.state();
    if (s.kind !== 'ready') return;
    this.presenting.set(false);
    this.setState(i, { kind: 'unsupported', file: s.file });
  }

  protected onImageClick(): void {
    // Toque/clique duplo alterna entre ajustado e 2,5x.
    const now = Date.now();
    if (now - this.lastTap < 300) {
      this.setZoom(this.zoom() > 1 ? 1 : 2.5);
      this.lastTap = 0;
      return;
    }
    this.lastTap = now;
  }

  protected onStageScroll(): void {
    if (this.readyFormat() !== 'pdf' || this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      this.updateCurrentPage();
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.requestClose();
      return;
    }
    if (event.key === 'Tab') {
      this.trapTab(event);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowRight' && this.isGallery()) {
      event.preventDefault();
      this.step(1);
    } else if (event.key === 'ArrowLeft' && this.isGallery()) {
      event.preventDefault();
      this.step(-1);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.zoomIn();
    } else if (event.key === '-') {
      event.preventDefault();
      this.zoomOut();
    } else if (event.key === '0') {
      event.preventDefault();
      this.resetZoom();
    }
  }

  // ================================================================ carregamento
  private load(i: number, force = false): void {
    const current = this.states().get(i);
    if (!force && current && current.kind !== 'error') return;
    const item = this.items()[i];
    if (!item) return;
    this.aborts.get(i)?.abort();
    const abort = new AbortController();
    this.aborts.set(i, abort);
    this.setState(i, { kind: 'loading' });

    void (async () => {
      try {
        const blob = await resolveToBlob(item.source, abort.signal);
        const head = new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer());
        if (abort.signal.aborted) return;
        const format = sniffFormat(head);
        const file: LoadedFile = { blob, format };
        this.setState(i, this.classify(i, file));
      } catch (err) {
        if (abort.signal.aborted) return;
        this.setState(i, { kind: 'error', message: this.loadErrorMessage(err, item), file: null });
      } finally {
        if (this.aborts.get(i) === abort) this.aborts.delete(i);
      }
    })();
  }

  private classify(i: number, file: LoadedFile): ItemState {
    const size = file.blob.size;
    if (file.format === 'unknown') return { kind: 'unsupported', file };
    if (file.format === 'docx' && size > DOCX_RENDER_LIMIT_BYTES) {
      return { kind: 'large', file, canForce: false };
    }
    const warnAt = file.format === 'pdf' ? PDF_WARN_BYTES : IMAGE_WARN_BYTES;
    if (size > warnAt && !this.forced().has(i)) return { kind: 'large', file, canForce: true };
    return { kind: 'ready', file };
  }

  private loadErrorMessage(err: unknown, item: DocumentPreviewItem): string {
    const fallback = item.errorMessage ?? 'Não foi possível carregar o arquivo agora.';
    if (err instanceof DocumentLoadError) {
      if (err.cause instanceof HttpErrorResponse) return this.apiErrors.messageFor(err.cause, fallback);
      if (err.message === 'network') return 'Sem conexão para carregar o arquivo. Verifique a internet.';
      if (err.status === 403 || err.status === 400) {
        return 'O link do arquivo expirou. Toque em "Tentar de novo".';
      }
      if (err.status === 404 || err.message === 'empty') return 'Arquivo não encontrado.';
    }
    this.logger.error('[document-preview] load failed', err);
    return fallback;
  }

  // ================================================================ apresentação
  private present(i: number, state: ItemState): void {
    const token = ++this.presentToken;
    this.resetPresentation();
    if (state.kind !== 'ready') return;
    const { file } = state;
    if (file.format === 'pdf') void this.presentPdf(token, i, file);
    else if (file.format === 'docx') void this.presentDocx(token, i, file);
    else if (isImageFormat(file.format)) {
      this.presenting.set(true);
      this.imageUrl.set(this.objectUrlFor(file.blob));
      this.prefetchNeighbours(i);
    }
  }

  private resetPresentation(): void {
    this.pdf?.destroy();
    this.pdf = null;
    this.pdfPages.set([]);
    this.currentPage.set(1);
    this.visiblePages.clear();
    this.renderedAt.clear();
    this.docxHtml.set(null);
    this.imageUrl.set(null);
    this.imageNatural.set(null);
    this.presenting.set(false);
    this.pinchScale.set(1);
  }

  private async presentPdf(token: number, i: number, file: LoadedFile): Promise<void> {
    this.presenting.set(true);
    try {
      const handle = await this.pdfEngine.open(await file.blob.arrayBuffer());
      if (token !== this.presentToken) {
        handle.destroy();
        return;
      }
      const sizes = await handle.pageSizes();
      if (token !== this.presentToken) {
        handle.destroy();
        return;
      }
      this.pdf = handle;
      this.pdfPages.set(sizes);
      this.stage().nativeElement.scrollTo({ top: 0 });
    } catch (err) {
      if (token !== this.presentToken) return;
      this.presenting.set(false);
      const message = isPdfPasswordError(err)
        ? 'Este PDF é protegido por senha. Baixe o arquivo para abri-lo.'
        : 'Não foi possível exibir este PDF aqui. Você ainda pode baixar o arquivo.';
      if (!isPdfPasswordError(err)) this.logger.error('[document-preview] pdf render failed', err);
      this.setState(i, { kind: 'error', message, file });
    }
  }

  private async presentDocx(token: number, i: number, file: LoadedFile): Promise<void> {
    this.presenting.set(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const watchdog = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('docx render timeout')), DOCX_RENDER_TIMEOUT_MS);
      });
      const html = await Promise.race([this.docxEngine.toSafeHtml(file.blob), watchdog]);
      if (token !== this.presentToken) return;
      this.docxHtml.set(html);
      this.presenting.set(false);
    } catch (err) {
      if (token !== this.presentToken) return;
      this.presenting.set(false);
      this.logger.error('[document-preview] docx render failed', err);
      this.setState(i, {
        kind: 'error',
        message: 'Não foi possível exibir este documento aqui. Você ainda pode baixar o arquivo.',
        file,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Galeria: a próxima e a anterior já descem enquanto a atual é vista. */
  private prefetchNeighbours(i: number): void {
    const count = this.items().length;
    if (count < 2) return;
    this.load((i + 1) % count);
    this.load((i - 1 + count) % count);
  }

  private observePages(canvases: readonly ElementRef<HTMLCanvasElement>[]): void {
    this.observer?.disconnect();
    this.observer = null;
    if (canvases.length === 0) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Sem IO (navegador muito velho / teste): desenha as primeiras páginas.
      canvases.slice(0, 3).forEach((c, idx) => this.renderPage(idx + 1, c.nativeElement));
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset['page']);
          if (entry.isIntersecting) {
            this.visiblePages.add(page);
            this.renderPage(page, entry.target as HTMLCanvasElement);
          } else {
            this.visiblePages.delete(page);
          }
        }
      },
      // Uma tela de folga: a próxima página já está desenhada quando chega.
      { root: this.stage().nativeElement, rootMargin: '100% 0px' },
    );
    for (const c of canvases) this.observer.observe(c.nativeElement);
  }

  private renderPage(page: number, canvas: HTMLCanvasElement): void {
    const handle = this.pdf;
    const size = this.pdfPages()[page - 1];
    if (!handle || !size) return;
    const width = this.pageCssWidth(size);
    if (this.renderedAt.get(page) === width) return;
    this.renderedAt.set(page, width);
    handle.render(page, canvas, width).then(
      () => {
        if (page === 1 || this.presenting()) this.presenting.set(false);
      },
      (err: unknown) => {
        this.renderedAt.delete(page);
        this.logger.error('[document-preview] pdf page render failed', err, { page });
      },
    );
  }

  private scheduleRerender(): void {
    if (this.rerenderTimer) clearTimeout(this.rerenderTimer);
    this.rerenderTimer = setTimeout(() => {
      this.rerenderTimer = null;
      const canvases = this.pageCanvases();
      for (const page of this.visiblePages) {
        const canvas = canvases[page - 1]?.nativeElement;
        if (canvas) this.renderPage(page, canvas);
      }
    }, 160);
  }

  private updateCurrentPage(): void {
    const stage = this.stage().nativeElement;
    const marker = stage.scrollTop + stage.clientHeight / 3;
    let current = 1;
    for (const ref of this.pageCanvases()) {
      const wrapper = ref.nativeElement.parentElement;
      if (!wrapper) continue;
      if (wrapper.offsetTop <= marker) current = Number(ref.nativeElement.dataset['page']);
      else break;
    }
    if (current !== this.currentPage()) this.currentPage.set(current);
  }

  // ================================================================ gestos
  private onTouchStart(e: TouchEvent): void {
    if (e.touches.length === 2 && this.canPinch()) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const rect = this.stage().nativeElement.getBoundingClientRect();
      const midX = (a.clientX + b.clientX) / 2 - rect.left;
      const midY = (a.clientY + b.clientY) / 2 - rect.top;
      this.pinch = { dist: distance(a, b), zoom: this.zoom(), midX, midY };
      const stage = this.stage().nativeElement;
      this.pinchOrigin.set(`${stage.scrollLeft + midX}px ${stage.scrollTop + midY}px`);
      this.touchStart = null;
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this.touchStart = { x: t.clientX, y: t.clientY, t: Date.now() };
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (!this.pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const ratio = distance(e.touches[0], e.touches[1]) / this.pinch.dist;
    const target = clamp(this.pinch.zoom * ratio, MIN_ZOOM, MAX_ZOOM);
    this.pinchScale.set(target / this.pinch.zoom);
  }

  private onTouchEnd(e: TouchEvent): void {
    if (this.pinch && e.touches.length < 2) {
      const { zoom, midX, midY } = this.pinch;
      const ratio = this.pinchScale();
      this.pinch = null;
      this.pinchScale.set(1);
      const stage = this.stage().nativeElement;
      const left = (stage.scrollLeft + midX) * ratio - midX;
      const top = (stage.scrollTop + midY) * ratio - midY;
      this.zoom.set(clamp(zoom * ratio, MIN_ZOOM, MAX_ZOOM));
      // O layout novo só existe depois do próximo frame.
      requestAnimationFrame(() => stage.scrollTo({ left, top }));
      return;
    }
    const start = this.touchStart;
    this.touchStart = null;
    if (!start || !this.isGallery() || this.zoom() > 1.01) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - start.t < 800) {
      this.step(dx < 0 ? 1 : -1);
    }
  }

  private canPinch(): boolean {
    const f = this.readyFormat();
    return f === 'pdf' || this.isImage();
  }

  // ================================================================ util
  private setZoom(value: number): void {
    this.zoom.set(clamp(Math.round(value * 100) / 100, MIN_ZOOM, MAX_ZOOM));
  }

  private setState(i: number, state: ItemState): void {
    this.states.update((map) => new Map(map).set(i, state));
    if (state.kind === 'error' && i === this.index()) this.liveMessage.set(state.message);
  }

  private abortAll(): void {
    for (const ctrl of this.aborts.values()) ctrl.abort();
    this.aborts.clear();
  }

  private objectUrlFor(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.objectUrls.add(url);
    return url;
  }

  private measureStage(): void {
    const stage = this.stage().nativeElement;
    this.stageWidth.set(stage.clientWidth);
    this.stageHeight.set(stage.clientHeight);
  }

  private trapTab(event: KeyboardEvent): void {
    const panel = this.panel().nativeElement;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.closest('[hidden]'),
    );
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const active = this.document.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;
    if (event.shiftKey) {
      if (index <= 0) {
        event.preventDefault();
        items[items.length - 1].focus({ preventScroll: true });
      }
      return;
    }
    if (index === -1 || index === items.length - 1) {
      event.preventDefault();
      items[0].focus({ preventScroll: true });
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distance(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
}
