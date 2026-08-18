import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { BackLink } from '../../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminAuditService } from '../admin-audit.service';
import { AdminAuditLogItem } from '../../../types/admin-audit.types';

const PAGE_SIZE = 20;

/**
 * Rótulos das ações. Chave = `name()` do enum `AdminAuditAction`; o valor cru é
 * o que vai no filtro para a API. Ação nova no backend que ainda não tenha
 * rótulo aqui cai no fallback de `humanize()` em vez de sumir da tela.
 */
const ACTION_LABELS: Record<string, string> = {
  USER_STATUS_CHANGED: 'Status de usuário alterado',
  USER_SYSTEM_ROLE_CHANGED: 'Papel de sistema alterado',
  COMPANY_STATUS_CHANGED: 'Status de empresa alterado',
  FEEDBACK_TASK_STATUS_CHANGED: 'Status de feedback alterado',
  FEEDBACK_TASK_DELETED: 'Feedback removido',
  BLOG_POST_CREATED: 'Post criado',
  BLOG_POST_UPDATED: 'Post editado',
  BLOG_POST_PUBLISHED: 'Post publicado',
  BLOG_POST_UNPUBLISHED: 'Post despublicado',
  BLOG_POST_DELETED: 'Post removido',
  RENTAL_SCHEDULE_REGENERATED: 'Cronograma regenerado',
  NOTIFICATION_TEST_DISPATCHED: 'Teste de templates enviado',
};

const TARGET_LABELS: Record<string, string> = {
  USER: 'Usuário',
  COMPANY: 'Empresa',
  FEEDBACK_TASK: 'Feedback',
  BLOG_POST: 'Post',
  RENTAL: 'Aluguel',
  NOTIFICATION: 'Notificação',
};

/** Cor do chip por família de ação — remoções em vermelho, criações em verde. */
const ACTION_CHIPS: Record<string, string> = {
  USER_STATUS_CHANGED: 'bg-amber-100 text-amber-700',
  USER_SYSTEM_ROLE_CHANGED: 'bg-purple-100 text-purple-700',
  COMPANY_STATUS_CHANGED: 'bg-amber-100 text-amber-700',
  FEEDBACK_TASK_STATUS_CHANGED: 'bg-blue-100 text-blue-700',
  FEEDBACK_TASK_DELETED: 'bg-red-100 text-red-700',
  BLOG_POST_CREATED: 'bg-emerald-100 text-emerald-700',
  BLOG_POST_UPDATED: 'bg-blue-100 text-blue-700',
  BLOG_POST_PUBLISHED: 'bg-emerald-100 text-emerald-700',
  BLOG_POST_UNPUBLISHED: 'bg-gray-200 text-gray-700',
  BLOG_POST_DELETED: 'bg-red-100 text-red-700',
  RENTAL_SCHEDULE_REGENERATED: 'bg-indigo-100 text-indigo-700',
  NOTIFICATION_TEST_DISPATCHED: 'bg-sky-100 text-sky-700',
};

const DEFAULT_CHIP = 'bg-gray-100 text-gray-700';

/** `BLOG_POST_DELETED` → `Blog post deleted`. Só para valores sem rótulo mapeado. */
function humanize(raw: string): string {
  const spaced = raw.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface ActionOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-admin-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackLink, DefaultPageLayout, PageCard, AlertBanner],
  templateUrl: './admin-audit.html',
})
export class AdminAudit implements OnInit {
  private readonly auditService = inject(AdminAuditService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly items = this.auditService.items;
  protected readonly loading = this.auditService.loading;
  protected readonly total = this.auditService.total;
  protected readonly actors = this.auditService.actors;

  /** Falha ao CARREGAR a trilha — banner inline, nunca toast. */
  protected readonly error = signal<string | null>(null);

  protected readonly actorFilter = signal<string>('');
  protected readonly actionFilter = signal<string>('');
  protected readonly fromFilter = signal<string>('');
  protected readonly toFilter = signal<string>('');
  protected readonly currentPage = signal(0);

  /** Linhas com o payload expandido, por id. */
  protected readonly expanded = signal<Record<string, boolean>>({});

  protected readonly actionOptions = computed<ActionOption[]>(() =>
    this.auditService
      .actions()
      .map((value) => ({ value, label: ACTION_LABELS[value] ?? humanize(value) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
  );

  protected readonly totalPages = computed(() => {
    const t = this.total();
    if (t <= 0) return 1;
    return Math.max(1, Math.ceil(t / PAGE_SIZE));
  });

  protected readonly canPrev = computed(() => this.currentPage() > 0);
  protected readonly canNext = computed(() => this.currentPage() + 1 < this.totalPages());

  protected readonly hasFilters = computed(
    () => !!this.actorFilter() || !!this.actionFilter() || !!this.fromFilter() || !!this.toFilter(),
  );

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

  protected setFromFilter(value: string): void {
    this.currentPage.set(0);
    this.fromFilter.set(value);
  }

  protected setToFilter(value: string): void {
    this.currentPage.set(0);
    this.toFilter.set(value);
  }

  protected clearFilters(): void {
    this.currentPage.set(0);
    this.actorFilter.set('');
    this.actionFilter.set('');
    this.fromFilter.set('');
    this.toFilter.set('');
  }

  protected prevPage(): void {
    if (this.canPrev()) this.currentPage.update((p) => p - 1);
  }

  protected nextPage(): void {
    if (this.canNext()) this.currentPage.update((p) => p + 1);
  }

  protected actionLabel(action: string): string {
    return ACTION_LABELS[action] ?? humanize(action);
  }

  protected actionChip(action: string): string {
    return ACTION_CHIPS[action] ?? DEFAULT_CHIP;
  }

  protected targetLabel(targetType: string): string {
    return TARGET_LABELS[targetType] ?? humanize(targetType);
  }

  protected actorLabel(item: AdminAuditLogItem): string {
    return item.actorName?.trim() || item.actorEmail?.trim() || 'Ator removido';
  }

  /** Últimos 8 chars do UUID — o suficiente para conferir, sem estourar o layout. */
  protected shortId(id: string | null): string {
    if (!id) return '—';
    return id.length <= 8 ? id : `…${id.slice(-8)}`;
  }

  protected isExpanded(id: string): boolean {
    return !!this.expanded()[id];
  }

  protected toggleExpanded(id: string): void {
    this.expanded.update((state) => ({ ...state, [id]: !state[id] }));
  }

  protected formatDateTime(value: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
