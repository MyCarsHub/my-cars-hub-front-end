import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../components/core/bottom-sheet/bottom-sheet';
import { PillTabOption, PillTabs } from '../../components/core/pill-tabs/pill-tabs';
import { StatusChip } from '../../components/core/status-chip/status-chip';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { KpiCard } from '../../components/kpi-card/kpi-card';
import { KpiGlyph } from '../../components/kpi-card/kpi-glyph';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { VehiclePicker } from '../../components/vehicles/vehicle-picker/vehicle-picker';
import { todayIso } from '../../components/vehicles/insurance-form-fields/insurance-utils';
import { ApiErrorService } from '../../services/api-error.service';
import { FleetFinanceService } from '../../services/fleet-finance.service';
import { NotificationService } from '../../services/notification.service';
import { VehicleIpvaService } from '../../services/vehicle-ipva.service';
import { IpvaFleetSummary, VehiclePickerFilter } from '../../types/fleet-finance.types';
import { VehicleListItem } from '../../types/vehicle.types';
import { applyPtBrMoneyMaskToControl } from '../../utils/ptbr-money-mask';
import { mediaQuerySignal } from '../../utils/viewport';
import {
  ptBrMoneyCents,
  ptBrMoneyValidator,
} from '../../utils/validators/ptbr-money.validator';
import {
  MAX_IPVA_INSTALLMENTS,
  ipvaSplitPreview,
} from '../vehicles/components/vehicle-ipva/ipva-split';
import {
  IPVA_STATUS_FILTERS,
  IpvaFleetViewRow,
  IpvaStatusFilter,
  brlCents,
  ipvaYearOptions,
  plateLabel,
  ptDayMonth,
  toViewRow,
} from './ipva-fleet-list';

export const IPVA_PAGE_SIZE = 20;
/** Espera depois da última tecla da busca. */
export const IPVA_SEARCH_DEBOUNCE_MS = 300;

type SheetStep = 'pick' | 'generate';

const MONEY_MESSAGES: Readonly<Record<string, string>> = {
  required: 'Informe o valor.',
  moneyFormat: 'Informe um valor válido (ex.: 1.200,00).',
  min: 'O valor precisa ser maior que zero.',
};

/**
 * IPVA da frota inteira, por exercício (STORY-VEHICLE-FINANCE). Os números do topo vêm prontos
 * de `/ipva/summary` — a tela não soma a lista, que é paginada. Tocar numa linha abre a seção de
 * IPVA da Gerência daquele carro, no mesmo ano. "Adicionar IPVA" escolhe um carro sem IPVA no
 * ano e gera as parcelas com o mesmo formulário da Gerência.
 */
