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
import { of, switchMap } from 'rxjs';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import {
  LIST_PERIODS,
  ListPeriod,
  RIDE_APPS,
  addDays,
  appLabel,
  brl,
  decimal,
  integer,
  listPeriodFrom,
  newestFirst,
  plural,
  relativeDay,
} from './driver-finance.calc';
import { DriverFinanceClock } from './driver-finance.clock';
import { DriverFinanceSource } from './driver-finance.source';
import { LedgerItem, LoadState } from './driver-finance.types';
import * as ui from './driver-finance.ui';
import { LedgerEntrySheet } from './ledger-entry-sheet';
import { ArrowSelect } from './arrow-select';

/**
 * Ganhos — what the driver earned with rides: period chips (hoje, 7, 30 dias), the total
 * with corridas/horas/km/valor por hora, earnings by app and the list (cards below `lg`,
 * table from `lg`). Every row opens the same popup to edit or delete.
 *
 * Reads the last 30 days once and filters in memory: the three periods are windows of it.
 */
@Component({
  selector: 'app-driver-earnings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, ArrowSelect, LedgerEntrySheet],
  providers: [DriverFinanceClock],
  host: { class: 'block' },
  template: `
    <section [class]="ui.PAGE" aria-labelledby="earnings-title">
      <div [class]="ui.STACK">
        <header class="flex items-start justify-between gap-3">
          <div class="flex flex-col gap-1 min-w-0">
            <h1 id="earnings-title" [class]="ui.H1">Ganhos</h1>
            <p [class]="ui.LEAD">O que você ganhou com corridas.</p>
          </div>
          @if (state() === 'ready' && hasAny()) {
            <div class="hidden sm:block shrink-0">
              <button type="button" data-action="new" (click)="openNew()" [class]="ui.BTN_PRIMARY">
                Novo ganho
              </button>
            </div>
          }
        </header>

        @switch (state()) {
          @case ('error') {
            <app-alert-banner variant="error" data-state="error">
              Não foi possível carregar seus ganhos.
              <button type="button" (click)="load()" [class]="ui.RETRY">Tentar novamente</button>
            </app-alert-banner>
          }
          @case ('loading') {
            <div aria-hidden="true" data-state="loading" class="flex flex-col gap-4">
              <div [class]="ui.SKELETON + ' h-36'"></div>
              <div [class]="ui.SKELETON + ' h-52'"></div>
              <div [class]="ui.SKELETON + ' h-60'"></div>
            </div>
            <span class="sr-only" role="status">Carregando ganhos…</span>
          }
          @default {
            @if (!hasAny()) {
              <div data-state="empty" [class]="ui.CARD + ' px-6 py-10 flex flex-col items-center gap-4 text-center'">
                <p class="m-0 text-base text-neutral-600 max-w-[36ch]">Você ainda não lançou nenhum ganho.</p>
                <button type="button" data-action="first" (click)="openNew()" [class]="ui.BTN_PRIMARY">
                  Lançar primeiro ganho
                </button>
              </div>
            } @else {
              <div role="radiogroup" aria-label="Período" appArrowSelect class="flex flex-wrap gap-2">
                @for (p of periods; track p.key) {
                  <button type="button" role="radio" [attr.aria-checked]="period() === p.key" [attr.tabindex]="period() === p.key ? 0 : -1"
                    [attr.data-period]="p.key" (click)="period.set(p.key)"
                    [class]="period() === p.key ? ui.CHIP_ON : ui.CHIP_OFF">{{ p.label }}</button>
                }
              </div>

              <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                <div [class]="ui.CARD">
                  <div class="px-4 sm:px-6 pt-5 pb-1 flex flex-col gap-1">
                    <span [class]="ui.EYEBROW">Total no período</span>
                    <span data-total class="text-[32px] sm:text-[40px] font-bold leading-tight tabular-nums text-neutral-900">
                      {{ money(summary().gross) }}
                    </span>
                  </div>
                  <dl class="m-0 grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4 gap-4 px-4 sm:px-6 pt-4 pb-5">
                    @for (k of kpis(); track k.label) {
                      <div class="min-w-0 flex flex-col gap-0.5">
                        <dt [class]="ui.EYEBROW">{{ k.label }}</dt>
                        <dd class="m-0 text-lg font-semibold tabular-nums text-neutral-900 whitespace-nowrap">{{ k.value }}</dd>
                      </div>
                    }
                  </dl>
                </div>

                @if (byApp().length) {
                  <div [class]="ui.CARD">
                    <div class="px-4 sm:px-6 pt-5 pb-2">
                      <h2 [class]="ui.H2">Por app</h2>
                      <p class="mt-0.5 mb-0 text-[13px] text-neutral-500">Quanto cada app rendeu no período.</p>
                    </div>
                    <ul class="m-0 list-none px-4 sm:px-6 pt-2 pb-5 flex flex-col gap-3.5">
                      @for (b of byApp(); track b.label) {
                        <li class="flex flex-col gap-1.5">
                          <div class="flex justify-between gap-2 text-sm text-neutral-800">
                            <span>{{ b.label }}</span>
                            <span class="font-semibold tabular-nums">{{ b.value }}</span>
                          </div>
                          <div class="h-2 rounded bg-neutral-100" aria-hidden="true">
                            <div class="h-2 rounded bg-success-500" [style.width.%]="b.pct"></div>
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
                    class="hidden lg:grid grid-cols-[120px_minmax(0,1fr)_90px_90px_90px_130px] gap-3 px-6 py-2.5 bg-neutral-50 border-t border-neutral-100 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    <span>Data</span><span>App</span><span>Corridas</span><span>Horas</span><span>Km</span>
                    <span class="text-right">Valor</span>
                  </div>
                  <ul class="m-0 p-0 list-none">
                    @for (r of rows(); track r.item.id) {
                      <li>
                        <button type="button" data-row (click)="openEdit(r.item)" [attr.aria-label]="r.aria"
                          class="grid grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[120px_minmax(0,1fr)_90px_90px_90px_130px]
                                 items-center gap-3 w-full min-h-16 px-4 sm:px-6 py-2.5 border-0 border-t border-neutral-100
                                 bg-white text-left text-neutral-900 cursor-pointer hover:bg-neutral-50
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500">
                          <span class="lg:hidden min-w-0 flex flex-col gap-0.5">
                            <span class="text-sm font-medium text-neutral-900">{{ r.title }}</span>
                            <span class="text-[13px] text-neutral-500">{{ r.sub }}</span>
                          </span>
                          <span class="hidden lg:block text-sm font-medium text-neutral-800">{{ r.when }}</span>
                          <span class="hidden lg:block text-sm text-neutral-800">{{ r.app }}</span>
                          <span class="hidden lg:block text-sm text-neutral-800 tabular-nums">{{ r.rides }}</span>
                          <span class="hidden lg:block text-sm text-neutral-800 tabular-nums">{{ r.hours }}</span>
                          <span class="hidden lg:block text-sm text-neutral-800 tabular-nums">{{ r.km }}</span>
                          <span class="text-sm font-semibold text-right tabular-nums whitespace-nowrap">{{ r.value }}</span>
                        </button>
                      </li>
                    }
                  </ul>
                } @else {
                  <div data-state="no-match"
                    class="px-6 py-8 flex flex-col items-center gap-3 text-center border-t border-neutral-100">
                    <p class="m-0 text-sm text-neutral-600">Nenhum ganho neste período.</p>
                    <button type="button" data-action="clear" (click)="period.set('30')" [class]="ui.BTN_OUTLINE">
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
          Novo ganho
        </button>
      </div>
    }

    <app-ledger-entry-sheet (saved)="onSaved($event.item)" (removed)="onRemoved($event)" />
  `,
})
export class DriverEarnings {
  private readonly source = inject(DriverFinanceSource);
  /** A signal: the page re-reads when the day turns over with it open. */
  private readonly today = inject(DriverFinanceClock).today;
  private readonly destroyRef = inject(DestroyRef);
  private readonly sheet = viewChild.required(LedgerEntrySheet);

