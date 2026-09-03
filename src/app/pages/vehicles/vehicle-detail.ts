import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { BackLink } from '../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { DetailActions } from '../../components/core/detail-actions/detail-actions';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { VehicleDocumentsCard } from './vehicle-documents-card';
import {
  SellVehicleDialog,
  SellVehicleFormValue,
} from './components/sell-vehicle-dialog/sell-vehicle-dialog';
import { ApiErrorService } from '../../services/api-error.service';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import { IpvaStatus, Vehicle, VehicleType } from '../../types/vehicle.types';
import { vehicleStatusMeta } from '../../utils/status-maps';

const TYPE_LABEL: Record<VehicleType, { label: string; chip: string }> = {
  CAR: { label: 'Carro', chip: 'bg-blue-100 text-blue-700' },
  MOTORCYCLE: { label: 'Moto', chip: 'bg-amber-100 text-amber-800' },
};

const IPVA_STATUS_LABEL: Record<IpvaStatus, { label: string; chip: string }> = {
  PAID: { label: 'Pago', chip: 'bg-emerald-100 text-emerald-800' },
  PENDING: { label: 'Pendente', chip: 'bg-amber-100 text-amber-800' },
  OVERDUE: { label: 'Vencido', chip: 'bg-red-100 text-red-800' },
};

@Component({
  selector: 'app-vehicle-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BackLink,
    RouterLink,
    DecimalPipe,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    DetailActions,
    AlertBanner,
    VehicleDocumentsCard,
    SellVehicleDialog,
  ],
  templateUrl: './vehicle-detail.html',
})
export class VehicleDetail implements OnInit {
  private readonly vehiclesService = inject(VehiclesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly transitioning = signal(false);

  protected readonly vehicle = signal<Vehicle | null>(null);
  protected readonly loading = signal(false);
  /** Falha ao CARREGAR o veículo — banner com caminho de volta pra lista. */
  protected readonly error = signal<string | null>(null);
  /**
   * Falha de uma OPERAÇÃO da tela (excluir, transição de status). Banner inline,
   * nunca toast: o interceptor não toasta 4xx e `messageFor()` reivindica o erro.
   */
  protected readonly actionError = signal<string | null>(null);
  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);

  protected readonly vehicleId = computed(() => this.vehicle()?.id ?? '');

  protected readonly typeInfo = computed(() => {
    const t = this.vehicle()?.type;
    return t ? TYPE_LABEL[t] : { label: '—', chip: 'bg-neutral-100 text-neutral-700' };
  });

  protected readonly statusInfo = computed(() => {
    const s = this.vehicle()?.status;
    return vehicleStatusMeta(s);
  });

  protected readonly canGoMaintenance = computed(() => {
    const s = this.vehicle()?.status;
    return s === 'AVAILABLE' || s === 'INACTIVE';
  });

  // Transições de status continuam VISÍVEIS no veículo vendido, mas
  // desabilitadas (ver `soldLockReason`): sumir com elas esconderia a regra.
  protected readonly canGoAvailable = computed(() => {
    const s = this.vehicle()?.status;
    return s === 'MAINTENANCE' || s === 'INACTIVE';
  });

  protected readonly canGoInactive = computed(() => {
    const s = this.vehicle()?.status;
    return s === 'AVAILABLE' || s === 'MAINTENANCE';
  });

  // ---- Venda (FEAT-0072) ------------------------------------------------

  protected readonly sellOpen = signal(false);
  protected readonly selling = signal(false);
  /** Recusa do servidor no POST: fica DENTRO do diálogo, com o form preservado. */
  protected readonly sellError = signal<string | null>(null);
  protected readonly undoOpen = signal(false);
  protected readonly undoingSale = signal(false);

  /**
   * Teto do seletor de data do diálogo — o template não tem `new Date()`.
   *
   * Recalculado a cada abertura (`askSell`) e não capturado na construção: uma
   * aba deixada aberta atravessando a meia-noite continuaria recusando "hoje".
   */
  protected readonly maxSaleDate = signal(todayAsInputDate());

