import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { AuthService } from '../../services/auth.service';
import { SessionService } from '../../services/session.service';
import { BillingService, isFreePlanInForce } from '../../services/billing.service';
import { environment } from '../../../environments/environment';
import { SubscriptionResponse } from '../../types/billing.types';
import { UserCompanies } from '../../types/user-companies';
import { MeResponse, UserDocument } from '../../types/me-response.type';

@Component({
  selector: 'app-profile',
  imports: [ReactiveFormsModule, DefaultPageLayout, PageCard, PrimaryInput],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Profile implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);
  private readonly authService = inject(AuthService);
  private readonly billingService = inject(BillingService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private meSub: Subscription | null = null;

  protected readonly subscription = this.billingService.subscription;

  /**
   * ACTIVE on the free plan, decided by the PLAN PRICE. This page loads
   * `/plans` on entry precisely so the rule has the row it needs; without it
   * the subscription counts as PAID, never as free. Guessing from a
   * momentarily null `currentPeriodEnd` used to label a paid subscription
   * "Plano gratuito / Sem cobrança".
   */
  protected readonly isFreeActive = computed(() =>
    isFreePlanInForce(this.subscription(), this.billingService.plans()),
  );

  protected readonly name = computed(() => this.session.getItem('name') ?? '—');
  protected readonly email = computed(() => this.session.getItem('email') ?? '—');
  protected readonly selectedCompanyName = computed(
    () => this.session.getItem('selectedCompanyName') ?? '—',
  );
  protected readonly selectedRole = computed(
    () => this.session.getItem('selectedRole') ?? '—',
  );

  // In-memory only. NEVER persisted — CPF/CNPJ is PII.
  private readonly _document = signal<UserDocument | null>(null);
  protected readonly documentType = computed(() => this._document()?.type ?? 'CPF');
  protected readonly documentMasked = computed(() => {
    const doc = this._document();
    if (!doc) return '—';
    const raw = doc.value;
    if (doc.type === 'CNPJ' && raw.length === 14) {
      return raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    if (doc.type === 'CPF' && raw.length === 11) {
      return raw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }
    return raw;
  });

  protected readonly profileForm = this.fb.group({
    name: [{ value: this.session.getItem('name') ?? '', disabled: true }],
    email: [{ value: this.session.getItem('email') ?? '', disabled: true }],
    document: [{ value: '', disabled: true }],
    company: [{ value: this.session.getItem('selectedCompanyName') ?? '', disabled: true }],
  });

  protected readonly companies = computed<UserCompanies[]>(() => {
    const raw = this.session.getItem('userCompanies');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as UserCompanies[]) : [];
    } catch {
      return [];
    }
  });

  protected readonly initials = computed(() => {
    const value = this.name();
    if (!value || value === '—') return '?';
    return value
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  });

  ngOnInit(): void {
    this.meSub = this.http.get<MeResponse>(`${environment.apiUrl}/auth/me`).subscribe({
      next: (me) => {
        this._document.set(me.document ?? null);
        this.profileForm.patchValue({ document: this.documentMasked() });
      },
      error: () => void 0,
    });
    // `/plans` is what turns `isFreeActive` from "unknown" into a fact.
    this.billingService
      .loadPlans()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err: unknown) => console.error('[profile] loadPlans failed', err) });
    this.billingService
      .loadSubscription()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => void 0 });
  }

  ngOnDestroy(): void {
    // Drop the in-memory document reference when leaving the page.
    this._document.set(null);
    this.meSub?.unsubscribe();
  }

  protected roleLabel(role: string): string {
    switch (role) {
      case 'OWNER':
        return 'Proprietário';
      case 'MANAGER':
        return 'Gerente';
      case 'DRIVER':
        return 'Motorista';
      default:
        return role;
    }
  }

  protected isActiveTenant(companyId: string): boolean {
    return this.session.getItem('selectedCompanyId') === companyId;
  }

  protected billingCycleLabel(sub: SubscriptionResponse): string {
    return sub.billingCycle === 'MONTHLY' ? 'Mensal' : 'Anual';
  }

  protected billingStatusLabel(sub: SubscriptionResponse): string {
    switch (sub.status) {
      case 'PENDING':
      case 'INCOMPLETE':
        return 'Aguardando pagamento';
      case 'TRIALING':
        return 'Período de teste';
      case 'ACTIVE':
        return 'Ativa';
      case 'PAST_DUE':
      case 'UNPAID':
        return 'Pagamento pendente';
      case 'PAUSED':
        return 'Pausada';
      case 'CANCELED':
        return 'Cancelada';
      case 'EXPIRED':
        return 'Expirada';
      default:
        return 'Status desconhecido';
    }
  }

  /**
   * Three tones, not two. Only ACTIVE is green; only a genuinely broken state
   * is red. TRIALING (and anything we don't recognise) is NEUTRAL — a running
   * trial is not a problem and must not be dressed as one.
   */
  protected billingStatusTone(sub: SubscriptionResponse): 'healthy' | 'neutral' | 'problem' {
    // A free ACTIVE plan is not a problem, but it is not a paid subscription
    // in force either — green would overstate it.
    if (this.isFreeActive()) return 'neutral';
    switch (sub.status) {
      case 'ACTIVE':
        return 'healthy';
      case 'PAST_DUE':
      case 'UNPAID':
      case 'CANCELED':
      case 'EXPIRED':
        return 'problem';
      case 'TRIALING':
      case 'PAUSED':
      case 'PENDING':
      case 'INCOMPLETE':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  /**
   * Eyebrow above the plan name. Mirrors /billing: only an ACTIVE
   * subscription may be announced as the plan in force.
   */
  protected readonly planEyebrow = computed<string>(() => {
    if (this.isFreeActive()) return 'Plano gratuito';
    switch (this.subscription()?.status) {
      case 'ACTIVE':
        return 'Plano atual';
      case 'TRIALING':
        return 'Período de teste';
      case 'CANCELED':
      case 'EXPIRED':
        return 'Assinatura encerrada';
      default:
        return 'Assinatura';
    }
  });

  protected readonly planTitle = computed<string>(() => {
    const sub = this.subscription();
    if (!sub) return 'Sem plano ativo';
    switch (sub.status) {
      case 'PENDING':
      case 'INCOMPLETE':
        return 'Nenhum plano ativo';
      default:
        return sub.planName || 'Sem plano ativo';
    }
  });

  /** Plan the user started paying for but never confirmed. */
  protected readonly pendingPlanCode = computed<string | null>(() => {
    const sub = this.subscription();
    if (!sub) return null;
    if (sub.pendingPlanCode) return sub.pendingPlanCode;
    if (sub.status === 'PENDING' || sub.status === 'INCOMPLETE') return sub.planCode;
    return null;
  });

  protected billingNextDate(sub: SubscriptionResponse): string {
    const iso = sub.status === 'TRIALING' ? sub.trialEndsAt : sub.currentPeriodEnd;
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(date);
  }

  protected goToBilling(): void {
    this.router.navigate(['/billing']);
  }

  protected logout(): void {
    this.authService.logout();
    this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
