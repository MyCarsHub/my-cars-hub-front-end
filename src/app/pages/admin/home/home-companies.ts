import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { Subject, catchError, map, of, switchMap } from 'rxjs';

import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { PageCard } from '../../../components/core/page-card/page-card';
import { formatBrl } from '../../../pipes/brl.pipe';
import { PillTabs, type PillTabOption } from '../../../components/core/pill-tabs/pill-tabs';
import { StatusChip, type StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { DataList, DataListCell, type DataListColumn } from '../../../components/lists/data-list/data-list';
import type { CsvColumn } from '../../../components/lists/data-list/data-list-csv';
import { ApiErrorService } from '../../../services/api-error.service';
import type { AdminCompanyListItem } from '../../../types/admin-company.types';
import type { AdminHomeScope, CompanySort } from '../../../types/admin-home.types';
import { AdminHomeService } from './admin-home.service';
import { HEALTH_LABEL, HEALTH_REASON, HEALTH_TONE, relativeTime } from './admin-home.view';

/** Linhas pedidas ao servidor: a mais, porque "Só clientes" tira as internas daqui. */
const FETCH_SIZE = 20;
/** Linhas mostradas na Visão geral; o resto está em /admin/companies. */
export const COMPANIES_SHOWN = 8;

const SORTS: readonly PillTabOption<CompanySort>[] = [
  { value: 'mrrReal', label: 'MRR' },
  { value: 'managed', label: 'Gerenciado' },
  { value: 'lastAccess', label: 'Último acesso' },
];

function city(c: AdminCompanyListItem): string | null {
  // A UF chega como foi digitada ("mg"); sigla de estado é sempre maiúscula.
  const uf = c.uf ? c.uf.trim().toUpperCase() : null;
  if (c.city && uf) return `${c.city}, ${uf}`;
  return c.city || uf || null;
}

/** As colunas do CSV do "Exportar" (o que a tabela mostra, em números crus). */
export const COMPANY_CSV_COLUMNS: readonly CsvColumn<AdminCompanyListItem>[] = [
  { key: 'name', header: 'Empresa', value: (c) => c.name },
  { key: 'city', header: 'Cidade/UF', value: (c) => city(c) },
  { key: 'plan', header: 'Plano', value: (c) => c.planName },
  { key: 'vehicles', header: 'Veículos', kind: 'integer', value: (c) => c.vehicleCount },
  { key: 'drivers', header: 'Motoristas', kind: 'integer', value: (c) => c.driverCount },
  { key: 'managed', header: 'Gerenciado no mês (R$)', kind: 'money-cents', value: (c) => c.managedMonthCents },
  { key: 'access', header: 'Horas de acesso 30d', kind: 'integer', value: (c) => c.accessHours30d },
  { key: 'actions', header: 'Ações 30d', kind: 'integer', value: (c) => c.actions30d },
  { key: 'last', header: 'Último acesso', value: (c) => c.lastAccessAt },
  { key: 'mrrReal', header: 'MRR real (R$)', kind: 'money-cents', value: (c) => c.mrrRealCents },
  { key: 'mrr', header: 'MRR tabela (R$)', kind: 'money-cents', value: (c) => c.mrrCents },
  { key: 'health', header: 'Saúde', value: (c) => (c.health ? HEALTH_LABEL[c.health] : null) },
  { key: 'reason', header: 'Motivo', value: (c) => (c.healthReason ? HEALTH_REASON[c.healthReason] : null) },
];

/**
 * "Cruzamento por empresa": plano, tamanho, valor gerenciado, uso e receita no mesmo lugar. É a
 * lista de /admin/companies ordenada no servidor; a linha abre a empresa. A tabela só aparece
 * quando CABE no cartão (`fit`, medido: barra lateral aberta conta): sem espaço, ela tira primeiro
 * Veíc., Motor., Acessos 30d e Ações 30d (e diz isso embaixo), depois vira cartões. MRR,
 * Gerenciado e Último acesso, o que o dono lê primeiro, nunca saem. Nenhuma rolagem lateral.
 */
@Component({
  selector: 'app-home-companies',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard, PillTabs, DataList, DataListCell, StatusChip, RouterLink, AlertBanner],
  host: { class: 'block min-w-0' },
  template: `
    <app-page-card title="Cruzamento por empresa" [fill]="true">
      <div class="px-4 sm:px-6 pb-5 flex flex-col gap-4 min-w-0" data-home-companies>
        <div class="-mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-xs text-fg-subtle">Plano, tamanho, valor gerenciado, uso e receita no mesmo lugar</p>
          <app-pill-tabs [options]="sorts" [value]="sort()" ariaLabel="Ordenar empresas por" (selected)="pick($event)" />
        </div>
        @if (error(); as e) {
          <app-alert-banner [message]="e">
            <button type="button" class="ml-1 underline min-h-[44px]" (click)="reload()">Tentar novamente</button>
          </app-alert-banner>
        }
        <!-- Dez colunas: cartões abaixo de lg; de lg para cima a tabela só aparece se couber no
             cartão (fit). Sem espaço: saem as colunas optional, depois viram cartões. Nunca rola. -->
        <app-data-list
          [columns]="columns"
          [rows]="shown()"
          [rowId]="rowId"
          [loading]="loading()"
          [rowTarget]="true"
          [dense]="true"
          [fit]="true"
          cardsBelow="lg"
          ariaLabel="Cruzamento por empresa"
          emptyText="Nenhuma empresa neste escopo."
          (rowActivate)="open($event)"
        >
          <ng-template dataListCell="name" let-row>
            <a
              [routerLink]="['/admin/companies', row.id]"
              class="font-semibold text-fg whitespace-nowrap hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
              >{{ row.name }}</a
            >
            @if (cityOf(row); as place) {
              <span class="block text-xs text-fg-subtle font-normal whitespace-nowrap">{{ place }}</span>
            }
          </ng-template>
          <ng-template dataListCell="mrr" let-row>
            <!-- A nota ("pelo preço de tabela") vai no title: a linha fica numa altura só. -->
            <span class="font-semibold text-fg" [attr.title]="mrrNote(row)">{{ mrrText(row) }}</span>
            @if (mrrNote(row); as note) {
              <span class="sr-only">{{ note }}</span>
            }
          </ng-template>
          <ng-template dataListCell="health" let-row>
            @if (healthOf(row); as h) {
              <span [attr.title]="h.reason">
                <app-status-chip size="sm" [tone]="h.tone">{{ h.label }}</app-status-chip>
              </span>
              @if (h.reason) {
                <span class="sr-only">{{ h.reason }}</span>
              }
            } @else {
              —
            }
          </ng-template>
        </app-data-list>
        <a
          routerLink="/admin/companies"
          class="self-start inline-flex items-center min-h-11 text-sm font-semibold text-fg-soft hover:text-fg underline-offset-4 hover:underline"
          >Ver todas as empresas</a
        >
      </div>
    </app-page-card>
  `,
})
export class HomeCompanies {
  private readonly service = inject(AdminHomeService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly router = inject(Router);

  readonly scope = input.required<AdminHomeScope>();
  /** As linhas mostradas, para o "Exportar" da página. */
  readonly rowsChange = output<readonly AdminCompanyListItem[]>();

  protected readonly sorts = SORTS;
  protected readonly sort = signal<CompanySort>('mrrReal');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  private readonly rows = signal<AdminCompanyListItem[]>([]);
  private readonly now = signal(Date.now());

  protected readonly rowId = (row: AdminCompanyListItem): string => row.id;

  /** "Só clientes" tira as internas (a lista do servidor mostra todas, de propósito). */
  protected readonly shown = computed(() =>
    this.rows()
      .filter((c) => this.scope() === 'all' || !c.internal)
      .slice(0, COMPANIES_SHOWN),
  );

  protected readonly columns: readonly DataListColumn<AdminCompanyListItem>[] = [
    { key: 'name', header: 'Empresa', primary: true, value: (c) => c.name },
    { key: 'plan', header: 'Plano', value: (c) => c.planName },
    // `optional`: o que a tabela tira primeiro quando não cabe (o cartão e o CSV mantêm).
    { key: 'vehicles', header: 'Veíc.', kind: 'integer', end: true, optional: true, value: (c) => c.vehicleCount },
    { key: 'drivers', header: 'Motor.', kind: 'integer', end: true, optional: true, value: (c) => c.driverCount },
    // Real completo, com centavos (regra do dono 18/11).
    {
      key: 'managed',
      header: 'Gerenciado',
      end: true,
      value: (c) => (c.managedMonthCents == null ? null : formatBrl(c.managedMonthCents)),
    },
    { key: 'access', header: 'Acessos 30d', kind: 'integer', end: true, optional: true, value: (c) => c.accessHours30d },
    { key: 'actions', header: 'Ações 30d', kind: 'integer', end: true, optional: true, value: (c) => c.actions30d },
    { key: 'last', header: 'Último acesso', value: (c) => this.lastText(c) },
    { key: 'mrr', header: 'MRR', end: true, value: (c) => this.mrrText(c) },
    { key: 'health', header: 'Saúde', end: true, value: (c) => (c.health ? HEALTH_LABEL[c.health] : null) },
  ];

  private readonly requests = new Subject<CompanySort>();

  constructor() {
    this.requests
      .pipe(
        switchMap((sort) => {
          this.loading.set(true);
          this.error.set(null);
          return this.service.companies(sort, FETCH_SIZE).pipe(
            map((res) => ({ rows: res.content ?? [], failure: null as unknown })),
            catchError((failure: unknown) => of({ rows: null, failure })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ rows, failure }) => {
        this.loading.set(false);
        this.now.set(Date.now());
        if (rows) {
          this.rows.set(rows);
          return;
        }
        this.apiErrors.claim(failure);
        this.rows.set([]);
        this.error.set('Não foi possível carregar as empresas.');
      });
    this.requests.next(this.sort());
    effect(() => this.rowsChange.emit(this.shown()));
  }

  protected pick(sort: CompanySort): void {
    this.sort.set(sort);
    this.requests.next(sort);
  }

  protected reload(): void {
    this.requests.next(this.sort());
  }

  protected open(row: AdminCompanyListItem): void {
    void this.router.navigate(['/admin/companies', row.id]);
  }

  protected healthOf(c: AdminCompanyListItem): { label: string; tone: StatusChipTone; reason: string | null } | null {
    if (!c.health) return null;
    return {
      label: HEALTH_LABEL[c.health],
      tone: HEALTH_TONE[c.health],
      reason: c.healthReason ? HEALTH_REASON[c.healthReason] : null,
    };
  }

  protected cityOf(c: AdminCompanyListItem): string | null {
    return city(c);
  }

  protected lastText(c: AdminCompanyListItem): string {
    if (c.lastAccessAt === undefined) return '—';
    return relativeTime(c.lastAccessAt, this.now()) ?? 'nunca acessou';
  }

  /** MRR cobrado; sem valor cobrado, o de tabela (e diz que é tabela). Zero = não paga. */
  protected mrrText(c: AdminCompanyListItem): string {
    if (c.mrrRealCents !== null && c.mrrRealCents !== undefined) {
      return c.mrrRealCents === 0 ? '—' : formatBrl(c.mrrRealCents);
    }
    return c.mrrCents ? formatBrl(c.mrrCents) : '—';
  }

  protected mrrNote(c: AdminCompanyListItem): string | null {
    if (c.mrrRealCents === null && c.mrrCents) return 'preço de tabela';
    if (c.mrrRealCents && c.mrrCents && c.mrrRealCents !== c.mrrCents) {
      return `tabela ${formatBrl(c.mrrCents)}`;
    }
    return null;
  }
}
