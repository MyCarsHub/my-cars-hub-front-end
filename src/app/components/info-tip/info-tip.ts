import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';

let nextId = 0;

/**
 * Botão "(i)" que abre e fecha um balão com a explicação de um campo.
 *
 * O balão é texto comum ligado ao botão por `aria-controls`/`aria-expanded` (não é um
 * tooltip de passar o mouse: no celular não há passar o mouse). Fecha com outro toque no
 * botão, Esc ou um toque fora. O texto vem em `text` ou como conteúdo projetado.
 */
@Component({
  selector: 'app-info-tip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'it',
    '(document:pointerdown)': 'onOutside($event)',
    '(keydown.escape)': 'close()',
  },
  template: `
    <button
      type="button"
      class="it-b"
      [attr.aria-label]="label()"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="controls() ?? id"
      (click)="open.set(!open())"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 11v5M12 8h.01"></path>
      </svg>
    </button>
    @if (!controls()) {
      <span class="it-bub" [id]="id" role="note" [hidden]="!open()">{{ text() }}<ng-content /></span>
    }
  `,
  styles: `
    :host { position: relative; display: inline-flex; vertical-align: middle; }
    .it-b {
      width: 44px; height: 44px; margin: -12px -10px; display: grid; place-items: center;
      border: 0; background: transparent; color: var(--color-fg-muted); cursor: pointer; border-radius: 22px;
    }
    .it-b[aria-expanded='true'] { color: var(--color-primary-600); }
    .it-b:focus-visible { outline: 2px solid var(--color-primary-400); outline-offset: -6px; }
    .it-bub {
      position: absolute; top: calc(100% + 10px); left: -12px; z-index: 30; width: min(300px, calc(100vw - 48px));
      padding: 12px 14px; border-radius: 12px; background: var(--color-surface);
      border: 1px solid var(--color-edge-field); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
      font-size: 14px; line-height: 20px; font-weight: 400; color: var(--color-fg-body); text-align: left;
      animation: it-in 200ms cubic-bezier(0.32, 0.72, 0, 1) both;
    }
    .it-bub[hidden] { display: none; }
    @keyframes it-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .it-bub { animation: none; } }
  `,
})
export class InfoTip {
  /** Nome do botão para o leitor de tela, ex.: "O que é a caução". */
  readonly label = input('Mais informações');
  readonly text = input('');
  /**
   * Id de um balão que o chamador desenha NO FLUXO, embaixo da linha (as pranchas do Novo
   * aluguel): o botão aponta para ele e o chamador mostra o balão com `expanded()`. Sem ele, o
   * balão é do próprio componente e flutua embaixo do botão.
   */
  readonly controls = input<string | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly id = `it-${++nextId}`;
  protected readonly open = signal(false);
  /** Aberto? (para o balão desenhado pelo chamador). */
  readonly expanded = this.open.asReadonly();

  close(): void {
    this.open.set(false);
  }

  protected onOutside(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node | null)) this.close();
  }
}
