import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  viewChild,
} from '@angular/core';
import type { ChartConfiguration } from 'chart.js';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

/**
 * Registro EXPLÍCITO, e é o que mantém o custo baixo.
 *
 * `chart.js/auto` traz TODOS os controladores (barra, pizza, radar, bolha,
 * dispersão, rosca…) e é o caminho que a documentação sugere primeiro. Aqui
 * registramos só o que a linha usa — é o "tree-shaking real" que o nó pediu, e
 * a diferença some do bundle porque nada mais é importado.
 *
 * Se algum dia esta lista crescer, o custo cresce junto: é aqui que se olha.
 * Medido: `BarController` + `BarElement` custam +10.52 kB brutos (+3.02 kB de
 * transferência) no chunk que carrega o gráfico — e nenhum byte no inicial.
 */
Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
);

/** Um ponto da série: o rótulo do eixo X e o valor. */
export interface LinePoint {
  readonly label: string;
  readonly value: number;
  /**
   * Período AINDA EM ANDAMENTO — hoje, a semana corrente, o mês corrente.
   *
   * Um bucket parcial vale menos que os vizinhos por construção: ele não
   * terminou. Desenhado como ponto normal, ele aparece como QUEDA, e quem olha
   * conclui que o negócio caiu quando só o calendário não fechou. É o tipo de
   * coisa que produz a pergunta errada numa reunião.
   *
   * Quem marca é a origem da série (ela sabe onde a janela foi truncada); o
   * gráfico só honra a marca — tracejado até o ponto, ponto vazado, e a
   * ressalva por escrito na tabela.
   */
  readonly partial?: boolean;
}

/**
 * Piso do eixo Y.
 *
 * REGRA DE ESCALA — é o coração do FEAT-0121, e vale mais que a biblioteca.
 *
 * O gráfico anterior normalizava pelo próprio máximo (`max = Math.max(1,
 * ...counts)`): com pico 3, o 3 virava o topo do desenho e a série ocupava a
 * altura inteira. Três usuários num mês pareciam uma montanha-russa. O eixo
 * mentia — não por bug de desenho, mas porque não tinha chão nem teto fixos.
 *
 * Aqui o eixo SEMPRE começa no zero e nunca encolhe abaixo deste piso. Com pico
 * 3 num eixo de 0 a 5, a linha fica rente ao chão — que é a leitura honesta.
 * Quando o produto crescer e o pico passar de 5, o eixo acompanha o dado.
 */
export const Y_AXIS_MIN_TOP = 5;

/**
 * Teto do eixo Y para uma série: o maior entre o piso e o máximo real.
 *
 * Função pura e exportada de propósito — é A regra de produto deste nó, e ela
 * precisa ser testável sem instanciar canvas nenhum.
 */
export function axisTopFor(values: readonly number[]): number {
  return Math.max(Y_AXIS_MIN_TOP, ...values, 0);
}

/**
 * Peso visual da série de REFERÊNCIA — fixo, e exportado para poder ser
 * afirmado por teste.
 *
 * Mora fora do componente pelo mesmo motivo de `axisTopFor`: é regra de
 * PRODUTO, não detalhe de desenho, e regra de produto que só existe dentro de
 * um `new Chart()` não é verificável — o canvas não roda no JSDOM. Congelado
 * para que nem o componente possa alterá-lo por engano.
 *
 * Se as duas séries tiverem peso parecido, a do período anterior é lida como
 * PREVISÃO do atual, e o cartão passa a prometer futuro em vez de comparar com
 * o passado. Por isso nada aqui é configurável de fora.
 */
export const REFERENCE_STYLE = Object.freeze({
  borderWidth: 1,
  borderDash: Object.freeze([4, 4]) as readonly number[],
  pointRadius: 0,
  pointHoverRadius: 0,
  fill: false,
});

