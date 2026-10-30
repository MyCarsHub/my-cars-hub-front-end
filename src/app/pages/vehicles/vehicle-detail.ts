import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { KvList } from '../../components/core/kv-list/kv-list';
import { ListGroup, ListRow } from '../../components/core/list-group/list-group';
import { PaintedCard } from '../../components/core/painted-card/painted-card';
import {
  SegmentedTabs,
  SegmentedTabsOption,
} from '../../components/core/segmented-tabs/segmented-tabs';
import { StatusChip, StatusChipTone } from '../../components/core/status-chip/status-chip';
import { VehicleActionsGroup } from './components/vehicle-actions-group/vehicle-actions-group';
import { VehicleHistoryGroup } from './components/vehicle-history-group/vehicle-history-group';
import { VehicleIcon } from './components/vehicle-icon/vehicle-icon';
import { VehicleMoneyHero } from './components/vehicle-money-hero/vehicle-money-hero';
import { VehiclePendencias } from './components/vehicle-pendencias/vehicle-pendencias';
import { VehicleRentalHero } from './components/vehicle-rental-hero/vehicle-rental-hero';
import { VehicleDocumentsCard } from './vehicle-documents-card';
import { VehicleDetailPhoto } from './components/vehicle-detail-photo/vehicle-detail-photo';
import { DocumentLike } from '../../components/documents/documents-card';
import {
  SellVehicleDialog,
  SellVehicleFormValue,
} from './components/sell-vehicle-dialog/sell-vehicle-dialog';
import { ApiErrorService } from '../../services/api-error.service';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import { IpvaStatus, Vehicle, VehiclePhotoSource, VehicleType } from '../../types/vehicle.types';
import { GerenciaSummary } from '../../types/gerencia-summary.types';
import { RentalListItemDto, RentalResponseDto } from '../../types/rental.types';
import { VehiclePendencia } from '../../types/vehicle-pendencia.types';
import { vehicleStatusMeta } from '../../utils/status-maps';
import { RentalService } from '../rentals/rental.service';
import {
  VehicleHero,
  brl,
  dayMonth,
  idleHero,
  latestEnd,
  pendenciaChip,
  pendenciaKm,
  rentedHero,
} from './vehicle-page.model';
import { formatSaleDate, saleReleasesSlotNote, soldLockReason as soldLockReasonFor } from './vehicle-sale-copy';

const TYPE_LABEL: Record<VehicleType, string> = { CAR: 'Carro', MOTORCYCLE: 'Moto' };

const IPVA_STATUS_CHIP: Record<IpvaStatus, { label: string; tone: StatusChipTone }> = {
  PAID: { label: 'Pago', tone: 'green' },
  PENDING: { label: 'Pendente', tone: 'neutral' },
  OVERDUE: { label: 'Vencido', tone: 'orange' },
};

export type VehicleTab = 'veiculo' | 'gerencia';

/** O segmento vem de `?aba=gerencia`: é para lá que o caminho antigo redireciona. */
function tabFromQuery(value: string | null): VehicleTab {
  return value === 'gerencia' ? 'gerencia' : 'veiculo';
}

