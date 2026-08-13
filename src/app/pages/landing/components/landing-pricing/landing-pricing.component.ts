import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ENTERPRISE_YEARLY_TOTAL, PLAN_PRICES } from '../../landing-plans';
import {
  PlanCardComponent,
  PlanCardTone,
  planCardTone,
} from '../../../../components/core/plan-card/plan-card';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '../../../../components/segmented-toggle/segmented-toggle';
import { PlanTier, planCapacityLine } from '../../../../utils/plan-limits';
import {
  PLAN_DESCRIPTION,
  PlanLadderArrangement,
  planCardFeatureLines,
} from '../../../../utils/plan-features';

type BillingCycle = 'monthly' | 'yearly';

/**
 * O card de plano já montado, pronto para o `@for`.
 *
 * Os quatro cards eram quatro blocos `<app-plan-card>` escritos à mão no
 * template. Não dava para reordená-los sem `order-*`, que reordena só o
 * PIXEL — e a ordem desta grade carrega sentido desde que cada card acima do
 * TRIAL passou a dizer "tudo o que o plano anterior tem". Com os cards num
 * array, a ordem do DOM e a ordem que se vê são a mesma coisa, nos dois
 * arranjos.
 */
interface PlanCardView {
  readonly tier: PlanTier;
  readonly tone: PlanCardTone;
  readonly name: string;
  readonly price: string;
  readonly cycleSuffix: string;
  readonly subtitle: string | null;
  readonly description: string;
  readonly features: readonly string[];
  readonly ribbon: string | null;
  readonly ctaLabel: string;
}

/**
 * ═══ POR QUE ESTA TELA NÃO ESCOLHE A ORDEM EM TEMPO DE EXECUÇÃO ═══
 *
 * A grade tinha um `orderedPlans()` que lia uma media query via signal e
 * invertia o array no telefone. Numa tela comum isso está certo; nesta está
 * errado, e o build provava: `/` é PRERENDERIZADA (`RenderMode.Prerender` em
 * `app.routes.server.ts`). No servidor não há `matchMedia`, então o signal
 * congela em `false` — o arranjo de TELEFONE — e o `index.html` estático saía
 * com ENTERPRISE, PRO, STARTER, TRIAL para TODO visitante.
 *
 * E falhava calado. Com hidratação ligada, a contagem de nós e o template batem,
 * então o Angular reivindica as views desidratadas por POSIÇÃO e só reescreve os
 * bindings: nenhum NG0500, nenhum aviso. O que o visitante de desktop via era a
 * fileira se reordenando sozinha no meio da hidratação.
 *
 * A correção é tirar a decisão do JS. As DUAS ordens vão no DOM e o CSS escolhe
 * qual existe — `hidden md:grid` / `md:hidden`, o mesmo 768px do `md:` do
 * Tailwind. O bloco escondido é `display: none`, que o tira da árvore de
 * acessibilidade E da ordem de Tab; então o que o leitor de tela percorre e o
 * que o olho vê são sempre o mesmo bloco. Nada é reordenado só no pixel, que era
 * a falha de WCAG 1.3.2 / 2.4.3 que o array evitava — e agora não há mais nada
 * a hidratar de forma divergente, porque não há signal na decisão.
 *
 * É também o que faz a CÓPIA fechar: cada bloco monta os bullets com o seu
 * próprio `PlanLadderArrangement`, então o card que aparece em cima com planos
 * ABAIXO dele diz "tudo o que os planos abaixo têm", e o do catálogo diz "tudo o
 * que o plano anterior tem". Uma ordem, uma frase, o mesmo bloco.
 */
const CATALOG: PlanLadderArrangement = 'catalog';
const REVERSED: PlanLadderArrangement = 'reversed';

/**
 * Preço em pt-BR, com o separador de milhar que o `toFixed(2)` não tem.
 *
 * `v.toFixed(2).replace('.', ',')` imprimia "R$ 1499,00" e "R$ 2990,00". Passou
 * despercebido porque, até a V59, nenhum preço da landing chegava a quatro
 * dígitos. `Intl` em `decimal` (e não em `currency`) de propósito: o `style:
 * 'currency'` insere um espaço NÃO-QUEBRÁVEL entre "R$" e o número, e é o "R$ "
 * com espaço comum que o resto da página e o guarda de `landing-structured-data`
 * procuram no texto renderizado.
 */
