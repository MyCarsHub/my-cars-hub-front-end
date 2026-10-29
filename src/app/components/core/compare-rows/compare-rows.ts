import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Uma linha do lado a lado. Valores já formatados para exibição; `null` vira "—". */
export interface CompareRow {
  key: string;
  label: string;
  left: string | null;
  right: string | null;
  divergent: boolean;
}

/**
 * Lado a lado de dois registros com a divergência destacada.
 *
 * Reutilizável (comparar com o Asaas hoje; qualquer "nosso × deles" amanhã).
 * - celular: cada campo é um bloco com o rótulo em cima e os dois valores em
 *   duas colunas iguais logo abaixo — nada some nem quebra em 375px;
 * - ≥640px: tabela de três colunas (campo | esquerda | direita) usando a largura;
 * - divergente: faixa âmbar, borda lateral e selo "Diferente" (texto, não só cor);
 * - carregando: esqueleto com as mesmas alturas, sem spinner;
 * - entrada em cascata curta (`.enter-up`), desligada com reduced-motion.
 */
@Component({
  selector: 'app-compare-rows',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rounded-2xl border border-edge-soft overflow-hidden" data-testid="compare-rows">
      <div
        class="grid grid-cols-2 sm:grid-cols-[minmax(8rem,1fr)_1fr_1fr] gap-x-3 bg-surface-muted px-4 py-2
               text-xs font-semibold uppercase tracking-wide text-fg-subtle"
        aria-hidden="true"
      >
        <span class="hidden sm:block">Campo</span>
        <span>{{ leftLabel() }}</span>
        <span>{{ rightLabel() }}</span>
      </div>
      @if (loading()) {
        @for (n of skeleton; track n) {
          <div class="px-4 py-3 border-t border-edge-soft" data-testid="compare-skeleton">
            <div class="h-3 w-24 rounded bg-surface-sunken animate-pulse sm:hidden"></div>
            <div class="mt-2 sm:mt-0 grid grid-cols-2 sm:grid-cols-[minmax(8rem,1fr)_1fr_1fr] gap-3">
              <div class="hidden sm:block h-4 rounded bg-surface-sunken animate-pulse"></div>
              <div class="h-4 rounded bg-surface-sunken animate-pulse"></div>
              <div class="h-4 rounded bg-surface-sunken animate-pulse"></div>
            </div>
          </div>
        }
      } @else {
        <dl>
          @for (row of rows(); track row.key; let i = $index) {
            <div
              class="enter-up border-t border-edge-soft px-4 py-3 border-l-4 transition-colors"
              [class]="row.divergent
                ? 'border-l-amber-500 bg-amber-50 dark:bg-amber-500/10'
                : 'border-l-transparent hover:bg-canvas'"
              [style.--stagger-i]="i"
              [attr.data-testid]="'compare-row-' + row.key"
              [attr.data-divergent]="row.divergent"
            >
              <div class="grid grid-cols-2 sm:grid-cols-[minmax(8rem,1fr)_1fr_1fr] gap-x-3 gap-y-1 items-baseline">
                <dt class="col-span-2 sm:col-span-1 flex items-center gap-2 text-sm text-fg-muted">
                  {{ row.label }}
                  @if (row.divergent) {
                    <span
                      class="inline-flex rounded-full bg-amber-200 dark:bg-amber-500/25 px-2 py-0.5 text-[11px]
                             font-semibold text-amber-900 dark:text-amber-100"
                    >Diferente</span>
                  }
                </dt>
                <dd class="text-base sm:text-sm tabular-nums text-fg break-words">
                  <span class="sr-only">{{ leftLabel() }}: </span>{{ row.left ?? '—' }}
                </dd>
                <dd
                  class="text-base sm:text-sm tabular-nums break-words"
                  [class]="row.divergent ? 'font-semibold text-amber-900 dark:text-amber-100' : 'text-fg'"
                >
                  <span class="sr-only">{{ rightLabel() }}: </span>{{ row.right ?? '—' }}
                </dd>
              </div>
            </div>
          }
        </dl>
      }
    </div>
    @if (!loading() && divergentCount() > 0) {
      <p class="mt-2 text-sm text-amber-900 dark:text-amber-100" data-testid="compare-summary" role="status">
        {{ divergentCount() === 1 ? '1 campo diferente.' : divergentCount() + ' campos diferentes.' }}
      </p>
    }
  `,
})
export class CompareRows {
  readonly rows = input<CompareRow[]>([]);
  readonly leftLabel = input('Nosso');
  readonly rightLabel = input('Deles');
  readonly loading = input(false);

  protected readonly skeleton = [1, 2, 3, 4, 5];
  protected readonly divergentCount = computed(() => this.rows().filter((r) => r.divergent).length);
}
