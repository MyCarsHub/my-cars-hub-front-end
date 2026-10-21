import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, of, switchMap } from 'rxjs';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_LABEL,
  LIST_PERIODS,
  ListPeriod,
  addDays,
  brl,
  expenseLabel,
  integer,
  listPeriodFrom,
  newestFirst,
  plural,
  relativeDay,
} from './driver-finance.calc';
import { DriverFinanceClock } from './driver-finance.clock';
import { DriverFinanceSource } from './driver-finance.source';
import { ExpenseCategory, LedgerItem, LoadState } from './driver-finance.types';
import * as ui from './driver-finance.ui';
import { LedgerEntrySheet } from './ledger-entry-sheet';
import { ArrowSelect } from './arrow-select';

type CategoryFilter = ExpenseCategory | 'ALL';

/**
 * Custos — what the driver spent to drive: period and category chips, the total, the cost
 * per km (from the odometer readings typed with the costs), costs by category and the list
 * (cards below `lg`, table from `lg`). Every row opens the same popup to edit or delete.
 */
@Component({
  selector: 'app-driver-expenses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, ArrowSelect, LedgerEntrySheet],
  providers: [DriverFinanceClock],
  host: { class: 'block' },
  template: `
    <section [class]="ui.PAGE" aria-labelledby="expenses-title">
      <div [class]="ui.STACK">
        <header class="flex items-start justify-between gap-3">
          <div class="flex flex-col gap-1 min-w-0">
            <h1 id="expenses-title" [class]="ui.H1">Custos</h1>
            <p [class]="ui.LEAD">O que você gastou para rodar.</p>
          </div>
          @if (state() === 'ready' && hasAny()) {
            <div class="hidden sm:block shrink-0">
              <button type="button" data-action="new" (click)="openNew()" [class]="ui.BTN_PRIMARY">
                Novo custo
              </button>
            </div>
          }
        </header>

        @switch (state()) {
          @case ('error') {
            <app-alert-banner variant="error" data-state="error">
              Não foi possível carregar seus custos.
              <button type="button" (click)="load()" [class]="ui.RETRY">Tentar novamente</button>
            </app-alert-banner>
          }
          @case ('loading') {
            <div aria-hidden="true" data-state="loading" class="flex flex-col gap-4">
              <div [class]="ui.SKELETON + ' h-36'"></div>
              <div [class]="ui.SKELETON + ' h-52'"></div>
              <div [class]="ui.SKELETON + ' h-60'"></div>
            </div>
            <span class="sr-only" role="status">Carregando custos…</span>
          }
          @default {
            @if (!hasAny()) {
              <div data-state="empty" [class]="ui.CARD + ' px-6 py-10 flex flex-col items-center gap-4 text-center'">
                <p class="m-0 text-base text-neutral-600 max-w-[36ch]">Você ainda não lançou nenhum custo.</p>
                <button type="button" data-action="first" (click)="openNew()" [class]="ui.BTN_PRIMARY">
                  Lançar primeiro custo
                </button>
              </div>
            } @else {
              <div class="flex flex-col gap-2">
                <div role="radiogroup" aria-label="Período" appArrowSelect class="flex flex-wrap gap-2">
                  @for (p of periods; track p.key) {
                    <button type="button" role="radio" [attr.aria-checked]="period() === p.key" [attr.tabindex]="period() === p.key ? 0 : -1"
                      [attr.data-period]="p.key" (click)="period.set(p.key)"
                      [class]="period() === p.key ? ui.CHIP_ON : ui.CHIP_OFF">{{ p.label }}</button>
                  }
                </div>
                <div role="radiogroup" aria-label="Categoria" appArrowSelect class="flex flex-wrap gap-2">
                  @for (c of categoryChips; track c.key) {
                    <button type="button" role="radio" [attr.aria-checked]="category() === c.key" [attr.tabindex]="category() === c.key ? 0 : -1"
                      [attr.data-category]="c.key" (click)="category.set(c.key)"
                      [class]="category() === c.key ? ui.CHIP_ON : ui.CHIP_OFF">{{ c.label }}</button>
                  }
                </div>
              </div>

              <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                <div [class]="ui.CARD">
                  <div class="px-4 sm:px-6 pt-5 pb-1 flex flex-col gap-1">
                    <span [class]="ui.EYEBROW">Total no período</span>
                    <span data-total class="text-[32px] sm:text-[40px] font-bold leading-tight tabular-nums text-neutral-900">
                      {{ money(total()) }}
                    </span>
                  </div>
                  <dl class="m-0 grid grid-cols-2 gap-4 px-4 sm:px-6 pt-4 pb-5">
                    <div class="min-w-0 flex flex-col gap-0.5">
                      <dt [class]="ui.EYEBROW">Lançamentos</dt>
                      <dd class="m-0 text-lg font-semibold tabular-nums text-neutral-900">{{ rows().length }}</dd>
                    </div>
                    <div class="min-w-0 flex flex-col gap-0.5">
                      <dt [class]="ui.EYEBROW">Custo por km</dt>
                      <dd class="m-0 text-lg font-semibold tabular-nums text-neutral-900 whitespace-nowrap">{{ perKm() }}</dd>
                    </div>
                  </dl>
                </div>

                @if (byCategory().length) {
                  <div [class]="ui.CARD">
                    <div class="px-4 sm:px-6 pt-5 pb-2">
                      <h2 [class]="ui.H2">Por categoria</h2>
                      <p class="mt-0.5 mb-0 text-[13px] text-neutral-500">Para onde foi o dinheiro.</p>
                    </div>
                    <ul class="m-0 list-none px-4 sm:px-6 pt-2 pb-5 flex flex-col gap-3.5">
                      @for (b of byCategory(); track b.label) {
                        <li class="flex flex-col gap-1.5">
                          <div class="flex justify-between gap-2 text-sm text-neutral-800">
                            <span>{{ b.label }}</span>
                            <span class="font-semibold tabular-nums">{{ b.value }}</span>
                          </div>
                          <div class="h-2 rounded bg-neutral-100" aria-hidden="true">
                            <div class="h-2 rounded bg-neutral-700" [style.width.%]="b.pct"></div>
                          </div>
                        </li>
                      }
                    </ul>
                  </div>
                }
              </div>

              <div [class]="ui.CARD">
                <div class="px-4 sm:px-6 pt-5 pb-2">
                  <h2 [class]="ui.H2" data-list-title>{{ listTitle() }}</h2>
                </div>
                @if (rows().length) {
                  <div aria-hidden="true"
                    class="hidden lg:grid grid-cols-[120px_minmax(0,1fr)_140px_130px] gap-3 px-6 py-2.5 bg-neutral-50 border-t border-neutral-100 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    <span>Data</span><span>Categoria</span><span>Km do carro</span><span class="text-right">Valor</span>
                  </div>
                  <ul class="m-0 p-0 list-none">
                    @for (r of rows(); track r.item.id) {
                      <li>
                        <button type="button" data-row (click)="openEdit(r.item)" [attr.aria-label]="r.aria"
                          class="grid grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[120px_minmax(0,1fr)_140px_130px]
                                 items-center gap-3 w-full min-h-16 px-4 sm:px-6 py-2.5 border-0 border-t border-neutral-100
                                 bg-white text-left text-neutral-900 cursor-pointer hover:bg-neutral-50
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500">
                          <span class="lg:hidden min-w-0 flex flex-col gap-0.5">
                            <span class="text-sm font-medium text-neutral-900">{{ r.title }}</span>
                            <span class="text-[13px] text-neutral-500">Km do carro: {{ r.km }}</span>
                          </span>
                          <span class="hidden lg:block text-sm font-medium text-neutral-800">{{ r.when }}</span>
                          <span class="hidden lg:block text-sm text-neutral-800">{{ r.category }}</span>
                          <span class="hidden lg:block text-sm text-neutral-800 tabular-nums">{{ r.km }}</span>
                          <span class="text-sm font-semibold text-right tabular-nums whitespace-nowrap">{{ r.value }}</span>
                        </button>
                      </li>
                    }
                  </ul>
                } @else {
                  <div data-state="no-match"
                    class="px-6 py-8 flex flex-col items-center gap-3 text-center border-t border-neutral-100">
                    <p class="m-0 text-sm text-neutral-600">Nenhum custo com esses filtros.</p>
                    <button type="button" data-action="clear" (click)="clearFilters()" [class]="ui.BTN_OUTLINE">
                      Limpar filtros
                    </button>
                  </div>
                }
              </div>
            }
          }
        }
      </div>
    </section>

    @if (state() === 'ready' && hasAny()) {
      <div class="sm:hidden">
        <button type="button" data-action="fab" (click)="openNew()" [class]="ui.FAB">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          Novo custo
        </button>
      </div>
    }

    <app-ledger-entry-sheet [lastOdometer]="lastOdometer()" (saved)="onSaved($event.item)"
      (removed)="onRemoved($event)" />
  `,
})
export class DriverExpenses {
  private readonly source = inject(DriverFinanceSource);
  /** A signal: the page re-reads when the day turns over with it open. */
  private readonly today = inject(DriverFinanceClock).today;
  private readonly destroyRef = inject(DestroyRef);
  private readonly sheet = viewChild.required(LedgerEntrySheet);

