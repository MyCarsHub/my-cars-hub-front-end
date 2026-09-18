import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { LineChart, LinePoint } from '../../../components/charts/line-chart/line-chart';
import { CashAccumulationResponse } from '../../../types/cash-accumulation.types';
import { cashAccumulationView, monthName } from '../../../utils/cash-accumulation-view';

/**
 * QUANTO JA ENTROU NO MES (FEAT-0123).
 *
 * A mecanica e a de app de investimento: todo dia a linha avanca um pouco e o
 * dono ve na hora se esta na frente ou atras. Por isso o TOTAL vem em destaque,
 * maior que o grafico — o numero e o que puxa, o grafico explica.
 *
 * As DUAS curvas vem do `app-line-chart` (FEAT-0121): a do mes corrente em
 * `points`, com a marca de periodo em andamento no ULTIMO ponto (hoje ainda esta
 * acontecendo, entao ele nao e queda), e a do mes anterior em `reference`. O peso
 * visual menor da referencia e congelado dentro do componente — nao e coisa que
 * esta tela configure, e por isso ninguem consegue passar uma referencia solida
 * por engano e fazer o cartao parecer que preve o futuro.
 *
 * A tabela sr-only tambem vem do componente, com a coluna da referencia: a
 * comparacao existe para quem usa leitor de tela, nao so para quem enxerga.
 */
@Component({
  selector: 'app-cash-accumulation-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LineChart],
  template: `
    @if (view(); as v) {
      <div class="min-w-0">
        <!-- O numero que puxa: maior que tudo no cartao. -->
        <p class="text-[11px] sm:text-xs text-neutral-500 uppercase tracking-wide truncate">
          Já entrou em {{ currentMonthLabel() }}
        </p>
        <p
          class="font-semibold mt-1 tabular-nums truncate"
          [class.text-3xl]="!compact()"
          [class.sm:text-4xl]="!compact()"
          [class.text-xl]="compact()"
          [class.sm:text-2xl]="compact()"
          [class.text-neutral-900]="!compact()"
          [class.text-orange-700]="compact()"
        >
          {{ v.total }}
        </p>

        <!--
          Le-se em um segundo e sabe dar MA noticia: emerald para cima, rose para
          baixo, neutro para empate. Esconder mes ruim faria o dono parar de
          consultar — e ele so volta todo dia se confiar no numero.
        -->
        <p
          class="font-medium mt-1"
          [class.text-sm]="!compact()"
          [class.text-[11px]]="compact()"
          [class.sm:text-xs]="compact()"
          [class.truncate]="compact()"
          [class.text-emerald-700]="v.trend === 'up'"
          [class.text-rose-700]="v.trend === 'down'"
          [class.text-neutral-500]="v.trend === 'flat'"
        >
          <span aria-hidden="true">{{ v.trend === 'up' ? '▲' : v.trend === 'down' ? '▼' : '=' }}</span>
          {{ v.comparison }}
        </p>

        @if (v.isEmpty && !compact()) {
          <!-- Zero e zero: explica em vez de sumir. -->
          <p class="text-xs text-neutral-500 mt-2">
            Nenhuma cobrança paga até o dia {{ v.current.throughDay }}. A linha começa a
            subir na primeira que entrar.
          </p>
        }

        <!--
          As duas curvas. "points" = mes corrente (ate hoje, ultimo ponto
          marcado como parcial); "reference" = mes anterior.

          O DESENHO DA REFERENCIA PARA NO DIA DE HOJE, e nao por escolha desta
          tela: o eixo X do componente sai da serie principal, entao os dias
          seguintes do mes anterior nao tem onde cair. A comparacao continua
          inteira (o servidor manda o delta contra o MESMO dia), mas o "onde ele
          chegou" nao aparece — e por isso o rotulo diz "ate aqui" em vez do
          nome do mes sozinho. A tela nao promete o que o desenho nao mostra.

          O teto do eixo sai calculado sobre AS DUAS series.
        -->
        @if (!compact()) {
        <div class="mt-3">
          <app-line-chart
            [points]="currentPoints()"
            [reference]="referencePoints()"
            [referenceLabel]="v.referenceLabel"
            [axisTop]="v.axisTopCents"
            [ariaLabel]="
              'Dinheiro recebido acumulado em ' +
              currentMonthLabel() +
              ', dia a dia, comparado com ' +
              v.previousMonthLabel +
              ' até o mesmo dia'
            "
            valueLabel="Acumulado"
            valueFormat="currencyCents"
            [heightPx]="140"
          />
        </div>
        }

      </div>
    }
  `,
})
export class CashAccumulationCard {
  readonly data = input.required<CashAccumulationResponse | null>();

  /**
   * Modo compacto: so o rotulo, o numero e a comparacao. Sem grafico e sem
   * tabela sr-only — no modo KPI os numeros ja estao no DOM como texto, e
   * uma tabela repetindo-os faria o leitor de tela anunciar tudo duas vezes.
   */
  readonly compact = input(false);

  protected readonly view = computed(() => {
    const response = this.data();
    return response ? cashAccumulationView(response) : null;
  });

  protected readonly currentMonthLabel = computed(() => {
    const response = this.data();
    return response ? monthName(response.current.month) : '';
  });

  /**
   * Curva do mes corrente. O ULTIMO ponto vai marcado como parcial: hoje ainda
   * esta acontecendo, e sem a marca ele seria lido como queda — o defeito de
   * bucket parcial. A marca sai tambem por TEXTO na tabela do componente.
   */
  protected readonly currentPoints = computed<readonly LinePoint[]>(() => {
    const points = this.view()?.current.points ?? [];
    const lastIndex = points.length - 1;
    return points.map((p, i) => ({
      label: String(p.day),
      value: p.cents,
      partial: i === lastIndex,
    }));
  });

  /**
   * Curva do mes anterior. SEM marca de parcial: e mes fechado, e marcar faria o
   * grafico dizer que o mes passado ainda esta acontecendo.
   */
  protected readonly referencePoints = computed<readonly LinePoint[]>(() =>
    (this.view()?.previous.points ?? []).map((p) => ({
      label: String(p.day),
      value: p.cents,
    })),
  );
}
