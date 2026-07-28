import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Tom do valor-manchete. Mapeado para classes AA-safe em `toneClass`. */
export type StatTileTone = 'brand' | 'positive' | 'negative' | 'warning' | 'neutral' | 'muted';

const TONE_CLASS: Record<StatTileTone, string> = {
  // primary-500 sobre branco = 3,79:1 → só passa em AA como texto grande bold,
  // por isso o valor é sempre `text-xl sm:text-2xl font-bold`. Não reduzir.
  brand: 'text-primary-500',
  // Verde só como "boa notícia confirmada" (guia de identidade). 4,36:1 large.
  positive: 'text-success-700',
  negative: 'text-rose-700',
  warning: 'text-amber-700',
  neutral: 'text-neutral-900',
  muted: 'text-neutral-500',
};

/**
 * Tile de KPI — a composição canônica usada nas grades de indicadores do
 * Dashboard e da Administração (card branco `rounded-2xl` + borda, label em
 * caixa alta, valor tabular e linha secundária), extraída para reuso.
 *
 * `labelNote` acrescenta um aviso curto em âmbar ao lado do label; o
 * `ng-content` default cai no rodapé do tile (chips, notas extras).
 *
 * @example
 * ```html
 * <app-stat-tile label="Total investido" [value]="total" hint="Compra + manutenções" />
 * ```
 */
@Component({
  selector: 'app-stat-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <div class="flex h-full min-w-0 flex-col rounded-2xl border border-line bg-white p-4">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 sm:text-xs">
        {{ label() }}
        @if (labelNote(); as note) {
          <span class="ml-1 normal-case tracking-normal text-amber-700">{{ note }}</span>
        }
      </p>
      <p class="mt-1 text-xl font-bold tabular-nums sm:text-2xl" [class]="toneClass()">
        {{ value() }}
      </p>
      @if (hint(); as h) {
        <p class="mt-1 text-[11px] text-neutral-500 sm:text-xs">{{ h }}</p>
      }
      <ng-content />
    </div>
  `,
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly labelNote = input<string | null>(null);
  readonly tone = input<StatTileTone>('brand');

  protected readonly toneClass = computed(() => TONE_CLASS[this.tone()]);
}
