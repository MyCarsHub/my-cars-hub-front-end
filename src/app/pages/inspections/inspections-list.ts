import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
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
import { InspectionKind, InspectionListItem } from '../../types/inspection.types';

/** Chip de tipo. `'ALL'` é "todas" — não vai para a query. */
type KindChip = FilterChipOption<InspectionKind | 'ALL'>;

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
  ],
  templateUrl: './inspections-list.html',
})
export class InspectionsList implements OnInit {
  private readonly service = inject(InspectionsService);
  private readonly vehicles = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly kindChips = KIND_CHIPS;

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

  /** Região viva: trocar filtro troca a lista sem mover foco nem rota. */
  protected readonly liveStatus = computed(() => {
    if (this.loading()) return 'Carregando vistorias…';
    if (this.error()) return 'Não foi possível carregar as vistorias.';
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
    this.service
      .list({
        page,
        vehicleId: this.vehicleId() || null,
        rentalId: this.rentalId().trim() || null,
        kind: kind === 'ALL' ? null : kind,
        from: range?.from ?? null,
        to: range?.to ?? null,
      })
      // O serviço já grava a falha no signal `error` (banner inline) —
      // reivindica o erro para a rede de segurança não disparar toast duplo.
      .subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
  }
}
