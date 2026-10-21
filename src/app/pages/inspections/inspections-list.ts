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
import { Router, RouterLink } from '@angular/router';
import { EMPTY, Subject, debounceTime, expand } from 'rxjs';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { KpiCard } from '../../components/kpi-card/kpi-card';
import { InspectionsService } from '../../services/inspections.service';
import { VehiclesService } from '../../services/vehicles.service';
import { VehicleListItem } from '../../types/vehicle.types';
import { ApiErrorService } from '../../services/api-error.service';
import { SessionService } from '../../services/session.service';
import { RentalService } from '../rentals/rental.service';
import {
  INSPECTION_SEARCH_MAX_LENGTH,
  InspectionKind,
  InspectionSort,
  InspectionStatus,
  InspectionSummary,
} from '../../types/inspection.types';
import { INSPECTION_STATUS_META } from '../../utils/status-maps';
import { InspectionSchedulesBlock } from './inspection-schedules-block/inspection-schedules-block';
import { InspectionCardView, INSPECTION_ANGLE_TOTAL, pluralize, toCardView } from './inspection-view';
import { INSPECTIONS_ROOT } from './driver/driver-inspection-guide';
import {
  DriverInspectionHero,
  DriverInspectionItem,
  DriverInspectionsHome,
} from './driver/driver-inspections-home';

/** O que cada filtro oferece. `ALL` nao vai para a query. */
const STATUS_OPTIONS: ReadonlyArray<{ value: InspectionStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Situação: Todas' },
  { value: 'SUBMITTED', label: 'Situação: Aguardando aprovação' },
  { value: 'PENDING', label: 'Situação: Em andamento' },
  { value: 'APPROVED', label: 'Situação: Aprovada' },
  { value: 'REJECTED', label: 'Situação: Recusada' },
];

const KIND_OPTIONS: ReadonlyArray<{ value: InspectionKind | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Tipo: Todos' },
  { value: 'CHECKOUT', label: 'Tipo: Retirada' },
  { value: 'CHECKIN', label: 'Tipo: Devolução' },
  // Vistoria de FROTA (sem aluguel): nasce na porta "Fazer vistoria" do dono e nao tem par
  // em retirada/devolucao. Sem esta opcao ela nao teria como ser filtrada.
  { value: 'FLEET', label: 'Tipo: Frota' },
];

const SORT_OPTIONS: ReadonlyArray<{ value: InspectionSort; label: string }> = [
  { value: 'date,desc', label: 'Ordenar: Mais recentes' },
  { value: 'date,asc', label: 'Ordenar: Mais antigas' },
];

/** Espera depois da ultima tecla antes de buscar — uma consulta por palavra, nao por letra. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Tamanho de cada pagina ao carregar os veiculos do dialogo de agendamento. 100 e o teto do
 * backend: pedir mais NAO devolve mais, devolve 100 em silencio. Por isso a tela PAGINA ate
 * o total em vez de pedir uma pagina enorme.
 */
const VEHICLE_PAGE_SIZE = 100;
/** Trava de seguranca do laco de paginas (20 x 100 = 2000 veiculos). */
const VEHICLE_MAX_PAGES = 20;

/** Um carro de um aluguel ATIVO do motorista — a porta dele para "Fazer vistoria". */
interface DriverVehicle {
  readonly vehicleId: string;
  readonly label: string;
  readonly plate: string | null;
}

/** Os quatro tiles, na ordem do desenho. */
interface KpiTile {
  readonly key: keyof InspectionSummary;
  readonly variant: 'primary' | 'emerald-dark' | 'emerald' | 'white';
  readonly label: string;
  readonly detail: string;
}

const KPI_TILES: readonly KpiTile[] = [
  { key: 'submitted', variant: 'primary', label: 'Aguardando aprovação', detail: 'precisam da sua decisão' },
  { key: 'pending', variant: 'emerald-dark', label: 'Em andamento', detail: 'fotos sendo tiradas' },
  { key: 'approved', variant: 'emerald', label: 'Aprovadas', detail: 'laudo em PDF disponível' },
  { key: 'rejected', variant: 'white', label: 'Recusadas', detail: 'aguardam nova vistoria' },
];

/**
 * `/vistorias` — as vistorias da empresa em cards, com os numeros no topo.
 *
 * ## Dois papeis, duas telas
 *
 * OWNER/MANAGER veem as da empresa: tiles (`GET /inspections/summary`), o cartao de
 * vistorias automaticas, filtros e "Revisar vistoria". O MOTORISTA ve as DELAS (o servidor
 * escopa a listagem), com o MESMO cartao de vistoria, mas sem tiles, sem agendamento e sem
 * nenhum controle de revisao — e com uma porta propria: "Fazer vistoria" para o carro do
 * aluguel ATIVO dele. O papel vem do token, a mesma fonte do `roleGuard`.
 *
 * A DECISAO (aprovar/recusar) saiu daqui: vive em `/vistorias/:id`, onde as 14 fotos cabem.
 */
