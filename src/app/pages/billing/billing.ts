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
import { SignatureModalComponent } from './components/signature-modal';
import { BillingService } from '../../services/billing.service';
import {
  BillingCycle,
  PlanResponse,
  SubscriptionResponse,
} from '../../types/billing.types';

@Component({
  selector: 'app-billing',
  imports: [
    CommonModule,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    SignatureModalComponent,
  ],
  templateUrl: './billing.html',
  styleUrl: './billing.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Billing implements OnInit {
  private readonly billingService = inject(BillingService);

  protected readonly plans = this.billingService.plans;
  protected readonly subscription = this.billingService.subscription;
  protected readonly loading = this.billingService.loading;
  protected readonly error = this.billingService.error;

  protected readonly cycle = signal<BillingCycle>('MONTHLY');
  protected readonly redirecting = signal(false);
  protected readonly showCancelDialog = signal(false);
  protected readonly showSignatureModal = signal(false);
  protected readonly pendingCheckoutPlanCode = signal<string | null>(null);
  protected readonly pendingCheckoutCycle = signal<BillingCycle>('MONTHLY');

  protected readonly recommendedCode = 'PRO';

  protected readonly currentPlanCode = computed(() => this.subscription()?.planCode ?? null);

  ngOnInit(): void {
    this.billingService.loadPlans().subscribe({ error: () => void 0 });
    this.billingService.loadSubscription().subscribe({ error: () => void 0 });
  }

  protected setCycle(cycle: BillingCycle): void {
    this.cycle.set(cycle);
  }

  protected priceFor(plan: PlanResponse): number {
    return this.cycle() === 'MONTHLY' ? plan.priceMonthly : plan.priceYearly;
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

  protected subscribe(plan: PlanResponse): void {
    if (this.redirecting()) return;
    
    // Show signature modal before proceeding
    this.pendingCheckoutPlanCode.set(plan.code);
    this.pendingCheckoutCycle.set(this.cycle());
    this.showSignatureModal.set(true);
  }

  protected onSignatureSigned(): void {
    const planCode = this.pendingCheckoutPlanCode();
    const cycle = this.pendingCheckoutCycle();
    
    this.showSignatureModal.set(false);
    this.pendingCheckoutPlanCode.set(null);

    if (!planCode) return;

    this.redirecting.set(true);
    this.billingService.startCheckout(planCode, cycle).subscribe({
      next: (res) => {
        window.location.href = res.redirectUrl;
      },
      error: () => {
        this.redirecting.set(false);
      },
    });
  }

  protected onSignatureCancelled(): void {
    this.showSignatureModal.set(false);
    this.pendingCheckoutPlanCode.set(null);
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
