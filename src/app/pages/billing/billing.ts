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
  PlanGateway,
  PlanPeriod,
  PlanResponse,
  SubscriptionResponse,
} from '../../types/billing.types';

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

  protected readonly recommendedName = 'PRO';

  /**
   * Which gateway to render. PLATFORM_ADMIN can switch; everyone else sees
   * `stripe` (default). See gotchas — the company gateway isn't currently
   * exposed on `access-status` / `subscription`, so we hardcode stripe as
   * the customer-facing default.
   */
  protected readonly activeGateway = computed<PlanGateway>(() =>
    this.isPlatformAdmin ? this.adminGateway() : 'stripe',
  );

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
   * Rows filtered by current gateway + selected period, one row per `name`.
   * When multiple codes exist for the same (name, period, gateway) we keep
   * the first — backend should already dedupe, but this stays defensive.
   */
  protected readonly visiblePlans = computed<PlanResponse[]>(() => {
    const gw = this.activeGateway();
    const period: PlanPeriod = this.cycle();
    const seen = new Set<string>();
    const out: PlanResponse[] = [];
    for (const p of this.plans()) {
      if (p.gateway !== gw) continue;
      if (p.period !== period) continue;
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      out.push(p);
    }
    return out;
  });

  /**
   * Percent savings for a given `name`, based on YEARLY vs MONTHLY row of
   * the same name + active gateway. Returns 0 when either side is missing.
   */
  protected planYearlySavingsByName(name: string): number {
    const gw = this.activeGateway();
    let monthly = 0;
    let yearly = 0;
    for (const p of this.plans()) {
      if (p.gateway !== gw) continue;
      if (p.name !== name) continue;
      if (p.period === 'MONTHLY') monthly = p.price;
      else if (p.period === 'YEARLY') yearly = p.price;
    }
    if (monthly <= 0 || yearly <= 0) return 0;
    return Math.round(100 * (1 - yearly / (monthly * 12)));
  }

  /** Best yearly savings across all plan groups (for the cycle-toggle badge). */
  protected readonly yearlySavingsBadge = computed<number>(() => {
    const gw = this.activeGateway();
    const monthly = new Map<string, number>();
    const yearly = new Map<string, number>();
    for (const p of this.plans()) {
      if (p.gateway !== gw) continue;
      if (p.period === 'MONTHLY') monthly.set(p.name, p.price);
      else if (p.period === 'YEARLY') yearly.set(p.name, p.price);
    }
    let best = 0;
    for (const [name, m] of monthly) {
      const y = yearly.get(name);
      if (!y || m <= 0 || y <= 0) continue;
      const pct = 100 * (1 - y / (m * 12));
      if (pct > best) best = pct;
    }
    return Math.round(best);
  });

  /**
   * The exact row that matches the customer's current subscription
   * (same code). This is a single (name, period, gateway) row already.
   */
  protected currentPlan = computed<PlanResponse | null>(() => {
    const code = this.currentPlanCode();
    if (!code) return null;
    return this.plans().find((p) => p.code === code) ?? null;
  });

  protected readonly currentHeroBackground = computed<string | null>(() => {
    const sub = this.subscription();
    if (!sub) return null;
    const name = (sub.planName ?? '').toUpperCase();
    if (name !== 'PRO' && name !== 'ENTERPRISE' && name !== 'BUSINESS') return null;
    return sub.billingCycle === 'YEARLY'
      ? 'linear-gradient(135deg, #34D399 0%, #10B981 55%, #059669 100%)'
      : 'linear-gradient(135deg, #FF5722 0%, #EB3F00 55%, #C93300 100%)';
  });

  protected readonly currentHeroMutedClass = computed<string>(() =>
    this.currentHeroBackground() ? 'text-white/80' : 'text-neutral-400',
  );

  protected readonly currentHeroGlow = computed<string>(() => {
    const sub = this.subscription();
    if (!sub) return 'rgba(235,63,0,0.25)';
    const name = (sub.planName ?? '').toUpperCase();
    const isPaid = name === 'PRO' || name === 'ENTERPRISE' || name === 'BUSINESS';
    if (!isPaid) return 'rgba(235,63,0,0.25)';
    return 'rgba(255,255,255,0.20)';
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

  /**
   * Monthly-equivalent price for a plan row. For yearly rows returns price/12.
   */
  protected monthlyEquivalent(plan: PlanResponse): number {
    return plan.period === 'MONTHLY' ? plan.price : plan.price / 12;
  }

  /** Display a plan limit — `null` (unlimited) renders as the infinity sign. */
  protected formatLimit(value: number | null): string {
    return value === null ? '∞' : String(value);
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
    return plan.name === this.recommendedName;
  }

  protected isBusinessPlan(plan: PlanResponse): boolean {
    return plan.name === 'BUSINESS' || plan.name === 'ENTERPRISE';
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
    if (plan.name === 'ENTERPRISE') return this.enterpriseFeatures;
    if (this.isBusinessPlan(plan)) return this.businessFeatures;
    return this.trialFeatures;
  }

  protected planSubtitle(plan: PlanResponse): string | null {
    if (this.cycle() === 'YEARLY') {
      const monthly = this.formatPrice(this.monthlyEquivalent(plan));
      const savings = this.planYearlySavingsByName(plan.name);
      return savings > 0
        ? `Equivale a ${monthly}/mês · economiza ${savings}%`
        : `Equivale a ${monthly}/mês`;
    }
    if (this.isRecommended(plan)) {
      const savings = this.planYearlySavingsByName(plan.name);
      if (savings > 0) {
        // Preview the effective monthly if user switched to yearly.
        // Look up the yearly row of the same name/gateway.
        const gw = this.activeGateway();
        const yearlyRow = this.plans().find(
          (p) => p.name === plan.name && p.gateway === gw && p.period === 'YEARLY',
        );
        if (yearlyRow) {
          return `ou ${this.formatPrice(yearlyRow.price / 12)}/mês no anual`;
        }
      }
    }
    return null;
  }

  protected planDescription(plan: PlanResponse): string | null {
    if (this.isRecommended(plan)) return 'Pra operações que precisam de mais capacidade.';
    if (plan.name === 'ENTERPRISE')
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
    switch (plan.name) {
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
    this.visiblePlans().some((p) => p.trialDays > 0),
  );

  protected readonly maxTrialDays = computed<number>(() => {
    let max = 0;
    for (const p of this.visiblePlans()) {
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
   * Kick off checkout. The row already encodes gateway + period + name,
   * so we forward `plan.code` (e.g. `PRO_MONTHLY_STRIPE`) verbatim.
   */
  protected subscribe(plan: PlanResponse): void {
    if (this.redirecting() || this.isCurrent(plan)) return;
    this.redirecting.set(true);
    const override = this.isPlatformAdmin ? this.adminGateway() : undefined;
    this.billingService.startCheckout(plan.code, override).subscribe({
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
