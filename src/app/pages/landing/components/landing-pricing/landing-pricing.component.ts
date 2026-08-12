import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { ENTERPRISE_YEARLY_TOTAL, PLAN_PRICES } from '../../landing-plans';
import { PlanCardComponent, planCardTone } from '../../../../components/core/plan-card/plan-card';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '../../../../components/segmented-toggle/segmented-toggle';
import { PLAN_CAPACITY, planCapacityLine } from '../../../../utils/plan-limits';
import {
  PLAN_DESCRIPTION,
  PLAN_PARITY_NOTE,
  planFeaturesFor,
} from '../../../../utils/plan-features';

type BillingCycle = 'monthly' | 'yearly';

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
  imports: [RouterModule, PlanCardComponent, SegmentedToggle],
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
   * O que MUDA entre as quatro listas são as duas primeiras linhas — a
   * capacidade — e, do PRO em diante, a linha de atendimento prioritário. O
   * resto é `PLAN_FEATURES`, idêntico de propósito: a `plans` não tem uma única
   * coluna de feature e o backend não porteia nada além dos dois tetos, então
   * uma lista de FUNÇÕES por tier venderia uma escada que o código não
   * implementa. Ver `utils/plan-features.ts`; quem explica a semelhança ao
   * visitante é `parityNote`, impresso uma vez acima da grade.
   */
  readonly trialItems = [
    planCapacityLine('TRIAL', 'vehicles'),
    planCapacityLine('TRIAL', 'drivers'),
    ...planFeaturesFor('TRIAL'),
  ];

  readonly starterItems = [
    planCapacityLine('STARTER', 'vehicles'),
    planCapacityLine('STARTER', 'drivers'),
    ...planFeaturesFor('STARTER'),
  ];

  readonly proItems = [
    planCapacityLine('PRO', 'vehicles'),
    planCapacityLine('PRO', 'drivers'),
    ...planFeaturesFor('PRO'),
  ];

  readonly enterpriseItems = [
    planCapacityLine('ENTERPRISE', 'vehicles'),
    planCapacityLine('ENTERPRISE', 'drivers'),
    ...planFeaturesFor('ENTERPRISE'),
  ];

  /** Degrau visual de cada card — a MESMA tabela que o billing autenticado lê. */
  protected readonly trialTone = planCardTone('TRIAL');
  protected readonly starterTone = planCardTone('STARTER');
  protected readonly proTone = planCardTone('PRO');
  protected readonly enterpriseTone = planCardTone('ENTERPRISE');

  /** Descrições por tier — só TAMANHO, nunca recurso. Ver `plan-features.ts`. */
  protected readonly trialDescription = PLAN_DESCRIPTION.TRIAL;
  protected readonly starterDescription = PLAN_DESCRIPTION.STARTER;
  protected readonly proDescription = PLAN_DESCRIPTION.PRO;
  protected readonly enterpriseDescription = PLAN_DESCRIPTION.ENTERPRISE;

  /** Frase que explica por que as quatro listas saem iguais. */
  protected readonly parityNote = PLAN_PARITY_NOTE;

  /**
   * Teto do PRO no título da seção — o maior número que a grade REALMENTE
   * mostra, já que o ENTERPRISE aparece como ilimitado e não tem número.
   * Interpolado, não digitado: a manchete dizia "aos 20" (teto do PRO na V44)
   * enquanto a grade logo abaixo já anunciava 25, e a landing voltou a
   * contradizer a si mesma exatamente como o cabeçalho de `trialItems` avisa.
   */
  protected readonly headlineTopCap = PLAN_CAPACITY.PRO.vehicles;

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

  protected setCycle(c: BillingCycle): void {
    this.cycle.set(c);
  }
  protected formatBRL(v: number): string {
    return v.toFixed(2).replace('.', ',');
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
