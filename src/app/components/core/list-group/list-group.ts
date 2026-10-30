import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  input,
} from '@angular/core';

/**
 * Grupo de linhas: título curto sobre o cartão, como nos Ajustes do iOS. O slot
 * `[groupNote]` fica alinhado à direita do título ("2 atrasadas, 7 no total", "Ver todas").
 */
@Component({
  selector: 'app-list-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    @if (heading(); as title) {
      <div class="flex items-end justify-between gap-3">
        <h2
          class="m-0 pt-[22px] pb-2 px-1.5 text-[13px] font-semibold text-fg-muted"
          [class.lg:pt-0]="flushTop()"
        >
          {{ title }}
        </h2>
        <ng-content select="[groupNote]" />
      </div>
    }
    <div [class]="cardClass()">
      <ng-content />
    </div>
  `,
})
export class ListGroup {
  protected readonly cardClass = computed(
    () =>
      'bg-surface border border-edge rounded-2xl overflow-hidden ' +
      (this.flat() ? '' : 'shadow-[0_1px_2px_rgb(16_16_16/0.05)] dark:shadow-none'),
  );

  readonly heading = input<string | null>(null);
  /** Dentro de uma folha: sem sombra, que ali seria um segundo cartão. */
  readonly flat = input(false, { transform: booleanAttribute });
  /** Primeiro grupo de uma coluna no desktop, alinhado ao topo do vizinho. */
  readonly flushTop = input(false, { transform: booleanAttribute });
}

/**
 * Uma linha de `app-list-group`, em `a`, `button` ou `div`. As partes são marcação simples:
 * `.tile` (com `.tint`, `.hot` ou `.alert`), `.t` com `b` e `small`, `.l1` para título e
 * chip na mesma linha, `.v` e `.chev`. O estilo mora aqui, sob `[appListRow]`.
 *
 * `locked`: a ação continua visível e diz por que não responde. Esconder faria o operador
 * procurar um bug onde existe uma regra.
 */
@Component({
  selector: 'a[appListRow], button[appListRow], div[appListRow]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class.list-row-danger]': 'danger()',
    '[class.list-row-locked]': 'locked()',
    '[class.list-row-inset]': 'inset()',
  },
  styleUrl: './list-group.css',
  template: `<ng-content />`,
})
export class ListRow {
  readonly danger = input(false, { transform: booleanAttribute });
  readonly locked = input(false, { transform: booleanAttribute });
  /** Sem ícone numa lista com ícones: o texto alinha com a coluna de texto de cima. */
  readonly inset = input(false, { transform: booleanAttribute });
}

/** Seta de "abre outra coisa" no fim da linha. */
@Component({
  selector: 'app-list-chevron',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <svg
      class="chev text-fg-faint flex-none"
      width="8"
      height="14"
      viewBox="0 0 8 14"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M1 1l6 6-6 6" />
    </svg>
  `,
})
export class ListChevron {}
