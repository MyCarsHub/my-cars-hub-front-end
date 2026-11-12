import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** Duração da saída; a entrada é 320ms (mola) no celular e 200ms no desktop. */
export const BOTTOM_SHEET_LEAVE_MS = 200;

let nextId = 0;

/**
 * Folha inferior no celular, diálogo centralizado no desktop (≥1024px).
 *
 * Reutilizável: o conteúdo entra por projeção; o rodapé de ações, pelo slot
 * `[sheetFooter]`. Quem usa controla a existência com `@if` e recebe `closed`
 * DEPOIS da animação de saída — então basta trocar o sinal no handler.
 *
 * Movimento (só transform/opacity, GPU):
 * - celular: sobe de baixo com curva de mola estilo iOS (320ms), puxador visível;
 * - desktop: escala 0,96→1 com fade (200ms), centralizado, largura limitada;
 * - fundo: fade + blur; saída em {@link BOTTOM_SHEET_LEAVE_MS};
 * - `prefers-reduced-motion`: sem deslocamento nem escala, só aparece.
 *
 * Teclado: Esc fecha; Tab fica preso dentro da folha; o foco vai para o primeiro
 * campo/botão ao abrir e volta para quem abriu ao fechar.
 */
@Component({
  selector: 'app-bottom-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape($event)',
  },
  styles: `
    :host { display: contents; }
    /* quietScroll: o corpo rola sem barra visível (o conteúdo continua rolável). */
    .quiet { scrollbar-width: none; }
    .quiet::-webkit-scrollbar { display: none; }
    .backdrop { animation: bs-fade-in 220ms ease-out both; }
    .panel { animation: bs-rise 320ms cubic-bezier(0.32, 0.72, 0, 1) both; will-change: transform; }
    .leaving .backdrop { animation: bs-fade-out ${BOTTOM_SHEET_LEAVE_MS}ms ease-in both; }
    .leaving .panel { animation: bs-sink ${BOTTOM_SHEET_LEAVE_MS}ms cubic-bezier(0.4, 0, 1, 1) both; }
    @media (min-width: 1024px) {
      .panel { animation: bs-pop 200ms cubic-bezier(0.2, 0.9, 0.3, 1) both; }
      .leaving .panel { animation: bs-unpop 160ms ease-in both; }
    }
    @keyframes bs-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes bs-fade-out { from { opacity: 1; } to { opacity: 0; } }
    @keyframes bs-rise { from { transform: translate3d(0, 100%, 0); } to { transform: translate3d(0, 0, 0); } }
    @keyframes bs-sink { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(0, 100%, 0); } }
    @keyframes bs-pop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
    @keyframes bs-unpop { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.97); } }
    /* bare (novidade v2): mola mais longa no celular; no desktop, escala 0,96→1 com um leve quique. */
    .panel.bare { animation: bs-rise 520ms cubic-bezier(0.32, 0.72, 0, 1) both; }
    @media (min-width: 1024px) {
      .panel.bare { animation: bs-pop-spring 440ms cubic-bezier(0.34, 1.32, 0.64, 1) both; }
    }
    @keyframes bs-pop-spring { from { opacity: 0; transform: translateY(14px) scale(0.96); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) {
      .backdrop, .panel, .leaving .backdrop, .leaving .panel { animation: none !important; }
      .leaving { opacity: 0; }
      /* bare: só um fade curto, sem mola. */
      .panel.bare { animation: bs-fade-in 160ms linear both !important; }
      .leaving .panel.bare { animation: none !important; }
    }
  `,
  template: `
    <div [class.leaving]="leaving()" data-testid="bottom-sheet">
      <div
        class="backdrop fixed inset-0 z-[110] bg-black/45 backdrop-blur-sm"
        (click)="requestClose()"
        aria-hidden="true"
      ></div>
      <div class="fixed inset-0 z-[120] flex items-end lg:items-center justify-center lg:p-6 pointer-events-none">
        <section
          #panel
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="bare() ? (labelledBy() ?? titleId) : titleId"
          class="panel relative overflow-hidden pointer-events-auto w-full shadow-2xl max-h-[92dvh] flex flex-col"
          [class]="panelClass()"
          (keydown.tab)="trapTab($event)"
        >
          @if (bare()) {
            <!-- O conteúdo desenha tudo (topo, título, X, ações); o h2 só existe se ninguém rotulou. -->
            @if (!labelledBy()) {
              <h2 [id]="titleId" class="sr-only">{{ title() }}</h2>
            }
            <div #body class="overflow-y-auto overscroll-contain grow" (scroll)="measure()"><ng-content select="[sheetBare]" /></div>
          } @else {
          <header class="px-5 pt-3 lg:pt-6 lg:px-6 shrink-0">
            <div class="mx-auto mb-3 h-1.5 w-10 rounded-full bg-surface-strong lg:hidden" aria-hidden="true"></div>
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 [id]="titleId" class="text-lg font-semibold text-fg break-words" [class.sr-only]="hideTitle()">{{ title() }}</h2>
                @if (subtitle()) {
                  <p class="mt-0.5 text-sm text-fg-subtle break-words">{{ subtitle() }}</p>
                }
              </div>
              @if (closable()) {
                <button
                  type="button"
                  class="press -mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full
                         text-fg-subtle hover:bg-canvas hover:text-fg
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  aria-label="Fechar"
                  data-testid="bottom-sheet-close"
                  (click)="requestClose()"
                >
                  <svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path d="M5 5l10 10M15 5L5 15" stroke-linecap="round" />
                  </svg>
                </button>
              }
            </div>
          </header>
          <div
            #body
            class="px-5 lg:px-6 py-4 overflow-y-auto overscroll-contain grow"
            [class.quiet]="quietScroll()"
            [style.mask-image]="fade() ? 'linear-gradient(to bottom, #000 calc(100% - 32px), transparent)' : null"
            [style.-webkit-mask-image]="fade() ? 'linear-gradient(to bottom, #000 calc(100% - 32px), transparent)' : null"
            (scroll)="measure()"
          >
            <ng-content />
          </div>
          <footer class="px-5 lg:px-6 pb-5 lg:pb-6 shrink-0 empty:hidden">
            <ng-content select="[sheetFooter]" />
          </footer>
          }
        </section>
      </div>
    </div>
  `,
})
export class BottomSheet implements OnInit, OnDestroy {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  /** O conteúdo desenha o próprio título (ex.: confirmação centralizada); o h2 fica só para leitores de tela. */
  readonly hideTitle = input(false);
  /**
   * `xl`: a grade de planos com cinco colunas (Assinatura → Mudar de plano).
   * `wide`: 820px no desktop — o Pix da assinatura (QR à esquerda, passos à direita).
   */
  readonly size = input<'md' | 'lg' | 'wide' | 'xl'>('md');
  /** Bloqueia Esc/fundo enquanto uma ação está em voo. */
  readonly busy = input(false);
  /**
   * Esconde a barra de rolagem do corpo (continua rolável) e desvanece a borda de baixo
   * enquanto houver mais conteúdo abaixo. Opt-in: as demais folhas não mudam.
   */
  readonly quietScroll = input(false);
  /** `false` esconde o X (aviso bloqueante): quem usa deve oferecer a saída por um botão. */
  readonly closable = input(true);
  /**
   * `bare`: sem cabeçalho, rodapé nem margens — o conteúdo (slot `[sheetBare]`) desenha tudo.
   * Cantos de 28 px, janela de 480 px a partir de 1024 px, entrada em mola (novidade v2).
   */
  readonly variant = input<'default' | 'bare'>('default');
  /** Id do título que o conteúdo desenha (só `bare`). */
  readonly labelledBy = input<string | null>(null);
  protected readonly bare = computed(() => this.variant() === 'bare');
  protected readonly panelClass = computed(() => {
    if (this.bare()) {
      return 'bare rounded-t-[28px] lg:rounded-[28px] lg:max-w-[480px] bg-surface pb-[env(safe-area-inset-bottom)] lg:pb-0';
    }
    const width =
      this.size() === 'xl' ? 'lg:max-w-[1220px]' : this.size() === 'wide' ? 'lg:max-w-[820px]' : this.size() === 'lg' ? 'lg:max-w-2xl' : 'lg:max-w-md';
    return `bg-surface border border-edge-soft rounded-t-3xl lg:rounded-2xl pb-[env(safe-area-inset-bottom)] lg:pb-0 ${width}`;
  });
  readonly closed = output<void>();

