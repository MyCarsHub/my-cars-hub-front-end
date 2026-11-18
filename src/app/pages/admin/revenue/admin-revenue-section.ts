import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap } from 'rxjs';

import { BarChart } from '../../../components/charts/bar-chart/bar-chart';
import { GrowthChart, type GrowthSeries } from '../../../components/charts/growth-chart/growth-chart';
import { PillTabs, type PillTabOption } from '../../../components/core/pill-tabs/pill-tabs';
import { PageCard } from '../../../components/core/page-card/page-card';
import { KpiCard } from '../../../components/kpi-card/kpi-card';
import { ApiErrorService } from '../../../services/api-error.service';
import { formatBRL } from '../../../types/dashboard.types';
import type { AdminRevenue, AdminRevenuePeriod } from '../../../types/admin-revenue.types';
import { MONEY_AXIS_FLOOR_CENTS } from '../../../utils/money-axis';
import { AdminRevenueService } from './admin-revenue.service';
import { dateLabel, monthBars, presentSeries, receivedShare } from './admin-revenue.series';

/** Cores do protótipo (Admin.dc.html): laranja da marca para o MRR, verde para o caixa. */
const BRAND_ORANGE = '#F63B04';
const BRAND_GREEN = '#0a9b62';

const PERIODS: readonly PillTabOption<AdminRevenuePeriod>[] = [
  { value: '3m', label: '3 meses' },
  { value: '12m', label: '12 meses' },
  { value: 'all', label: 'Desde o início' },
];

/**
 * Receita DA PLATAFORMA na Visão geral do admin (assinaturas das locadoras ao MyCarsHub): esperado
 * do mês, recebido, desconto em cupons, acumulado e o crescimento do MRR. Os cartões de cima da
 * Visão geral ficam como estão; esta seção entra logo abaixo deles, no lugar de "Crescimento ao
 * longo do tempo" do protótipo.
 *
 * Mês sem dado não vira zero: sai do gráfico e a legenda diz desde quando o dado existe.
 */