const BRL = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Acento do toggle de ciclo e do card Pro — laranja da marca no Mensal, verde
 * no Anual. Os dois vêm dos tokens de `styles.css`, NÃO de hex local: o
 * `#FF5722 → #EB3F00 → #C93300` que morava aqui era um terceiro laranja que
 * não existia em `@theme`, e ficava lado a lado com a rampa canônica dentro da
 * própria tela de billing. Além de fora do sistema, ele reprovava o AA: o
 * ponto mais claro (#FF5722) dá 3,16:1 com texto branco.
 */
const CYCLE_MONTHLY_BACKGROUND = 'var(--brand-gradient-deep)';
const CYCLE_MONTHLY_SHADOW = '0 6px 18px -6px rgba(194,47,0,0.4)';
const CYCLE_YEARLY_BACKGROUND = 'var(--success-gradient-deep)';
const CYCLE_YEARLY_SHADOW = '0 6px 18px -6px rgba(10,120,84,0.45)';

/**
 * Dona dos PREÇOS que a landing anuncia (via `landing-plans.ts`). Não emite JSON-LD: os
 * mesmos preços saem uma única vez no `offers` do `SoftwareApplication`, escrito pela
 * página da landing — ver `landing-structured-data.ts`.
 */
@Component({
  selector: 'app-landing-pricing',
  imports: [NgTemplateOutlet, RouterModule, PlanCardComponent, SegmentedToggle],
  templateUrl: './landing-pricing.component.html',
  styleUrls: ['./landing-pricing.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class LandingPricingComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);

  protected readonly cycle = signal<BillingCycle>('monthly');

  constructor() {
    this.revealOnScroll();
  }

  /**
   * Opções do toggle Mensal/Anual — o badge mostra a economia real do anual,
   * calculada a partir dos totais tabelados. Depois da V59 os três planos pagos
   * economizam a mesma faixa (~17%), então um único badge continua honesto.
   */
  protected readonly cycleOptions = computed<readonly SegmentedToggleOption<BillingCycle>[]>(() => [
    {
      value: 'monthly',
      label: 'Mensal',
      activeBackground: CYCLE_MONTHLY_BACKGROUND,
      activeShadow: CYCLE_MONTHLY_SHADOW,
    },
    {
      value: 'yearly',
      label: 'Anual',
      badge: `-${this.proSavings()}%`,
      activeBackground: CYCLE_YEARLY_BACKGROUND,
      activeShadow: CYCLE_YEARLY_SHADOW,
      // Chip ESCURO, não claro: `bg-white/[0.22]` clareava o pedaço do pill
      // exatamente atrás do "-17%" e derrubava aquele texto branco de 10,5px
      // para 3,60:1 — medido sobre o VERDE (#0A7854), que é o único pill onde
      // este badge aparece; sobre o laranja daria 3,98:1, e nenhum dos dois
      // passa. O default do toggle (`bg-black/25`) dá 8,25:1 sobre o verde.
      badgeActiveClass: 'bg-black/25',
    },
  ]);

  // Prices live in `landing-plans.ts` — shared with the JSON-LD builder so the cards and
  // the structured data cannot drift apart.
  private readonly starterMonthly = PLAN_PRICES.starterMonthly;
  private readonly starterYearlyTotal = PLAN_PRICES.starterYearlyTotal;
  private readonly proMonthly = PLAN_PRICES.proMonthly;
  private readonly proYearlyTotal = PLAN_PRICES.proYearlyTotal;
  private readonly enterpriseMonthly = PLAN_PRICES.enterpriseMonthly;
  private readonly enterpriseYearlyTotal = ENTERPRISE_YEARLY_TOTAL;

  /** Price shown on each paid card: monthly value on Mensal, YEARLY TOTAL on Anual. */
  protected readonly starterPrice = computed(() =>
    this.cycle() === 'monthly' ? this.starterMonthly : this.starterYearlyTotal,
  );
  protected readonly proPrice = computed(() =>
    this.cycle() === 'monthly' ? this.proMonthly : this.proYearlyTotal,
  );
  protected readonly enterprisePrice = computed(() =>
    this.cycle() === 'monthly' ? this.enterpriseMonthly : this.enterpriseYearlyTotal,
  );

  protected readonly starterSavings = computed(() =>
    this.savingsPercent(this.starterMonthly, this.starterYearlyTotal),
  );
  protected readonly proSavings = computed(() =>
    this.savingsPercent(this.proMonthly, this.proYearlyTotal),
  );
  protected readonly enterpriseSavings = computed(() =>
    this.savingsPercent(this.enterpriseMonthly, this.enterpriseYearlyTotal),
  );

  /** Sufixo do preço, comum aos quatro cards. */
  protected readonly priceCycleSuffix = computed(() =>
    this.cycle() === 'monthly' ? 'mês' : 'ano',
  );

  /**
   * O gradiente/sombra/acento do card Pro saíram daqui junto com os inputs
   * `gradientCss` / `shadowCss` / `accentTextClass` de `app-plan-card`. Eram
   * três strings de estilo cruzando a fronteira do componente, e foi por elas
   * que um gradient de 3,16:1 entrou no card sem passar por revisão de
   * contraste. O tratamento agora é escolhido por `planCardTone()` a partir do
   * tier, e cada degrau tem contraste medido dentro do próprio `plan-card.ts`.
   */

  /**
   * ATENÇÃO — capacidades escritas à mão, e a landing é a única superfície que
   * NÃO pode derivá-las da API: `GET /v1/billing/plans` exige autenticação
   * (`SecurityConfig`) e esta página é pública, sem sessão. Enquanto o endpoint
   * não tiver uma variante pública, **todo ajuste na tabela `plans` precisa ser
   * repetido em `PLAN_CAPACITY`** — foi a divergência entre os dois que fez a
   * landing anunciar limites que o backend não entregava.
   *
   * Os números vêm de `utils/plan-limits.ts` (cópia da `plans`, ver V59); a
   * decisão de exibir o ENTERPRISE como ilimitado vem do mesmo arquivo, para
   * não divergir de billing e dashboard.
   *
   * A COMPOSIÇÃO da lista não é decidida aqui: `planCardFeatureLines()` monta o
   * TRIAL com tudo e todo degrau acima com a herança mais o delta dele — ver
   * `utils/plan-features.ts`. Esta tela só entrega a capacidade, porque é a
   * única que precisa escrevê-la à mão.
   *
   * A `plans` não tem uma única coluna de feature e o backend não porteia nada
   * além dos dois tetos, então uma lista de FUNÇÕES por tier continua proibida —
   * venderia uma escada que o código não implementa.
   */
  private readonly capacityLines: Readonly<Record<PlanTier, readonly string[]>> = {
    TRIAL: [planCapacityLine('TRIAL', 'vehicles'), planCapacityLine('TRIAL', 'drivers')],
    STARTER: [planCapacityLine('STARTER', 'vehicles'), planCapacityLine('STARTER', 'drivers')],
    PRO: [planCapacityLine('PRO', 'vehicles'), planCapacityLine('PRO', 'drivers')],
    ENTERPRISE: [
      planCapacityLine('ENTERPRISE', 'vehicles'),
      planCapacityLine('ENTERPRISE', 'drivers'),
    ],
  };

  /**
   * Os bullets de um tier NO ARRANJO pedido. O arranjo só muda a redação da
   * herança; a composição é sempre a mesma — ver `planCardFeatureLines()`.
   */
  private items(tier: PlanTier, arrangement: PlanLadderArrangement): readonly string[] {
    return planCardFeatureLines(tier, this.capacityLines[tier], arrangement);
  }

  /** As listas do arranjo do CATÁLOGO, que é o que o spec desta tela inspeciona. */
  readonly trialItems = this.items('TRIAL', CATALOG);
  readonly starterItems = this.items('STARTER', CATALOG);
  readonly proItems = this.items('PRO', CATALOG);
  readonly enterpriseItems = this.items('ENTERPRISE', CATALOG);

  /**
   * Degrau visual de cada card — a MESMA tabela que o billing autenticado lê.
   *
   * Deixaram de ser constantes porque o tratamento passou a depender do ciclo: o
   * anual pinta de verde os três degraus coloridos. Quem decide continua sendo
   * `planCardTone()`, nunca esta tela.
   */
  protected readonly trialTone = computed(() => planCardTone('TRIAL', this.cycle()));
  protected readonly starterTone = computed(() => planCardTone('STARTER', this.cycle()));
  protected readonly proTone = computed(() => planCardTone('PRO', this.cycle()));
  protected readonly enterpriseTone = computed(() => planCardTone('ENTERPRISE', this.cycle()));

  /** Descrições por tier — só TAMANHO, nunca recurso. Ver `plan-features.ts`. */
  protected readonly trialDescription = PLAN_DESCRIPTION.TRIAL;
  protected readonly starterDescription = PLAN_DESCRIPTION.STARTER;
  protected readonly proDescription = PLAN_DESCRIPTION.PRO;
  protected readonly enterpriseDescription = PLAN_DESCRIPTION.ENTERPRISE;

  protected readonly starterPriceLabel = computed<string>(
    () => `R$ ${this.formatBRL(this.starterPrice())}`,
  );
  protected readonly proPriceLabel = computed<string>(
    () => `R$ ${this.formatBRL(this.proPrice())}`,
  );
  protected readonly enterprisePriceLabel = computed<string>(
    () => `R$ ${this.formatBRL(this.enterprisePrice())}`,
  );

  protected readonly starterSubtitle = computed<string>(() =>
    this.subtitleFor(this.starterYearlyTotal, this.starterSavings()),
  );
  protected readonly proSubtitle = computed<string>(() =>
    this.subtitleFor(this.proYearlyTotal, this.proSavings()),
  );
  protected readonly enterpriseSubtitle = computed<string>(() =>
    this.subtitleFor(this.enterpriseYearlyTotal, this.enterpriseSavings()),
  );

  /**
   * Os quatro cards na ordem do CATÁLOGO, montados PARA o arranjo pedido — é a
   * mesma chamada que decide a sequência e a redação da herança, então elas não
   * têm por onde divergir.
   */
  private ladder(arrangement: PlanLadderArrangement): readonly PlanCardView[] {
    return [
      {
        tier: 'TRIAL',
        tone: this.trialTone(),
        name: 'Trial gratuito',
        price: 'R$ 0',
        cycleSuffix: '14 dias',
        subtitle: null,
        description: this.trialDescription,
        features: this.items('TRIAL', arrangement),
        ribbon: null,
        ctaLabel: 'Criar conta grátis',
      },
      {
        tier: 'STARTER',
        tone: this.starterTone(),
        name: 'Starter',
        price: this.starterPriceLabel(),
        cycleSuffix: this.priceCycleSuffix(),
        subtitle: this.starterSubtitle(),
        description: this.starterDescription,
        features: this.items('STARTER', arrangement),
        ribbon: null,
        ctaLabel: 'Assinar Starter',
      },
      {
        tier: 'PRO',
        tone: this.proTone(),
        name: 'Pro',
        price: this.proPriceLabel(),
        cycleSuffix: this.priceCycleSuffix(),
        subtitle: this.proSubtitle(),
        description: this.proDescription,
        features: this.items('PRO', arrangement),
        ribbon: 'Mais popular',
        ctaLabel: 'Assinar Pro',
      },
      {
        tier: 'ENTERPRISE',
        tone: this.enterpriseTone(),
        name: 'Enterprise',
        price: this.enterprisePriceLabel(),
        cycleSuffix: this.priceCycleSuffix(),
        subtitle: this.enterpriseSubtitle(),
        description: this.enterpriseDescription,
        features: this.items('ENTERPRISE', arrangement),
        ribbon: 'Sua frota cresceu?',
        ctaLabel: 'Assinar Enterprise',
      },
    ];
  }

  /** A escada do catálogo — o bloco que o CSS mostra a partir de `md`. */
  protected readonly catalogPlans = computed<readonly PlanCardView[]>(() => this.ladder(CATALOG));

  /**
   * A escada de TELEFONE — ENTERPRISE primeiro, TRIAL por último, e a herança
   * apontando para BAIXO, que é onde os planos menores realmente estão neste
   * arranjo. O CSS mostra este bloco abaixo de `md`.
   */
  protected readonly phonePlans = computed<readonly PlanCardView[]>(() =>
    [...this.ladder(REVERSED)].reverse(),
  );

  protected setCycle(c: BillingCycle): void {
    this.cycle.set(c);
  }
  protected formatBRL(v: number): string {
    return BRL.format(v);
  }

  /**
   * Economia real do anual, DERIVADA dos dois valores tabelados. Nunca um
   * percentual escrito à mão: os `* 0.8` (Pro) e `* 0.85` + "economiza 15%"
   * (Enterprise) que moravam aqui eram fatores inventados pela landing, e o do
   * Pro já mentia antes da V59 — anunciava um mensal-equivalente mais barato do
   * que o plano anual realmente cobra.
   */
  private savingsPercent(monthly: number, yearlyTotal: number): number {
    return Math.round((1 - yearlyTotal / (monthly * 12)) * 100);
  }

  /**
   * Subtítulo do card. Os dois ciclos falam do MESMO número — o mensal
   * equivalente do plano anual (`total / 12`) — porque é ele que o cliente
   * passa a pagar; o mensal só o apresenta como convite.
   */
  private subtitleFor(yearlyTotal: number, savings: number): string {
    const monthlyEquivalent = `R$ ${this.formatBRL(yearlyTotal / 12)}`;
    return this.cycle() === 'yearly'
      ? `Equivale a ${monthlyEquivalent}/mês · economiza ${savings}%`
      : `ou ${monthlyEquivalent}/mês no anual`;
  }

  protected goToLogin(): void {
    this.router.navigate(['/login']);
  }

  private revealOnScroll(): void {
    // `afterNextRender` em vez de `ngAfterViewInit`: este bloco usa APIs de DOM real
    // (IntersectionObserver, NodeList.forEach) que não existem durante o prerender. O
    // Angular pula estes callbacks no servidor — ver `app.routes.server.ts`.
    afterNextRender(() => {
      const obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add('revealed');
              obs.unobserve(e.target);
            }
          }
        },
        { threshold: 0.15 },
      );
      this.host.nativeElement.querySelectorAll('.reveal').forEach((el: Element) => obs.observe(el));
    });
  }
}