/**
 * Gráfico de LINHA sobre Chart.js, com alternativa textual.
 *
 * ## Por que canvas tem tabela junto
 *
 * O desenho vive num `<canvas>`, que para leitor de tela é um retângulo opaco —
 * um número dentro dele não é lido por ninguém. A tabela ao lado (visualmente
 * escondida, mas presente na árvore de acessibilidade) é a MESMA série em
 * texto. Não é enfeite de conformidade: é a única forma de alguém sem visão
 * saber o que o gráfico diz.
 *
 * ## Mobile
 *
 * `maintainAspectRatio: false` + altura fixa no contêiner, para o gráfico se
 * adaptar a 360px sem esticar o desenho (o SVG anterior usava
 * `preserveAspectRatio="none"`, que deformava a curva em telas estreitas). Os
 * rótulos do eixo X são limitados por `maxTicksLimit`, senão 30 datas viram uma
 * tarja preta ilegível no celular.
 */
@Component({
  selector: 'app-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative w-full" [style.height.px]="heightPx()">
      <canvas #canvas aria-hidden="true"></canvas>
    </div>

    <!--
      Alternativa textual: sr-only a esconde do olho e a mantém para o leitor
      de tela — ver o bloco "Por que canvas tem tabela junto" no componente.
    -->
    <table class="sr-only">
      <caption>
        {{ ariaLabel() }}
      </caption>
      <thead>
        <tr>
          <th scope="col">Período</th>
          <th scope="col">{{ valueLabel() }}</th>
          <!--
            A coluna de comparacao NAO e enfeite: sem ela a comparacao existiria
            so no desenho, e quem usa leitor de tela receberia o numero do mes
            sem nada com que compara-lo — que e justamente o que o cartao
            existe para mostrar.
          -->
          @if (reference()) {
            <th scope="col">{{ referenceLabel() }}</th>
          }
        </tr>
      </thead>
      <tbody>
        @for (point of points(); track point.label; let i = $index) {
          <tr>
            <th scope="row">
              {{ point.label }}
              <!--
                A ressalva do periodo parcial vai JUNTO do rotulo, no texto.
                Marcar so no desenho (tracejado, ponto vazado) entregaria a
                ressalva a quem enxerga e a esconderia de quem usa leitor de
                tela — justamente quem nao tem como inferir pelo formato.
              -->
              @if (point.partial) {
                <span>(período em andamento, ainda não fechado)</span>
              }
            </th>
            <td>{{ point.value }}</td>
            @if (reference(); as ref) {
              <td>{{ ref[i]?.value ?? '—' }}</td>
            }
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class LineChart implements OnDestroy {
  readonly points = input.required<readonly LinePoint[]>();
  readonly ariaLabel = input.required<string>();
  /** `line` para série temporal, `bar` para comparação entre períodos. */
  readonly type = input<'line' | 'bar'>('line');
  /**
   * Teto do eixo Y JÁ CALCULADO pelo chamador.
   *
   * FORMA ESCOLHIDA, e é decisão declarada: o componente aceita um NÚMERO, não
   * uma função. Duas razões. A primeira é que função como `input` envelhece mal
   * com OnPush — quem passa tende a passar um closure que captura estado velho,
   * e o gráfico redesenha com um teto de duas mudanças atrás. A segunda é que
   * número é verificável: um teste afirma o teto sem instanciar canvas nenhum,
   * que é como a regra de escala é testada hoje.
   *
   * CONTAGEM e DINHEIRO têm pisos diferentes por natureza — 5 unidades e
   * R$ 100 não são a mesma grandeza — então cada domínio traz o seu
   * (`axisTopFor` aqui, `moneyAxisTopFor` no dashboard). Não unifiquei os dois
   * e não quero que o componente escolha por ninguém.
   *
   * Ausente, aplica-se `axisTopFor` (regra de CONTAGEM). É o que mantém o
   * `admin-home` sem mudança nenhuma — mas quem plota DINHEIRO precisa passar
   * este valor, ou vai receber um piso de 5 onde queria R$ 100.
   *
   * HAVENDO `reference`, calcule o teto sobre AS DUAS SÉRIES. A referência é um
   * período FECHADO e quase sempre a maior das duas — calculada só sobre a
   * série principal, ela sai cortada, e a série cortada é justamente a que dá a
   * medida de comparação. O padrão interno já soma as duas; quem passa o
   * número assume a conta.
   */
  readonly axisTop = input<number | null>(null);

  /**
   * Série de COMPARAÇÃO, desenhada atrás da principal — tipicamente o período
   * anterior. Ausente (`null`), o gráfico fica exatamente como era antes de ela
   * existir: um dataset só.
   *
   * Deve ter os MESMOS rótulos da série principal, na mesma ordem; é o que faz
   * "dia 3" de um mês cair sobre "dia 3" do outro.
   */
  readonly reference = input<readonly LinePoint[] | null>(null);
  readonly referenceLabel = input('Período anterior');
  /** Nome da grandeza, usado no cabeçalho da tabela e no tooltip. */
  readonly valueLabel = input('Valor');
  readonly heightPx = input(160);

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private chart: Chart<'line' | 'bar', number[], string> | null = null;

  /**
   * Teto do eixo: o maior entre o piso e o máximo real da série. Ver
   * `Y_AXIS_MIN_TOP` para o porquê de existir um piso.
   */
  /**
   * Teto efetivo: o do chamador quando existe, senão a regra de contagem.
   *
   * O padrão olha as DUAS séries. Uma referência mais alta que a principal
   * estouraria o topo e sairia cortada — e a série cortada seria justamente a
   * que dá a medida de comparação. Quem PASSA `axisTop` assume essa conta:
   * calcule sobre principal + referência, ou verá o mesmo corte.
   */
  private readonly effectiveAxisTop = computed(() => {
    const fromCaller = this.axisTop();
    if (fromCaller !== null) return fromCaller;
    const values = [
      ...this.points().map((p) => p.value),
      ...(this.reference() ?? []).map((p) => p.value),
    ];
    return axisTopFor(values);
  });

  constructor() {
    effect(() => {
      const points = this.points();
      const top = this.effectiveAxisTop();
      const isBar = this.type() === 'bar';
      const canvas = this.canvasRef().nativeElement;

      this.chart?.destroy();
      this.chart = null;

      // Sem contexto 2D nao ha o que desenhar, e isso NAO e caso de erro: vale
      // no SSR (o app tem @angular/ssr) e no JSDOM da suite. A tabela ao lado
      // ja carrega a serie inteira, entao a informacao nao se perde — some
      // apenas o desenho. Sem esta guarda, o Chart.js cospe "can't acquire
      // context" no console do servidor e no output dos testes.
      if (!canvas.getContext('2d')) return;

      const primary = this.token('--color-primary-500', '#F63B04');
      const surface = this.token('--color-white', '#FFFFFF');

      // O dataset de BARRA e o de LINHA divergem de verdade: `fill`, `tension`
      // e `segment` so existem na linha, e a marca do periodo parcial muda de
      // forma — na linha e traco tracejado + ponto vazado; na barra e a propria
      // barra vazada, com contorno tracejado. Montar um dataset "dos dois"
      // entregaria opcoes que o Chart.js ignora em silencio num dos modos.
      const dataset = isBar
        ? {
            data: points.map((p) => p.value),
            label: this.valueLabel(),
            // Barra do periodo em andamento fica VAZADA: some o preenchimento
            // solido, fica so o contorno tracejado. Lida como "ainda enchendo".
            backgroundColor: points.map((p) => (p.partial ? surface : primary)),
            borderColor: primary,
            borderWidth: points.some((p) => p.partial) ? 2 : 0,
            borderDash: points.some((p) => p.partial) ? [5, 4] : undefined,
            borderRadius: 4,
          }
        : {
            data: points.map((p) => p.value),
            label: this.valueLabel(),
            borderColor: primary,
            backgroundColor: this.token('--color-primary-low', '#FFE6DD'),
            borderWidth: 2,
            pointRadius: (ctx: { dataIndex: number }) =>
              points[ctx.dataIndex]?.partial ? 5 : points.length > 14 ? 0 : 3,
            pointStyle: 'circle' as const,
            pointBackgroundColor: (ctx: { dataIndex: number }) =>
              points[ctx.dataIndex]?.partial ? surface : primary,
            pointBorderWidth: 2,
            pointHoverRadius: 6,
            tension: 0.3,
            fill: true,
            segment: {
              borderDash: (ctx: { p1DataIndex: number }) =>
                points[ctx.p1DataIndex]?.partial ? [5, 4] : undefined,
            },
          };

      const reference = this.reference();

      /**
       * A referência é MAIS LEVE POR CONSTRUÇÃO, e nenhuma dessas opções é
       * configurável de fora. Se as duas séries tiverem peso parecido, a linha
       * do mês passado é lida como PREVISÃO do mês atual — e o cartão passa a
       * prometer futuro em vez de comparar com o passado. Deixar isso a cargo
       * de quem consome é garantir que um dia alguém passe uma referência
       * sólida e ninguém perceba até o dono tirar a conclusão errada.
       *
       * É SEMPRE LINHA, mesmo quando a série principal é barra. Em barra, a
       * marca de "período em andamento" JÁ É a barra vazada com contorno
       * tracejado (ver o dataset acima) — uma referência vazada e tracejada
       * ficaria indistinguível dela, e o gráfico passaria a ter duas coisas
       * diferentes com o mesmo desenho. Linha fina sobre colunas separa os dois
       * papéis sem ambiguidade e continua sendo o peso menor.
       *
       * A marca de parcial NÃO se aplica aqui: a referência é um período
       * fechado. Nenhuma opção deste dataset lê `partial`.
       */
      const referenceDataset = reference
        ? {
            type: 'line' as const,
            data: reference.map((p) => p.value),
            label: this.referenceLabel(),
            borderColor: this.token('--color-neutral-400', '#A1A1A1'),
            borderWidth: REFERENCE_STYLE.borderWidth,
            borderDash: [...REFERENCE_STYLE.borderDash],
            pointRadius: REFERENCE_STYLE.pointRadius,
            pointHoverRadius: REFERENCE_STYLE.pointHoverRadius,
            fill: REFERENCE_STYLE.fill,
            tension: 0.3,
          }
        : null;

      // UM cast, aqui: com dataset de tipo próprio (a referência é sempre
      // linha, mesmo em barra) o Chart.js entra no modo "tipos por dataset", e
      // a inferência abre para todo o registro de tipos. O cast reafirma o que
      // o componente de fato aceita — line e bar — sem espalhar `any`.
      const config = {
        type: isBar ? 'bar' : 'line',
        data: {
          labels: points.map((p) => p.label),
          // Referência PRIMEIRO no array: o Chart.js desenha na ordem, então o
          // índice 0 fica atrás. É o que mantém a série principal legível por
          // cima dela.
          datasets: referenceDataset ? [referenceDataset, dataset] : [dataset],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          // O canvas é `aria-hidden`; quem responde ao leitor de tela é a
          // tabela. Sem isto o Chart.js injeta um fallback interno redundante.
          plugins: { legend: { display: false }, tooltip: { enabled: true } },
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: {
              beginAtZero: true,
              suggestedMax: top,
              // Contagem de pessoas não tem casa decimal: sem isto o eixo
              // chega a mostrar "1,5 usuários" quando o pico é pequeno.
              ticks: { precision: 0, maxTicksLimit: 5 },
              grid: { color: this.token('--color-neutral-200', '#E5E5E5') },
            },
            x: {
              // 30 datas não cabem em 360px; o Chart.js rareia os rótulos.
              ticks: { maxTicksLimit: 6, autoSkip: true },
              grid: { display: false },
            },
          },
        },
      } as ChartConfiguration<'line' | 'bar', number[], string>;

      this.chart = new Chart(canvas, config);
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = null;
  }

  /**
   * Lê a cor do design system em vez de repetir o hexadecimal aqui. O canvas
   * não entende classe do Tailwind, então o token é resolvido em tempo de
   * execução; o `fallback` cobre SSR, onde não há `document`.
   */
  private token(name: string, fallback: string): string {
    if (typeof document === 'undefined') return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }
}
