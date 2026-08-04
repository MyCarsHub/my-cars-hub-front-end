import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';

/**
 * Seletor dos nós que participam do ciclo de Tab dentro do painel. `[tabindex="-1"]`
 * fica de fora de propósito: o próprio painel usa `-1` para receber o foco inicial
 * sem entrar na ordem de tabulação.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Diálogo de **leitura**: mostra conteúdo longo que o card de origem corta.
 * Diferente do `ConfirmDialog` (decisão) e dos diálogos de formulário (edição),
 * aqui não há ação destrutiva — só um botão de fechar.
 *
 * É a implementação de referência do bloco "Diálogos do app não têm focus trap
 * nem trava de scroll" (documentation/FIXES.md): mantém Tab/Shift+Tab presos ao
 * painel, devolve o foco ao elemento que abriu, fecha no `Escape` e trava a
 * rolagem do `body` enquanto está aberto. Nenhuma dependência externa (o repo
 * não tem Angular CDK).
 *
 * Mobile-first: folha colada na base (`items-end`) que vira caixa centrada a
 * partir de `sm`; o corpo rola sozinho e o painel nunca passa de 90vh.
 *
 * @example
 * ```html
 * <app-detail-dialog [open]="detail() !== null" [title]="detail()?.title ?? ''"
 *   (closed)="closeDetail()">
 *   <p class="whitespace-pre-wrap">{{ detail()?.description }}</p>
 * </app-detail-dialog>
 * ```
 */
@Component({
  selector: 'app-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './detail-dialog.html',
  animations: [
    trigger('backdrop', [
      transition(':enter', [style({ opacity: 0 }), animate('150ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('dialog', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95) translateY(-8px)' }),
        animate(
          '200ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 1, transform: 'scale(1) translateY(0)' }),
        ),
      ]),
      transition(':leave', [
        animate(
          '150ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 0, transform: 'scale(0.95) translateY(-8px)' }),
        ),
      ]),
    ]),
  ],
})
export class DetailDialog {
  private static instanceCounter = 0;

  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Controla a visibilidade. */
  readonly open = input.required<boolean>();

  /** Título do diálogo — também é o nome acessível (`aria-labelledby`). */
  readonly title = input<string>('');

  /** Linha de apoio abaixo do título (opcional). */
  readonly subtitle = input<string>('');

  /** Rótulo do botão que fecha. */
  readonly closeLabel = input<string>('Fechar');

  /** Emitido no backdrop, no botão de fechar e no `Escape`. */
  readonly closed = output<void>();

  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly titleId = `detail-dialog-title-${++DetailDialog.instanceCounter}`;
  protected readonly bodyId = `${this.titleId}-body`;

  /** Elemento que tinha o foco antes de abrir; recebe o foco de volta ao fechar. */
  private previouslyFocused: HTMLElement | null = null;
  /** Valor original de `body.style.overflow`, restaurado ao destravar. */
  private previousBodyOverflow: string | null = null;

  constructor() {
    effect(() => {
      const isOpen = this.open();
      const panel = this.panelRef();
      if (!isOpen) {
        this.teardown();
        return;
      }
      if (!panel) return;
      this.setup(panel.nativeElement);
    });

    // Fechar a rota/aba com o diálogo aberto não pode deixar o body travado.
    this.destroyRef.onDestroy(() => this.teardown());
  }

  protected onClose(): void {
    this.closed.emit();
  }

  /**
   * Escape fecha; Tab circula dentro do painel. O handler vive no container do
   * diálogo (e não em `document`) porque o foco já está preso ali dentro.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const items = this.focusables();
    if (items.length === 0) {
      // Nada focável: o painel é o único destino possível.
      event.preventDefault();
      this.panelRef()?.nativeElement.focus({ preventScroll: true });
      return;
    }

    const index = items.indexOf(this.document.activeElement as HTMLElement);
    if (event.shiftKey) {
      // index === -1 significa foco no próprio painel: Shift+Tab vai para o fim.
      if (index <= 0) {
        event.preventDefault();
        items[items.length - 1].focus({ preventScroll: true });
      }
      return;
    }
    if (index === items.length - 1) {
      event.preventDefault();
      items[0].focus({ preventScroll: true });
    }
  }

  private setup(panel: HTMLElement): void {
    if (this.previouslyFocused === null) {
      const active = this.document.activeElement;
      this.previouslyFocused = active instanceof HTMLElement ? active : null;
    }
    this.lockScroll();
    // Foco no container (não no botão de fechar) para o leitor de tela anunciar
    // título + corpo antes de qualquer controle.
    panel.focus({ preventScroll: true });
  }

  private teardown(): void {
    this.unlockScroll();
    const target = this.previouslyFocused;
    this.previouslyFocused = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  private focusables(): HTMLElement[] {
    const panel = this.panelRef()?.nativeElement;
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.getAttribute('aria-hidden') !== 'true',
    );
  }

  private lockScroll(): void {
    if (!this.isBrowser || this.previousBodyOverflow !== null) return;
    const body = this.document.body;
    this.previousBodyOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
  }

  private unlockScroll(): void {
    if (this.previousBodyOverflow === null) return;
    this.document.body.style.overflow = this.previousBodyOverflow;
    this.previousBodyOverflow = null;
  }
}