  protected readonly ui = ui;
  protected readonly periods = LIST_PERIODS;
  protected readonly money = brl;

  protected readonly state = signal<LoadState>('loading');
  protected readonly items = signal<LedgerItem[]>([]);
  /** At least one ganho at any date — "vazio" versus "vazio com filtros". */
  protected readonly hasAny = signal(false);
  protected readonly period = signal<ListPeriod>('7');

  private readonly visible = computed(() => {
    const from = listPeriodFrom(this.period(), this.today());
    return this.items()
      .filter((i) => i.type === 'INCOME' && i.date >= from && i.date <= this.today())
      .sort(newestFirst);
  });

  protected readonly summary = computed(() => {
    const s = { gross: 0, rides: 0, hours: 0, km: 0 };
    for (const i of this.visible()) {
      s.gross += i.amount;
      s.rides += i.rides ?? 0;
      s.hours += i.hours ?? 0;
      s.km += i.km ?? 0;
    }
    return s;
  });

  protected readonly kpis = computed(() => {
    const s = this.summary();
    return [
      { label: 'Corridas', value: integer(s.rides) },
      { label: 'Horas', value: `${decimal(s.hours)} h` },
      { label: 'Km', value: integer(s.km) },
      { label: 'Por hora', value: s.hours ? brl(s.gross / s.hours) : '—' },
    ];
  });

