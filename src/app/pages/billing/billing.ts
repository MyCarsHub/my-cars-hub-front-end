import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { PageCard } from '../../components/core/page-card/page-card';
import { PlanCardComponent } from '../../components/core/plan-card/plan-card';
import { BillingService } from '../../services/billing.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { SessionService } from '../../services/session.service';
import {
  BillingCycle,
  GatewayOverride,
  PlanResponse,
  SubscriptionResponse,
} from '../../types/billing.types';

interface CompareRow {
  label: string;
  values: (plan: PlanResponse) => string;
}

@Component({
  selector: 'app-billing',
  imports: [CommonModule, DefaultPageLayout, ConfirmDialog, PageCard, PlanCardComponent],
  templateUrl: './billing.html',
  styleUrl: './billing.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Billing implements OnInit {
  private readonly billingService = inject(BillingService);
  private readonly session = inject(SessionService);
  private readonly externalNav = inject(ExternalNavigationService);

  protected readonly isPlatformAdmin = this.session.isPlatformAdmin();
  protected readonly adminGateway = signal<GatewayOverride>('stripe');

  protected readonly plans = this.billingService.plans;
  protected readonly subscription = this.billingService.subscription;
  protected readonly loading = this.billingService.loading;
  protected readonly error = this.billingService.error;

  protected readonly cycle = signal<BillingCycle>('MONTHLY');
  protected readonly redirecting = signal(false);
  protected readonly showCancelDialog = signal(false);
  protected readonly expandedPlanId = signal<string | null>(null);
  protected readonly showCompare = signal(false);

  protected readonly recommendedCode = 'PRO';

  /** Gradient do card recomendado — orange no Mensal, Hub Green no Anual. */
  protected readonly recommendedGradient = computed<string>(() =>
    this.cycle() === 'YEARLY'
      ? 'linear-gradient(135deg, #34D399 0%, #10B981 55%, #059669 100%)'
      : 'linear-gradient(135deg, #FF5722 0%, #EB3F00 55%, #C93300 100%)',
  );

  /** Sombra colorida do card recomendado, casando com o gradient ativo. */
  protected readonly recommendedShadow = computed<string>(() =>
    this.cycle() === 'YEARLY'
      ? '0 1px 0 0 rgba(255,255,255,0.22) inset, 0 32px 72px -22px rgba(16,185,129,0.45)'
      : '0 1px 0 0 rgba(255,255,255,0.22) inset, 0 32px 72px -22px rgba(235,63,0,0.45)',
  );

  /** Cor do texto no botão branco do card recomendado (matching gradient). */
  protected readonly recommendedAccentText = computed<string>(() =>
    this.cycle() === 'YEARLY' ? 'text-emerald-700' : 'text-brand-strong',
  );

  protected readonly currentPlanCode = computed(() => this.subscription()?.planCode ?? null);

  /**
   * Maior % de economia anual entre todos os planos (arredondado).
   * Formula: 100 * (1 - priceYearly / (priceMonthly * 12)).
   */
  protected readonly yearlySavingsBadge = computed<number>(() => {
    const list = this.plans();
    let best = 0;
    for (const p of list) {
      if (p.priceMonthly > 0 && p.priceYearly > 0) {
        const pct = 100 * (1 - p.priceYearly / (p.priceMonthly * 12));
        if (pct > best) best = pct;
      }
    }
    return Math.round(best);
  });

  /**
   * Percentual de economia anual de um plano específico (para exibir no card de assinatura atual).
   */
  protected planYearlySavings(plan: PlanResponse): number {
    if (plan.priceMonthly <= 0 || plan.priceYearly <= 0) return 0;
    return Math.round(100 * (1 - plan.priceYearly / (plan.priceMonthly * 12)));
  }

  protected currentPlan = computed<PlanResponse | null>(() => {
    const code = this.currentPlanCode();
    if (!code) return null;
    return this.plans().find((p) => p.code === code) ?? null;
  });

  /**
   * Hero background CSS for the "Plano atual" section.
   * - TRIAL / no paid plan → null (falls back to dark bg-neutral-900).
   * - PRO / ENTERPRISE + MONTHLY → orange brand gradient.
   * - PRO / ENTERPRISE + YEARLY → emerald "Hub Green" gradient.
   */
  protected readonly currentHeroBackground = computed<string | null>(() => {
    const sub = this.subscription();
    if (!sub) return null;
    const code = sub.planCode?.toUpperCase() ?? '';
    if (code !== 'PRO' && code !== 'ENTERPRISE' && code !== 'BUSINESS') return null;
    return sub.billingCycle === 'YEARLY'
      ? 'linear-gradient(135deg, #34D399 0%, #10B981 55%, #059669 100%)'
      : 'linear-gradient(135deg, #FF5722 0%, #EB3F00 55%, #C93300 100%)';
  });

  /** Tailwind classes for muted labels inside the hero (adapts to bg). */
  protected readonly currentHeroMutedClass = computed<string>(() =>
    this.currentHeroBackground() ? 'text-white/80' : 'text-neutral-400',
  );

  /** Glow color for the top-right blur on the hero, matching the plan background. */
  protected readonly currentHeroGlow = computed<string>(() => {
    const sub = this.subscription();
    if (!sub) return 'rgba(235,63,0,0.25)';
    const code = sub.planCode?.toUpperCase() ?? '';
    const isPaid = code === 'PRO' || code === 'ENTERPRISE' || code === 'BUSINESS';
    if (!isPaid) return 'rgba(235,63,0,0.25)';
    return sub.billingCycle === 'YEARLY' ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.20)';
  });

  ngOnInit(): void {
    this.billingService.loadPlans().subscribe({ error: () => void 0 });
    this.billingService.loadSubscription().subscribe({ error: () => void 0 });
  }

  protected setCycle(cycle: BillingCycle): void {
    this.cycle.set(cycle);
  }

  protected setAdminGateway(g: GatewayOverride): void {
    this.adminGateway.set(g);
  }

  protected priceFor(plan: PlanResponse): number {
    return this.cycle() === 'MONTHLY' ? plan.priceMonthly : plan.priceYearly;
  }

  /**
   * Preço equivalente MENSAL quando o ciclo é anual (para mostrar "R$ X /mês" no card).
   */
  protected monthlyEquivalent(plan: PlanResponse): number {
    if (this.cycle() === 'MONTHLY') return plan.priceMonthly;
    return plan.priceYearly / 12;
  }

  protected formatPrice(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    }).format(value);
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(date);
  }

  protected statusLabel(status: SubscriptionResponse['status']): string {
    switch (status) {
      case 'TRIALING':
        return 'Período de Teste';
      case 'ACTIVE':
        return 'Ativa';
      case 'PAST_DUE':
        return 'Pagamento Pendente';
      case 'CANCELED':
        return 'Cancelada';
      case 'EXPIRED':
        return 'Expirada';
    }
  }

  protected statusBadgeClass(status: SubscriptionResponse['status']): string {
    switch (status) {
      case 'ACTIVE':
      case 'TRIALING':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'PAST_DUE':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'CANCELED':
      case 'EXPIRED':
        return 'bg-rose-100 text-rose-800 border-rose-200';
    }
  }

  protected trackByPlanId(_i: number, plan: PlanResponse): string {
    return plan.id;
  }

  protected isCurrent(plan: PlanResponse): boolean {
    return this.currentPlanCode() === plan.code;
  }

  protected isRecommended(plan: PlanResponse): boolean {
    return plan.code === this.recommendedCode;
  }

  protected isBusinessPlan(plan: PlanResponse): boolean {
    return plan.code === 'BUSINESS' || plan.code === 'ENTERPRISE';
  }

  protected planVariant(plan: PlanResponse): 'trial' | 'pro' | 'business' {
    if (this.isRecommended(plan)) return 'pro';
    if (this.isBusinessPlan(plan)) return 'business';
    return 'trial';
  }

  /** Feature lists mirroring landing-pricing (hardcoded per tier). */
  private readonly trialFeatures: readonly string[] = [
    'Até 2 veículos',
    'Até 3 motoristas',
    'Contratos, cobranças, multas, manutenções',
    'Suporte por email',
  ];

  private readonly proFeatures: readonly string[] = [
    'Até 20 veículos',
    'Motoristas ilimitados',
    'Cobranças automáticas por Asaas e Stripe',
    'Assinatura eletrônica com validade jurídica',
    'Vistoria digital completa em 14 ângulos por veículo',
    'Multi-usuário com controle de acesso',
    'Suporte prioritário',
  ];

  private readonly businessFeatures: readonly string[] = [
    'Veículos ilimitados',
    'Multi-empresa ilimitado (cadastre suas filiais)',
    'Usuários e papéis ilimitados',
    'Relatórios avançados exportáveis',
    'Onboarding assistido dedicado',
    'Suporte prioritário com SLA',
  ];

  private readonly enterpriseFeatures: readonly string[] = [
    'Veículos ilimitados',
    'Multi-marca / multi-filial',
    'Usuários e papéis ilimitados',
    'Integrações premium (ERP, telemetria)',
    'Suporte dedicado com SLA',
    'Gerente de conta',
  ];

  protected planFeatures(plan: PlanResponse): readonly string[] {
    if (this.isRecommended(plan)) return this.proFeatures;
    if (plan.code === 'ENTERPRISE') return this.enterpriseFeatures;
    if (this.isBusinessPlan(plan)) return this.businessFeatures;
    return this.trialFeatures;
  }

  protected planSubtitle(plan: PlanResponse): string | null {
    if (this.cycle() === 'YEARLY' && plan.priceYearly > 0 && plan.priceMonthly > 0) {
      const monthly = this.formatPrice(this.monthlyEquivalent(plan));
      const savings = this.planYearlySavings(plan);
      return savings > 0
        ? `Equivale a ${monthly}/mês · economiza ${savings}%`
        : `Equivale a ${monthly}/mês`;
    }
    if (
      this.isRecommended(plan) &&
      this.cycle() === 'MONTHLY' &&
      plan.priceYearly > 0 &&
      this.planYearlySavings(plan) > 0
    ) {
      return `ou ${this.formatPrice(this.monthlyEquivalent(plan))}/mês no anual`;
    }
    return null;
  }

  protected planDescription(plan: PlanResponse): string | null {
    if (this.isRecommended(plan)) return 'Pra operações que precisam de mais capacidade.';
    if (plan.code === 'ENTERPRISE')
      return 'Frota grande, integrações premium, suporte dedicado.';
    if (this.isBusinessPlan(plan))
      return 'Pra frotas grandes, multi-filial, com integrações customizadas.';
    return null;
  }

  protected planRibbon(plan: PlanResponse): string | null {
    if (this.isRecommended(plan)) return 'Mais popular';
    if (this.isBusinessPlan(plan)) return 'Sua frota cresceu?';
    return null;
  }

  protected planCtaLabel(plan: PlanResponse): string {
    if (this.isCurrent(plan)) return 'Plano atual';
    if (this.redirecting()) return 'Redirecionando…';
    if (this.subscription()) return `Alterar para ${plan.name}`;
    return `Assinar ${plan.name}`;
  }

  protected planAccentClass(plan: PlanResponse): string {
    return this.isRecommended(plan) ? this.recommendedAccentText() : 'text-brand-strong';
  }

  protected planBeforeFeaturesText(plan: PlanResponse): string | null {
    return this.isBusinessPlan(plan) ? 'Tudo que o plano Pro tem +' : null;
  }

  protected planGradient(plan: PlanResponse): string | null {
    return this.isRecommended(plan) ? this.recommendedGradient() : null;
  }

  protected planShadow(plan: PlanResponse): string | null {
    return this.isRecommended(plan) ? this.recommendedShadow() : null;
  }

  protected planCycleSuffix(): string {
    return this.cycle() === 'MONTHLY' ? 'mês' : 'ano';
  }

  protected planCtaDisabled(plan: PlanResponse): boolean {
    return this.isCurrent(plan) || this.redirecting() || this.loading();
  }

  protected taglineFor(plan: PlanResponse): string {
    switch (plan.code) {
      case 'TRIAL':
      case 'STARTER':
        return 'Para começar';
      case 'PRO':
        return 'Para escalar';
      case 'BUSINESS':
      case 'ENTERPRISE':
        return 'Para grandes frotas';
      default:
        return '';
    }
  }

  protected readonly hasAnyTrial = computed<boolean>(() =>
    this.plans().some((p) => p.trialDays > 0),
  );

  protected readonly maxTrialDays = computed<number>(() => {
    let max = 0;
    for (const p of this.plans()) {
      if (p.trialDays > max) max = p.trialDays;
    }
    return max;
  });

  protected statusDotClass(status: SubscriptionResponse['status']): string {
    switch (status) {
      case 'ACTIVE':
        return 'bg-emerald-500';
      case 'TRIALING':
        return 'bg-amber-500';
      case 'PAST_DUE':
        return 'bg-rose-500';
      case 'CANCELED':
      case 'EXPIRED':
        return 'bg-gray-400';
    }
  }

  protected statusPillClass(status: SubscriptionResponse['status']): string {
    switch (status) {
      case 'ACTIVE':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'TRIALING':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'PAST_DUE':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'CANCELED':
      case 'EXPIRED':
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  }

  protected toggleCompare(): void {
    this.showCompare.update((v) => !v);
  }

  protected toggleExpanded(planId: string): void {
    this.expandedPlanId.update((cur) => (cur === planId ? null : planId));
  }

  protected isExpanded(planId: string): boolean {
    return this.expandedPlanId() === planId;
  }

  /**
   * Clicar em "Assinar" (subscribe) vai DIRETO para o checkout do gateway.
   */
  protected subscribe(plan: PlanResponse): void {
    if (this.redirecting() || this.isCurrent(plan)) return;
    this.redirecting.set(true);
    const override = this.isPlatformAdmin ? this.adminGateway() : undefined;
    this.billingService.startCheckout(plan.code, this.cycle(), override).subscribe({
      next: (res) => {
        this.externalNav.openExternal(res.redirectUrl);
        this.redirecting.set(false);
      },
      error: () => {
        this.redirecting.set(false);
      },
    });
  }

  protected openCancel(): void {
    this.showCancelDialog.set(true);
  }

  protected onCancelConfirmed(): void {
    this.showCancelDialog.set(false);
    this.billingService.cancel().subscribe({
      next: () => this.billingService.loadSubscription().subscribe({ error: () => void 0 }),
      error: () => void 0,
    });
  }

  protected onCancelDismissed(): void {
    this.showCancelDialog.set(false);
  }
}