  /** O veículo foi vendido: a tela inteira passa a ser somente-leitura. */
  protected readonly sold = computed(() => this.vehicle()?.sale != null);

  protected readonly sale = computed(() => this.vehicle()?.sale ?? null);

  /**
   * Motivo ÚNICO pelo qual as ações de operação estão travadas.
   *
   * Vira `title`/`aria-describedby` dos controles desabilitados: o operador
   * precisa entender POR QUE o botão não responde — esconder a ação faria ele
   * procurar um bug onde existe uma regra.
   */
  protected readonly soldLockReason = computed(() => {
    const sale = this.sale();
    if (!sale) return null;
    return `Veículo vendido em ${this.formatDate(sale.saleDate)}. Desfaça a venda para voltar a operar.`;
  });

  protected readonly sellEntityLabel = computed(() => {
    const v = this.vehicle();
    if (!v) return '';
    return `${this.formatPlate(v.plate)} · ${v.brand} ${v.model}`;
  });

  protected readonly deleteDisabledReason = computed(() => {
    const soldReason = this.soldLockReason();
    if (soldReason) return soldReason;
    const s = this.vehicle()?.status;
    if (s === 'RENTED') {
      return 'Veículo está alugado. Finalize o aluguel para excluir.';
    }
    return null;
  });

  protected readonly licensingBadge = computed(() => {
    const iso = this.vehicle()?.licensingExpiration;
    if (!iso) return null;
    const expiry = new Date(iso + 'T00:00:00').getTime();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = Math.round((expiry - startOfToday) / 86400000);
    if (days < 0) return { label: 'Vencido', chip: 'bg-rose-100 text-rose-700' };
    if (days <= 30) return { label: `Vence em ${days}d`, chip: 'bg-amber-100 text-amber-800' };
    return null;
  });

  protected readonly hasIpva = computed(() => {
    const v = this.vehicle();
    if (!v) return false;
    return v.ipvaAmount != null || v.ipvaDueDate != null || v.ipvaStatus != null;
  });

  protected readonly ipvaStatusBadge = computed(() => {
    const s = this.vehicle()?.ipvaStatus;
    return s ? IPVA_STATUS_LABEL[s] : null;
  });

  protected readonly ipvaOverdueChip = computed(() => {
    const v = this.vehicle();
    if (!v || !v.ipvaExpired || v.ipvaStatus === 'PAID') return null;
    if (!v.ipvaDueDate) return { label: 'IPVA vencido' };
    const due = new Date(v.ipvaDueDate + 'T00:00:00').getTime();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = Math.max(0, Math.round((startOfToday - due) / 86400000));
    if (days === 0) return { label: 'IPVA vence hoje' };
    return { label: `IPVA vencido há ${days} ${days === 1 ? 'dia' : 'dias'}` };
  });

