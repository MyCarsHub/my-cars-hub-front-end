import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';

import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { NotificationService } from '../../../services/notification.service';
import { AdminCompaniesService } from '../admin-companies.service';
import {
  AdminCompanyListItem,
  AdminCompanyStatus,
  AdminCompanySubscriptionStatus,
} from '../../../types/admin-company.types';

type StatusFilter = 'ALL' | 'ACTIVE' | 'SUSPENDED';
type PlanFilter = 'ALL' | 'TRIAL_MONTHLY' | 'PRO_MONTHLY';

interface PendingAction {
  kind: 'SUSPEND' | 'REACTIVATE';
  company: AdminCompanyListItem;
}

interface ChipStyle {
  label: string;
  chip: string;
}

const COMPANY_STATUS_CHIPS: Record<AdminCompanyStatus, ChipStyle> = {
  ACTIVE: { label: 'Ativa', chip: 'bg-emerald-100 text-emerald-700' },
  SUSPENDED: { label: 'Suspensa', chip: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Cancelada', chip: 'bg-gray-200 text-gray-700' },
};

const SUB_STATUS_CHIPS: Record<AdminCompanySubscriptionStatus, ChipStyle> = {
  TRIALING: { label: 'Trial', chip: 'bg-blue-100 text-blue-700' },
  ACTIVE: { label: 'Ativa', chip: 'bg-emerald-100 text-emerald-700' },
  PAST_DUE: { label: 'Atrasada', chip: 'bg-amber-100 text-amber-700' },
  CANCELED: { label: 'Cancelada', chip: 'bg-gray-200 text-gray-700' },
  EXPIRED: { label: 'Expirada', chip: 'bg-red-100 text-red-700' },
};

const PAGE_SIZE = 20;

@Component({
  selector: 'app-admin-companies',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, DefaultPageLayout, PageCard, ConfirmDialog],
  templateUrl: './admin-companies.html',
})
export class AdminCompanies implements OnInit, OnDestroy {
  private readonly companiesService = inject(AdminCompaniesService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  protected readonly companies = this.companiesService.companies;
  protected readonly loading = this.companiesService.loading;
  protected readonly error = this.companiesService.error;
  protected readonly total = this.companiesService.total;

  protected readonly searchControl = new FormControl<string>('', { nonNullable: true });
  protected readonly search = signal<string>('');
  protected readonly statusFilter = signal<StatusFilter>('ALL');
  protected readonly planFilter = signal<PlanFilter>('ALL');
  protected readonly currentPage = signal(0);

  protected readonly openActionMenuId = signal<string | null>(null);
  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly rowPending = signal<Record<string, boolean>>({});

  protected readonly totalPages = computed(() => {
    const t = this.total();
    if (t <= 0) return 1;
    return Math.max(1, Math.ceil(t / PAGE_SIZE));
  });

  protected readonly canPrev = computed(() => this.currentPage() > 0);
  protected readonly canNext = computed(() => this.currentPage() + 1 < this.totalPages());

  protected readonly confirmVariant = computed<'info' | 'warning' | 'danger'>(() => {
    const a = this.pendingAction();
    if (!a) return 'info';
    return a.kind === 'SUSPEND' ? 'danger' : 'warning';
  });

  protected readonly confirmTitle = computed(() => {
    const a = this.pendingAction();
    if (!a) return '';
    return a.kind === 'SUSPEND' ? 'Suspender empresa' : 'Reativar empresa';
  });

  protected readonly confirmMessage = computed(() => {
    const a = this.pendingAction();
    if (!a) return '';
    const label = a.company.name;
    return a.kind === 'SUSPEND'
      ? `«${label}» perderá acesso imediatamente à plataforma. Continuar?`
      : `«${label}» voltará a ter acesso normal à plataforma.`;
  });

  protected readonly confirmLabel = computed(() => {
    const a = this.pendingAction();
    if (!a) return 'Confirmar';
    return a.kind === 'SUSPEND' ? 'Suspender' : 'Reativar';
  });

  constructor() {
    effect(() => {
      const search = this.search();
      const status = this.statusFilter();
      const plan = this.planFilter();
      const page = this.currentPage();
      this.companiesService
        .load({
          search,
          status,
          planCode: plan === 'ALL' ? null : plan,
          page,
          size: PAGE_SIZE,
        })
        .subscribe({
          error: () => this.notify.error('Falha ao carregar empresas.'),
        });
    });
  }

  ngOnInit(): void {
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((value) => {
        this.currentPage.set(0);
        this.search.set(value ?? '');
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  protected setStatusFilter(value: StatusFilter): void {
    this.currentPage.set(0);
    this.statusFilter.set(value);
  }

  protected setPlanFilter(value: PlanFilter): void {
    this.currentPage.set(0);
    this.planFilter.set(value);
  }

  protected prevPage(): void {
    if (this.canPrev()) this.currentPage.update((p) => p - 1);
  }

  protected nextPage(): void {
    if (this.canNext()) this.currentPage.update((p) => p + 1);
  }

  protected toggleMenu(company: AdminCompanyListItem, event?: Event): void {
    event?.stopPropagation();
    this.openActionMenuId.update((cur) => (cur === company.id ? null : company.id));
  }

  protected closeMenu(): void {
    this.openActionMenuId.set(null);
  }

  protected openDetail(company: AdminCompanyListItem): void {
    this.closeMenu();
    this.router.navigate(['/admin/companies', company.id]);
  }

  protected requestToggleStatus(company: AdminCompanyListItem): void {
    this.closeMenu();
    if (company.active) {
      this.pendingAction.set({ kind: 'SUSPEND', company });
    } else {
      // reactivate is safe — apply direct
      this.applyStatus(company, true);
    }
  }

  protected cancelPending(): void {
    this.pendingAction.set(null);
  }

  protected confirmPending(): void {
    const a = this.pendingAction();
    if (!a) return;
    this.applyStatus(a.company, a.kind !== 'SUSPEND');
    this.pendingAction.set(null);
  }

  protected isPending(id: string): boolean {
    return !!this.rowPending()[id];
  }

  protected companyChip(status: AdminCompanyStatus): ChipStyle {
    return COMPANY_STATUS_CHIPS[status] ?? { label: status, chip: 'bg-gray-100 text-gray-700' };
  }

  protected subChip(status: AdminCompanySubscriptionStatus | null): ChipStyle | null {
    if (!status) return null;
    return SUB_STATUS_CHIPS[status] ?? { label: status, chip: 'bg-gray-100 text-gray-700' };
  }

  protected formatDate(value: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private setRowPending(id: string, value: boolean): void {
    this.rowPending.update((state) => ({ ...state, [id]: value }));
  }

  private applyStatus(company: AdminCompanyListItem, active: boolean): void {
    this.setRowPending(company.id, true);
    this.companiesService.updateStatus(company.id, active).subscribe({
      next: () => {
        this.setRowPending(company.id, false);
        this.notify.success(active ? 'Empresa reativada.' : 'Empresa suspensa.');
      },
      error: (err: HttpErrorResponse) => {
        this.setRowPending(company.id, false);
        this.notify.error(this.extractError(err, 'Falha ao atualizar status da empresa.'));
      },
    });
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