  protected readonly ui = ui;
  protected readonly periods = LIST_PERIODS;
  protected readonly money = brl;
  protected readonly categoryChips: readonly { key: CategoryFilter; label: string }[] = [
    { key: 'ALL', label: 'Todas' },
    ...EXPENSE_CATEGORIES.map((c) => ({ key: c, label: EXPENSE_LABEL[c] })),
  ];

  protected readonly state = signal<LoadState>('loading');
  protected readonly items = signal<LedgerItem[]>([]);
  protected readonly hasAny = signal(false);
  /**
   * Highest odometer in the 30 days this page loads — the popup's "Último registro". A
   * reading older than that window is not seen (the ledger has no "last odometer" read).
   */
  protected readonly lastOdometer = signal<number | null>(null);
  protected readonly period = signal<ListPeriod>('30');
  protected readonly category = signal<CategoryFilter>('ALL');

  private readonly visible = computed(() => {
    const from = listPeriodFrom(this.period(), this.today());
    const cat = this.category();
    return this.items()
      .filter(
        (i) =>
          i.type === 'EXPENSE' &&
          i.date >= from &&
          i.date <= this.today() &&
          (cat === 'ALL' || i.category === cat),
      )
      .sort(newestFirst);
  });

  protected readonly total = computed(() => this.visible().reduce((t, i) => t + i.amount, 0));

