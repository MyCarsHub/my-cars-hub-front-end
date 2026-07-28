import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminCompaniesService } from '../admin-companies.service';
import {
  AdminCompanyMember,
  AdminCompanyStatus,
  AdminCompanySubscriptionStatus,
} from '../../../types/admin-company.types';

interface ChipStyle {
  label: string;
  chip: string;
}

const COMPANY_STATUS: Record<AdminCompanyStatus, ChipStyle> = {
  ACTIVE: { label: 'Ativa', chip: 'bg-emerald-100 text-emerald-700' },
  SUSPENDED: { label: 'Suspensa', chip: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Cancelada', chip: 'bg-gray-200 text-gray-700' },
};

const SUB_STATUS: Record<AdminCompanySubscriptionStatus, ChipStyle> = {
  TRIALING: { label: 'Trial', chip: 'bg-blue-100 text-blue-700' },
  ACTIVE: { label: 'Ativa', chip: 'bg-emerald-100 text-emerald-700' },
  PAST_DUE: { label: 'Atrasada', chip: 'bg-amber-100 text-amber-700' },
  CANCELED: { label: 'Cancelada', chip: 'bg-gray-200 text-gray-700' },
  EXPIRED: { label: 'Expirada', chip: 'bg-red-100 text-red-700' },
};

const CONFIRMATION_WORD = 'SUSPENDER';

@Component({
  selector: 'app-admin-company-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
  ],
  templateUrl: './admin-company-detail.html',
})
export class AdminCompanyDetail implements OnInit, OnDestroy {
  private readonly companiesService = inject(AdminCompaniesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  private companyId: string | null = null;

  protected readonly detail = this.companiesService.detail;
  protected readonly loading = this.companiesService.detailLoading;
  /** Falha ao CARREGAR a empresa — banner com CTA de "tentar novamente". */
  protected readonly error = signal<string | null>(null);
  protected readonly updating = this.companiesService.statusUpdating;

  protected readonly confirmDialogOpen = signal(false);
  protected readonly confirmControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  /**
   * Falha da OPERACAO de suspender/reativar (ou da validação da palavra de
   * confirmação). Banner inline dentro do diálogo, nunca toast.
   */
  protected readonly actionError = signal<string | null>(null);

  protected readonly targetActive = computed(() => !(this.detail()?.active ?? false));

  protected readonly companyChip = computed<ChipStyle | null>(() => {
    const status = this.detail()?.status;
    if (!status) return null;
    return COMPANY_STATUS[status] ?? { label: status, chip: 'bg-gray-100 text-gray-700' };
  });

  protected readonly subscriptionChip = computed<ChipStyle | null>(() => {
    const status = this.detail()?.subscription?.status;
    if (!status) return null;
    return SUB_STATUS[status] ?? { label: status, chip: 'bg-gray-100 text-gray-700' };
  });

  ngOnInit(): void {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = params.get('id');
        if (!id) {
          this.router.navigate(['/admin/companies']);
          return;
        }
        this.companyId = id;
        this.loadDetail(id);
      });
  }

  ngOnDestroy(): void {
    this.companiesService.clearDetail();
  }

  protected reload(): void {
    if (this.companyId) this.loadDetail(this.companyId);
  }

  private loadDetail(id: string): void {
    this.error.set(null);
    this.companiesService.loadDetail(id).subscribe({
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar a empresa.'));
      },
    });
  }

  protected openStatusDialog(): void {
    this.confirmControl.reset('');
    this.actionError.set(null);
    this.confirmDialogOpen.set(true);
  }

  protected closeStatusDialog(): void {
    this.confirmDialogOpen.set(false);
    this.actionError.set(null);
  }

  protected confirmStatusChange(): void {
    const current = this.detail();
    if (!current || !this.companyId) return;

    const nextActive = !current.active;
    this.actionError.set(null);

    // Only require the typed confirmation when suspending — reactivating is safe.
    if (!nextActive) {
      const typed = (this.confirmControl.value ?? '').trim().toUpperCase();
      if (typed !== CONFIRMATION_WORD) {
        this.actionError.set(`Digite "${CONFIRMATION_WORD}" para confirmar.`);
        return;
      }
    }

    this.companiesService.updateStatus(this.companyId, nextActive).subscribe({
      next: (res) => {
        this.confirmDialogOpen.set(false);
        this.actionError.set(null);
        this.notifications.success(
          res.active ? 'Empresa reativada com sucesso.' : 'Empresa suspensa com sucesso.',
        );
      },
      error: (err: HttpErrorResponse) => {
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível atualizar o status da empresa.'),
        );
      },
    });
  }

  protected formatDate(value: string | null): string {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  protected formatDateTime(value: string | null): string {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected roleLabel(role: string): string {
    const map: Record<string, string> = {
      OWNER: 'Proprietário',
      MANAGER: 'Gerente',
      DRIVER: 'Motorista',
    };
    return map[role] ?? role;
  }

  protected memberStatusChip(status: string): string {
    if (status === 'ACTIVE') return 'bg-emerald-100 text-emerald-700';
    if (status === 'INVITED') return 'bg-blue-100 text-blue-700';
    return 'bg-gray-100 text-gray-700';
  }

  protected trackMember(_index: number, member: AdminCompanyMember): string {
    return member.userId;
  }

  protected billingCycleLabel(value: string | null): string {
    if (!value) return '—';
    const map: Record<string, string> = {
      WEEKLY: 'Semanal',
      MONTHLY: 'Mensal',
      YEARLY: 'Anual',
    };
    return map[value] ?? value;
  }
}
