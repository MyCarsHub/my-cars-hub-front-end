import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap } from 'rxjs';

import { PageCard } from '../../../components/core/page-card/page-card';
import { formatKpiNumber } from '../../../components/kpi-card/kpi-card';
import { ApiErrorService } from '../../../services/api-error.service';
import type { AdminHomeScope, AdminUpcoming } from '../../../types/admin-home.types';
import { AdminHomeService } from './admin-home.service';
import { monthShort, shortDay } from './admin-home.view';

/** Linhas mostradas (as primeiras datas); o total do período fica no pé. */
const SHOWN = 6;

export interface DueRow {
  readonly key: string;
  readonly date: string;
  readonly label: string;
  readonly value: string;
  readonly incoming: boolean;
  readonly note: string | null;
}

/** Pure: receber e pagar numa lista só, pela data; empate põe o receber antes. */
export function dueRows(data: AdminUpcoming, scope: AdminHomeScope): DueRow[] {
  const brl = (c: number) => formatKpiNumber('brl-cents-whole', c);
  const rows: DueRow[] = [
    ...data.receivables
      .filter((r) => scope === 'all' || !r.internal)
      .map((r) => ({
        key: `r-${r.companyId}-${r.dueDate}`,
        date: r.dueDate,
        label: `Receber: ${r.companyName} · ${r.planName}`,
        value: `+ ${brl(r.amountCents)}`,
        incoming: true,
        note: r.amountSource === 'LIST_PRICE' ? 'preço de tabela' : null,
      })),
    ...data.payables.map((p) => ({
      key: `p-${p.vendorId}-${p.dueDate}`,
      date: p.dueDate,
      label: `Pagar: ${p.vendorName}`,
      value: p.amountCents === null ? 'sem valor' : `− ${brl(p.amountCents)}`,
      incoming: false,
      note:
        p.amountCents === null
          ? 'nenhum custo lançado'
          : p.amountMonth
            ? `valor de ${monthShort(p.amountMonth)}`
            : null,
    })),
  ];
  return rows.sort((a, b) => (a.date === b.date ? Number(b.incoming) - Number(a.incoming) : a.date < b.date ? -1 : 1));
}

/**
 * "Próximos vencimentos": o que a plataforma recebe (renovações) e paga (fornecedores com dia de
 * cobrança) nos próximos 30 dias. Entrada em verde e saída em vermelho, só no texto do valor.
 * Fornecedor sem dia de cobrança não some em silêncio: o aviso abre o "Lançar custo" nele.
 */
@Component({
  selector: 'app-home-upcoming',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard],
  host: { class: 'block min-w-0' },
  template: `
    <app-page-card title="Próximos vencimentos" [fill]="true">
      <div class="px-4 sm:px-6 pb-5 flex flex-col gap-3 min-w-0 flex-1" data-home-upcoming>
        <p class="-mt-3 text-xs text-fg-subtle">O que a plataforma paga e recebe nos próximos 30 dias</p>
        @if (loading() && !data()) {
          <div class="space-y-1.5">
            @for (n of [0, 1, 2]; track n) {
              <div class="h-9 rounded-xl bg-surface-sunken animate-pulse motion-reduce:animate-none"></div>
            }
          </div>
        } @else if (error()) {
          <p role="alert" class="text-sm text-rose-700 dark:text-rose-300">
            {{ error() }}
            <button type="button" class="ml-1 underline min-h-[44px]" (click)="reload()">Tentar novamente</button>
          </p>
        } @else {
          <ul class="flex flex-col gap-1.5">
            @for (row of rows(); track row.key) {
              <li data-due-row class="flex items-center gap-2 rounded-xl bg-surface-muted px-3 py-2 min-w-0">
                <span class="w-11 shrink-0 text-xs text-fg-muted tabular-nums">{{ day(row.date) }}</span>
                <span class="flex-1 min-w-0">
                  <span class="block text-sm text-fg truncate">{{ row.label }}</span>
                  @if (row.note) {
                    <span class="block text-[11px] text-fg-subtle">{{ row.note }}</span>
                  }
                </span>
                <b
                  class="shrink-0 text-sm tabular-nums whitespace-nowrap"
                  [class.text-emerald-700]="row.incoming"
                  [class.dark:text-emerald-300]="row.incoming"
                  [class.text-rose-700]="!row.incoming"
                  [class.dark:text-rose-300]="!row.incoming"
                  >{{ row.value }}</b
                >
              </li>
            } @empty {
              <li class="text-sm text-fg-subtle py-4 text-center">Nada vence nos próximos 30 dias.</li>
            }
          </ul>
          @if (hidden() > 0) {
            <p class="text-xs text-fg-subtle">e mais {{ hidden() }} até {{ until() }}</p>
          }
          @if (data(); as d) {
            <p class="text-xs text-fg-muted tabular-nums">
              Receber {{ money(d.receivablesTotalCents) }}
              @if (d.payablesTotalCents !== null) {
                · pagar {{ money(d.payablesTotalCents) }}
              }
            </p>
            @if (d.vendorsWithoutBillingDay > 0) {
              @if (canManage()) {
                <button
                  type="button"
                  data-billing-day-prompt
                  class="press self-start min-h-11 rounded-xl bg-surface-sunken px-3 text-sm font-semibold text-fg-body
                         hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  (click)="askBillingDay.emit()"
                >
                  Informe o dia de cobrança de {{ vendorsText(d.vendorsWithoutBillingDay) }}
                </button>
              } @else {
                <p class="text-xs text-fg-subtle">
                  {{ vendorsText(d.vendorsWithoutBillingDay) }} sem dia de cobrança: o "pagar" fica incompleto.
                </p>
              }
            }
          }
        }
      </div>
    </app-page-card>
  `,
})
export class HomeUpcoming {
  private readonly service = inject(AdminHomeService);
  private readonly apiErrors = inject(ApiErrorService);

  readonly scope = input.required<AdminHomeScope>();
  /** Muda depois de um lançamento de custo: recarrega. */
  readonly reloadKey = input(0);
  readonly canManage = input(false);
  readonly askBillingDay = output<void>();

  protected readonly data = signal<AdminUpcoming | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  private readonly all = computed(() => {
    const d = this.data();
    return d ? dueRows(d, this.scope()) : [];
  });
  protected readonly rows = computed(() => this.all().slice(0, SHOWN));
  protected readonly hidden = computed(() => Math.max(0, this.all().length - SHOWN));
  protected readonly until = computed(() => {
    const u = this.data()?.until;
    return u ? shortDay(u) : '';
  });

  private readonly requests = new Subject<AdminHomeScope>();

  constructor() {
    this.requests
      .pipe(
        switchMap((scope) => {
          this.loading.set(true);
          this.error.set(null);
          return this.service.upcoming(scope).pipe(
            map((res) => ({ res, failure: null as unknown })),
            catchError((failure: unknown) => of({ res: null, failure })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ res, failure }) => {
        this.loading.set(false);
        if (res) {
          this.data.set(res);
          return;
        }
        this.apiErrors.claim(failure);
        this.data.set(null);
        this.error.set('Não foi possível carregar os vencimentos.');
      });
    effect(() => {
      this.reloadKey();
      this.requests.next(this.scope());
    });
  }

  protected reload(): void {
    this.requests.next(this.scope());
  }

  protected day(iso: string): string {
    return shortDay(iso);
  }

  protected money(cents: number): string {
    return formatKpiNumber('brl-cents-whole', cents);
  }

  protected vendorsText(n: number): string {
    return n === 1 ? '1 fornecedor' : `${n} fornecedores`;
  }
}