  /**
   * Km driven in the PERIOD: highest − lowest odometer of every cost in it, whatever the
   * category chip (a category filter must not shrink the distance the car ran).
   */
  private readonly periodKm = computed(() => {
    const from = listPeriodFrom(this.period(), this.today());
    const kms = this.items()
      .filter((i) => i.type === 'EXPENSE' && i.date >= from && i.date <= this.today())
      .map((i) => i.odometerKm ?? 0)
      .filter((k) => k > 0);
    return kms.length > 1 ? Math.max(...kms) - Math.min(...kms) : 0;
  });

  /** The shown costs (all, or one category) ÷ the km of the period. */
  protected readonly perKm = computed(() => {
    const km = this.periodKm();
    return km ? brl(this.total() / km) : '—';
  });

  protected readonly byCategory = computed(() => {
    const total = this.total();
    // Every category the entries carry — one without a chip still gets its own bar, so the
    // bars always add up to the total.
    const sums = new Map<string, number>();
    for (const i of this.visible()) sums.set(i.category, (sums.get(i.category) ?? 0) + i.amount);
    const order = (c: string) => {
      const index = (EXPENSE_CATEGORIES as readonly string[]).indexOf(c);
      return index < 0 ? EXPENSE_CATEGORIES.length : index;
    };
    return [...sums.entries()]
      .sort((x, y) => order(x[0]) - order(y[0]))
      .map(([c, cents]) => ({ label: expenseLabel(c), cents }))
      .filter((x) => x.cents > 0)
      .map((x) => ({ label: x.label, value: brl(x.cents), pct: total ? Math.round((x.cents / total) * 100) : 0 }));
  });

  protected readonly rows = computed(() =>
    this.visible().map((item) => {
      const when = relativeDay(item.date, this.today());
      return {
        item,
        when,
        category: expenseLabel(item.category),
        km: item.odometerKm ? `${integer(item.odometerKm)} km` : '—',
        value: brl(item.amount),
        title: `${expenseLabel(item.category)} · ${when}`,
        aria: `Editar custo de ${brl(item.amount)}, ${when}`,
      };
    }),
  );

  protected readonly listTitle = computed(() =>
    plural(this.rows().length, 'lançamento', 'lançamentos'),
  );

  constructor() {
    // First load, and again when "hoje" turns over (the windows are relative to it).
    effect(() => {
      this.today();
      untracked(() => this.load());
    });
  }

  load(): void {
    this.state.set('loading');
    const today = this.today();
    this.source
      .list({ from: addDays(today, -29), to: today, type: 'EXPENSE' })
      .pipe(
        switchMap((items) =>
          items.length
            ? of({ items, any: true })
            : this.source.hasAny('EXPENSE').pipe(map((any) => ({ items, any }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ items, any }) => {
          this.items.set(items);
          this.hasAny.set(any);
          this.lastOdometer.set(this.maxOdometer(items));
          this.state.set('ready');
        },
        error: () => this.state.set('error'),
      });
  }

  protected clearFilters(): void {
    this.period.set('30');
    this.category.set('ALL');
  }

  protected openNew(): void {
    this.sheet().openCreate('EXPENSE');
  }

  protected openEdit(item: LedgerItem): void {
    this.sheet().openEdit(item);
  }

  protected onSaved(item: LedgerItem): void {
    this.items.update((list) => [item, ...list.filter((i) => i.id !== item.id)]);
    this.hasAny.set(true);
    this.lastOdometer.set(this.maxOdometer(this.items()));
  }

  protected onRemoved(id: string): void {
    this.items.update((list) => list.filter((i) => i.id !== id));
  }

  private maxOdometer(items: readonly LedgerItem[]): number | null {
    const max = Math.max(0, ...items.map((i) => i.odometerKm ?? 0));
    return max || null;
  }
}
