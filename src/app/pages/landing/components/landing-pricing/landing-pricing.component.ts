import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { PLAN_PRICES } from '../../landing-plans';
import { PlanTier } from '../../../../utils/plan-limits';
import { PLAN_TIER_ORDER } from '../../../../utils/plan-features';
import { PLAN_COPY, planRows } from '../../../../utils/plan-grid-copy';
import { PlanIntentService } from '../../../../services/plan-intent.service';
import { PlanColumn, PlanGrid } from '../../../billing/plan-grid';
import { environment } from '../../../../../environments/environment';

type BillingCycle = 'monthly' | 'yearly';

/**
 * Seção de planos da landing (rev. 2026-10-29, aprovada pelo dono).
 *
 * É a MESMA grade da Assinatura (`app-plan-grid`): cinco colunas iguais e
 * alinhadas, a mesma superfície para todos os planos e só o Pro em destaque
 * (borda acesa, "Mais escolhido", CTA cheio). O texto das colunas sai de
 * `utils/plan-grid-copy.ts`, o mesmo que o app usa — a landing nunca promete
 * algo diferente do que a tela de planos mostra.
 *
 * Os preços são escritos à mão em `landing-plans.ts`: a landing pública não tem
 * sessão e o catálogo do billing exige autenticação. `landing-plans.spec.ts`
 * guarda o espelho com o banco.
 */
@Component({
  selector: 'app-landing-pricing',
  imports: [PlanGrid],
  templateUrl: './landing-pricing.component.html',
  styleUrls: ['./landing-pricing.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class LandingPricingComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);
  private readonly planIntent = inject(PlanIntentService);

  protected readonly cycle = signal<BillingCycle>('monthly');

  constructor() {
    this.revealOnScroll();
  }

  /** Desconto do anual, medido no Pro (o mesmo -17% em todos: anual = 10x o mensal). */
  protected readonly proSavings = computed(() =>
    Math.round((1 - PLAN_PRICES.proYearlyTotal / (PLAN_PRICES.proMonthly * 12)) * 100),
  );

  protected readonly gridCycle = computed(
    () => (this.cycle() === 'monthly' ? 'MONTHLY' : 'YEARLY') as 'MONTHLY' | 'YEARLY',
  );

  /** Cinco colunas, mesma superfície; só o Pro em destaque. */
  protected readonly columns = computed<PlanColumn[]>(() => {
    const yearly = this.cycle() === 'yearly';
    const paid = (monthly: number, yearlyTotal: number) => ({
      price: gridPrice(yearly ? yearlyTotal : monthly),
      per: yearly ? '/ano' : '/mês',
      sub: yearly ? `R$ ${gridPrice(yearlyTotal / 12, true)} por mês` : 'Cobrado todo mês',
    });
    const byTier: Readonly<Record<PlanTier, { price: string; per: string | null; sub: string; cta: string }>> = {
      TRIAL: { price: 'Grátis', per: null, sub: `${PLAN_PRICES.trialDays} dias, sem cartão`, cta: 'Criar conta grátis' },
      STARTER: { ...paid(PLAN_PRICES.starterMonthly, PLAN_PRICES.starterYearlyTotal), cta: 'Assinar Starter' },
      PRO: { ...paid(PLAN_PRICES.proMonthly, PLAN_PRICES.proYearlyTotal), cta: 'Assinar Pro' },
      SCALE: { ...paid(PLAN_PRICES.scaleMonthly, PLAN_PRICES.scaleYearlyTotal), cta: 'Assinar Scale' },
      // V127: "Sob consulta" — vendido por contato (`plans.contact_only`).
      ENTERPRISE: { price: 'Sob consulta', per: null, sub: 'Preço conforme a frota', cta: 'Falar com a gente' },
    };
    return PLAN_TIER_ORDER.map((tier) => {
      const t = byTier[tier];
      return {
        tier,
        name: PLAN_COPY[tier].name,
        pitch: PLAN_COPY[tier].pitch,
        price: t.price,
        per: t.per,
        sub: t.sub,
        rows: planRows(tier),
        current: false,
        recommended: false,
        featured: tier === 'PRO',
        ctaLabel: t.cta,
        ctaDisabled: false,
        ctaAria: `${t.cta} — plano ${PLAN_COPY[tier].name}`,
        note: null,
        error: null,
        plan: null,
        contact: tier === 'ENTERPRISE',
      };
    });
  });

  /** Só o que é verdade: trial de 14 dias sem cartão; cancelamento a qualquer momento (FAQ). */
  protected readonly trustItems: readonly string[] = [
    `${PLAN_PRICES.trialDays} dias grátis`,
    'Sem cartão no teste',
    'Cancele quando quiser',
  ];

  protected setCycle(c: BillingCycle): void {
    this.cycle.set(c);
  }

  /**
   * Guarda a INTENÇÃO (não uma assinatura) e manda ao login; o onboarding a
   * mostra depois. Enterprise é contato, nunca intenção de compra.
   */
  protected goToLogin(tier: PlanTier): void {
    if (tier === 'ENTERPRISE') {
      this.contactSales();
      return;
    }
    this.planIntent.remember(tier);
    this.router.navigate(['/login']);
  }

  /** Enterprise "Sob consulta": WhatsApp do suporte; sem número configurado, o login. */
  private contactSales(): void {
    const phone = environment.supportWhatsapp;
    if (phone && typeof window !== 'undefined') {
      const text = encodeURIComponent('Olá! Quero falar sobre o plano Enterprise do MyCarsHub.');
      window.open(`https://wa.me/${phone}?text=${text}`, '_blank', 'noopener');
      return;
    }
    this.planIntent.remember('TRIAL');
    this.router.navigate(['/login']);
  }

  private revealOnScroll(): void {
    // `afterNextRender`: IntersectionObserver não existe no prerender.
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

/** "79,90", "299", "1.599" — o "R$" a grade desenha menor. */
function gridPrice(value: number, forceCents = false): string {
  const whole = Math.abs(value - Math.round(value)) < 0.005 && !forceCents;
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(value);
}
