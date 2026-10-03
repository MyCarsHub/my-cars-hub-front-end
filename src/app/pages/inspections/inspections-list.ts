import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import {
  FilterChipGroup,
  FilterChipOption,
} from '../../components/filter-chip-group/filter-chip-group';
import { DateRange, DateRangePicker } from '../../components/date-range-picker/date-range-picker';
import { InspectionsService } from '../../services/inspections.service';
import { VehiclesService } from '../../services/vehicles.service';
import { ApiErrorService } from '../../services/api-error.service';
import {
  InspectionKind,
  InspectionListItem,
  InspectionReviewResult,
  InspectionStatus,
} from '../../types/inspection.types';
import { InspectionReview } from './inspection-review';
import { InspectionSchedulesBlock } from './inspection-schedules-block/inspection-schedules-block';

/** Chip de tipo. `'ALL'` é "todas" — não vai para a query. */
type KindChip = FilterChipOption<InspectionKind | 'ALL'>;
type StatusChip = FilterChipOption<InspectionStatus | 'ALL'>;

/**
 * A FILA DO DONO. `SUBMITTED` vem primeiro depois de "Todas" porque e o unico
 * estado que PEDE acao de alguem: e a vistoria que ja foi fotografada e esta
 * parada esperando aprovacao. Sem este filtro a aprovacao existiria mas
 * ninguem a encontraria.
 */
const STATUS_CHIPS: readonly StatusChip[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'SUBMITTED', label: 'Aguardando aprovação' },
  { value: 'PENDING', label: 'Em andamento' },
  { value: 'APPROVED', label: 'Aprovadas' },
  { value: 'REJECTED', label: 'Recusadas' },
];

const STATUS_LABELS: Readonly<Record<InspectionStatus, string>> = {
  PENDING: 'Em andamento',
  SUBMITTED: 'Aguardando aprovação',
  APPROVED: 'Aprovada',
  REJECTED: 'Recusada',
};

const KIND_CHIPS: readonly KindChip[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'CHECKIN', label: 'Entrada' },
  { value: 'CHECKOUT', label: 'Saída' },
  // FLEET é vistoria de FROTA, sem aluguel — o backend a criou no PR #190 e ela
  // não tem equivalente no fluxo antigo, preso à locação.
  { value: 'FLEET', label: 'Frota' },
];

const KIND_LABEL: Record<InspectionKind, string> = {
  CHECKIN: 'Entrada',
  CHECKOUT: 'Saída',
  FLEET: 'Frota',
};

/**
 * `/vistorias` — todas as vistorias da frota, filtráveis.
 *
 * Existe porque a vistoria só era alcançável DENTRO do aluguel: para achar a
 * vistoria de um carro específico era preciso lembrar em qual locação ela
 * estava. Aqui ela é pesquisável por veículo, por locação e por período, e os
 * três filtros se combinam.
 *
 * O endpoint ainda não existe (ver `inspections.service.ts`): a tela consome o
 * contrato proposto. Enquanto ele não sobe, a lista mostra o erro inline em vez
 * de tela branca.
 */
@Component({
  selector: 'app-inspections-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    FilterChipGroup,
    DateRangePicker,
    InspectionReview,
    InspectionSchedulesBlock,
  ],
  templateUrl: './inspections-list.html',
})
export class InspectionsList implements OnInit {
  private readonly service = inject(InspectionsService);
  private readonly vehicles = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly router = inject(Router);

  protected readonly kindChips = KIND_CHIPS;
  protected readonly statusChips = STATUS_CHIPS;

  protected readonly items = this.service.items;
  protected readonly loading = this.service.loading;
  protected readonly error = this.service.error;
  protected readonly page = this.service.page;
  protected readonly size = this.service.size;
  protected readonly total = this.service.total;

  /** Opções do seletor de veículo, carregadas uma vez. */
  protected readonly vehicleOptions = signal<Array<{ id: string; label: string }>>([]);

  protected readonly vehicleId = signal<string>('');
  protected readonly rentalId = signal<string>('');
  protected readonly kind = signal<InspectionKind | 'ALL'>('ALL');
  protected readonly status = signal<InspectionStatus | 'ALL'>('ALL');

