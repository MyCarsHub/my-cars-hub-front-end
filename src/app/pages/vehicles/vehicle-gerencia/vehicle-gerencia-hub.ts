import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { BackLink } from '../../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import {
  VehicleSummaryChip,
  VehicleSummary,
} from '../../../components/vehicles/vehicle-summary-chip/vehicle-summary-chip';
import { VehiclesService } from '../../../services/vehicles.service';
import { GerenciaFinanceChunk, GerenciaSummary } from '../../../types/gerencia-summary.types';
import { FinancingsList } from '../../financings/financings-list';
import { InsurancesList } from '../../insurances/insurances-list';
import { MaintenancesList } from '../../maintenances/maintenances-list';
import { RentalService } from '../../rentals/rental.service';
import { RentalListItemDto, rentalStatusInfo } from '../../../types/rental.types';
import { licensingBadge } from '../../../utils/status-maps';
import {
  RovingFocusTracker,
  resolveRovingKey,
} from '../../../components/roving-focus/roving-focus';

type TabKey = 'financeiro' | 'seguros' | 'manutencoes' | 'alugueis' | 'documentos';

interface TabDef {
  key: TabKey;
  label: string;
}

/**
 * Esta tablist é horizontal (`aria-orientation` default), então só as setas
 * laterais + Home/End/confirmação pertencem a ela. `resolveRovingKey` também
 * entende ArrowUp/ArrowDown por causa do SegmentedToggle (radiogroup vertical);
 * aqui elas precisam continuar rolando a página, e a decisão de orientação é do
 * call site — por isso o filtro fica neste componente, não no helper.
 */
const HORIZONTAL_TABLIST_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'Enter',
  ' ',
]);

@Component({
  selector: 'app-vehicle-gerencia-hub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BackLink,
    RouterLink,
    DefaultPageLayout,
    VehicleSummaryChip,
    FinancingsList,
    InsurancesList,
    MaintenancesList,
  ],
  templateUrl: './vehicle-gerencia-hub.html',
})
export class VehicleGerenciaHub implements OnInit {
  private readonly vehiclesService = inject(VehiclesService);
  private readonly rentalService = inject(RentalService);
  private readonly route = inject(ActivatedRoute);

  protected readonly vehicleId = signal<string>('');
  protected readonly summary = signal<GerenciaSummary | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly rentals = signal<RentalListItemDto[]>([]);
  protected readonly rentalsLoading = signal(false);
  protected readonly rentalsError = signal<string | null>(null);
  private rentalsFetched = false;

  protected readonly activeTab = signal<TabKey>('financeiro');

  protected readonly tabs: TabDef[] = [
    { key: 'financeiro', label: 'Financeiro' },
    { key: 'seguros', label: 'Seguros' },
    { key: 'manutencoes', label: 'Manutenções' },
    { key: 'alugueis', label: 'Aluguéis' },
    { key: 'documentos', label: 'Documentos' },
  ];

  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');
  private readonly tabFocus = new RovingFocusTracker();

  private readonly activeTabIndex = computed(() => {
    const index = this.tabs.findIndex((tab) => tab.key === this.activeTab());
    return index < 0 ? 0 : index;
  });

  /** Com foco dentro da tablist segue o item focado; fora, volta pro tab ativo. */
  protected readonly rovingTabIndex = computed(() => this.tabFocus.index() ?? this.activeTabIndex());

  /** Ids estáveis que amarram tab ↔ painel (`aria-controls` / `aria-labelledby`). */
  protected tabId(key: TabKey): string {
    return `gerencia-tab-${key}`;
  }

  protected panelId(key: TabKey): string {
    return `gerencia-panel-${key}`;
  }

  protected onTabsFocusIn(event: FocusEvent): void {
    this.tabFocus.onFocusIn(event, this.tabButtons());
  }

  protected onTabsFocusOut(event: FocusEvent): void {
    this.tabFocus.onFocusOut(event, this.tabButtons());
  }

  /**
   * Setas / Home / End movem só o foco; Enter / Espaço confirmam — variante
   * "selection does not follow focus" do APG, adequada aqui porque trocar de
   * aba dispara carga de dados (aluguéis).
   */
  protected onTabsKeydown(event: KeyboardEvent): void {
    if (!HORIZONTAL_TABLIST_KEYS.has(event.key)) return;

    const current = this.rovingTabIndex();
    const action = resolveRovingKey(event.key, current, this.tabs.length);
    if (action === null) return;

    event.preventDefault();

    if (action.kind === 'confirm') {
      this.selectTab(this.tabs[current].key);
      return;
    }

    this.tabFocus.set(action.index);
    this.tabButtons()[action.index]?.nativeElement.focus();
  }

