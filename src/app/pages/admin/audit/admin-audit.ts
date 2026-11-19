import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { BackLink } from '../../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { KvList } from '../../../components/core/kv-list/kv-list';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import {
  DateRange,
  DateRangePicker,
  DateRangePresetKey,
} from '../../../components/date-range-picker/date-range-picker';
import {
  DataList,
  DataListActions,
  DataListCell,
  type DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import { ListFilterSelect, ListToolbar } from '../../../components/lists/list-toolbar/list-toolbar';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminAuditService } from '../admin-audit.service';
import { AdminAuditLogItem } from '../../../types/admin-audit.types';
import { AuditTone, auditActionLabel, auditActionTone, auditTargetLabel } from './audit-labels';
import { whenAgo, whenDay, whenExact, whenLong, whenTime } from './admin-when';

const PAGE_SIZE = 20;

/** Chips do período. Sem chip marcado ao abrir: a trilha começa sem recorte de data. */
const PERIOD_KEYS: readonly DateRangePresetKey[] = [
  'today',
  '7d',
  '30d',
  'monthCurrent',
  'monthPast',
  'year',
  'custom',
];

interface ActionOption {
  value: string;
  label: string;
}

function actorName(item: AdminAuditLogItem): string {
  return item.actorName?.trim() || item.actorEmail?.trim() || 'Pessoa removida';
}

