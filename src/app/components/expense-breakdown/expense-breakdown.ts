import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { ExpenseBreakdownDto } from '../../types/dashboard.types';
import { ExpenseCategory, expenseRows } from '../../utils/expense-breakdown';
import { formatKpiNumber } from '../kpi-card/kpi-card';

/*
 * Classes escritas por extenso: o Tailwind só gera o utilitário que acha no fonte.
 * A cor mora SÓ no quadradinho do ícone; a linha, o rótulo e o valor ficam neutros.
 */
const CHIP: Record<ExpenseCategory, string> = {
  maintenance: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  fines: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  ipva: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  insurance: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  financing: 'bg-primary-100 text-primary-700 dark:bg-primary-500/15 dark:text-primary-400',
};

/**
 * Para onde foi o dinheiro: a despesa da janela quebrada em manutenção, multas, IPVA,
 * seguro e financiamento. Lista compacta (uma coluna no celular, cinco no desktop),
 * separada por espaço — sem linha divisória, sem fundo na linha.
 */
@Component({
  selector: 'app-expense-breakdown',
  // The host is the query container: columns follow ITS width (a 512px dialog is not a 1024px screen).
  host: { class: 'block @container min-w-0' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length > 0) {
      <ul class="grid gap-x-3 gap-y-3 grid-cols-2 @md:grid-cols-3 @2xl:grid-cols-5" [attr.aria-label]="ariaLabel()">
        @for (row of rows(); track row.key) {
          <li class="flex items-center gap-2.5 min-w-0 min-h-[44px]" [attr.data-expense]="row.key">
            <span class="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center" [class]="chip(row.key)" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                @switch (row.key) {
                  @case ('maintenance') {
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  }
                  @case ('fines') {
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <path d="M12 9v4" /><path d="M12 17h.01" />
                  }
                  @case ('ipva') {
                    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
                    <path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h5" />
                  }
                  @case ('insurance') {
                    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                  }
                  @case ('financing') {
                    <path d="M3 21h18" /><path d="M5 21V10" /><path d="M19 21V10" /><path d="M9 21v-7" /><path d="M15 21v-7" />
                    <path d="M12 3 3 8h18z" />
                  }
                }
              </svg>
            </span>
            <span class="flex-1 min-w-0">
              <span class="block text-xs text-gray-500 dark:text-fg-subtle break-words" data-expense-label>{{ row.label }}</span>
              <span class="block text-sm font-semibold tabular-nums whitespace-nowrap" data-expense-value
                    [class]="row.cents > 0 ? 'text-gray-900 dark:text-fg' : 'text-gray-400 dark:text-fg-faint'">
                {{ money(row.cents) }}
              </span>
              <span class="block text-[11px] text-gray-500 dark:text-fg-subtle tabular-nums" data-expense-share>{{ pct(row.share) }}</span>
            </span>
          </li>
        }
      </ul>
    }
  `,
})
export class ExpenseBreakdown {
  /** Quebra em centavos; aceita parcial (backend anterior manda só manutenção e multas). */
  readonly breakdown = input<Partial<ExpenseBreakdownDto> | null | undefined>(null);
  readonly ariaLabel = input('Despesas por categoria');

  protected readonly rows = computed(() => expenseRows(this.breakdown()));

  protected chip(key: ExpenseCategory): string {
    return CHIP[key];
  }

  protected money(cents: number): string {
    return formatKpiNumber('brl-cents', cents);
  }

  protected pct(share: number): string {
    return formatKpiNumber('ratio', share, 0);
  }
}