  /**
   * Qual linha esta ABERTA para revisao. Uma por vez: duas galerias de 14 fotos
   * abertas no celular e rolagem infinita, e a decisao erra de vistoria.
   */
  protected readonly reviewingId = signal<string | null>(null);
  /**
   * O bloco de agendamento vive ABAIXO da lista, mas a acao primaria da tela
   * fica no topo, em `cardActions` — como em `vehicles-list`. O botao de lá
   * abre o formulario de cá: uma acao, um formulario, nenhuma copia nova.
   */
  private readonly scheduleBlock = viewChild(InspectionSchedulesBlock);

  protected openSchedule(): void {
    this.scheduleBlock()?.openForm('FLEET');
  }

  /**
   * FILTROS recolhidos no CELULAR apenas (`sm:hidden` no gatilho). No desktop a
   * grade cabe e esconder seria esconder sem motivo.
   */
  protected readonly filtersOpen = signal(false);

  protected toggleFilters(): void {
    this.filtersOpen.update((open) => !open);
  }

  /**
   * O CONTADOR e obrigatorio, nao enfeite: recolhido sem ele, um filtro
   * esquecido explicaria uma lista curta sem nenhuma pista na tela.
   */
  protected readonly activeFiltersCount = computed(() => {
    let count = 0;
    if (this.vehicleId() !== '') count++;
    if (this.status() !== 'ALL') count++;
    if (this.kind() !== 'ALL') count++;
    if (this.range() !== null) count++;
    return count;
  });

  protected readonly filtersButtonLabel = computed(() => {
    const n = this.activeFiltersCount();
    return n > 0 ? `Filtros, ${n} ativo${n > 1 ? 's' : ''}` : 'Filtros';
  });

  /** A PORTA ate a captura: ela exige `?vehicleId=`, entao o carro vem daqui. */
  protected readonly startOpen = signal(false);
  protected readonly startVehicleId = signal('');
  protected readonly startError = signal<string | null>(null);

  protected toggleStart(): void {
    this.startError.set(null);
    this.startOpen.update((open) => !open);
  }

  protected onStartVehicleChange(value: string): void {
    this.startVehicleId.set(value);
    this.startError.set(null);
  }

  /**
   * Abre a captura COM o carro escolhido.
   *
   * O card de Detalhes do Veiculo era o unico lugar que passava `vehicleId`, e
   * ele saiu. Sem este passo, o botao levaria a captura a nascer em erro — porta
   * que existe e nao abre, que foi o defeito do dia.
   */
  protected startInspection(): void {
    const vehicleId = this.startVehicleId();
    if (!vehicleId) {
      this.startError.set('Escolha o carro que voce vai vistoriar.');
      return;
    }

    // A promessa NAO e descartada: guard que recusa deixaria a pessoa olhando
    // uma tela que nao mudou, sem nada a fazer.
    this.router
      .navigate(['/vistorias', 'nova'], { queryParams: { vehicleId } })
      .then((ok) => {
        if (!ok) this.startError.set('Nao foi possivel abrir a tela de vistoria.');
      })
      .catch(() => this.startError.set('Nao foi possivel abrir a tela de vistoria.'));
  }

  protected readonly range = signal<DateRange | null>(null);

  /**
   * Há algum filtro ativo?
   *
   * É o que separa "nenhuma vistoria com esses filtros" de "nenhuma vistoria
   * ainda" — duas situações diferentes que não podem mostrar a mesma frase. A
   * primeira se resolve limpando o filtro; a segunda, fazendo uma vistoria.
   */
  protected readonly hasActiveFilters = computed(
    () =>
      this.vehicleId() !== '' ||
      this.rentalId().trim() !== '' ||
      this.kind() !== 'ALL' ||
      this.status() !== 'ALL' ||
      this.range() !== null,
  );

  protected readonly isEmpty = computed(
    () => !this.loading() && !this.error() && this.items().length === 0,
  );

  protected readonly totalPages = computed(() => {
    const total = this.total();
    const size = this.size();
    return total === 0 || size === 0 ? 1 : Math.ceil(total / size);
  });

  protected readonly pageNumber = computed(() => this.page() + 1);
  protected readonly hasPrev = computed(() => this.page() > 0);
  protected readonly hasNext = computed(() => this.page() + 1 < this.totalPages());