@Component({
  selector: 'app-vehicle-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DefaultPageLayout,
    ConfirmDialog,
    AlertBanner,
    KvList,
    ListGroup,
    ListRow,
    PaintedCard,
    SegmentedTabs,
    StatusChip,
    VehicleActionsGroup,
    VehicleDocumentsCard,
    VehicleDetailPhoto,
    VehicleHistoryGroup,
    VehicleIcon,
    VehicleMoneyHero,
    VehiclePendencias,
    VehicleRentalHero,
    SellVehicleDialog,
  ],
  templateUrl: './vehicle-detail.html',
})
export class VehicleDetail implements OnInit {
  private readonly vehiclesService = inject(VehiclesService);
  private readonly rentalService = inject(RentalService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
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

  protected readonly tab = signal<VehicleTab>('veiculo');

  // Cada leitura carrega sozinha: se uma falha, as outras continuam na tela. A página só
  // LÊ daqui para baixo; quem resolve pendência ou cobrança é a tela de destino.
  protected readonly summary = signal<GerenciaSummary | null>(null);
  protected readonly summaryError = signal<string | null>(null);
  protected readonly pendencias = signal<readonly VehiclePendencia[]>([]);
  protected readonly pendenciasLoaded = signal(false);
  protected readonly pendenciasError = signal<string | null>(null);

  private readonly activeRental = signal<RentalListItemDto | null>(null);
  private readonly rentalDetail = signal<RentalResponseDto | null>(null);
  /** `null`: nenhum concluído. `undefined`: não deu para saber. */
  private readonly lastRentalEnd = signal<string | null | undefined>(undefined);
  protected readonly rentalLoading = signal(true);

  protected readonly pageTitle = computed(() => {
    const v = this.vehicle();
    return v ? this.formatPlate(v.plate) : 'Veículo';
  });

  protected readonly pageDescription = computed(() => {
    const v = this.vehicle();
    if (!v) return '';
    return [`${v.brand} ${v.model}`, v.yearModel, v.color].filter(Boolean).join(' · ');
  });

  /** O número do segmento é o tamanho da lista, nunca o `openCount` do resumo. */
  protected readonly tabOptions = computed<readonly SegmentedTabsOption<VehicleTab>[]>(() => {
    const count = this.pendencias().length;
    return [
      { value: 'veiculo', label: 'Veículo' },
      {
        value: 'gerencia',
        label: 'Gerência',
        count,
        countLabel: count === 1 ? '1 pendência' : `${count} pendências`,
      },
    ];
  });

  protected readonly hero = computed<VehicleHero | null>(() => {
    const v = this.vehicle();
    if (!v) return null;
    const rental = this.activeRental();
    if (rental) return rentedHero(rental, this.rentalDetail());
    // Vendido e sem aluguel: o bloco da venda já diz tudo.
    if (v.sale) return null;
    return idleHero(v.id, v.status, this.lastRentalEnd());
  });

  /**
   * A foto do cabeçalho, a mesma da lista: quem decide é o backend (o anexo PHOTO,
   * senão a frente da última vistoria aprovada). Signal próprio, e não lido de
   * `vehicle()`, porque venda e status respondem o veículo SEM foto: copiar essa
   * resposta para `vehicle` não pode apagar o quadro.
   */
  protected readonly photo = signal<{ url: string; source: VehiclePhotoSource } | null>(null);
  private readonly photoFailed = signal(false);
  protected readonly showPhoto = computed(() => this.photo() !== null && !this.photoFailed());

  /** Nome do anexo PHOTO, para o visualizador. A foto em si não sai daqui. */
  protected readonly photoFileName = signal<string | null>(null);
  /** O anexo PHOTO conhecido; `undefined` até a primeira lista do card. */
  private photoDocumentId: string | null | undefined = undefined;
  private photoRefresh: Subscription | null = null;

  protected readonly typeLabel = computed(() => {
    const t = this.vehicle()?.type;
    return t ? TYPE_LABEL[t] : '—';
  });

  protected readonly statusInfo = computed(() => vehicleStatusMeta(this.vehicle()?.status));

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
   * Efeito da venda na vaga do plano (FIX-0262), no banner de vendido. Mesma
   * frase do diálogo de vender — mora em `vehicle-sale-copy` por isso.
   */
  protected readonly slotNote = saleReleasesSlotNote;

  /**
   * Motivo ÚNICO pelo qual as ações de operação estão travadas.
   *
   * Vira `title`/`aria-describedby` dos controles desabilitados: o operador
   * precisa entender POR QUE o botão não responde — esconder a ação faria ele
   * procurar um bug onde existe uma regra.
   */
  protected readonly soldLockReason = computed(() => {
    // A frase mora em `vehicle-sale-copy` porque o formulário de edição usa a
    // MESMA (FIX-0250) — duas cópias divergiriam no primeiro ajuste de texto.
    return soldLockReasonFor(this.sale());
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
      return 'Finalize o aluguel para excluir';
    }
    return null;
  });

  /** Os chips da Documentação leem a pendência: a urgência é decidida no backend. */
  private pendenciaOf(type: VehiclePendencia['type']): VehiclePendencia | undefined {
    return this.pendencias().find((p) => p.type === type);
  }

  protected readonly licensingChip = computed(() => {
    const p = this.pendenciaOf('LICENSING');
    return p ? pendenciaChip(p) : null;
  });

  protected readonly hasIpva = computed(() => {
    const v = this.vehicle();
    if (!v) return false;
    return v.ipvaAmount != null || v.ipvaDueDate != null || v.ipvaStatus != null;
  });

  protected readonly ipvaTitle = computed(() => {
    const due = this.vehicle()?.ipvaDueDate;
    return due ? `IPVA ${due.slice(0, 4)}` : 'IPVA';
  });

  protected readonly ipvaDetail = computed(() => {
    const v = this.vehicle();
    const amount = v?.ipvaAmount != null ? brl(v.ipvaAmount) : null;
    const due = v?.ipvaDueDate ? `vence em ${dayMonth(v.ipvaDueDate)}` : null;
    return [amount, due].filter(Boolean).join(', ') || 'Sem valor informado';
  });

  protected readonly ipvaChip = computed(() => {
    const p = this.pendenciaOf('IPVA');
    if (p) return pendenciaChip(p);
    const status = this.vehicle()?.ipvaStatus;
    return status ? IPVA_STATUS_CHIP[status] : null;
  });

  protected formatKm(km: number | null | undefined): string {
    return km == null ? '—' : pendenciaKm(km);
  }

  protected formatMoney(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return (cents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  }

  ngOnInit(): void {
    // O redirecionamento de `:id/gerencia` pode cair nesta mesma página, já aberta.
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => this.tab.set(tabFromQuery(params.get('aba'))));

    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.load(id);
    this.loadSummary(id);
    this.loadPendencias(id);
    this.loadRental(id);
  }