@Component({
  selector: 'app-inspections-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    KpiCard,
    InspectionSchedulesBlock,
    DriverInspectionsHome,
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
  private readonly destroyRef = inject(DestroyRef);
  /** Where the inspection screens live (`/vistorias`; the local demo mounts them elsewhere). */
  private readonly root = inject(INSPECTIONS_ROOT);

  /**
   * O MOTORISTA. Lido do TOKEN uma vez: o papel nao muda sem trocar de empresa, e trocar
   * de empresa remonta a tela. Decide o que NAO e carregado — `/v1/vehicles` e 403 para ele
   * e o resumo e da empresa — alem do que e escondido.
   */
  protected readonly isDriver = this.session.getCompanyRoleFromToken() === 'DRIVER';

  protected readonly pageDescription = this.isDriver
    ? 'Suas vistorias e o carro do seu aluguel ativo.'
    : 'Fotos e hodômetro enviados pelos motoristas. Você aprova ou pede para refazer.';

  protected readonly searchPlaceholder = this.isDriver
    ? 'Buscar por placa ou modelo…'
    : 'Buscar por placa, modelo ou motorista…';
  protected readonly searchMaxLength = INSPECTION_SEARCH_MAX_LENGTH;

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly kindOptions = KIND_OPTIONS;
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly kpiTiles = KPI_TILES;

  protected readonly loading = this.service.loading;
  protected readonly error = this.service.error;
  protected readonly page = this.service.page;
  protected readonly size = this.service.size;
  protected readonly total = this.service.total;

  /** As linhas ja traduzidas para o cartao — a unica leitura do contrato da lista. */
  protected readonly cards = computed<InspectionCardView[]>(() =>
    this.service.items().map((item) => toCardView(item)),
  );

  // ---------------------------------------------------------------- filtros

  protected readonly query = signal('');
  protected readonly status = signal<InspectionStatus | 'ALL'>('ALL');
  protected readonly kind = signal<InspectionKind | 'ALL'>('ALL');
  protected readonly sort = signal<InspectionSort>('date,desc');

  /** A busca como foi enviada por ultimo: evita a consulta dupla de Enter + debounce. */
  private appliedQuery = '';
  private readonly searchTyped = new Subject<void>();

  /**
   * Ha filtro ativo? E o que separa "nenhuma vistoria com esses filtros" de "nenhuma
   * vistoria ainda" — duas situacoes que nao podem mostrar a mesma frase. A ordenacao NAO
   * e filtro: nao esconde nada.
   */
  protected readonly hasActiveFilters = computed(
    () => this.normalizedQuery() !== '' || this.status() !== 'ALL' || this.kind() !== 'ALL',
  );

  // ----------------------------------------------------------------- tiles

  protected readonly summary = signal<InspectionSummary | null>(null);
  protected readonly summaryState = signal<'loading' | 'ready' | 'error'>('loading');

  /** O texto de um tile. Falha mostra "—": zero inventado afirmaria "nada a decidir". */
  protected kpiValue(key: keyof InspectionSummary): string | number {
    const summary = this.summary();
    if (this.summaryState() !== 'ready' || summary === null) return '—';
    return summary[key];
  }

  // -------------------------------------------------- vistoria avulsa / motorista

  /** Opcoes do seletor de veiculo — alimentam o dialogo de agendamento e a porta do dono. */
  protected readonly vehicleOptions = signal<Array<{ id: string; label: string }>>([]);

  /** Os carros dos alugueis ATIVOS do motorista, e em que ponto a busca esta. */
  protected readonly driverVehicles = signal<DriverVehicle[]>([]);
  protected readonly driverVehiclesState = signal<'loading' | 'ready' | 'error'>('loading');

  /** A PORTA do dono ate a captura: ela exige `?vehicleId=`, entao o carro vem daqui. */
  protected readonly startOpen = signal(false);
  protected readonly startVehicleId = signal('');
  protected readonly startError = signal<string | null>(null);

  // -------------------------------------------------------------- derivados

  protected readonly isEmpty = computed(
    () => !this.loading() && !this.error() && this.cards().length === 0,
  );

  protected readonly totalPages = computed(() => {
    const total = this.total();
    const size = this.size();
    return total === 0 || size === 0 ? 1 : Math.ceil(total / size);
  });

  protected readonly pageNumber = computed(() => this.page() + 1);
  protected readonly hasPrev = computed(() => this.page() > 0);
  protected readonly hasNext = computed(() => this.page() + 1 < this.totalPages());

  /** "12 vistorias" — plural resolvido. Vazio enquanto carrega ou em erro. */
  protected readonly countLabel = computed(() =>
    this.loading() || this.error() ? '' : pluralize(this.total(), 'vistoria', 'vistorias'),
  );

  /**
   * Regiao viva: trocar filtro troca a lista sem mover foco nem rota. O erro sai de
   * `error()`, a MESMA fonte que o banner renderiza — duas frases para o mesmo evento e uma
   * que esta errada.
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

  constructor() {
    this.searchTyped
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applySearch());
  }

  ngOnInit(): void {
    this.reload(0);
    if (this.isDriver) {
      // `/v1/vehicles` e 403 para o motorista: nada de carregar a frota. O carro dele
      // vem dos alugueis dele, que ja trazem placa e modelo.
      this.loadDriverVehicles();
    } else {
      this.loadVehicleOptions();
      this.loadSummary();
    }
  }

  // ------------------------------------------------------------------ dados

  /** Carrega os numeros do topo. Falha vira "—" nos tiles, nunca um zero. */
  protected loadSummary(): void {
    this.summaryState.set('loading');
    this.service.summary().subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.summaryState.set('ready');
      },
      error: (err: unknown) => {
        this.apiErrors.claim(err);
        this.summary.set(null);
        this.summaryState.set('error');
      },
    });
  }

  /**
   * Carrega TODOS os veiculos do seletor, uma pagina por vez.
   *
   * Cada pagina entra no seletor assim que chega; uma falha no meio mantem o que ja veio.
   * O seletor e conveniencia: sem ele o dialogo de agendamento ainda agenda a frota inteira.
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
            plate: rental.vehiclePlate?.trim() || null,
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

  /** Recarrega lista e tiles — o "Tentar novamente" do erro de carregamento. */
  protected retry(): void {
    this.reload(this.page());
    if (!this.isDriver) this.loadSummary();
  }

  private reload(page: number): void {
    this.appliedQuery = this.normalizedQuery();
    const kind = this.kind();
    const status = this.status();
    this.service
      .list({
        page,
        kind: kind === 'ALL' ? null : kind,
        status: status === 'ALL' ? null : status,
        q: this.appliedQuery || null,
        sort: this.sort(),
      })
      // O servico ja grava a falha no signal `error` (banner inline) — reivindica o erro
      // para a rede de seguranca nao disparar toast duplo.
      .subscribe({
        next: () => {
          // The hero reads ONLY the first page (the most recent ones): page 2 holds old,
          // already redone inspections and must not drive "what to do now".
          if (this.isDriver && page === 0) {
            this.heroCards.set(this.cards());
            this.loadRejectionReason();
          }
        },
        error: (err: unknown) => {
          // Unknown is not "nothing open": without page 0 the hero offers nothing.
          if (page === 0) this.heroCards.set(null);
          this.apiErrors.claim(err);
        },
      });
  }

  // ---------------------------------------------------------------- eventos

  /** A busca como vai para o servidor: aparada e no limite que ele aceita. */
  private normalizedQuery(): string {
    return this.query().trim().slice(0, INSPECTION_SEARCH_MAX_LENGTH);
  }

  protected onSearchInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.searchTyped.next();
  }

  /** Enter (ou o "x" do campo de busca): busca ja, sem esperar o debounce. */
  protected submitSearch(): void {
    this.applySearch();
  }

  private applySearch(): void {
    if (this.normalizedQuery() === this.appliedQuery) return;
    this.reload(0);
  }

  protected onStatusChange(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value as InspectionStatus | 'ALL');
    this.reload(0);
  }

  protected onKindChange(event: Event): void {
    this.kind.set((event.target as HTMLSelectElement).value as InspectionKind | 'ALL');
    this.reload(0);
  }

  protected onSortChange(event: Event): void {
    this.sort.set((event.target as HTMLSelectElement).value as InspectionSort);
    this.reload(0);
  }

  /** Zera TUDO — busca, situacao, tipo e ordenacao — e volta a primeira pagina. */
  protected clearFilters(): void {
    this.query.set('');
    this.status.set('ALL');
    this.kind.set('ALL');
    this.sort.set('date,desc');
    this.reload(0);
  }

  protected prev(): void {
    if (this.hasPrev()) this.reload(this.page() - 1);
  }

  protected next(): void {
    if (this.hasNext()) this.reload(this.page() + 1);
  }

  // ---------------------------------------------------------- cartao / porta

  /**
   * O que o botao do cartao diz e para onde leva.
   *
   * O dono ve "Revisar vistoria" so no que espera decisao; o resto e "Ver detalhes". O
   * MOTORISTA nao decide: para ele o que importa e CONTINUAR a que esta em andamento e LER o
   * motivo de uma recusa para refazer — as duas moram na tela de captura, nao no detalhe.
   */
  protected action(card: InspectionCardView): { label: string; link: string[] } {
    const detail = [this.root, card.id];
    if (this.isDriver) {
      if (card.status === 'PENDING') {
        return { label: 'Continuar vistoria', link: [...detail, 'captura'] };
      }
      if (card.status === 'REJECTED') {
        return { label: 'Ver recusa e refazer', link: [...detail, 'captura'] };
      }
      return { label: 'Ver detalhes', link: detail };
    }
    return {
      label: card.status === 'SUBMITTED' ? 'Revisar vistoria' : 'Ver detalhes',
      link: detail,
    };
  }

  protected chipClass(status: InspectionStatus): string {
    return INSPECTION_STATUS_META[status]?.chip ?? 'bg-neutral-100 text-neutral-700';
  }

  protected statusLabel(status: InspectionStatus): string {
    return INSPECTION_STATUS_META[status]?.label ?? status;
  }

  /** A foto da frente que NAO carregou (URL assinada vencida): cai no placeholder. */
  protected readonly brokenPhotos = signal<ReadonlySet<string>>(new Set());

  protected photoFor(card: InspectionCardView): string | null {
    return this.brokenPhotos().has(card.id) ? null : card.frontPhotoUrl;
  }

  protected onPhotoError(id: string): void {
    this.brokenPhotos.update((current) => new Set(current).add(id));
  }

  protected toggleStart(): void {
    this.startError.set(null);
    this.startOpen.update((open) => !open);
  }

  protected onStartVehicleChange(event: Event): void {
    this.startVehicleId.set((event.target as HTMLSelectElement).value);
    this.startError.set(null);
  }

  /**
   * Abre a captura COM o carro escolhido. A captura exige `?vehicleId=`: sem ele ela so
   * sabe dizer que falta um carro — porta que existe e nao abre.
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
      this.startError.set('Escolha o carro que você vai vistoriar.');
      return;
    }

    // A promessa NAO e descartada: guard que recusa deixaria a pessoa olhando uma tela que
    // nao mudou, sem nada a fazer.
    this.router
      .navigate([this.root, 'nova'], { queryParams: { vehicleId } })
      .then((ok) => {
        if (!ok) this.startError.set('Não foi possível abrir a tela de vistoria.');
      })
      .catch(() => this.startError.set('Não foi possível abrir a tela de vistoria.'));
  }

  // ------------------------------------------------------- motorista (prototipo)

  /**
   * The refusal reason of the driver's LATEST inspection, for the hero. The list does not
   * carry it, so it comes from the detail — only when the latest one is refused.
   */
  protected readonly latestRejection = signal<{ id: string; reason: string | null } | null>(null);

  /**
   * The cards of PAGE 0 — the driver's most recent inspections, newest first — as of the
   * last successful load of that page. `null` = not known (never loaded, or that load failed).
   */
  protected readonly heroCards = signal<InspectionCardView[] | null>(null);

  private loadRejectionReason(): void {
    const latest = this.heroCards()?.[0];
    if (!latest || latest.status !== 'REJECTED') {
      this.latestRejection.set(null);
      return;
    }
    if (this.latestRejection()?.id === latest.id) return;
    this.latestRejection.set({ id: latest.id, reason: null });
    this.service.getOne(latest.id).subscribe({
      next: (found) =>
        this.latestRejection.set({ id: latest.id, reason: found.rejectionReason?.trim() || null }),
      // Without the reason the hero still says what to do; the capture screen shows it.
      error: (err: unknown) => this.apiErrors.claim(err),
    });
  }

  protected readonly driverState = computed<'loading' | 'error' | 'ready'>(() =>
    this.loading() ? 'loading' : this.error() ? 'error' : 'ready',
  );

  /** The cards of "Minhas vistorias", in the prototype's shape. */
  protected readonly driverItems = computed<DriverInspectionItem[]>(() =>
    this.cards().map((card) => {
      const act = this.driverAction(card);
      const meta = [card.kind, card.date].filter(Boolean).join(' · ');
      const photos =
        card.status === 'PENDING' && card.photos
          ? ` · ${card.photos.got}/${card.photos.total} fotos`
          : '';
      return {
        id: card.id,
        plate: card.plate,
        model: card.model,
        statusLabel: this.statusLabel(card.status),
        chipClass: this.chipClass(card.status),
        meta: meta + photos,
        note:
          card.status === 'REJECTED'
            ? 'Precisa refazer'
            : card.status === 'APPROVED'
              ? 'Laudo em PDF disponível'
              : null,
        noteTone:
          card.status === 'REJECTED' ? 'rose' : card.status === 'APPROVED' ? 'emerald' : null,
        photoUrl: this.photoFor(card),
        actionLabel: act.label,
        actionLink: act.link,
      };
    }),
  );

  /** The driver opens the details; the one in progress goes straight back to the camera. */
  private driverAction(card: InspectionCardView): { label: string; link: string[] } {
    return card.status === 'PENDING'
      ? { label: 'Continuar vistoria', link: [this.root, card.id, 'captura'] }
      : { label: 'Ver detalhes', link: [this.root, card.id] };
  }

  /**
   * The ONE thing to do now, in this order: continue the one in progress, redo the refused
   * one, wait for the company, start one for the active rental's car, or nothing.
   * `null` = still loading what the answer depends on.
   */
  protected readonly driverHero = computed<DriverInspectionHero | null>(() => {
    // Unknown while the first page is loading or failed: the list's error banner (with
    // "Tentar novamente") is the state. Never "Começar" over an inspection we could not see.
    const cards = this.heroCards();
    if (cards === null) return null;
    const total = INSPECTION_ANGLE_TOTAL;

    const pending = cards.find((c) => c.status === 'PENDING');
    if (pending) {
      const got = pending.photos?.got;
      return {
        tone: 'primary',
        label: 'Vistoria em andamento',
        title: `Vistoria do ${pending.plate}`,
        sub:
          typeof got === 'number'
            ? `${got} de ${total} fotos tiradas. Continue de onde parou.`
            : 'Continue de onde parou.',
        actions: [{ label: 'Continuar vistoria', link: [this.root, pending.id, 'captura'] }],
      };
    }

    const latest = cards[0];
    if (latest?.status === 'REJECTED') {
      const rejection = this.latestRejection();
      const reason = rejection?.id === latest.id ? rejection.reason : null;
      return {
        tone: 'rose',
        label: 'Vistoria recusada',
        title: `Refaça a vistoria do ${latest.plate}`,
        sub: reason
          ? `Motivo: ${reason}`
          : 'A locadora pediu para refazer as fotos. Comece de novo pelo botão abaixo.',
        actions: [
          // Opens the refused inspection in the guided capture; the redo itself is one more,
          // deliberate tap there ("Refazer vistoria"), never a side effect of the link.
          { label: 'Refazer vistoria', link: [this.root, latest.id, 'captura'] },
        ],
      };
    }
    if (latest?.status === 'SUBMITTED') {
      return {
        tone: 'emerald',
        label: 'Vistoria enviada',
        title: 'Aguardando a locadora',
        sub: 'Você recebe um aviso assim que ela aprovar ou pedir ajustes.',
        actions: [],
      };
    }

    if (this.driverVehiclesState() !== 'ready') return null;
    const cars = this.driverVehicles();
    if (cars.length === 0) {
      return {
        tone: 'neutral',
        label: 'Sem aluguel ativo',
        title: 'Nenhuma vistoria para fazer agora',
        sub:
          'A vistoria é feita no carro de um aluguel ativo. Quando a locadora liberar o carro, ' +
          'ela aparece aqui.',
        actions: [],
      };
    }
    const single = cars.length === 1;
    return {
      tone: 'primary',
      label: 'Vistoria do seu aluguel',
      title: single && cars[0].plate ? `Vistoria do ${cars[0].plate}` : 'Vistoria do seu carro',
      sub: `São ${total} fotos e o número do hodômetro. Leva uns 5 minutos.`,
      actions: cars.map((car) => ({
        label: single ? 'Começar vistoria' : `Começar vistoria · ${car.plate ?? car.label}`,
        vehicleId: car.vehicleId,
      })),
    };
  });

  /** The hero's own failure: only when the answer depended on the active rental. */
  protected readonly driverHeroError = computed(() =>
    this.driverHero() === null &&
    this.heroCards() !== null &&
    this.driverVehiclesState() === 'error'
      ? 'Não conseguimos achar o seu aluguel ativo agora.'
      : null,
  );

  protected readonly driverPageLabel = computed(
    () => `${this.countLabel()} — página ${this.pageNumber()} de ${this.totalPages()}`,
  );
}
