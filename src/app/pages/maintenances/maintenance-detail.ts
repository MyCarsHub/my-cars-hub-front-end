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
import { Observable } from 'rxjs';
import { BackLink } from '../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { DetailActions } from '../../components/core/detail-actions/detail-actions';
import {
  VehicleSummary,
  VehicleSummaryChip,
} from '../../components/vehicles/vehicle-summary-chip/vehicle-summary-chip';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import {
  ConcludeMaintenanceDialog,
  isInputRejection,
} from './components/conclude-maintenance-dialog/conclude-maintenance-dialog';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { MaintenancesService } from '../../services/maintenances.service';
import { VehiclesService } from '../../services/vehicles.service';
import {
  MAINTENANCE_STATUS_OPTIONS,
  MAINTENANCE_TYPE_OPTIONS,
  Maintenance,
  MaintenanceStatus,
} from '../../types/maintenance.types';
import { licensingBadge } from '../../utils/status-maps';
import { formatQuantity } from './maintenance-cost';

/** Transições de status disponíveis (backend: `/conclude`, `/cancel`). */
type MaintenanceTransition = 'conclude' | 'cancel';

/** Status a partir dos quais o backend aceita concluir/cancelar. */
const TRANSITIONABLE: readonly MaintenanceStatus[] = ['SCHEDULED', 'IN_PROGRESS'];

@Component({
  selector: 'app-maintenance-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BackLink,
    RouterLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    ConcludeMaintenanceDialog,
    DetailActions,
    VehicleSummaryChip,
    AlertBanner,
  ],
  templateUrl: './maintenance-detail.html',
})
export class MaintenanceDetail implements OnInit {
  private readonly maintenancesService = inject(MaintenancesService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly item = signal<Maintenance | null>(null);
  protected readonly vehicle = signal<VehicleSummary | null>(null);
  protected readonly loading = signal(false);
  /** Load failure — replaces the page body. */
  protected readonly error = signal<string | null>(null);
  /** Failure of the delete action — inline banner above the summary. */
  protected readonly actionError = signal<string | null>(null);

  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);

  /** Transição pendente de confirmação. */
  protected readonly pendingAction = signal<MaintenanceTransition | null>(null);
  protected readonly actionBusy = signal(false);
  /**
   * Recusa da leitura pelo backend (400/422). Fica DENTRO do diálogo, que
   * permanece aberto com o valor digitado — no mobile os botões ficam no fim de
   * uma página longa e o banner cairia fora da tela.
   */
  protected readonly concludeError = signal<string | null>(null);

  protected readonly concludeOpen = computed(() => this.pendingAction() === 'conclude');
  protected readonly cancelOpen = computed(() => this.pendingAction() === 'cancel');

  /**
   * Concluir/cancelar só existem para `SCHEDULED` / `IN_PROGRESS` — qualquer
   * outro status volta 409 no backend, então os botões somem.
   */
  protected readonly canTransition = computed(() => {
    const s = this.item()?.status;
    return s != null && TRANSITIONABLE.includes(s);
  });

  /** Leitura sugerida: a real do veículo quando carregada, senão a já gravada. */
  protected readonly concludeDefault = computed(
    () => this.vehicle()?.hodometer ?? this.item()?.hodometerReading ?? null,
  );

  protected readonly vehicleHodometer = computed(() => this.vehicle()?.hodometer ?? null);

  protected readonly concludeLabel = computed(() => {
    const m = this.item();
    return m ? m.description : '';
  });

  protected readonly typeInfo = computed(() => {
    const t = this.item()?.type;
    return MAINTENANCE_TYPE_OPTIONS.find((o) => o.value === t) ?? null;
  });
  protected readonly statusInfo = computed(() => {
    const s = this.item()?.status;
    return MAINTENANCE_STATUS_OPTIONS.find((o) => o.value === s) ?? null;
  });