  protected formatMoney(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return (cents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.vehiclesService.getOne(id).subscribe({
      next: (v) => {
        this.vehicle.set(v);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Veículo não encontrado.'));
        this.loading.set(false);
      },
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
    const v = this.vehicle();
    if (!v) return;
    this.actionError.set(null);
    this.deleting.set(true);
    this.vehiclesService.remove(v.id).subscribe({
      next: () => {
        this.notify.success(`Veículo «${this.formatPlate(v.plate)}» excluído.`);
        this.router.navigate(['/veiculos']);
      },
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível excluir o veículo.'),
        );
      },
    });
  }

  // ---- Venda: registrar, desfazer (FEAT-0072) ---------------------------

  protected askSell(): void {
    if (this.sold()) return;
    this.sellError.set(null);
    this.maxSaleDate.set(todayAsInputDate());
    this.sellOpen.set(true);
  }

  protected cancelSell(): void {
    if (this.selling()) return;
    this.sellOpen.set(false);
    this.sellError.set(null);
  }

  /**
   * O diálogo já entrega o valor em CENTAVOS e a data validada; aqui só resta
   * a chamada. A recusa do servidor volta para DENTRO do diálogo, com o
   * formulário preservado — o usuário corrige sem redigitar tudo.
   */
  protected confirmSell(value: SellVehicleFormValue): void {
    const v = this.vehicle();
    if (!v || this.selling()) return;
    this.sellError.set(null);
    this.selling.set(true);
    this.vehiclesService.sell(v.id, value).subscribe({
      next: (updated) => {
        this.selling.set(false);
        this.sellOpen.set(false);
        this.vehicle.set(updated);
        this.notify.success(`Venda registrada para «${this.formatPlate(updated.plate)}».`);
      },
      error: (err: HttpErrorResponse) => {
        this.selling.set(false);
        this.sellError.set(
          this.apiErrors.messageFor(err, 'Não foi possível registrar a venda.'),
        );
      },
    });
  }

  protected askUndoSale(): void {
    if (!this.sold()) return;
    this.actionError.set(null);
    this.undoOpen.set(true);
  }

  protected cancelUndoSale(): void {
    if (this.undoingSale()) return;
    this.undoOpen.set(false);
  }

  /**
   * Desfaz a venda (recompra). O 409 aqui NÃO é erro técnico: significa que a
   * frota já reocupou a vaga do plano enquanto o veículo estava vendido. A
   * mensagem diz o que aconteceu e as DUAS saídas possíveis — genérico
   * ("não foi possível") deixaria o operador sem ação.
   */
  protected confirmUndoSale(): void {
    const v = this.vehicle();
    if (!v || this.undoingSale()) return;
    this.actionError.set(null);
    this.undoingSale.set(true);
    this.vehiclesService.undoSale(v.id, 'Venda desfeita pelo operador').subscribe({
      next: (updated) => {
        this.undoingSale.set(false);
        this.undoOpen.set(false);
        this.vehicle.set(updated);
        this.notify.success('Venda desfeita. O veículo voltou para a frota.');
      },
      error: (err: HttpErrorResponse) => {
        this.undoingSale.set(false);
        this.undoOpen.set(false);
        this.actionError.set(this.undoSaleErrorMessage(err));
      },
    });
  }

  private undoSaleErrorMessage(err: HttpErrorResponse): string {
    if (err.status === 409) {
      // O texto do servidor pode ser técnico; aqui o operador precisa das
      // saídas. Se o backend mandar uma mensagem própria, ela entra como
      // contexto no fim, sem substituir a explicação.
      const detail = this.apiErrors.messageFor(err, '');
      const base =
        'Não dá para desfazer a venda agora: a vaga deste veículo no plano já foi ocupada ' +
        'por outro carro da frota. Libere uma vaga (venda, exclua ou inative outro veículo) ' +
        'ou faça upgrade do plano e tente de novo.';
      return detail ? `${base} (${detail})` : base;
    }
    return this.apiErrors.messageFor(err, 'Não foi possível desfazer a venda.');
  }

  protected transitionStatus(target: 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE'): void {
    const v = this.vehicle();
    if (!v || this.transitioning() || this.sold()) return;
    this.actionError.set(null);
    this.transitioning.set(true);
    this.vehiclesService.updateStatus(v.id, target).subscribe({
      next: (updated) => {
        this.transitioning.set(false);
        this.vehicle.set(updated);
        this.notify.success(`Status atualizado para ${vehicleStatusMeta(updated.status).label}.`);
      },
      error: (err: HttpErrorResponse) => {
        this.transitioning.set(false);
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível alterar o status.'),
        );
      },
    });
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    if (iso.length === 10) return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  protected formatPlate(plate: string | undefined): string {
    const p = (plate ?? '').toUpperCase();
    if (p.length === 7) return `${p.slice(0, 3)}-${p.slice(3)}`;
    return p || '—';
  }
}

/**
 * Hoje no fuso LOCAL, em `yyyy-MM-dd` (formato do `input[type=date]`).
 *
 * `toISOString()` converte para UTC e, à noite no Brasil, devolveria o dia
 * SEGUINTE — o teto de "não pode ser no futuro" passaria a aceitar amanhã.
 * Mesma cautela do `nowAsInputDateTime` do formulário de sinistro.
 */
function todayAsInputDate(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
