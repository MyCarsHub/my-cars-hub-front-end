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
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { BillingService } from '../../services/billing.service';
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
  imports: [CommonModule, DefaultPageLayout, PageCard, ConfirmDialog],
  templateUrl: './billing.html',
  styleUrl: './billing.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Billing implements OnInit {
  private readonly billingService = inject(BillingService);
  private readonly session = inject(SessionService);

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

  protected readonly recommendedCode = 'PRO';

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
        window.location.href = res.redirectUrl;
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
