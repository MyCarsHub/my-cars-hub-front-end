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
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subject, catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { BackLink } from '../../../components/core/back-link/back-link';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { PageCard } from '../../../components/core/page-card/page-card';
import { PillTabs, type PillTabOption } from '../../../components/core/pill-tabs/pill-tabs';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import { type FilterChipOption } from '../../../components/filter-chip-group/filter-chip-group';
import { KpiCard } from '../../../components/kpi-card/kpi-card';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import {
  DataList,
  DataListActions,
  DataListCell,
  type DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { buildCsv, downloadCsv, type CsvColumn } from '../../../components/lists/data-list/data-list-csv';
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import { ListToolbar } from '../../../components/lists/list-toolbar/list-toolbar';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import type {
  PlatformCost,
  PlatformCostMonth,
  PlatformCostSchedule,
  PlatformVendor,
  PlatformVendorCategory,
} from '../../../types/admin-finance.types';
import type { AdminHome } from '../../../types/admin-home.types';
import { AdminFinanceService } from '../finance/admin-finance.service';
import { AdminHomeService } from '../home/admin-home.service';
import { ADMIN_HOME_DEFAULT_SCOPE, adminMonthToDate, mrrRealCaption, nullText } from '../home/admin-home.view';
import { CostEntrySheet } from './cost-entry-sheet';
import {
  addMonths,
  brl,
  costErrorMessage,
  currentMonth,
  entryRows,
  fixedRows,
  isStale,
  latestOfChain,
  monthName,
  monthOnly,
  monthSplit,
  monthTitle,
  runningFixed,
  vendorCategoryText,
  type EntryRow,
  type FixedRow,
} from './costs-copy';
import { COSTS_ACTION_PARAM, COSTS_CATEGORY_PARAM, COSTS_TAB_PARAM, type CostsTab } from './costs-link';
import { FixedCostChangeSheet, type FixedCostChange } from './fixed-cost-change-sheet';
import { FixedCostSheet } from './fixed-cost-sheet';
import { VendorSheet } from './vendor-sheet';

type FixedFilter = 'ALL' | 'RUNNING' | 'ENDED';

interface VendorRow {
  readonly vendor: PlatformVendor;
  readonly name: string;
  readonly category: string;
  readonly status: string;
}

interface Confirm {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly variant: 'danger' | 'info';
  readonly success: string;
  readonly run: () => Observable<unknown>;
}

const FIXED_COLUMNS: readonly DataListColumn<FixedRow>[] = [
  { key: 'title', header: 'Fornecedor · serviço', primary: true, value: (r) => r.title },
  { key: 'amount', header: 'Valor', value: (r) => r.amountText },
  { key: 'day', header: 'Dia', value: (r) => r.dayText },
  { key: 'period', header: 'Período', value: (r) => r.periodText },
  { key: 'status', header: 'Situação', kind: 'status', value: (r) => r.chip.label, tone: (r) => r.chip.tone },
];

const FIXED_CSV: readonly CsvColumn<FixedRow>[] = [
  { key: 'vendor', header: 'Fornecedor', value: (r) => r.schedule.vendorName },
  { key: 'service', header: 'Serviço', value: (r) => r.schedule.service },
  { key: 'category', header: 'Categoria', value: (r) => r.category },
  { key: 'amount', header: 'Valor por mês', kind: 'money-cents', value: (r) => r.amountCents },
  { key: 'day', header: 'Dia de cobrança', kind: 'integer', value: (r) => r.schedule.billingDay },
  { key: 'period', header: 'Período', value: (r) => r.periodText },
  { key: 'status', header: 'Situação', value: (r) => r.chip.label },
];

const ENTRY_COLUMNS: readonly DataListColumn<EntryRow>[] = [
  { key: 'title', header: 'Fornecedor · serviço', primary: true, value: (r) => r.title },
  { key: 'amount', header: 'Valor', value: (r) => r.amountText },
  { key: 'due', header: 'Vence', value: (r) => r.dueText },
  { key: 'note', header: 'Nota', value: (r) => r.note },
];

const ENTRY_CSV: readonly CsvColumn<EntryRow>[] = [
  { key: 'month', header: 'Mês', value: (r) => r.cost.month },
  { key: 'vendor', header: 'Fornecedor', value: (r) => r.cost.vendorName },
  { key: 'description', header: 'Serviço', value: (r) => r.cost.description },
  { key: 'kind', header: 'Tipo', value: (r) => r.kind },
  { key: 'edited', header: 'Editado', value: (r) => (r.edited ? 'sim' : 'não') },
  { key: 'amount', header: 'Valor', kind: 'money-cents', value: (r) => r.cost.amountCents },
  { key: 'due', header: 'Vencimento', value: (r) => r.cost.dueDate },
  { key: 'note', header: 'Nota', value: (r) => r.cost.note },
];

const VENDOR_COLUMNS: readonly DataListColumn<VendorRow>[] = [
  { key: 'name', header: 'Fornecedor', primary: true, value: (r) => r.name },
  { key: 'category', header: 'Categoria', value: (r) => r.category },
  {
    key: 'status',
    header: 'Situação',
    kind: 'status',
    value: (r) => r.status,
    tone: (r) => (r.vendor.active ? 'green' : 'neutral'),
  },
];

const TABS: readonly CostsTab[] = ['fixos', 'mes', 'fornecedores'];

/**
 * Dinheiro › Custos: o que a plataforma paga todo mês. Custos fixos (cadastrados uma vez, lançam
 * sozinhos no dia 1), lançamentos do mês (cada linha corrigida só naquele mês) e fornecedores.
 * O total do mês entra no Lucro do Painel.
 *
 * Ler pede `ver`; toda escrita pede `custo.gerir` (o servidor confere de novo). Nenhum botão de ação
 * solto: novo fixo, avulso, fornecedor e exportar ficam no ⋮ do topo; o resto no ⋮ da linha.
 */
@Component({
  selector: 'app-admin-costs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionsMenu,
    AlertBanner,
    BackLink,
    ConfirmDialog,
    CostEntrySheet,
    DataList,
    DataListActions,
    DataListCell,
    DataListMenuItem,
    DefaultPageLayout,
    FixedCostChangeSheet,
    FixedCostSheet,
    KpiCard,
    ListToolbar,
    PageCard,
    PillTabs,
    StatusChip,
    VendorSheet,
  ],
  templateUrl: './admin-costs.html',
})
export class AdminCosts implements OnInit {
  private readonly service = inject(AdminFinanceService);
  private readonly homeService = inject(AdminHomeService);
  private readonly caps = inject(AdminCapabilitiesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly canManage = computed(() => this.caps.can('custo.gerir'));
  protected readonly thisMonth = currentMonth();
  protected readonly thisMonthWord = monthOnly(this.thisMonth);
  protected readonly brl = brl;

  // ---------------------------------------------------------------- dados

  protected readonly schedules = signal<PlatformCostSchedule[]>([]);
  protected readonly vendors = signal<PlatformVendor[]>([]);
  /** O mês corrente: alimenta os números do topo (os mesmos do Painel). */
  protected readonly current = signal<PlatformCostMonth | null>(null);
  /** O mês escolhido em "Lançamentos do mês". */
  protected readonly month = signal(this.thisMonth);
  protected readonly monthData = signal<PlatformCostMonth | null>(null);
  protected readonly home = signal<AdminHome | null>(null);

  protected readonly listsLoading = signal(true);
  protected readonly listsError = signal<string | null>(null);
  protected readonly monthLoading = signal(true);
  protected readonly monthError = signal<string | null>(null);
  protected readonly homeLoading = signal(true);

  private readonly monthRequests = new Subject<string>();
  /** Completa quando a carga de fixos e fornecedores em andamento termina (o atalho espera por ela). */
  private listsDone: Observable<unknown> = of(null);

  // ---------------------------------------------------------------- abas e filtros

  protected readonly tab = signal<CostsTab>('fixos');
  protected readonly search = signal('');
  protected readonly fixedFilter = signal<FixedFilter>('ALL');

  protected readonly fixedColumns = FIXED_COLUMNS;
  protected readonly entryColumns = ENTRY_COLUMNS;
  protected readonly vendorColumns = VENDOR_COLUMNS;
  protected readonly fixedId = (r: FixedRow): string => r.schedule.id;
  protected readonly entryId = (r: EntryRow): string => r.cost.id;
  protected readonly vendorId = (r: VendorRow): string => r.vendor.id;
  protected readonly fixedKebab = (r: FixedRow): string => `Ações do custo fixo ${r.title}`;
  protected readonly entryKebab = (r: EntryRow): string => `Ações do lançamento ${r.title}`;
  protected readonly vendorKebab = (r: VendorRow): string => `Ações do fornecedor ${r.name}`;
  protected readonly manageOnly = (): boolean => this.canManage();

  protected readonly allFixed = computed(() => fixedRows(this.schedules()));
  protected readonly fixedOptions = computed<readonly FilterChipOption<FixedFilter>[]>(() => {
    const rows = this.searched(this.allFixed());
    return [
      { value: 'ALL', label: 'Todos', count: rows.length },
      { value: 'RUNNING', label: 'Ativos', count: rows.filter((r) => !r.ended).length },
      { value: 'ENDED', label: 'Encerrados', count: rows.filter((r) => r.ended).length },
    ];
  });
  protected readonly fixed = computed(() => {
    const f = this.fixedFilter();
    return this.searched(this.allFixed()).filter((r) => (f === 'ALL' ? true : f === 'ENDED' ? r.ended : !r.ended));
  });
  protected readonly running = computed(() => runningFixed(this.allFixed()));

  protected readonly entries = computed(() => entryRows(this.monthData()?.rows ?? []));
  protected readonly monthWord = computed(() => monthOnly(this.month()));
  protected readonly monthLabel = computed(() => monthName(this.month()));
  protected readonly monthHeading = computed(() => monthTitle(this.month()));
  protected readonly monthTotal = computed(() => {
    const d = this.monthData();
    if (!d) return null;
    const split = monthSplit(d.rows);
    return {
      total: d.totalCents === null ? null : brl(d.totalCents),
      split: `fixos ${brl(split.fixedCents)} · avulsos ${brl(split.oneOffCents)}`,
    };
  });

  protected readonly vendorRows = computed<VendorRow[]>(() =>
    [...this.vendors()]
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR'))
      .map((vendor) => ({
        vendor,
        name: vendor.name,
        category: vendorCategoryText(vendor.category, vendor.categoryLabel),
        status: vendor.active ? 'Ativo' : 'Inativo',
      })),
  );

  protected readonly tabOptions = computed<readonly PillTabOption<CostsTab>[]>(() => [
    { value: 'fixos', label: 'Custos fixos', shortLabel: 'Fixos', count: this.allFixed().filter((r) => !r.ended).length },
    { value: 'mes', label: 'Lançamentos do mês', shortLabel: 'Do mês', count: this.monthData()?.rows.length ?? 0 },
    { value: 'fornecedores', label: 'Fornecedores', count: this.vendors().filter((v) => v.active).length },
  ]);

  // ---------------------------------------------------------------- números do topo

  protected readonly costsKpi = computed(() => {
    const c = this.current();
    if (!c) return { value: null as number | null, detail: null as string | null };
    if (c.totalCents === null) return { value: null, detail: `nenhum custo lançado em ${this.thisMonthWord}` };
    const split = monthSplit(c.rows);
    return { value: c.totalCents, detail: `fixos ${brl(split.fixedCents)} · avulsos ${brl(split.oneOffCents)}` };
  });

  /** O "MRR real" do Painel: mesmo pedido, mesmo campo, mesmo nome e mesma legenda. */
  protected readonly mrrKpi = computed(() => {
    const k = this.home()?.kpis.mrrReal;
    if (!k) return { value: null as number | null, detail: null as string | null };
    return { value: k.value, detail: k.value === null ? nullText(k, this.thisMonth) : mrrRealCaption(k) };
  });

  protected readonly profitKpi = computed(() => {
    const k = this.home()?.kpis.profitMonth;
    if (!k) return { value: null as number | null, detail: null as string | null };
    if (k.value !== null) return { value: k.value, detail: 'o mesmo número do Painel' };
    return {
      value: null,
      detail: k.nullReason === 'NO_COSTS' ? 'sem custos lançados no mês' : 'ninguém pagando no mês',
    };
  });

  /** "Receita − Custos = Lucro": as partes que o servidor usou no Lucro do Painel. */
  protected readonly flow = computed(() => {
    const k = this.home()?.kpis.profitMonth;
    if (!k) return null;
    const mrr = k.parts['mrrRealCents'];
    const costs = k.parts['costsCents'];
    if (k.value === null || mrr == null || costs == null) return null;
    return { mrr: brl(mrr), costs: brl(costs), profit: brl(k.value) };
  });

  // ---------------------------------------------------------------- folhas e confirmação

  protected readonly fixedSheet = signal<{ schedule: PlatformCostSchedule | null; category: PlatformVendorCategory | null } | null>(null);
  protected readonly changeSheet = signal<{ mode: FixedCostChange; schedule: PlatformCostSchedule } | null>(null);
  protected readonly entrySheet = signal<{ cost: PlatformCost | null; category: PlatformVendorCategory | null } | null>(null);
  protected readonly vendorSheet = signal<{ vendor: PlatformVendor | null } | null>(null);
  protected readonly confirm = signal<Confirm | null>(null);
  protected readonly confirmBusy = signal(false);

  /** A linha em edição ainda tem um custo fixo que aceita "mudar daqui para frente". */
  protected readonly entryCanChangeFixed = computed(() => {
    const c = this.entrySheet()?.cost;
    return !!c?.scheduleId && latestOfChain(this.schedules(), c.scheduleId) !== null;
  });

  constructor() {
    this.monthRequests
      .pipe(
        switchMap((m) => {
          this.monthLoading.set(true);
          this.monthError.set(null);
          return this.service.costs(m).pipe(
            map((res) => ({ res, failure: null as unknown })),
            catchError((failure: unknown) => of({ res: null, failure })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ res, failure }) => {
        this.monthLoading.set(false);
        if (failure) {
          this.apiErrors.claim(failure);
          this.monthData.set(null);
          this.monthError.set('Não foi possível carregar os lançamentos do mês.');
          return;
        }
        this.monthData.set(res);
        if (res && res.month === this.thisMonth) this.current.set(res);
      });
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const tab = params.get(COSTS_TAB_PARAM) as CostsTab | null;
    if (tab && TABS.includes(tab)) this.tab.set(tab);
    this.reloadAll();
    this.caps.ensureLoaded().subscribe(() => this.openFromShortcut());
  }

  // ---------------------------------------------------------------- cargas

  protected reloadAll(): void {
    this.loadLists();
    this.loadMonth();
    if (this.month() !== this.thisMonth) this.loadCurrent();
    this.loadHome();
  }

  protected loadLists(): Observable<unknown> {
    this.listsLoading.set(true);
    this.listsError.set(null);
    const done = new Subject<unknown>();
    this.listsDone = done;
    forkJoin({ schedules: this.service.schedules(), vendors: this.service.vendors() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ schedules, vendors }) => {
          this.listsLoading.set(false);
          this.schedules.set(schedules ?? []);
          this.vendors.set(vendors ?? []);
          done.next(true);
          done.complete();
        },
        error: (err: unknown) => {
          this.listsLoading.set(false);
          this.apiErrors.claim(err);
          this.listsError.set('Não foi possível carregar os custos fixos e os fornecedores.');
          done.complete();
        },
      });
    return done;
  }

  protected loadMonth(): void {
    this.monthRequests.next(this.month());
  }

  private loadCurrent(): void {
    this.service
      .costs(this.thisMonth)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => this.current.set(res), error: (err: unknown) => this.apiErrors.claim(err) });
  }

  /** MRR real e Lucro do mês corrente: o mesmo pedido que o Painel abre ("Mês atual", só clientes). */
  private loadHome(): void {
    this.homeLoading.set(true);
    this.homeService
      .home(adminMonthToDate(), ADMIN_HOME_DEFAULT_SCOPE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.homeLoading.set(false);
          this.home.set(res);
        },
        error: (err: unknown) => {
          this.homeLoading.set(false);
          this.apiErrors.claim(err);
          this.home.set(null);
        },
      });
  }

  // ---------------------------------------------------------------- navegação

  protected setTab(tab: CostsTab): void {
    this.tab.set(tab);
  }

  protected setQuery(q: string): void {
    this.search.set(q);
  }

  protected setFixedFilter(f: FixedFilter): void {
    this.fixedFilter.set(f);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.fixedFilter.set('ALL');
  }

  protected shiftMonth(delta: number): void {
    this.month.update((m) => addMonths(m, delta));
    this.loadMonth();
  }

  protected showMonth(): void {
    this.month.set(this.thisMonth);
    this.loadMonth();
    this.tab.set('mes');
  }

  private searched(rows: readonly FixedRow[]): FixedRow[] {
    const q = this.search().trim().toLocaleLowerCase('pt-BR');
    return q ? rows.filter((r) => `${r.title} ${r.category}`.toLocaleLowerCase('pt-BR').includes(q)) : [...rows];
  }

  /** `?acao=fixo|avulso|fornecedor` (atalhos do Painel), com `categoria=ACQUISITION` opcional. */
  private openFromShortcut(): void {
    const params = this.route.snapshot.queryParamMap;
    const action = params.get(COSTS_ACTION_PARAM);
    if (!action) return;
    const category = (params.get(COSTS_CATEGORY_PARAM) as PlatformVendorCategory | null) ?? null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [COSTS_ACTION_PARAM]: null, [COSTS_CATEGORY_PARAM]: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    if (!this.canManage()) return;
    // A folha escolhe o fornecedor da lista: espera ela chegar.
    const open = (): void => {
      if (action === 'fixo') this.newFixed(category);
      else if (action === 'avulso') this.newEntry(category);
      else if (action === 'fornecedor') this.vendorSheet.set({ vendor: null });
    };
    if (!this.listsLoading()) open();
    else this.listsDone.subscribe({ complete: open });
  }

  // ---------------------------------------------------------------- ações do topo

  protected newFixed(category: PlatformVendorCategory | null = null): void {
    if (this.canManage()) this.fixedSheet.set({ schedule: null, category });
  }

  protected newEntry(category: PlatformVendorCategory | null = null): void {
    if (!this.canManage()) return;
    this.tab.set('mes');
    this.entrySheet.set({ cost: null, category });
  }

  protected newVendor(): void {
    if (this.canManage()) this.vendorSheet.set({ vendor: null });
  }

  /** CSV da aba na tela (o mês escolhido em Lançamentos). */
  protected exportCsv(): void {
    const tab = this.tab();
    if (tab === 'fixos') {
      downloadCsv('custos-fixos.csv', buildCsv(FIXED_CSV, this.fixed()));
    } else if (tab === 'mes') {
      downloadCsv(`custos-${this.month()}.csv`, buildCsv(ENTRY_CSV, this.entries()));
    } else {
      downloadCsv('fornecedores.csv', buildCsv(VENDOR_COLUMNS, this.vendorRows()));
    }
  }

  // ---------------------------------------------------------------- ações das linhas

  protected editFixed(row: FixedRow): void {
    if (this.canManage()) this.fixedSheet.set({ schedule: row.schedule, category: null });
  }

  protected changeFixed(row: FixedRow, mode: FixedCostChange): void {
    if (this.canManage()) this.changeSheet.set({ mode, schedule: row.schedule });
  }

  protected askReopen(row: FixedRow): void {
    const s = row.schedule;
    this.confirm.set({
      title: 'Tirar a data de fim',
      message: `${s.vendorName} · ${s.service} volta a lançar todo mês, sem fim. Meses tirados à mão continuam fora.`,
      confirmLabel: 'Tirar a data de fim',
      cancelLabel: 'Manter',
      variant: 'info',
      success: 'Custo fixo sem data de fim.',
      run: () => this.service.endSchedule(s.id, { endMonth: null }),
    });
  }

  protected editEntry(row: EntryRow): void {
    if (this.canManage()) this.entrySheet.set({ cost: row.cost, category: null });
  }

  protected onEntryActivate(row: EntryRow): void {
    this.editEntry(row);
  }

  protected revertEntry(row: EntryRow): void {
    this.service.revertCost(row.cost.id).subscribe({
      next: () => {
        this.notify.success(`${row.title} voltou ao valor do fixo em ${this.monthWord()}.`);
        this.afterWrite();
      },
      error: (err: unknown) => this.failed(err),
    });
  }

  protected askRemoveEntry(cost: PlatformCost): void {
    const month = monthOnly(cost.month);
    const fixed = cost.kind === 'FIXED';
    this.confirm.set({
      title: `Tirar só de ${month}`,
      message: fixed
        ? `${cost.vendorName} · ${cost.description} sai de ${month} e não volta a ser lançado neste mês. Os outros meses não mudam.`
        : `${cost.vendorName} · ${cost.description} sai de ${month}.`,
      confirmLabel: 'Tirar do mês',
      cancelLabel: 'Manter',
      variant: 'danger',
      success: `Custo tirado de ${month}.`,
      run: () => this.service.deleteCost(cost.id),
    });
  }

  /** "Mudar o custo fixo daqui para frente", vindo da folha de um lançamento. */
  protected changeFixedFromEntry(cost: PlatformCost): void {
    const latest = cost.scheduleId ? latestOfChain(this.schedules(), cost.scheduleId) : null;
    this.entrySheet.set(null);
    if (latest) this.changeSheet.set({ mode: 'amount', schedule: latest });
  }

  protected removeFromEntry(cost: PlatformCost): void {
    this.entrySheet.set(null);
    this.askRemoveEntry(cost);
  }

  protected editVendor(row: VendorRow): void {
    if (this.canManage()) this.vendorSheet.set({ vendor: row.vendor });
  }

  protected askToggleVendor(row: VendorRow): void {
    const v = row.vendor;
    const activate = !v.active;
    this.confirm.set({
      title: activate ? 'Ativar fornecedor' : 'Desativar fornecedor',
      message: activate
        ? `${v.name} volta às listas de fornecedores dos custos.`
        : `${v.name} sai das listas. O histórico de custos dele fica guardado.`,
      confirmLabel: activate ? 'Ativar' : 'Desativar',
      cancelLabel: 'Manter',
      variant: activate ? 'info' : 'danger',
      success: activate ? `${v.name} ativado.` : `${v.name} desativado.`,
      run: () =>
        this.service.updateVendor(v.id, {
          name: v.name,
          category: v.category,
          categoryLabel: v.categoryLabel,
          active: activate,
        }),
    });
  }

  protected runConfirm(): void {
    const c = this.confirm();
    if (!c) return;
    this.confirmBusy.set(true);
    c.run().subscribe({
      next: () => {
        this.confirmBusy.set(false);
        this.confirm.set(null);
        this.notify.success(c.success);
        this.afterWrite();
      },
      error: (err: unknown) => {
        this.confirmBusy.set(false);
        this.confirm.set(null);
        this.failed(err);
      },
    });
  }

  protected cancelConfirm(): void {
    if (!this.confirmBusy()) this.confirm.set(null);
  }

  // ---------------------------------------------------------------- depois de escrever

  protected onSaved(message: string): void {
    this.notify.success(message);
    this.afterWrite();
  }

  protected onVendorCreated(): void {
    this.loadLists();
  }

  /** Uma escrita muda fixos, o mês, o total corrente e o Lucro: recarrega tudo. */
  protected afterWrite(): void {
    this.reloadAll();
  }

  private failed(err: unknown): void {
    this.apiErrors.claim(err);
    this.notify.error(costErrorMessage(err));
    if (isStale(err)) this.afterWrite();
  }
}