@Component({
  selector: 'app-admin-revenue-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KpiCard, PageCard, GrowthChart, BarChart, PillTabs],
  host: { class: 'block mb-4' },
  template: `
    <section aria-labelledby="admin-revenue-title" data-admin-revenue>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-3">
        <div class="min-w-0">
          <h2 id="admin-revenue-title" class="text-base font-semibold text-fg">Receita da plataforma</h2>
          <p class="text-xs text-fg-subtle mt-0.5">
            Assinaturas das locadoras ao MyCarsHub. Contas internas ficam de fora.
          </p>
        </div>
        <app-pill-tabs
          [options]="periods"
          [value]="period()"
          ariaLabel="Período dos gráficos de receita"
          (selected)="pick($event)"
        />
      </div>

      @if (error()) {
        <div
          role="alert"
          class="rounded-lg bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm p-3 mb-3"
        >
          {{ error() }}
          <button type="button" class="ml-2 underline hover:no-underline min-h-[44px]" (click)="reload()">
            Tentar novamente
          </button>
        </div>
      }

      <div class="grid gap-3 grid-cols-2 xl:grid-cols-4 mb-4">
        <div
          app-kpi-card
          data-expected-card
          class="col-span-2 xl:col-span-1"
          variant="primary"
          label="Esperado no mês"
          numberFormat="brl-cents-whole"
          [anchored]="true"
          [stagger]="0"
          [loading]="pending()"
          [value]="revenue()?.expected?.expectedCents ?? null"
          [detail]="expectedDetail()"
          [progress]="expectedProgress()"
        ></div>
        <div
          app-kpi-card
          data-received-card
          variant="emerald"
          label="Recebido no mês"
          numberFormat="brl-cents-whole"
          placeholder="dash"
          [anchored]="true"
          [stagger]="1"
          [loading]="pending()"
          [value]="revenue()?.received?.monthCents ?? null"
          [detail]="receivedDetail()"
        ></div>
        <div
          app-kpi-card
          data-discount-card
          variant="white"
          label="Desconto em cupons no mês"
          numberFormat="brl-cents-whole"
          placeholder="dash"
          [anchored]="true"
          [stagger]="2"
          [loading]="pending()"
          [value]="revenue()?.discounts?.monthCents ?? null"
          [detail]="discountDetail()"
        ></div>
        <div
          app-kpi-card
          data-cumulative-card
          variant="white"
          label="Faturamento acumulado"
          numberFormat="brl-cents-whole"
          placeholder="dash"
          [anchored]="true"
          [stagger]="3"
          [loading]="pending()"
          [value]="revenue()?.received?.totalCents ?? null"
          [detail]="cumulativeDetail()"
        ></div>
      </div>

      <!-- Sem o MRR ficam três gráficos: uma fileira de três, sem metade vazia; cada cartão na
           altura do conteúdo (o de cupons fica curto quando a Stripe não responde). -->
      <div
        class="grid gap-4 grid-cols-1"
        [class.lg:grid-cols-2]="showMrr()"
        [class.lg:grid-cols-3]="!showMrr()"
        [class.items-start]="!showMrr()"
        data-revenue-charts
      >
        @if (showMrr()) {
        <app-page-card title="Crescimento do MRR">
          <div class="p-4" data-mrr-chart>
            <p class="text-xs text-fg-subtle mb-3">
              Receita recorrente por mês pelo preço de tabela: a última foto diária de cada mês.
              @if (mrrSince(); as since) {
                O histórico começa em {{ since }}.
              }
            </p>
            @if (pending()) {
              <div class="h-40 rounded bg-surface-sunken animate-pulse"></div>
            } @else if (mrrSeries().values.length > 0) {
              <app-growth-chart
                [series]="mrrChart()"
                [labels]="mrrSeries().labels"
                valueFormat="brl-cents-compact"
                [axisFloor]="axisFloor"
                [endDot]="true"
                [endTooltip]="true"
                [heightPx]="180"
                ariaLabel="MRR estimado da plataforma por mês"
              />
            } @else {
              <p data-empty class="text-sm text-fg-subtle text-center py-10">{{ mrrEmpty() }}</p>
            }
          </div>
        </app-page-card>
        }

        <app-page-card title="Faturamento acumulado">
          <div class="p-4" data-cumulative-chart>
            <p class="text-xs text-fg-subtle mb-3">
              Tudo o que entrou das assinaturas, somado mês a mês.
              @if (receivedSince(); as since) {
                O caixa é registrado desde {{ since }}; antes disso não há dado.
              }
            </p>
            @if (pending()) {
              <div class="h-40 rounded bg-surface-sunken animate-pulse"></div>
            } @else if (cumulativeSeries().values.length > 0) {
              <app-growth-chart
                [series]="cumulativeChart()"
                [labels]="cumulativeSeries().labels"
                valueFormat="brl-cents-compact"
                [axisFloor]="axisFloor"
                [smooth]="false"
                [endDot]="true"
                [endTooltip]="true"
                [heightPx]="180"
                emptyText="Nada recebido no período."
                ariaLabel="Faturamento acumulado da plataforma por mês"
              />
            } @else {
              <p data-empty class="text-sm text-fg-subtle text-center py-10">{{ receivedEmpty() }}</p>
            }
          </div>
        </app-page-card>

        <app-page-card title="Recebido por mês">
          <div class="p-4" data-received-chart>
            <p class="text-xs text-fg-subtle mb-3">
              Pagamentos de assinatura confirmados, no mês em que entraram.
            </p>
            @if (pending()) {
              <div class="h-32 rounded bg-surface-sunken animate-pulse"></div>
            } @else if (receivedBars().length > 0) {
              <app-bar-chart [data]="receivedBars()" />
              @if (revenue()?.received?.rowsWithoutAmount; as unknown) {
                <p class="text-xs text-fg-subtle mt-3">
                  {{ unknown }} pagamento(s) sem valor informado pelo gateway, fora da soma.
                </p>
              }
            } @else {
              <p data-empty class="text-sm text-fg-subtle text-center py-10">{{ receivedEmpty() }}</p>
            }
          </div>
        </app-page-card>

        <app-page-card title="Desconto dado em cupons">
          <div class="p-4" data-discount-chart>
            <p class="text-xs text-fg-subtle mb-3">
              Quanto os cupons tiraram das faturas pagas, no mês do pagamento. Fatura devolvida não conta.
            </p>
            @if (pending()) {
              <div class="h-32 rounded bg-surface-sunken animate-pulse"></div>
            } @else if (!discountsAvailable()) {
              <p data-empty class="text-sm text-fg-subtle py-2">
                Indisponível agora: a Stripe não respondeu a tempo. Os outros números seguem valendo.
              </p>
            } @else {
              <app-bar-chart [data]="discountBars()" />
              @if (revenue()?.discounts?.truncated) {
                <p class="text-xs text-amber-700 dark:text-amber-300 mt-3">
                  Muitas faturas no período: a leitura parou no limite e o valor pode estar abaixo do real.
                </p>
              }
            }
          </div>
        </app-page-card>
      </div>
    </section>
  `,
})
export class AdminRevenueSection implements OnInit {
  private readonly service = inject(AdminRevenueService);
  private readonly apiErrors = inject(ApiErrorService);

  /**
   * O gráfico do MRR estimado. A Visão geral v2 desliga: ela já desenha o MRR real e o estimado
   * juntos, e dois gráficos de MRR na mesma tela diriam coisas diferentes.
   */
  readonly showMrr = input(true);

