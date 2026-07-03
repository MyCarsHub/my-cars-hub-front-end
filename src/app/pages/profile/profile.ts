import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { AuthService } from '../../services/auth.service';
import { SessionService } from '../../services/session.service';
import { BillingService } from '../../services/billing.service';
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
  private meSub: Subscription | null = null;

  protected readonly subscription = this.billingService.subscription;

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
    this.billingService.loadSubscription().subscribe({ error: () => void 0 });
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

  protected billingStatusIsHealthy(sub: SubscriptionResponse): boolean {
    return sub.status === 'ACTIVE' || sub.status === 'TRIALING';
  }

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