  /**
   * Região viva: trocar filtro troca a lista sem mover foco nem rota.
   *
   * FIX-0565 — o erro sai de `error()`, a MESMA fonte que o banner renderiza, e não de uma
   * cópia da frase. A cópia era o defeito: o serviço já separa recusa de falha, mas aqui
   * estava escrito "não foi possível carregar" fixo, então num 403 quem enxerga lia
   * "você não tem permissão" e quem usa leitor de tela ouvia uma falha de carregamento.
   * Duas frases para o mesmo evento é uma que está errada — e a errada mandava o usuário
   * recarregar uma tela que nunca ia abrir.
   *
   * Ler a fonte em vez de repeti-la é o que impede as duas de divergirem de novo quando
   * alguém acrescentar a próxima causa no serviço.
   */
  protected readonly liveStatus = computed(() => {
    if (this.loading()) return 'Carregando vistorias…';
    const loadError = this.error();
    if (loadError) return loadError;
    const count = this.total();
    if (count === 0) {
      return this.hasActiveFilters()
        ? 'Nenhuma vistoria encontrada com os filtros aplicados.'
        : 'Nenhuma vistoria registrada ainda.';
    }
    return count === 1 ? '1 vistoria encontrada.' : `${count} vistorias encontradas.`;
  });

  ngOnInit(): void {
    this.reload(0);
    this.vehicles
      .list({ size: 500, sort: 'plate_asc' })
      .pipe()
      .subscribe({
        next: (res) =>
          this.vehicleOptions.set(
            (res.content ?? []).map((v) => ({
              id: v.id,
              label: [v.plate, v.model].filter(Boolean).join(' · '),
            })),
          ),
        // O seletor de veículo é conveniência: sem ele a tela ainda filtra por
        // locação e por data. Falhar aqui não pode derrubar a lista.
        error: () => this.vehicleOptions.set([]),
      });
  }

  protected onVehicleChange(value: string): void {
    this.vehicleId.set(value);
    this.reload(0);
  }

  protected onRentalChange(value: string): void {
    this.rentalId.set(value);
    this.reload(0);
  }

  protected onKindChange(value: InspectionKind | 'ALL'): void {
    this.kind.set(value);
    this.reload(0);
  }

  protected onStatusChange(value: InspectionStatus | 'ALL'): void {
    this.status.set(value);
    this.reviewingId.set(null);
    this.reload(0);
  }

  protected statusLabel(value: InspectionStatus): string {
    return STATUS_LABELS[value] ?? value;
  }

  /** So faz sentido revisar o que foi ENVIADO e ainda nao foi decidido. */
  protected awaitingReview(item: InspectionListItem): boolean {
    return item.status === 'SUBMITTED';
  }

  protected toggleReview(id: string): void {
    this.reviewingId.update((current) => (current === id ? null : id));
  }

  /**
   * Decidida: a linha mudou de estado no servidor, entao a lista recarrega em
   * vez de a tela remendar o item em memoria — o status novo vem de quem manda.
   */
  protected onDecided(_result: InspectionReviewResult): void {
    this.reviewingId.set(null);
    this.reload(this.page());
  }

  protected onRangeChange(range: DateRange | null): void {
    this.range.set(range);
    this.reload(0);
  }

  /** Limpa TODOS os filtros de uma vez — a saída do estado vazio filtrado. */
  protected clearFilters(): void {
    this.vehicleId.set('');
    this.rentalId.set('');
    this.kind.set('ALL');
    this.range.set(null);
    this.reload(0);
  }

  protected prev(): void {
    if (this.hasPrev()) this.reload(this.page() - 1);
  }

  protected next(): void {
    if (this.hasNext()) this.reload(this.page() + 1);
  }

  protected kindLabel(kind: InspectionKind): string {
    return KIND_LABEL[kind] ?? kind;
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('pt-BR');
  }

  protected vehicleLabel(item: InspectionListItem): string {
    return [item.vehiclePlate, item.vehicleModel].filter(Boolean).join(' · ');
  }

  private reload(page: number): void {
    const range = this.range();
    const kind = this.kind();
    const status = this.status();
    this.service
      .list({
        page,
        vehicleId: this.vehicleId() || null,
        rentalId: this.rentalId().trim() || null,
        kind: kind === 'ALL' ? null : kind,
        status: status === 'ALL' ? null : status,
        from: range?.from ?? null,
        to: range?.to ?? null,
      })
      // O serviço já grava a falha no signal `error` (banner inline) —
      // reivindica o erro para a rede de segurança não disparar toast duplo.
      .subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
  }
}