  protected readonly chipVehicle = computed<VehicleSummary | null>(() => {
    const s = this.summary();
    if (!s) return null;
    return {
      id: s.vehicle.id,
      plate: s.vehicle.plate,
      brand: s.vehicle.brand,
      model: s.vehicle.model,
      hodometer: s.vehicle.hodometer,
      licensingExpiration: s.vehicle.licensingExpiration,
      type: s.vehicle.type,
      status: s.vehicle.status,
    };
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.vehicleId.set(id);
    this.load(id);
  }

  protected retry(): void {
    const id = this.vehicleId();
    if (id) this.load(id);
  }

  protected selectTab(key: TabKey): void {
    this.activeTab.set(key);
    if (key === 'alugueis' && !this.rentalsFetched) {
      this.loadRentals(this.vehicleId());
    }
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.vehiclesService.getGerenciaSummary(id).subscribe({
      next: (s) => {
        this.summary.set(s);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(this.extractError(err, 'Não foi possível carregar a gerência do veículo.'));
      },
    });
  }

  private loadRentals(vehicleId: string): void {
    if (!vehicleId) return;
    this.rentalsLoading.set(true);
    this.rentalsError.set(null);
    this.rentalService.list({ vehicleId, size: 50 }).subscribe({
      next: (res) => {
        this.rentals.set(res.content ?? []);
        this.rentalsFetched = true;
        this.rentalsLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.rentalsLoading.set(false);
        this.rentalsError.set(this.extractError(err, 'Não foi possível carregar os aluguéis.'));
      },
    });
  }

  protected retryRentals(): void {
    this.rentalsFetched = false;
    this.loadRentals(this.vehicleId());
  }

  // ---- Venda do veículo (FEAT-0074) --------------------------------------

  /** Valor bruto da venda, ou `null` quando o veículo não foi vendido. */
  protected readonly saleValueCents = computed(
    () => this.summary()?.finance?.saleValueCents ?? null,
  );

  protected readonly hasSale = computed(() => this.saleValueCents() !== null);

  /**
   * A CONTA do resultado, escrita por extenso.
   *
   * Sem isso o usuário via "Resultado: R$ 12.000" ao lado de investido e
   * receita e tinha de somar de cabeça para descobrir se a venda entrou. Com a
   * venda na jogada a conta tem três parcelas, e a legenda passa a dizer quais.
   */
  protected readonly resultFormula = computed(() =>
    this.hasSale()
      ? 'Receita + venda, menos investimento'
      : 'Receita menos investimento',
  );

  protected formatMoney(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100);
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('pt-BR');
  }

  protected daysUntil(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const then = new Date(iso + 'T00:00:00').getTime();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((then - today) / 86400000);
  }

  protected rentalStatusChip(status: RentalListItemDto['status']): { label: string; chip: string } {
    return rentalStatusInfo(status);
  }

  /** Sign-aware currency: negative results shown in red, positive in green. */
  protected resultClass(cents: number): string {
    if (cents > 0) return 'text-emerald-700';
    if (cents < 0) return 'text-rose-700';
    return 'text-neutral-900';
  }

  /**
   * Color for the "Recebido" amount vs contracted revenue:
   * - equal (fully paid) → emerald
   * - < revenue but > 0 (partial) → amber
   * - 0 with revenue > 0 → neutral gray (hint shown separately)
   * - both zero → neutral
   */
  protected receivedClass(finance: GerenciaFinanceChunk): string {
    const rev = finance.totalRentalRevenueCents;
    const recv = finance.totalRentalReceivedCents;
    if (rev === 0 && recv === 0) return 'text-neutral-900';
    if (recv === 0) return 'text-neutral-500';
    if (recv >= rev) return 'text-emerald-700';
    return 'text-amber-700';
  }

  protected licensingChipLabel(): { label: string; chip: string } | null {
    const s = this.summary();
    if (!s) return null;
    const iso = s.licensing.expiration;
    if (!iso) return null;
    return licensingBadge(iso);
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