  protected selectTab(tab: VehicleTab): void {
    this.tab.set(tab);
    void this.router.navigate([], {
      queryParams: { aba: tab === 'gerencia' ? 'gerencia' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private loadSummary(id: string): void {
    this.summaryError.set(null);
    this.vehiclesService.getGerenciaSummary(id).subscribe({
      next: (s) => this.summary.set(s),
      error: (err: HttpErrorResponse) => {
        this.summaryError.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar a gerência do veículo.'),
        );
      },
    });
  }

  private loadPendencias(id: string): void {
    this.pendenciasError.set(null);
    this.vehiclesService.getPendencias(id).subscribe({
      next: (items) => {
        this.pendencias.set(Array.isArray(items) ? items : []);
        this.pendenciasLoaded.set(true);
      },
      error: (err: HttpErrorResponse) => {
        this.pendenciasError.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar as pendências.'),
        );
      },
    });
  }

  /** Só GET: aluguel ativo, o detalhe dele, ou o último concluído para o carro parado. */
  private loadRental(id: string): void {
    this.rentalLoading.set(true);
    this.rentalService.list({ vehicleId: id, status: 'ACTIVE', size: 1 }).subscribe({
      next: (res) => {
        const active = res.content?.[0] ?? null;
        this.activeRental.set(active);
        if (active) this.loadRentalDetail(active.id);
        else this.loadLastRentalEnd(id);
      },
      error: (err: HttpErrorResponse) => this.onRentalFailed(err),
    });
  }

  private loadRentalDetail(rentalId: string): void {
    this.rentalService.getById(rentalId).subscribe({
      next: (detail) => {
        this.rentalDetail.set(detail);
        this.rentalLoading.set(false);
      },
      error: (err: HttpErrorResponse) => this.onRentalFailed(err),
    });
  }

  private loadLastRentalEnd(vehicleId: string): void {
    this.rentalService.list({ vehicleId, status: 'COMPLETED', size: 100 }).subscribe({
      next: (res) => {
        this.lastRentalEnd.set(latestEnd(res.content ?? []));
        this.rentalLoading.set(false);
      },
      error: (err: HttpErrorResponse) => this.onRentalFailed(err),
    });
  }

  /** O hero diz que não leu; o aluguel em si não mudou, então nada de banner vermelho. */
  private onRentalFailed(err: HttpErrorResponse): void {
    this.apiErrors.claim(err);
    this.rentalLoading.set(false);
  }

  protected retrySummary(): void {
    const id = this.vehicle()?.id;
    if (id) this.loadSummary(id);
  }

  protected retryPendencias(): void {
    const id = this.vehicle()?.id;
    if (id) this.loadPendencias(id);
  }

  /** Venda e desfazer mudam Resultado e pendências, e a página não recarrega sozinha. */
  private refreshGerencia(vehicleId: string): void {
    this.loadSummary(vehicleId);
    this.loadPendencias(vehicleId);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.vehiclesService.getOne(id, { includePhoto: true }).subscribe({
      next: (v) => {
        this.vehicle.set(v);
        this.showPhotoOf(v);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Veículo não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  /**
   * A lista vem do servidor com o mais recente primeiro, como na edição do veículo.
   * Ela não escolhe a foto: só avisa que o anexo mudou no slot. Aí o backend é
   * perguntado de novo, porque remover o anexo pode revelar a frente da vistoria.
   * A primeira lista não pergunta nada: o GET do veículo acabou de responder.
   */
  protected onDocumentsChange(documents: DocumentLike[]): void {
    const document = documents.find((d) => d.kind === 'PHOTO') ?? null;
    const previousId = this.photoDocumentId;
    this.photoDocumentId = document?.id ?? null;
    this.photoFileName.set(document?.fileName ?? null);
    if (previousId === undefined || previousId === this.photoDocumentId) return;
    this.refreshPhoto();
  }

  private refreshPhoto(): void {
    const v = this.vehicle();
    if (!v) return;
    this.photoRefresh?.unsubscribe();
    this.photoRefresh = this.vehiclesService.getOne(v.id, { includePhoto: true }).subscribe({
      next: (fresh) => this.showPhotoOf(fresh),
      error: (err: HttpErrorResponse) => {
        // O card de documentos, logo abaixo, é quem fala de falha de anexo. O
        // quadro não fica mostrando um arquivo que pode já ter sido removido.
        this.apiErrors.claim(err);
        this.showPhotoOf(null);
      },
    });
  }

  private showPhotoOf(vehicle: Vehicle | null): void {
    const url = vehicle?.photoUrl;
    const source = vehicle?.photoSource;
    this.photoFailed.set(false);
    this.photo.set(url && source ? { url, source } : null);
  }

  protected onPhotoFailed(): void {
    this.photoFailed.set(true);
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
        this.refreshGerencia(updated.id);
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
        this.refreshGerencia(updated.id);
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
    if (!v || this.transitioning() || this.sold() || v.status === 'RENTED') return;
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

  /**
   * Delegado a `vehicle-sale-copy.formatSaleDate`: era o MESMO corpo, byte a
   * byte. Uma cópia a menos para alguém consertar a âncora `T00:00:00` só de um
   * lado (é ela que impede o `Date` de voltar um dia no fuso do Brasil).
   */
  protected formatDate(iso: string | null | undefined): string {
    return formatSaleDate(iso);
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
