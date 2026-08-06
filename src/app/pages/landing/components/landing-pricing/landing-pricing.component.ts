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
import { PlanCardComponent } from '../../../../components/core/plan-card/plan-card';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '../../../../components/segmented-toggle/segmented-toggle';
import { planCapacityLine } from '../../../../utils/plan-limits';

type BillingCycle = 'monthly' | 'yearly';

/** Acento do toggle de ciclo: laranja da landing no Mensal, Hub Green no Anual. */
const CYCLE_MONTHLY_BACKGROUND = 'linear-gradient(135deg, #FF5722 0%, #EB3F00 55%, #C93300 100%)';
const CYCLE_MONTHLY_SHADOW = '0 6px 18px -6px rgba(235,63,0,0.4)';
const CYCLE_YEARLY_BACKGROUND = 'linear-gradient(135deg, #34D399 0%, #10B981 55%, #059669 100%)';
const CYCLE_YEARLY_SHADOW = '0 6px 18px -6px rgba(16,185,129,0.45)';

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

  /** Opções do toggle Mensal/Anual — o badge mostra a economia real do anual. */
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
      badgeActiveClass: 'bg-white/[0.22]',
    },
  ]);

  // Prices live in `landing-plans.ts` — shared with the JSON-LD builder so the cards and
  // the structured data cannot drift apart.
  private readonly proMonthly = PLAN_PRICES.proMonthly;
  private readonly proYearlyTotal = PLAN_PRICES.proYearlyTotal;
  private readonly enterpriseMonthly = PLAN_PRICES.enterpriseMonthly;
  private readonly enterpriseYearlyTotal = ENTERPRISE_YEARLY_TOTAL;

  /** Price shown on PRO card: monthly value on Mensal, YEARLY TOTAL on Anual. */
  protected readonly proPrice = computed(() =>
    this.cycle() === 'monthly' ? this.proMonthly : this.proYearlyTotal,
  );
  protected readonly enterprisePrice = computed(() =>
    this.cycle() === 'monthly' ? this.enterpriseMonthly : this.enterpriseYearlyTotal,
  );
  protected readonly proSavings = computed(() =>
    Math.round((1 - this.proYearlyTotal / (this.proMonthly * 12)) * 100),
  );
  protected readonly proCycleSuffix = computed(() => (this.cycle() === 'monthly' ? 'mês' : 'ano'));

  /** Gradiente do card Pro — laranja no Mensal, Hub Green no Anual. */
  protected readonly proGradient = computed<string>(() =>
    this.cycle() === 'yearly'
      ? 'linear-gradient(135deg, #34D399 0%, #10B981 55%, #059669 100%)'
      : 'linear-gradient(135deg, #FF5722 0%, #EB3F00 55%, #C93300 100%)',
  );

  /** Sombra colorida do card Pro casando com o gradient. */
  protected readonly proShadow = computed<string>(() =>
    this.cycle() === 'yearly'
      ? '0 1px 0 0 rgba(255,255,255,0.22) inset, 0 32px 72px -22px rgba(16,185,129,0.5)'
      : '0 1px 0 0 rgba(255,255,255,0.22) inset, 0 32px 72px -22px rgba(235,63,0,0.5)',
  );

  /** Cor do texto do botão branco + ícone do check dentro do círculo. */
  protected readonly proAccentText = computed<string>(() =>
    this.cycle() === 'yearly' ? 'text-emerald-700' : 'text-brand-strong',
  );

  /**
   * ATENÇÃO — capacidades escritas à mão, e a landing é a única superfície que
   * NÃO pode derivá-las da API: `GET /v1/billing/plans` exige autenticação
   * (`SecurityConfig`) e esta página é pública, sem sessão. Enquanto o endpoint
   * não tiver uma variante pública, **todo ajuste na tabela `plans` precisa ser
   * repetido em `PLAN_CAPACITY`** — foi a divergência entre os dois que fez a
   * landing anunciar limites que o backend não entregava.
   *
   * Os números vêm de `utils/plan-limits.ts` (cópia da `plans`, ver V44); a
   * decisão de exibir o ENTERPRISE como ilimitado vem do mesmo arquivo, para
   * não divergir de billing e dashboard.
   */
  readonly trialItems = [
    planCapacityLine('TRIAL', 'vehicles'),
    planCapacityLine('TRIAL', 'drivers'),
    'Contratos, cobranças, multas, manutenções',
    'Suporte por email',
  ];

  readonly proItems = [
    planCapacityLine('PRO', 'vehicles'),
    planCapacityLine('PRO', 'drivers'),
    'Cobranças automáticas por Asaas e Stripe',
    'Assinatura eletrônica com validade jurídica',
    'Vistoria digital completa em 14 ângulos por veículo',
    'Multi-usuário com controle de acesso',
    'Suporte prioritário',
  ];

  readonly enterpriseItems = [
    planCapacityLine('ENTERPRISE', 'vehicles'),
    planCapacityLine('ENTERPRISE', 'drivers'),
    'Multi-marca / multi-filial',
    'Usuários e papéis ilimitados',
    'Integrações premium (ERP, telemetria)',
    'Suporte dedicado com SLA',
    'Gerente de conta',
  ];

  protected readonly proPriceLabel = computed<string>(() => `R$ ${this.formatBRL(this.proPrice())}`);
  protected readonly enterprisePriceLabel = computed<string>(
    () => `R$ ${this.formatBRL(this.enterprisePrice())}`,
  );
  protected readonly proSubtitle = computed<string>(() => {
    if (this.cycle() === 'yearly') {
      const monthlyEq = this.proYearlyTotal / 12;
      return `Equivale a R$ ${this.formatBRL(monthlyEq)}/mês · economiza ${this.proSavings()}%`;
    }
    return `ou R$ ${this.formatBRL(this.proMonthly * 0.8)}/mês no anual`;
  });
  protected readonly enterpriseSubtitle = computed<string>(() => {
    if (this.cycle() === 'yearly') {
      const monthlyEq = this.enterpriseYearlyTotal / 12;
      return `Equivale a R$ ${this.formatBRL(monthlyEq)}/mês · economiza 15%`;
    }
    return `ou R$ ${this.formatBRL(this.enterpriseMonthly * 0.85)}/mês no anual`;
  });

  protected setCycle(c: BillingCycle): void { this.cycle.set(c); }
  protected formatBRL(v: number): string { return v.toFixed(2).replace('.', ','); }

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
