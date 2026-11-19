import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap } from 'rxjs';

import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BarChart, type BarSeries } from '../../../components/charts/bar-chart/bar-chart';
import { CHART_GREEN, chartSeriesColors } from '../../../components/charts/chart-tooltip/chart-tooltip';
import { GrowthChart, type GrowthSeries } from '../../../components/charts/growth-chart/growth-chart';
import { PageCard } from '../../../components/core/page-card/page-card';
import { formatDateRangePtBr } from '../../../components/date-range-picker/date-range-picker';
import { KpiCard, type KpiDelta } from '../../../components/kpi-card/kpi-card';
import { formatBrl } from '../../../pipes/brl.pipe';
import { ApiErrorService } from '../../../services/api-error.service';
import type { AdminHomeRange } from '../../../types/admin-home.types';
import type { AdminRevenue, AdminRevenueBucket, AdminRevenuePoint } from '../../../types/admin-revenue.types';
import { MONEY_AXIS_FLOOR_CENTS } from '../../../utils/money-axis';
import { bucketLabels, monthLong, valueDelta } from '../home/admin-home.view';
import { AdminRevenueService } from './admin-revenue.service';
import { dateLabel, receivedShare } from './admin-revenue.series';

/** Recebido é caixa: verde. MRR e desconto são série única: a cor principal (laranja). */
const RECEIVED_COLOR = CHART_GREEN;
const SINGLE_SERIES_COLOR = chartSeriesColors([1])[0];

/** Chave do pedido: a resposta só aparece sob as datas que a pediram. */
export function rangeKey(range: AdminHomeRange | null): string | null {
  return range ? `${range.from}|${range.to}` : null;
}

/**
 * Os pontos do gráfico: um por intervalo da janela (`points`, contrato `changed:` 18/11). Servidor
 * de antes da mudança só manda `months`: cada mês vira um ponto, para a tela não quebrar.
 */
export function revenuePoints(r: AdminRevenue | null): readonly AdminRevenuePoint[] {
  if (!r) return [];
  if (r.points) return r.points;
  return r.months.map((m) => ({
    start: `${m.month}-01`,
    end: `${m.month}-01`,
    mrrCents: m.mrrCents,
    mrrAsOf: m.mrrAsOf,
    receivedCents: m.receivedCents,
    cumulativeReceivedCents: m.cumulativeReceivedCents,
    couponDiscountCents: m.couponDiscountCents,
  }));
}

const BUCKET_WORD: Record<AdminRevenueBucket, string> = { DAY: 'dia', WEEK: 'semana', MONTH: 'mês' };

const hasValue = (values: readonly (number | null)[]): boolean => values.some((v) => v !== null);

/** Pure: the period total of a chart in cents, as "R$ 1.234,56"; null when nothing above zero was measured. */
export function periodTotalText(values: readonly (number | null | undefined)[]): string | null {
  const total = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  return total > 0 ? formatBrl(total) : null;
}

/**
 * Receita DA PLATAFORMA na Visão geral do admin (assinaturas das locadoras ao MyCarsHub): esperado
 * do mês, recebido e desconto em cupons NO PERÍODO da tela, acumulado e o crescimento do MRR.
 *
 * O período é o da página (um controle só, regra do dono 18/11): a seção recebe `range` e não tem
 * pílulas próprias. Ponto sem dado não vira zero: fica sem marca no gráfico e a legenda diz desde
 * quando o dado existe.
 */