  protected readonly titleId = `bottom-sheet-title-${++nextId}`;
  protected readonly leaving = signal(false);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');
  /** Há mais conteúdo abaixo da dobra (só mede com `quietScroll`). */
  protected readonly fade = signal(false);
  private readonly doc = inject(DOCUMENT);
  private opener: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;

  constructor() {
    afterNextRender(() => {
      this.focusFirst();
      this.measure();
      const view = this.doc.defaultView;
      if (view && 'ResizeObserver' in view) {
        const ro = new view.ResizeObserver(() => this.measure());
        ro.observe(this.body().nativeElement);
        const inner = this.body().nativeElement.firstElementChild;
        if (inner) ro.observe(inner);
        this.observer = ro;
      }
    });
  }

  ngOnInit(): void {
    const active = this.doc.activeElement;
    this.opener = active instanceof HTMLElement ? active : null;
  }

  protected measure(): void {
    if (!this.quietScroll()) {
      this.fade.set(false);
      return;
    }
    const el = this.body().nativeElement;
    this.fade.set(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    // Devolve o foco a quem abriu, se ele ainda estiver na página.
    if (this.opener && this.doc.contains(this.opener)) this.opener.focus();
  }

  /**
   * Fecha com a animação de saída. `force` ignora o `busy` — para quem fecha a
   * folha no MESMO tique em que a ação terminou (o input ainda não atualizou).
   */
  requestClose(force = false): void {
    if ((this.busy() && !force) || this.leaving()) return;
    this.leaving.set(true);
    const reduced = this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setTimeout(() => this.closed.emit(), reduced ? 0 : BOTTOM_SHEET_LEAVE_MS);
  }

  protected onEscape(event: Event): void {
    event.preventDefault();
    this.requestClose();
  }

  protected trapTab(event: Event): void {
    const focusables = this.focusables();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const shift = (event as KeyboardEvent).shiftKey;
    if (shift && this.doc.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!shift && this.doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusFirst(): void {
    const all = this.focusables();
    // O botão Fechar é o primeiro no DOM; prefere o primeiro controle do conteúdo.
    // `data-autofocus` marca o controle principal quando o conteúdo prefere outro.
    const target =
      all.find((el) => el.hasAttribute('data-autofocus')) ??
      all.find((el) => el.dataset['testid'] !== 'bottom-sheet-close') ??
      all[0];
    target?.focus({ preventScroll: true });
  }

  private focusables(): HTMLElement[] {
    const selector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(this.panel().nativeElement.querySelectorAll<HTMLElement>(selector));
  }
}