  protected readonly periods = PERIODS;
  protected readonly axisFloor = MONEY_AXIS_FLOOR_CENTS;
  protected readonly period = signal<AdminRevenuePeriod>('12m');

  private readonly data = signal<AdminRevenue | null>(null);
  private readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /**
   * Só a resposta DO período selecionado: o número de "12 meses" nunca aparece sob "Desde o início".
   * O estado é da seção (não de um serviço raiz), então voltar ao /admin não mostra a visita anterior.
   */
  protected readonly revenue = computed(() => {
    const d = this.data();
    return d && d.period === this.period() ? d : null;
  });
  protected readonly pending = computed(() => this.loading() && !this.revenue());

  /** Cada troca de período cancela a carga anterior (switchMap): resposta atrasada não sobrescreve. */
  private readonly requests = new Subject<AdminRevenuePeriod>();

  constructor() {
    this.requests
      .pipe(
        switchMap((period) => {
          this.loading.set(true);
          this.error.set(null);
          return this.service.fetch(period).pipe(
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
        // A seção mostra o próprio aviso; reivindicar o erro evita o toast repetido do interceptor.
        this.apiErrors.claim(failure);
        this.data.set(null);
        this.error.set('Não foi possível carregar a receita da plataforma.');
      });
  }

  private readonly months = computed(() => this.revenue()?.months ?? []);

  protected readonly mrrSeries = computed(() => presentSeries(this.months(), (m) => m.mrrCents));
  protected readonly mrrChart = computed<GrowthSeries[]>(() => [
    { key: 'mrr', label: 'MRR estimado', color: BRAND_ORANGE, values: this.mrrSeries().values },
  ]);
  protected readonly mrrSince = computed(() => dateLabel(this.revenue()?.mrr?.since ?? null));
  protected readonly mrrEmpty = computed(() => {
    const since = this.mrrSince();
    return since
      ? `Sem foto diária neste período. O histórico começa em ${since}.`
      : 'Ainda sem foto diária do MRR.';
  });

  protected readonly cumulativeSeries = computed(() =>
    presentSeries(this.months(), (m) => m.cumulativeReceivedCents),
  );
  protected readonly cumulativeChart = computed<GrowthSeries[]>(() => [
    { key: 'cumulative', label: 'Acumulado', color: BRAND_GREEN, values: this.cumulativeSeries().values },
  ]);

  protected readonly receivedSince = computed(() => dateLabel(this.revenue()?.received?.since ?? null));
  protected readonly receivedBars = computed(() => monthBars(this.months(), (m) => m.receivedCents));
  protected readonly receivedEmpty = computed(() => {
    const since = this.receivedSince();
    return since
      ? `Nenhum pagamento neste período. O caixa é registrado desde ${since}.`
      : 'Nenhum pagamento de assinatura registrado ainda.';
  });

  protected readonly discountsAvailable = computed(() => this.revenue()?.discounts?.available ?? false);
  protected readonly discountBars = computed(() => monthBars(this.months(), (m) => m.couponDiscountCents));

  protected readonly expectedDetail = computed(() => {
    const e = this.revenue()?.expected;
    if (!e) return null;
    const until = dateLabel(e.until)?.slice(0, 5) ?? '';
    const renewals =
      e.upcomingRenewals === 1 ? '1 renovação' : `${e.upcomingRenewals} renovações`;
    return `${formatBRL(e.receivedCents)} recebido + ${renewals} até ${until}, pelo preço de tabela, sem cupom`;
  });
  protected readonly expectedProgress = computed(() => {
    const e = this.revenue()?.expected;
    return e ? receivedShare(e.receivedCents, e.expectedCents) : null;
  });

  protected readonly receivedDetail = computed(() => {
    if (!this.revenue()) return null;
    const since = this.receivedSince();
    return since ? `caixa registrado desde ${since}` : 'nenhum pagamento registrado ainda';
  });

  protected readonly discountDetail = computed(() => {
    const d = this.revenue()?.discounts;
    if (!d) return null;
    if (!d.available) return 'Stripe indisponível agora';
    return `${formatBRL(d.periodCents ?? 0)} no período escolhido`;
  });

  protected readonly cumulativeDetail = computed(() => {
    if (!this.revenue()) return null;
    const since = this.receivedSince();
    return since ? `desde ${since}` : 'começa no primeiro pagamento';
  });

  ngOnInit(): void {
    this.requests.next(this.period());
  }

  protected pick(period: AdminRevenuePeriod): void {
    if (period === this.period()) return;
    this.period.set(period);
    this.requests.next(period);
  }

  protected reload(): void {
    this.requests.next(this.period());
  }
}