@Component({
  selector: 'app-admin-revenue-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KpiCard, PageCard, GrowthChart, BarChart, AlertBanner],
  host: { class: 'block mb-4' },
  template: `
    <section aria-labelledby="admin-revenue-title" data-admin-revenue>
      <div class="mb-3 min-w-0">
        <h2 id="admin-revenue-title" class="text-base font-semibold text-fg">Receita da plataforma</h2>
        <p class="text-xs text-fg-subtle mt-0.5" data-revenue-range>
          Assinaturas das locadoras ao MyCarsHub{{ rangeText() ? ', de ' + rangeText() : ', no período escolhido' }}.
          Contas internas ficam de fora.
        </p>
      </div>

      @if (error(); as e) {
        <app-alert-banner class="mb-3" [message]="e">
          <button type="button" class="ml-1 underline min-h-[44px]" (click)="reload()">Tentar novamente</button>
        </app-alert-banner>
      }

      <div class="grid gap-3 grid-cols-2 xl:grid-cols-4 mb-4">
        <div
          app-kpi-card
          data-expected-card
          class="col-span-2 xl:col-span-1"
          variant="primary"
          [label]="expectedLabel()"
          numberFormat="brl-cents"
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
          [label]="receivedLabel()"
          numberFormat="brl-cents"
          placeholder="dash"
          [anchored]="true"
          [stagger]="1"
          [loading]="pending()"
          [value]="receivedValue()"
          [delta]="receivedDelta()"
          [detail]="receivedDetail()"
        ></div>
        <div
          app-kpi-card
          data-discount-card
          variant="white"
          label="Desconto em cupons no período"
          numberFormat="brl-cents"
          placeholder="dash"
          [anchored]="true"
          [stagger]="2"
          [loading]="pending()"
          [value]="discountValue()"
          [detail]="discountDetail()"
        ></div>
        <div
          app-kpi-card
          data-cumulative-card
          variant="white"
          label="Faturamento acumulado"
          numberFormat="brl-cents"
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
                Receita recorrente pelo preço de tabela: a última foto diária de cada intervalo.
                @if (mrrSince(); as since) {
                  O histórico começa em {{ since }}.
                }
              </p>
              @if (pending()) {
                <div class="h-40 rounded bg-surface-sunken dark:bg-placeholder-fill animate-pulse"></div>
              } @else if (hasMrr()) {
                <app-growth-chart
                  [series]="mrrChart()"
                  [labels]="labels()"
                  valueFormat="brl-cents-compact"
                  [axisFloor]="axisFloor"
                  [endDot]="true"
                  [heightPx]="180"
                  ariaLabel="MRR estimado da plataforma no período"
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
              Tudo o que entrou das assinaturas, somado até o fim de cada {{ bucketWord() }}.
              @if (receivedSince(); as since) {
                O caixa é registrado desde {{ since }}; antes disso não há dado.
              }
            </p>
            @if (pending()) {
              <div class="h-40 rounded bg-surface-sunken dark:bg-placeholder-fill animate-pulse"></div>
            } @else if (hasCumulative()) {
              <app-growth-chart
                [series]="cumulativeChart()"
                [labels]="labels()"
                valueFormat="brl-cents-compact"
                [axisFloor]="axisFloor"
                [smooth]="false"
                [endDot]="true"
                [heightPx]="180"
                emptyText="Nada recebido no período."
                ariaLabel="Faturamento acumulado da plataforma no período"
              />
            } @else {
              <p data-empty class="text-sm text-fg-subtle text-center py-10">{{ receivedEmpty() }}</p>
            }
          </div>
        </app-page-card>

        <app-page-card [title]="'Recebido por ' + bucketWord()">
          <div class="p-4" data-received-chart>
            @if (!pending() && receivedTotal(); as total) {
              <p class="text-xl font-semibold text-fg tabular-nums leading-tight mb-1" data-received-total>
                {{ total }} <span class="text-xs font-normal text-fg-subtle">no período</span>
              </p>
            }
            <p class="text-xs text-fg-subtle mb-3">
              Pagamentos de assinatura confirmados, no {{ bucketWord() }} em que entraram.
            </p>
            @if (pending()) {
              <div class="h-32 rounded bg-surface-sunken dark:bg-placeholder-fill animate-pulse"></div>
            } @else if (hasReceived()) {
              <app-bar-chart
                [series]="receivedSeries()"
                [labels]="labels()"
                valueFormat="brl-cents"
                [legend]="false"
                [yAxis]="true"
                [axisFloor]="axisFloor"
                [heightPx]="180"
                [emptyText]="receivedEmpty()"
                [ariaLabel]="'Recebido por ' + bucketWord() + ' no período'"
              />
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
            @if (!pending() && discountTotal(); as total) {
              <p class="text-xl font-semibold text-fg tabular-nums leading-tight mb-1" data-discount-total>
                {{ total }} <span class="text-xs font-normal text-fg-subtle">em descontos</span>
              </p>
            }
            <p class="text-xs text-fg-subtle mb-3">
              Quanto os cupons tiraram das faturas pagas, no {{ bucketWord() }} do pagamento. Fatura devolvida não conta.
            </p>
            @if (pending()) {
              <div class="h-32 rounded bg-surface-sunken dark:bg-placeholder-fill animate-pulse"></div>
            } @else if (!discountsAvailable()) {
              <p data-empty class="text-sm text-fg-subtle py-2">
                Indisponível agora: a Stripe não respondeu a tempo. Os outros números seguem valendo.
              </p>
            } @else {
              <app-bar-chart
                [series]="discountSeries()"
                [labels]="labels()"
                valueFormat="brl-cents"
                [legend]="false"
                [yAxis]="true"
                [axisFloor]="axisFloor"
                [heightPx]="180"
                emptyText="Nenhum desconto de cupom no período."
                [ariaLabel]="'Desconto em cupons por ' + bucketWord() + ' no período'"
              />
              @if (revenue()?.discounts?.truncated) {
                <p class="text-xs text-fg-soft mt-3">
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
export class AdminRevenueSection {
  private readonly service = inject(AdminRevenueService);
  private readonly apiErrors = inject(ApiErrorService);

  /** O período da página (`from`/`to`). `null` enquanto a página ainda não escolheu: nada é pedido. */
  readonly range = input<AdminHomeRange | null>(null);

  /**
   * O gráfico do MRR estimado. A Visão geral v2 desliga: ela já desenha o MRR real e o estimado
   * juntos, e dois gráficos de MRR na mesma tela diriam coisas diferentes.
   */
  readonly showMrr = input(true);

  protected readonly axisFloor = MONEY_AXIS_FLOOR_CENTS;

  private readonly data = signal<{ key: string; res: AdminRevenue } | null>(null);
  private readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /**
   * Só a resposta DO período na tela: o número de um intervalo nunca aparece sob as datas de outro.
   * O estado é da seção (não de um serviço raiz), então voltar ao /admin não mostra a visita anterior.
   */
  protected readonly revenue = computed(() => {
    const d = this.data();
    return d && d.key === rangeKey(this.range()) ? d.res : null;
  });
  protected readonly pending = computed(() => this.loading() && !this.revenue());

  /** Cada troca de período cancela a carga anterior (switchMap): resposta atrasada não sobrescreve. */
  private readonly requests = new Subject<AdminHomeRange>();

  constructor() {
    this.requests
      .pipe(
        switchMap((range) => {
          this.loading.set(true);
          this.error.set(null);
          const key = rangeKey(range) as string;
          return this.service.fetch(range).pipe(
            map((res) => ({ key, res, failure: null as unknown })),
            catchError((failure: unknown) => of({ key, res: null, failure })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ key, res, failure }) => {
        this.loading.set(false);
        if (res) {
          this.data.set({ key, res });
          return;
        }
        // A seção mostra o próprio aviso; reivindicar o erro evita o toast repetido do interceptor.
        this.apiErrors.claim(failure);
        this.data.set(null);
        this.error.set('Não foi possível carregar a receita da plataforma.');
      });
    effect(() => {
      const range = this.range();
      if (range) this.requests.next(range);
    });
  }

  /** As datas que o SERVIDOR usou, escritas no subtítulo. */
  protected readonly rangeText = computed(() => formatDateRangePtBr(this.revenue()?.meta ?? null));

  private readonly bucket = computed<AdminRevenueBucket>(() => this.revenue()?.meta?.bucket ?? 'MONTH');
  protected readonly bucketWord = computed(() => BUCKET_WORD[this.bucket()]);
  private readonly points = computed(() => revenuePoints(this.revenue()));
  protected readonly labels = computed(() => bucketLabels(this.points().map((p) => p.start), this.bucket()));

  private readonly mrrValues = computed(() => this.points().map((p) => p.mrrCents));
  protected readonly hasMrr = computed(() => hasValue(this.mrrValues()));
  protected readonly mrrChart = computed<GrowthSeries[]>(() => [
    { key: 'mrr', label: 'MRR estimado', color: SINGLE_SERIES_COLOR, values: this.mrrValues() },
  ]);
  protected readonly mrrSince = computed(() => dateLabel(this.revenue()?.mrr?.since ?? null));
  protected readonly mrrEmpty = computed(() => {
    const since = this.mrrSince();
    return since
      ? `Sem foto diária neste período. O histórico começa em ${since}.`
      : 'Ainda sem foto diária do MRR.';
  });

  private readonly cumulativeValues = computed(() => this.points().map((p) => p.cumulativeReceivedCents));
  protected readonly hasCumulative = computed(() => hasValue(this.cumulativeValues()));
  protected readonly cumulativeChart = computed<GrowthSeries[]>(() => [
    { key: 'cumulative', label: 'Acumulado', color: RECEIVED_COLOR, values: this.cumulativeValues() },
  ]);

  protected readonly receivedSince = computed(() => dateLabel(this.revenue()?.received?.since ?? null));
  private readonly receivedValues = computed(() => this.points().map((p) => p.receivedCents));
  protected readonly hasReceived = computed(() => hasValue(this.receivedValues()));
  protected readonly receivedSeries = computed<BarSeries[]>(() => [
    { key: 'received', label: 'Recebido', color: RECEIVED_COLOR, values: this.receivedValues() },
  ]);
  protected readonly receivedEmpty = computed(() => {
    const since = this.receivedSince();
    return since
      ? `Nenhum pagamento neste período. O caixa é registrado desde ${since}.`
      : 'Nenhum pagamento de assinatura registrado ainda.';
  });

  protected readonly discountsAvailable = computed(() => this.revenue()?.discounts?.available ?? false);
  private readonly discountValues = computed(() => this.points().map((p) => p.couponDiscountCents));
  protected readonly discountSeries = computed<BarSeries[]>(() => [
    { key: 'discount', label: 'Desconto', color: SINGLE_SERIES_COLOR, values: this.discountValues() },
  ]);

  /** The sum of the drawn columns, written under the card title; nothing when the period is zero. */
  protected readonly receivedTotal = computed(() => periodTotalText(this.receivedValues()));
  protected readonly discountTotal = computed(() =>
    this.discountsAvailable() ? periodTotalText(this.discountValues()) : null,
  );

  // ---------------------------------------------------------------- cartões

  /** "Esperado em novembro": é sempre o mês corrente, qualquer que seja o período. */
  protected readonly expectedLabel = computed(() => {
    const month = this.revenue()?.expected?.month;
    return month ? `Esperado em ${monthLong(month)}` : 'Esperado no mês';
  });
  protected readonly expectedDetail = computed(() => {
    const e = this.revenue()?.expected;
    if (!e) return null;
    const until = dateLabel(e.until)?.slice(0, 5) ?? '';
    const renewals = e.upcomingRenewals === 1 ? '1 renovação' : `${e.upcomingRenewals} renovações`;
    return `${formatBrl(e.receivedCents)} recebido + ${renewals} até ${until}, pelo preço de tabela, sem cupom`;
  });
  protected readonly expectedProgress = computed(() => {
    const e = this.revenue()?.expected;
    return e ? receivedShare(e.receivedCents, e.expectedCents) : null;
  });

  /** Servidor com `periodCents`: o caixa do período. Antes da mudança: o do mês corrente, e o rótulo diz. */
  private readonly byPeriod = computed(() => this.revenue()?.received?.periodCents !== undefined);
  protected readonly receivedLabel = computed(() => (this.byPeriod() ? 'Recebido no período' : 'Recebido no mês'));
  protected readonly receivedValue = computed(() => {
    const r = this.revenue()?.received;
    if (!r) return null;
    return this.byPeriod() ? (r.periodCents ?? null) : r.monthCents;
  });
  protected readonly receivedDelta = computed<KpiDelta | null>(() => {
    const r = this.revenue()?.received;
    if (!r || !this.byPeriod()) return null;
    return valueDelta(r.periodCents, r.previousPeriodCents, 'vs período anterior');
  });
  protected readonly receivedDetail = computed(() => {
    const r = this.revenue();
    if (!r) return null;
    const since = this.receivedSince();
    const previous = formatDateRangePtBr(
      r.meta ? { from: r.meta.previousFrom, to: r.meta.previousTo } : null,
    );
    if (this.byPeriod() && previous && r.received.previousPeriodCents != null) {
      return `período anterior (${previous}): ${formatBrl(r.received.previousPeriodCents)}`;
    }
    return since ? `caixa registrado desde ${since}` : 'nenhum pagamento registrado ainda';
  });

  protected readonly discountValue = computed(() => {
    const d = this.revenue()?.discounts;
    return d && d.available ? d.periodCents : null;
  });
  protected readonly discountDetail = computed(() => {
    const d = this.revenue()?.discounts;
    if (!d) return null;
    if (!d.available) return 'Stripe indisponível agora';
    return d.discountedInvoices === 1 ? '1 fatura com desconto' : `${d.discountedInvoices} faturas com desconto`;
  });

  protected readonly cumulativeDetail = computed(() => {
    if (!this.revenue()) return null;
    const since = this.receivedSince();
    return since ? `tudo desde ${since}; não segue o período` : 'começa no primeiro pagamento';
  });

  protected reload(): void {
    const range = this.range();
    if (range) this.requests.next(range);
  }
}