  protected readonly nextBadge = computed(() => {
    const iso = this.item()?.nextServiceDate;
    if (!iso) return null;
    const badge = licensingBadge(iso);
    // Only surface urgency states for the "próxima manutenção" chip — "Em dia"
    // is redundant next to the plain date.
    if (badge.label === 'Vencido' || badge.label.startsWith('Vence em')) {
      return badge;
    }
    return null;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.maintenancesService.getOne(id).subscribe({
      next: (m) => {
        this.item.set(m);
        this.loading.set(false);
        this.loadVehicle(m.vehicleId);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Manutenção não encontrada.'));
        this.loading.set(false);
      },
    });
  }

  private loadVehicle(id: string): void {
    this.vehiclesService.getOne(id).subscribe({
      next: (v) =>
        this.vehicle.set({
          id: v.id,
          plate: v.plate,
          brand: v.brand,
          model: v.model,
          type: v.type,
          hodometer: v.hodometer,
          licensingExpiration: v.licensingExpiration,
        }),
      error: () => this.vehicle.set(null),
    });
  }

  protected askDelete(): void {
    this.deleteOpen.set(true);
  }
  protected cancelDelete(): void {
    if (this.deleting()) return;
    this.deleteOpen.set(false);
  }
  protected confirmDelete(): void {
    const m = this.item();
    if (!m) return;
    this.actionError.set(null);
    this.deleting.set(true);
    this.maintenancesService.remove(m.id).subscribe({
      next: () => {
        this.notifications.success('Manutenção removida.');
        this.router.navigate(['/manutencoes']);
      },
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível excluir.'));
      },
    });
  }

  protected askConclude(): void {
    this.concludeError.set(null);
    this.pendingAction.set('conclude');
  }

  protected askCancel(): void {
    this.pendingAction.set('cancel');
  }

  protected closeActionDialog(): void {
    if (this.actionBusy()) return;
    this.pendingAction.set(null);
    this.concludeError.set(null);
  }

  protected confirmConclude(hodometerReading: number): void {
    const m = this.item();
    if (!m || this.actionBusy()) return;
    this.concludeError.set(null);
    this.runTransition(
      this.maintenancesService.conclude(m.id, { hodometerReading }),
      'Manutenção concluída.',
      'Não foi possível concluir a manutenção.',
      // 400/422 = leitura recusada; corrigível no próprio campo do diálogo.
      (message) => this.concludeError.set(message),
    );
  }

  protected confirmCancel(): void {
    const m = this.item();
    if (!m || this.actionBusy()) return;
    this.runTransition(
      this.maintenancesService.cancel(m.id),
      'Manutenção cancelada.',
      'Não foi possível cancelar a manutenção.',
    );
  }

  /**
   * Ao contrário do delete, a transição mantém o usuário na tela: o registro
   * continua existindo e o novo status precisa ficar visível aqui mesmo.
   *
   * @param onFieldError Quando informado e o backend recusar a ENTRADA (400/422),
   * o diálogo permanece aberto com o valor digitado e a mensagem é renderizada
   * dentro dele. Os demais erros (409 de status, 404, 5xx) fecham e vão para o
   * banner — não há o que corrigir no campo.
   */
  private runTransition(
    request: Observable<Maintenance>,
    successMessage: string,
    fallbackError: string,
    onFieldError?: (message: string) => void,
  ): void {
    this.actionError.set(null);
    this.actionBusy.set(true);
    request.subscribe({
      next: (updated) => {
        this.actionBusy.set(false);
        this.pendingAction.set(null);
        this.concludeError.set(null);
        this.item.set(updated);
        this.notifications.success(successMessage);
      },
      error: (err: HttpErrorResponse) => {
        this.actionBusy.set(false);
        const message = this.apiErrors.messageFor(err, fallbackError);
        if (onFieldError && isInputRejection(err)) {
          onFieldError(message);
          return;
        }
        this.pendingAction.set(null);
        this.actionError.set(message);
      },
    });
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    if (iso.length === 10) return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  protected formatNumber(n: number | null | undefined): string {
    if (n == null) return '—';
    return new Intl.NumberFormat('pt-BR').format(n);
  }

  /**
   * Subtotal das peças. Soma os `totalCents` que o backend já gravou (coluna gerada) —
   * não recalcula `quantity * unitPrice` no cliente, para não arriscar divergir do
   * número exibido como total.
   */
  /**
   * Peças da manutenção, normalizadas. O tipo já garante a lista, mas uma resposta
   * de backend anterior à V64 não traz a chave — `?? []` evita quebrar a tela nesse
   * intervalo de deploy.
   */
  protected readonly costItems = computed(() => this.item()?.items ?? []);

  protected readonly itemsTotalCents = computed(() =>
    this.costItems().reduce((sum, it) => sum + (it.totalCents ?? 0), 0),
  );

  /** Quantidade fracionária em pt-BR (`3.5` → `"3,5"`). */
  protected readonly formatQuantity = formatQuantity;

  protected formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100);
  }
}