@Component({
  selector: 'app-ipva-fleet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    AlertBanner,
    BottomSheet,
    DefaultPageLayout,
    FieldControl,
    FormField,
    KpiCard,
    KpiGlyph,
    PillTabs,
    StatusChip,
    VehiclePicker,
  ],
  templateUrl: './ipva-fleet.html',
})
export class IpvaFleet implements OnInit {
  private readonly service = inject(FleetFinanceService);
  private readonly ipvaService = inject(VehicleIpvaService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  /** `md`: daí para cima é tabela, abaixo é cartão. */
  protected readonly wide = mediaQuerySignal('(min-width: 48rem)');

  protected readonly today = todayIso();
  protected readonly currentYear = Number(this.today.slice(0, 4));
  protected readonly maxInstallments = MAX_IPVA_INSTALLMENTS;
  protected readonly moneyMessages = MONEY_MESSAGES;
  protected readonly countMessages: Readonly<Record<string, string>> = {
    required: 'Informe o número de parcelas.',
    min: `De 1 a ${MAX_IPVA_INSTALLMENTS} parcelas.`,
    max: `De 1 a ${MAX_IPVA_INSTALLMENTS} parcelas.`,
  };
  protected readonly dateMessages: Readonly<Record<string, string>> = {
    required: 'Informe a data.',
  };

  protected readonly year = signal(this.currentYear);
  protected readonly status = signal<IpvaStatusFilter>('ALL');
  protected readonly searchControl = new FormControl('', { nonNullable: true });
  private readonly term = signal('');

  protected readonly summary = signal<IpvaFleetSummary | null>(null);
  protected readonly summaryLoading = signal(true);
  protected readonly summaryError = signal<string | null>(null);

  protected readonly rows = signal<IpvaFleetViewRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly page = signal(0);
  protected readonly total = signal(0);
  /** Troca a cada ano/aba: a lista é refeita e a cascata de entrada recomeça. */
  private readonly epoch = signal(0);
  protected readonly epochs = computed(() => [{ id: this.epoch() }]);

  private listSub: Subscription | null = null;
  private summarySub: Subscription | null = null;

  // ---- folha "Adicionar IPVA" ---------------------------------------------
  protected readonly sheetOpen = signal(false);
  protected readonly step = signal<SheetStep>('pick');
  protected readonly chosen = signal<VehicleListItem | null>(null);
  protected readonly saving = signal(false);
  protected readonly sheetError = signal<string | null>(null);
  protected readonly generatePreview = signal<string | null>(null);
  private readonly sheetRef = viewChild(BottomSheet);

  protected readonly generateForm = this.fb.nonNullable.group({
    totalReais: ['', [ptBrMoneyValidator({ minCents: 1 })]],
    installments: [
      3,
      [Validators.required, Validators.min(1), Validators.max(MAX_IPVA_INSTALLMENTS)],
    ],
    firstDueDate: ['', [Validators.required]],
  });

  protected readonly pickerFilter = computed<VehiclePickerFilter>(() => ({
    kind: 'withoutIpvaYear',
    year: this.year(),
  }));

  protected readonly yearTabs = computed<readonly PillTabOption<string>[]>(() =>
    ipvaYearOptions(this.currentYear).map((y) => ({
      value: String(y),
      label: String(y),
      testId: `year-${y}`,
    })),
  );

  /** Só "Todos" leva número: é o único que o resumo conta sem ambiguidade. */
  protected readonly statusTabs = computed<readonly PillTabOption<IpvaStatusFilter>[]>(() => {
    const all = this.summary()?.vehiclesWithIpva;
    return IPVA_STATUS_FILTERS.map((f) => ({
      value: f.value,
      label: f.label,
      shortLabel: f.short,
      count: f.value === 'ALL' && all != null ? all : undefined,
      testId: `status-${f.value}`,
    }));
  });

  protected readonly kpiLoading = computed(() => this.summaryLoading() && !this.summary());
  protected readonly hasAny = computed(() => (this.summary()?.vehiclesWithIpva ?? 0) > 0);
  protected readonly anyFilter = computed(
    () => this.term().trim() !== '' || this.status() !== 'ALL',
  );
  protected readonly totalPages = computed(() =>
    this.total() === 0 ? 1 : Math.ceil(this.total() / IPVA_PAGE_SIZE),
  );

  protected readonly paidRatio = computed<number | null>(() => {
    const s = this.summary();
    return s && s.totalCents > 0 ? s.paidCents / s.totalCents : null;
  });

  protected readonly totalCaption = computed(() => {
    const n = this.summary()?.vehiclesWithIpva ?? 0;
    return n === 1 ? '1 veículo' : `${n} veículos`;
  });

  protected readonly paidCaption = computed(() => {
    const r = this.paidRatio();
    return r === null ? 'nada lançado' : `${Math.round(r * 100)}% do total`;
  });

  protected readonly openCaption = computed(() => {
    const due = this.summary()?.nextDueDate;
    return due ? `próximo em ${ptDayMonth(due)}` : 'nada a vencer';
  });

  protected readonly overdueCaption = computed(() => {
    const s = this.summary();
    return s && s.overdueCents > 0 ? brlCents(s.overdueCents) : 'nenhuma';
  });

  protected readonly resultsText = computed(() => {
    const n = this.total();
    return n === 0 ? 'Nenhum resultado' : n === 1 ? '1 veículo' : `${n} veículos`;
  });

  protected readonly sheetTitle = computed(() =>
    this.step() === 'pick' ? `Adicionar IPVA de ${this.year()}` : `Gerar parcelas de ${this.year()}`,
  );

  protected readonly sheetSubtitle = computed(() => {
    const v = this.chosen();
    if (this.step() === 'generate' && v) return `${plateLabel(v.plate)} · ${v.brand} ${v.model}`;
    return 'Escolha um veículo que ainda não tem IPVA neste ano.';
  });

  ngOnInit(): void {
    this.searchControl.valueChanges
      .pipe(
        debounceTime(IPVA_SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((q) => {
        this.term.set(q);
        this.loadList(0);
      });
    this.generateForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updatePreview());
    this.reloadAll();
  }

  protected reloadAll(): void {
    this.loadSummary();
    this.loadList(0);
  }

  private loadSummary(): void {
    this.summarySub?.unsubscribe();
    this.summaryLoading.set(true);
    this.summaryError.set(null);
    const year = this.year();
    this.summarySub = this.service.ipvaSummary(year).subscribe({
      next: (s) => {
        this.summary.set(s);
        this.summaryLoading.set(false);
      },
      error: (err: unknown) => {
        this.summaryLoading.set(false);
        this.summary.set(null);
        this.summaryError.set(this.apiErrors.messageFor(err, 'Não foi possível carregar o resumo do IPVA.'));
      },
    });
  }

  protected loadList(page: number): void {
    this.listSub?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    const status = this.status();
    this.listSub = this.service
      .ipvaList({
        year: this.year(),
        status: status === 'ALL' ? undefined : status,
        q: this.term(),
        page,
        size: IPVA_PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.rows.set((res.content ?? []).map(toViewRow));
          this.total.set(res.total ?? 0);
          this.page.set(res.page ?? page);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.rows.set([]);
          this.total.set(0);
          this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar o IPVA da frota.'));
        },
      });
  }

  protected selectYear(value: string): void {
    const year = Number(value);
    if (year === this.year()) return;
    this.year.set(year);
    this.epoch.update((n) => n + 1);
    this.reloadAll();
  }

  protected selectStatus(value: IpvaStatusFilter): void {
    if (value === this.status()) return;
    this.status.set(value);
    this.epoch.update((n) => n + 1);
    this.loadList(0);
  }

  protected clearFilters(): void {
    this.searchControl.setValue('', { emitEvent: false });
    this.term.set('');
    this.status.set('ALL');
    this.epoch.update((n) => n + 1);
    this.loadList(0);
  }

  protected prev(): void {
    if (this.page() > 0) this.loadList(this.page() - 1);
  }

  protected next(): void {
    if (this.page() + 1 < this.totalPages()) this.loadList(this.page() + 1);
  }

  protected openRow(row: IpvaFleetViewRow): void {
    void this.router.navigate(['/veiculos', row.row.vehicleId], {
      queryParams: { aba: 'gerencia', ipva: row.row.year },
    });
  }

  protected onRowKey(event: KeyboardEvent, row: IpvaFleetViewRow): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.openRow(row);
  }