  protected readonly byApp = computed(() => {
    const total = this.summary().gross;
    return RIDE_APPS.map((app) => ({
      label: appLabel(app),
      cents: this.visible()
        .filter((i) => i.app === app)
        .reduce((t, i) => t + i.amount, 0),
    }))
      .filter((x) => x.cents > 0)
      .map((x) => ({ label: x.label, value: brl(x.cents), pct: total ? Math.round((x.cents / total) * 100) : 0 }));
  });

  protected readonly rows = computed(() =>
    this.visible().map((item) => {
      const when = relativeDay(item.date, this.today());
      const hours = item.hours ? `${decimal(item.hours)} h` : '—';
      const km = item.km ? `${integer(item.km)} km` : '—';
      return {
        item,
        when,
        app: appLabel(item.app),
        rides: item.rides ?? '—',
        hours,
        km,
        value: brl(item.amount),
        title: `${appLabel(item.app)} · ${when}`,
        sub:
          [
            item.rides ? plural(item.rides, 'corrida', 'corridas') : null,
            item.hours ? hours : null,
            item.km ? km : null,
          ]
            .filter(Boolean)
            .join(' · ') ||
          item.notes ||
          'Sem detalhes',
        aria: `Editar ganho de ${brl(item.amount)}, ${when}`,
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
      .list({ from: addDays(today, -29), to: today, type: 'INCOME' })
      .pipe(
        switchMap((items) =>
          items.length
            ? of({ items, any: true })
            : this.source.hasAny('INCOME').pipe(switchMap((any) => of({ items, any }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ items, any }) => {
          this.items.set(items);
          this.hasAny.set(any);
          this.state.set('ready');
        },
        error: () => this.state.set('error'),
      });
  }

  protected openNew(): void {
    this.sheet().openCreate('INCOME');
  }

  protected openEdit(item: LedgerItem): void {
    this.sheet().openEdit(item);
  }

  protected onSaved(item: LedgerItem): void {
    this.items.update((list) => [item, ...list.filter((i) => i.id !== item.id)]);
    this.hasAny.set(true);
  }

  protected onRemoved(id: string): void {
    this.items.update((list) => list.filter((i) => i.id !== id));
  }
}