@Component({
  selector: 'app-admin-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BackLink,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    BottomSheet,
    KvList,
    StatusChip,
    DateRangePicker,
    DataList,
    DataListCell,
    DataListActions,
    DataListMenuItem,
    ListToolbar,
    ListFilterSelect,
  ],
  templateUrl: './admin-audit.html',
})
export class AdminAudit implements OnInit {
  private readonly auditService = inject(AdminAuditService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly items = this.auditService.items;
  protected readonly loading = this.auditService.loading;
  protected readonly total = this.auditService.total;
  protected readonly actors = this.auditService.actors;

  protected readonly periodKeys = PERIOD_KEYS;

  /** Falha ao CARREGAR a trilha — banner inline, nunca toast. */
  protected readonly error = signal<string | null>(null);

  protected readonly actorFilter = signal<string>('');
  protected readonly actionFilter = signal<string>('');
  protected readonly fromFilter = signal<string>('');
  protected readonly toFilter = signal<string>('');
  protected readonly currentPage = signal(0);

  /** "Limpar filtros" desmarca o período pelo próprio seletor (`clear()`), sem recriá-lo. */
  private readonly periodPicker = viewChild(DateRangePicker);

  /** Relógio do "há 3 h", renovado a cada carga da trilha. */
  protected readonly now = signal(Date.now());

  /** Registro aberto na folha de detalhes. */
  protected readonly detail = signal<AdminAuditLogItem | null>(null);
  private readonly sheet = viewChild(BottomSheet);

  protected readonly actionOptions = computed<ActionOption[]>(() =>
    this.auditService
      .actions()
      .map((value) => ({ value, label: auditActionLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
  );

  protected readonly totalPages = computed(() => {
    const t = this.total();
    if (t <= 0) return 1;
    return Math.max(1, Math.ceil(t / PAGE_SIZE));
  });

  protected readonly hasFilters = computed(
    () => !!this.actorFilter() || !!this.actionFilter() || !!this.fromFilter() || !!this.toFilter(),
  );

  protected readonly emptyText = computed(() =>
    this.hasFilters()
      ? 'Nenhuma ação registrada com esses filtros.'
      : 'Nenhuma ação administrativa registrada ainda.',
  );

  protected readonly columns: DataListColumn<AdminAuditLogItem>[] = [
    {
      key: 'action',
      header: 'Ação',
      kind: 'status',
      primary: true,
      value: (r) => auditActionLabel(r.action),
      tone: (r) => auditActionTone(r.action),
    },
    { key: 'when', header: 'Quando', value: (r) => whenExact(r.createdDate) ?? '—' },
    { key: 'actor', header: 'Quem fez', value: (r) => actorName(r) },
    {
      key: 'target',
      header: 'Alvo',
      optional: true,
      value: (r) => [auditTargetLabel(r.targetType), r.targetId].filter(Boolean).join(' '),
    },
  ];

  protected readonly rowId = (row: AdminAuditLogItem): string => row.id;
  /** Each kebab is named after its row, so a screen reader can tell them apart. */
  protected readonly kebabLabel = (row: AdminAuditLogItem): string =>
    `Ações do registro ${auditActionLabel(row.action)} de ${actorName(row)}`;

  constructor() {
    effect(() => {
      const actorUserId = this.actorFilter();
      const action = this.actionFilter();
      const from = this.fromFilter();
      const to = this.toFilter();
      const page = this.currentPage();
      this.error.set(null);
      this.auditService
        .load({ actorUserId, action, from, to, page, size: PAGE_SIZE })
        .subscribe({
          next: () => this.now.set(Date.now()),
          error: (err: HttpErrorResponse) =>
            this.error.set(
              this.apiErrors.messageFor(
                err,
                'Não foi possível carregar a trilha de auditoria. Tente novamente.',
              ),
            ),
        });
    });
  }

  ngOnInit(): void {
    // Falhas nos filtros são silenciosas: a listagem principal segue utilizável.
    this.auditService.loadActions().subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
    this.auditService.loadActors().subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
  }

  protected setActorFilter(value: string): void {
    this.currentPage.set(0);
    this.actorFilter.set(value);
  }

  protected setActionFilter(value: string): void {
    this.currentPage.set(0);
    this.actionFilter.set(value);
  }

  /** Período do seletor compartilhado (`yyyy-MM-dd`, dias de Brasília no backend). */
  protected setRange(range: DateRange): void {
    this.currentPage.set(0);
    this.fromFilter.set(range.from);
    this.toFilter.set(range.to);
  }

  /** Período desmarcado ("Limpar período" ou "Limpar filtros"): volta a todo o histórico. */
  protected clearRange(): void {
    this.currentPage.set(0);
    this.fromFilter.set('');
    this.toFilter.set('');
  }

  protected clearFilters(): void {
    this.currentPage.set(0);
    this.actorFilter.set('');
    this.actionFilter.set('');
    this.fromFilter.set('');
    this.toFilter.set('');
    this.periodPicker()?.clear();
  }

  protected goToPage(page: number): void {
    this.currentPage.set(Math.max(0, Math.min(page, this.totalPages() - 1)));
  }

  protected actionLabel(action: string): string {
    return auditActionLabel(action);
  }

  protected actionTone(action: string): AuditTone {
    return auditActionTone(action);
  }

  protected targetLabel(targetType: string): string {
    return auditTargetLabel(targetType);
  }

  protected actorLabel(item: AdminAuditLogItem): string {
    return actorName(item);
  }

  /** Últimos 8 chars do UUID — o suficiente para conferir; o inteiro fica no balão e na folha. */
  protected shortId(id: string | null): string {
    if (!id) return '—';
    return id.length <= 8 ? id : `…${id.slice(-8)}`;
  }

  protected day(value: string | null): string {
    return whenDay(value);
  }

  protected time(value: string | null): string {
    return whenTime(value);
  }

  protected exact(value: string | null): string {
    return whenExact(value) ?? '—';
  }

  protected long(value: string | null): string | null {
    return whenLong(value);
  }

  protected ago(value: string | null): string | null {
    return whenAgo(value, this.now());
  }

  protected openDetail(item: AdminAuditLogItem): void {
    this.detail.set(item);
  }

  protected dismissDetail(): void {
    const ref = this.sheet();
    if (ref) ref.requestClose();
    else this.detail.set(null);
  }

  protected closeDetail(): void {
    this.detail.set(null);
  }
}
