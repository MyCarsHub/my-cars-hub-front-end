import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ApplicationRef,
  ComponentRef,
  DestroyRef,
  EnvironmentInjector,
  Injectable,
  InjectionToken,
  PLATFORM_ID,
  Type,
  createComponent,
  inject,
} from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import {
  DocumentPreviewGallery,
  DocumentPreviewRequest,
  toGallery,
} from './document-preview.types';

/** O contrato mínimo entre o serviço e o componente do modal. */
export interface DocumentPreviewHost {
  /** Avisa o serviço que o usuário pediu para fechar (X, Esc, fundo). */
  readonly closeRequested: { subscribe(fn: () => void): { unsubscribe(): void } };
}

/**
 * Como o serviço obtém o componente do modal. O padrão é `import()` dinâmico: o modal
 * (e, atrás dele, pdf.js e docx-preview) só desce quando alguém abre um documento — o
 * serviço, que todo card injeta, é a única parte no bundle inicial. Specs trocam o token
 * por um carregador síncrono, porque `import()` dinâmico não resolve no runner.
 */
export const DOCUMENT_PREVIEW_VIEWER = new InjectionToken<
  () => Promise<Type<DocumentPreviewHost>>
>('DOCUMENT_PREVIEW_VIEWER', {
  providedIn: 'root',
  factory: () => () =>
    import('./document-preview-viewer').then((m) => m.DocumentPreviewViewer),
});

/** Marca da entrada de histórico empurrada ao abrir. */
const HISTORY_KEY = 'mchDocumentPreview';

/**
 * O PADRÃO para ver qualquer documento do app: um modal de pré-visualização, nunca uma
 * aba nova. Folha em tela cheia no celular, modal grande no desktop.
 *
 *     preview.open({ source: () => api.signedUrl(id), fileName: 'CNH' });
 *     preview.open({ items: fotos, startIndex: 3, title: 'Vistoria de retirada' });
 *
 * O VOLTAR DO NAVEGADOR/ANDROID FECHA O MODAL. Ao abrir, uma entrada é empurrada no
 * histórico (mesma URL); o `popstate` dela fecha o modal em vez de sair da página. Fechar
 * pelo X/Esc/fundo consome a entrada com `history.back()`, então o histórico volta ao que
 * era. O Router ignora os dois movimentos: a URL não muda (`onSameUrlNavigation: ignore`).
 *
 * FOCO: o elemento que tinha o foco no `open()` (o botão "Abrir") recebe o foco de volta
 * quando o modal fecha.
 */
@Injectable({ providedIn: 'root' })
export class DocumentPreviewService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);
  private readonly loadViewer = inject(DOCUMENT_PREVIEW_VIEWER);
  private readonly router = inject(Router, { optional: true });

  private ref: ComponentRef<DocumentPreviewHost> | null = null;
  private trigger: HTMLElement | null = null;
  /** Identidade da entrada de histórico DESTE modal; `null` = nenhuma empurrada. */
  private historyToken: string | null = null;
  /** Abertura em voo (o chunk do modal ainda descendo). */
  private pending = 0;
  private readonly onPopState = () => {
    // A entrada do modal saiu de baixo de nós: o usuário apertou VOLTAR.
    if (this.historyToken && this.currentHistoryToken() !== this.historyToken) {
      this.historyToken = null;
      this.teardown();
    }
  };

  constructor() {
    // Uma navegação de verdade (sessão expirou, link interno) leva o modal junto. A
    // entrada de histórico fica para trás — é inofensiva: mesma URL que a anterior.
    this.router?.events
      .pipe(filter((e) => e instanceof NavigationStart && e.navigationTrigger !== 'popstate'))
      .subscribe(() => {
        if (this.ref || this.pending) {
          this.historyToken = null;
          this.teardown();
        }
      });
    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  /** O modal está aberto (ou abrindo)? */
  isOpen(): boolean {
    return this.ref !== null || this.pending > 0;
  }

  /**
   * Abre o visualizador. Chamar de novo com ele aberto TROCA o conteúdo (sem empurrar
   * outra entrada no histórico).
   */
  open(request: DocumentPreviewRequest): void {
    if (!this.isBrowser) return;
    const gallery = toGallery(request);
    if (gallery.items.length === 0) return;

    if (!this.ref && !this.pending) {
      const active = this.document.activeElement;
      this.trigger = active instanceof HTMLElement && active !== this.document.body ? active : null;
      this.pushHistory();
    }
    if (this.ref) {
      this.ref.setInput('request', gallery);
      return;
    }
    const attempt = ++this.pending;
    void this.loadViewer().then(
      (type) => {
        // Fechado (voltar, navegação) enquanto o chunk descia: não monta nada.
        if (attempt !== this.pending) return;
        this.pending = 0;
        this.mount(type, gallery);
      },
      () => {
        // Chunk não desceu (offline, deploy novo): devolve o histórico e o foco.
        if (attempt !== this.pending) return;
        this.close();
      },
    );
  }

  /** Fecha o modal e consome a entrada de histórico que ele empurrou. */
  close(): void {
    const consumeHistory = this.historyToken !== null && this.currentHistoryToken() === this.historyToken;
    this.historyToken = null;
    this.teardown();
    if (consumeHistory) {
      // Removido ANTES do back(): o popstate que vem a seguir não é nosso.
      this.document.defaultView?.history.back();
    }
  }

  private mount(type: Type<DocumentPreviewHost>, gallery: DocumentPreviewGallery): void {
    const ref = createComponent(type, { environmentInjector: this.injector });
    ref.setInput('request', gallery);
    ref.instance.closeRequested.subscribe(() => this.close());
    this.appRef.attachView(ref.hostView);
    this.document.body.appendChild(ref.location.nativeElement as HTMLElement);
    this.ref = ref;
  }

  private teardown(): void {
    this.pending = 0;
    this.document.defaultView?.removeEventListener('popstate', this.onPopState);
    const ref = this.ref;
    this.ref = null;
    if (ref) {
      this.appRef.detachView(ref.hostView);
      ref.destroy();
    }
    const trigger = this.trigger;
    this.trigger = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  private pushHistory(): void {
    const win = this.document.defaultView;
    if (!win) return;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      // Preserva o estado do Router (`navigationId`/`ɵrouterPageId`) na entrada nova.
      const state = (win.history.state ?? {}) as Record<string, unknown>;
      win.history.pushState({ ...state, [HISTORY_KEY]: token }, '');
    } catch {
      return; // histórico indisponível (sandbox): o modal ainda fecha por X/Esc.
    }
    this.historyToken = token;
    win.addEventListener('popstate', this.onPopState);
  }

  private currentHistoryToken(): string | null {
    const state = this.document.defaultView?.history.state as Record<string, unknown> | null;
    const token = state?.[HISTORY_KEY];
    return typeof token === 'string' ? token : null;
  }
}
