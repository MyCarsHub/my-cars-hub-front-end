import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { EMPTY, expand } from 'rxjs';
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
import { VehicleListItem } from '../../types/vehicle.types';
import { ApiErrorService } from '../../services/api-error.service';
import { SessionService } from '../../services/session.service';
import { RentalService } from '../rentals/rental.service';
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
 * Tamanho de cada pagina ao carregar os veiculos do filtro. 100 e o teto do
 * backend: pedir mais NAO devolve mais, devolve 100 em silencio — foi o que
 * deixou carro fora do seletor sem aviso nenhum. Por isso a tela PAGINA ate o
 * total em vez de pedir uma pagina enorme.
 */
const VEHICLE_PAGE_SIZE = 100;
/** Trava de seguranca do laco de paginas (20 x 100 = 2000 veiculos). */
const VEHICLE_MAX_PAGES = 20;

/** Um carro de um aluguel ATIVO do motorista — a porta dele para "Fazer vistoria". */
interface DriverVehicle {
  readonly vehicleId: string;
  readonly label: string;
}

/**
 * `/vistorias` — as vistorias, filtráveis.
 *
 * Existe porque a vistoria só era alcançável DENTRO do aluguel: para achar a
 * vistoria de um carro específico era preciso lembrar em qual locação ela
 * estava. Aqui ela é pesquisável por veículo, por locação e por período, e os
 * três filtros se combinam.
 *
 * ## Dois papeis, duas telas
 *
 * OWNER/MANAGER veem as da empresa, com filtro de veiculo/locacao, agendamento
 * e aprovacao. O MOTORISTA ve as DELAS (o servidor escopa a listagem), sem nada
 * que seja da empresa — filtros de frota, agendamento, aprovacao — e com uma
 * porta propria: "Fazer vistoria" para o carro do aluguel ATIVO dele. O papel
 * vem do token, a mesma fonte do `roleGuard`.
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
  private readonly session = inject(SessionService);
  private readonly rentals = inject(RentalService);

  /**
   * O MOTORISTA. Lido do TOKEN uma vez: o papel nao muda sem trocar de empresa, e
   * trocar de empresa remonta a tela. Decide o que NAO e carregado — `/v1/vehicles`
   * e 403 para ele — alem do que e escondido.
   */
  protected readonly isDriver = this.session.getCompanyRoleFromToken() === 'DRIVER';

  protected readonly pageDescription = this.isDriver
    ? 'Suas vistorias e o carro do seu aluguel ativo.'
    : 'Todas as vistorias da frota, por veiculo e periodo.';

  protected readonly kindChips = KIND_CHIPS;
  protected readonly statusChips = STATUS_CHIPS;

  protected readonly items = this.service.items;
  protected readonly loading = this.service.loading;
  protected readonly error = this.service.error;
  protected readonly page = this.service.page;
  protected readonly size = this.service.size;
  protected readonly total = this.service.total;

  /** Opções do seletor de veículo, carregadas por paginas ate o total. */
  protected readonly vehicleOptions = signal<Array<{ id: string; label: string }>>([]);

  /** Os carros dos alugueis ATIVOS do motorista, e em que ponto a busca esta. */
  protected readonly driverVehicles = signal<DriverVehicle[]>([]);
  protected readonly driverVehiclesState = signal<'loading' | 'ready' | 'error'>('loading');

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
    this.openCapture(this.startVehicleId());
  }

  /** O MOTORISTA nao escolhe carro: o botao dele ja nomeia o do aluguel ativo. */
  protected startDriverInspection(vehicleId: string): void {
    this.openCapture(vehicleId);
  }

  private openCapture(vehicleId: string): void {
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
    if (this.isDriver) {
      // `/v1/vehicles` e 403 para o motorista: nada de carregar a frota. O carro dele
      // vem dos alugueis dele, que ja trazem placa e modelo.
      this.loadDriverVehicles();
    } else {
      this.loadVehicleOptions();
    }
  }

  /**
   * Carrega TODOS os veiculos do seletor, uma pagina por vez.
   *
   * Cada pagina entra no seletor assim que chega; uma falha no meio mantem o que ja
   * veio. O seletor e conveniencia: sem ele a tela ainda filtra por locacao e data.
   */
  private loadVehicleOptions(): void {
    const toOptions = (items: VehicleListItem[]) =>
      items.map((v) => ({
        id: v.id,
        label: [v.plate, v.model].filter(Boolean).join(' · '),
      }));
    const fetchPage = (page: number) =>
      this.vehicles.list({ page, size: VEHICLE_PAGE_SIZE, sort: 'plate_asc' });

    fetchPage(0)
      .pipe(
        expand((res) => {
          const size = res.size || VEHICLE_PAGE_SIZE;
          const next = (res.page ?? 0) + 1;
          const hasMore = (res.content ?? []).length > 0 && next * size < (res.total ?? 0);
          return hasMore && next < VEHICLE_MAX_PAGES ? fetchPage(next) : EMPTY;
        }),
      )
      .subscribe({
        next: (res) =>
          this.vehicleOptions.update((current) => [...current, ...toOptions(res.content ?? [])]),
        error: () => undefined,
      });
  }

  /** Os carros dos alugueis ATIVOS do motorista — de onde ele pode fazer vistoria. */
  protected loadDriverVehicles(): void {
    this.driverVehiclesState.set('loading');
    this.rentals.list({ status: 'ACTIVE', page: 0, size: 20 }).subscribe({
      next: (res) => {
        const seen = new Set<string>();
        const found: DriverVehicle[] = [];
        for (const rental of res.content ?? []) {
          if (seen.has(rental.vehicleId)) continue;
          seen.add(rental.vehicleId);
          const car = [rental.vehicleBrand, rental.vehicleModel].filter(Boolean).join(' ');
          found.push({
            vehicleId: rental.vehicleId,
            label: [rental.vehiclePlate, car].filter(Boolean).join(' · ') || 'Veículo do aluguel',
          });
        }
        this.driverVehicles.set(found);
        this.driverVehiclesState.set('ready');
      },
      error: (err: unknown) => {
        this.apiErrors.claim(err);
        this.driverVehicles.set([]);
        this.driverVehiclesState.set('error');
      },
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

  /**
   * So faz sentido revisar o que foi ENVIADO e ainda nao foi decidido — e so para quem
   * decide. O motorista nao aprova nem recusa: o servidor nega, e a tela nem oferece.
   */
  protected awaitingReview(item: InspectionListItem): boolean {
    return !this.isDriver && item.status === 'SUBMITTED';
  }

  /**
   * O que a linha oferece para ABRIR a vistoria na tela de captura — a unica porta para
   * continuar uma em andamento e para ver o motivo de uma recusa.
   */
  protected openLabel(item: InspectionListItem): string {
    switch (item.status) {
      case 'PENDING':
        return 'Continuar vistoria';
      case 'REJECTED':
        return 'Ver recusa e refazer';
      default:
        return 'Ver fotos';
    }
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
    // A situacao tambem e filtro: o contador e o vazio filtrado a contam. Limpar tudo
    // menos ela deixava "Limpar filtros" recarregando com o mesmo filtro escondido.
    this.status.set('ALL');
    this.range.set(null);
    this.reviewingId.set(null);
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

  /**
   * Placa · marca modelo. Cada parte e opcional (uma resposta antiga nao as manda), e a
   * linha nunca fica em branco: sem nenhuma, diz que o carro nao foi identificado em vez
   * de desenhar um titulo vazio.
   */
  protected vehicleLabel(item: InspectionListItem): string {
    const car = [item.vehicleBrand, item.vehicleModel].filter(Boolean).join(' ');
    return [item.vehiclePlate, car].filter(Boolean).join(' · ') || 'Veículo não identificado';
  }

  /** "14 foto(s)", ou `null` quando o servidor nao mandou a contagem — nunca "undefined". */
  protected photoCountLabel(item: InspectionListItem): string | null {
    return typeof item.photoCount === 'number' ? `${item.photoCount} foto(s)` : null;
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
