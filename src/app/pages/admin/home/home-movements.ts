import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subject, catchError, map, of, switchMap } from 'rxjs';

import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { PageCard } from '../../../components/core/page-card/page-card';
import { PillTabs, type PillTabOption } from '../../../components/core/pill-tabs/pill-tabs';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import { DataList, DataListCell, type DataListColumn } from '../../../components/lists/data-list/data-list';
import { ApiErrorService } from '../../../services/api-error.service';
import type { AdminHomeScope, MovementGroup, PlatformMovement } from '../../../types/admin-home.types';
import { AdminHomeService } from './admin-home.service';
import { formatDateRangePtBr } from '../../../components/date-range-picker/date-range-picker';
import { ORIGIN_LABEL, RESULT_LABEL, ROLE_TONE, actionLabel, relativeTime, resultTone, roleLabel } from './admin-home.view';

type Tab = 'ALL' | MovementGroup;

const TABS: readonly PillTabOption<Tab>[] = [
  { value: 'ALL', label: 'Tudo' },
  { value: 'SIGNUPS', label: 'Cadastros' },
  { value: 'CHARGES', label: 'Cobranças' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'FAILURES', label: 'Falhas' },
];

/** Linhas na Visão geral; a trilha inteira está em /admin/auditoria. */
export const MOVEMENTS_SHOWN = 10;

interface Query {
  readonly tab: Tab;
  readonly scope: AdminHomeScope;
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * "Movimentações": tudo o que acontece na plataforma, do mais recente ao mais antigo. As abas são
 * filtros do servidor (`group`); o escopo decide se as contas internas entram.
 */
@Component({
  selector: 'app-home-movements',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard, PillTabs, DataList, DataListCell, StatusChip, RouterLink, AlertBanner],
  host: { class: 'block min-w-0' },
  template: `
    <app-page-card title="Movimentações">
      <div class="px-4 sm:px-6 pb-5 flex flex-col gap-4 min-w-0" data-home-movements>
        <div class="-mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-xs text-fg-subtle" data-movements-range>
            Tudo que acontece na plataforma, do mais recente ao mais antigo{{ rangeText() ? ', de ' + rangeText() : '' }}
          </p>
          <app-pill-tabs [options]="tabs" [value]="tab()" ariaLabel="Tipo de movimentação" (selected)="pick($event)" />
        </div>
        @if (error(); as e) {
          <app-alert-banner [message]="e">
            <button type="button" class="ml-1 underline min-h-[44px]" (click)="reload()">Tentar novamente</button>
          </app-alert-banner>
        }
        <app-data-list
          [columns]="columns"
          [rows]="rows()"
          [rowId]="rowId"
          [loading]="loading()"
          [fit]="true"
          ariaLabel="Movimentações da plataforma"
          emptyText="Nada registrado neste filtro e período."
        >
          <ng-template dataListCell="who" let-row>
            <span class="inline-flex flex-wrap items-center gap-1.5 min-w-0">
              <!-- Evento do sistema (webhook, rotina) não tem papel: só "Sistema", sem chip. -->
              @if (row.actorRole && row.actorName) {
                <app-status-chip size="sm" [tone]="roleTone">{{ roleLabel(row.actorRole) }}</app-status-chip>
              }
              <b class="font-semibold text-fg truncate">{{ row.actorName || 'Sistema' }}</b>
            </span>
          </ng-template>
          <ng-template dataListCell="result" let-row>
            <app-status-chip size="sm" [tone]="resultTone(row.result)">{{ resultLabel(row.result) }}</app-status-chip>
          </ng-template>
        </app-data-list>
        <a
          routerLink="/admin/auditoria"
          class="self-start inline-flex items-center min-h-11 text-sm font-semibold text-fg-soft hover:text-fg underline-offset-4 hover:underline"
          >Ver tudo na auditoria</a
        >
      </div>
    </app-page-card>
  `,
})
export class HomeMovements {
  private readonly service = inject(AdminHomeService);
  private readonly apiErrors = inject(ApiErrorService);

  readonly scope = input.required<AdminHomeScope>();
  /** Início do período escolhido (`YYYY-MM-DD`); nulo = os últimos 30 dias do servidor. */
  readonly from = input<string | null>(null);
  /** Fim do período escolhido (`YYYY-MM-DD`); nulo = hoje no servidor. */
  readonly to = input<string | null>(null);

  protected readonly tabs = TABS;
  protected readonly tab = signal<Tab>('ALL');
  protected readonly rows = signal<PlatformMovement[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  private readonly now = signal(Date.now());
  /** A janela que o SERVIDOR usou (`meta.from/to`), escrita no subtítulo. */
  private readonly served = signal<{ from: string; to: string } | null>(null);
  protected readonly rangeText = computed(() => formatDateRangePtBr(this.served()));

  protected readonly rowId = (row: PlatformMovement): string => row.id;
  protected readonly roleLabel = roleLabel;
  protected readonly roleTone = ROLE_TONE;
  protected readonly resultTone = resultTone;

  protected readonly columns: readonly DataListColumn<PlatformMovement>[] = [
    { key: 'action', header: 'Ação', primary: true, value: (m) => actionLabel(m.action, m.detail) },
    { key: 'when', header: 'Quando', value: (m) => relativeTime(m.occurredAt, this.now()) },
    { key: 'who', header: 'Quem', value: (m) => m.actorName },
    { key: 'company', header: 'Empresa', value: (m) => m.companyName },
    { key: 'origin', header: 'Origem', optional: true, value: (m) => ORIGIN_LABEL[m.origin] ?? m.origin },
    { key: 'result', header: 'Resultado', end: true, value: (m) => RESULT_LABEL[m.result] ?? m.result },
  ];

  private readonly requests = new Subject<Query>();

  constructor() {
    this.requests
      .pipe(
        switchMap((q) => {
          this.loading.set(true);
          this.error.set(null);
          this.served.set(null);
          return this.service
            .movements({
              group: q.tab === 'ALL' ? null : q.tab,
              includeInternal: q.scope === 'all',
              from: q.from,
              to: q.to,
              size: MOVEMENTS_SHOWN,
            })
            .pipe(
              map((res) => ({ rows: res.content ?? [], served: res.meta ?? null, failure: null as unknown })),
              catchError((failure: unknown) => of({ rows: null, served: null, failure })),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ rows, served, failure }) => {
        this.loading.set(false);
        this.now.set(Date.now());
        this.served.set(served);
        if (rows) {
          this.rows.set(rows);
          return;
        }
        this.apiErrors.claim(failure);
        this.rows.set([]);
        this.error.set('Não foi possível carregar as movimentações.');
      });
    effect(() => this.requests.next(this.query()));
  }

  protected pick(tab: Tab): void {
    this.tab.set(tab);
  }

  protected reload(): void {
    this.requests.next(this.query());
  }

  private query(): Query {
    return { tab: this.tab(), scope: this.scope(), from: this.from(), to: this.to() };
  }

  protected resultLabel(result: string): string {
    return RESULT_LABEL[result] ?? result;
  }
}
