import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { DetailActions } from '../../components/core/detail-actions/detail-actions';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import {
  VehicleSummary,
  VehicleSummaryChip,
} from '../../components/vehicles/vehicle-summary-chip/vehicle-summary-chip';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { InsurancesService } from '../../services/insurances.service';
import {
  InsuranceDetail as InsuranceDetailDto,
  InsuranceInstallment,
  InsurancePolicyDocument,
} from '../../types/insurance.types';
import {
  INSURANCE_COVERAGE_LABELS,
  INSURANCE_PAYMENT_METHOD_LABELS,
  INSURANCE_STATUS_META,
} from '../../utils/status-maps';
import { todayIso } from '../../components/vehicles/insurance-form-fields/insurance-utils';
import { InsurancePolicyDocumentCard } from './insurance-policy-document-card';
import { InsuranceInstallmentsCard } from './insurance-installments-card';

/** Ação de página aguardando confirmação no diálogo. */
type PendingAction = 'cancel' | 'delete';

@Component({
  selector: 'app-insurance-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    DetailActions,
    AlertBanner,
    VehicleSummaryChip,
    InsurancePolicyDocumentCard,
    InsuranceInstallmentsCard,
  ],
  templateUrl: './insurance-detail.html',
})
export class InsuranceDetail implements OnInit {
  private readonly insurancesService = inject(InsurancesService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly insurance = signal<InsuranceDetailDto | null>(null);
  protected readonly loading = signal(false);
  /** Load failure — replaces the page body. */
  protected readonly error = signal<string | null>(null);
  /** Falha de uma ação (cancelar/excluir). Banner inline, nunca toast. */
  protected readonly actionError = signal<string | null>(null);

  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly actionBusy = signal(false);

  protected readonly dialogOpen = computed(() => this.pendingAction() !== null);

  protected readonly dialogTitle = computed(() =>
    this.pendingAction() === 'cancel' ? 'Cancelar apólice' : 'Excluir apólice',
  );

  protected readonly dialogMessage = computed(() =>
    this.pendingAction() === 'cancel'
      ? 'Cancelar esta apólice com a data de hoje? Ela deixa de contar como cobertura ativa do veículo.'
      : 'Tem certeza que deseja excluir esta apólice? Esta ação não pode ser desfeita.',
  );

  protected readonly dialogConfirmLabel = computed(() =>
    this.pendingAction() === 'cancel' ? 'Cancelar apólice' : 'Excluir',
  );

  protected readonly dialogVariant = computed<'info' | 'warning' | 'danger'>(() =>
    this.pendingAction() === 'cancel' ? 'warning' : 'danger',
  );

  protected readonly chipVehicle = computed<VehicleSummary | null>(() => {
    const i = this.insurance();
    if (!i) return null;
    return {
      id: i.vehicleId,
      plate: i.vehiclePlate,
      brand: i.vehicleBrand,
      model: i.vehicleModel,
    };
  });

  protected readonly statusBadge = computed<{ label: string; chip: string }>(() => {
    const i = this.insurance();
    if (!i) return { label: '—', chip: 'bg-neutral-100 text-neutral-700' };
    const meta = INSURANCE_STATUS_META[i.status];
    return meta
      ? { label: meta.label, chip: meta.chip }
      : { label: i.status, chip: 'bg-neutral-100 text-neutral-700' };
  });

  /** Badge de vencimento derivado de `daysToExpiry` (calculado no backend). */
  protected readonly expiryBadge = computed<{ label: string; chip: string } | null>(() => {
    const i = this.insurance();
    if (!i || i.status !== 'ACTIVE') return null;
    const days = i.daysToExpiry;
    if (days == null) return null;
    if (days < 0) return { label: 'Vencida', chip: 'bg-rose-100 text-rose-700' };
    if (days <= 7) return { label: `Vence em ${days} dia(s)`, chip: 'bg-rose-100 text-rose-700' };
    if (days <= 30) return { label: `Vence em ${days} dias`, chip: 'bg-amber-100 text-amber-800' };
    return { label: `Vence em ${days} dias`, chip: 'bg-emerald-100 text-emerald-700' };
  });

  protected readonly coverageText = computed<string>(() => {
    const i = this.insurance();
    if (!i) return '—';
    return INSURANCE_COVERAGE_LABELS[i.coverageType] ?? i.coverageType;
  });

  /**
   * Rótulo da forma de pagamento. O mapa local vem primeiro (mesma copy do
   * `<select>` do formulário); `paymentMethodLabel` do backend é o fallback
   * para um valor de enum que o frontend ainda não conheça.
   */
  protected readonly paymentMethodText = computed<string>(() => {
    const i = this.insurance();
    if (!i || !i.paymentMethod) return '—';
    return INSURANCE_PAYMENT_METHOD_LABELS[i.paymentMethod] ?? i.paymentMethodLabel ?? '—';
  });

  /** Apólice CANCELLED ou EXPIRED não pode ser editada nem cancelada. */
  protected readonly canModify = computed<boolean>(() => {
    const i = this.insurance();
    if (!i) return false;
    return i.status !== 'CANCELLED' && i.status !== 'EXPIRED';
  });

  protected readonly editLink = computed<unknown[] | null>(() => {
    const i = this.insurance();
    if (!i || !this.canModify()) return null;
    return ['/seguros', i.id, 'editar'];
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.insurancesService.getOne(id).subscribe({
      next: (i) => {
        this.insurance.set(i);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Apólice não encontrada.'));
        this.loading.set(false);
      },
    });
  }

  /**
   * Sincroniza o detalhe com o que os cards filhos já receberam do backend.
   * Sem refetch de propósito: o POST/DELETE do documento e toda mutação de
   * parcela já devolvem o estado final.
   */
  protected onPolicyDocumentChanged(document: InsurancePolicyDocument | null): void {
    this.insurance.update((i) => (i ? { ...i, policyDocument: document } : i));
  }

  protected onInstallmentsChanged(installments: InsuranceInstallment[]): void {
    this.insurance.update((i) => (i ? { ...i, installments } : i));
  }

  protected askAction(action: PendingAction): void {
    this.pendingAction.set(action);
  }

  protected dismissAction(): void {
    if (this.actionBusy()) return;
    this.pendingAction.set(null);
  }

  protected confirmAction(): void {
    const action = this.pendingAction();
    const i = this.insurance();
    if (!action || !i || this.actionBusy()) return;
    this.actionBusy.set(true);
    this.actionError.set(null);

    const onError = (fallback: string) => (err: unknown) => {
      this.actionBusy.set(false);
      this.pendingAction.set(null);
      this.actionError.set(this.apiErrors.messageFor(err, fallback));
    };

    if (action === 'cancel') {
      this.insurancesService
        .cancel(i.vehicleId, i.id, { cancelledDate: todayIso() })
        .subscribe({
          next: () => {
            this.actionBusy.set(false);
            this.pendingAction.set(null);
            this.notifications.success('Apólice cancelada.');
            this.load(i.id);
          },
          error: onError('Não foi possível cancelar a apólice.'),
        });
      return;
    }

    this.insurancesService.remove(i.vehicleId, i.id).subscribe({
      next: () => {
        this.actionBusy.set(false);
        this.pendingAction.set(null);
        this.notifications.success('Apólice excluída.');
        this.router.navigate(['/seguros']);
      },
      error: onError('Não foi possível excluir a apólice.'),
    });
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    if (iso.length === 10) return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  protected formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100);
  }
}