  // ---- folha ---------------------------------------------------------------

  protected openSheet(): void {
    this.chosen.set(null);
    this.step.set('pick');
    this.sheetError.set(null);
    this.saving.set(false);
    this.sheetOpen.set(true);
  }

  protected pick(vehicle: VehicleListItem): void {
    this.chosen.set(vehicle);
    this.generateForm.reset({ totalReais: '', installments: 3, firstDueDate: '' });
    this.generatePreview.set(null);
    this.sheetError.set(null);
    this.step.set('generate');
  }

  protected backToPick(): void {
    if (this.saving()) return;
    this.sheetError.set(null);
    this.step.set('pick');
  }

  protected onSheetClosed(): void {
    this.sheetOpen.set(false);
    this.chosen.set(null);
    this.saving.set(false);
  }

  protected onMoneyInput(event: Event): void {
    applyPtBrMoneyMaskToControl(event, this.generateForm.controls.totalReais);
  }

  protected submitGenerate(): void {
    const vehicle = this.chosen();
    const form = this.generateForm;
    if (!vehicle || this.saving()) return;
    if (form.invalid) {
      form.markAllAsTouched();
      return;
    }
    const raw = form.getRawValue();
    this.saving.set(true);
    this.sheetError.set(null);
    this.ipvaService
      .generate(vehicle.id, this.year(), {
        totalCents: ptBrMoneyCents(raw.totalReais) ?? 0,
        installments: Number(raw.installments),
        firstDueDate: raw.firstDueDate,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.notifications.success(`IPVA de ${plateLabel(vehicle.plate)} cadastrado.`);
          const ref = this.sheetRef();
          if (ref) ref.requestClose(true);
          else this.onSheetClosed();
          this.reloadAll();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          const { formMessage } = this.apiErrors.handleForm(
            err,
            form,
            'Não foi possível gerar as parcelas.',
          );
          this.sheetError.set(formMessage);
        },
      });
  }

  private updatePreview(): void {
    const raw = this.generateForm.getRawValue();
    this.generatePreview.set(
      ipvaSplitPreview(ptBrMoneyCents(raw.totalReais), Number(raw.installments), brlCents),
    );
  }
}
