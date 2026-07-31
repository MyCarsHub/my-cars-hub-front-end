import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import { SupportTicketService } from '../../../services/support-ticket.service';
import {
  SUPPORT_CHANNEL_LABEL,
  SUPPORT_STATUS_META,
  SupportTicketDto,
  SupportTicketStatus,
} from '../../../types/support.types';

/**
 * Backoffice PLATFORM_ADMIN de tickets de suporte. Lista paginada com filtro
 * por status, expande a mensagem completa inline, botão pra mover status.
 */
@Component({
  selector: 'app-admin-support-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DefaultPageLayout, PageCard, AlertBanner, ActionsMenu],
  templateUrl: './admin-support-list.html',
})
export class AdminSupportList implements OnInit {
  private readonly service = inject(SupportTicketService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  protected readonly channelLabel = SUPPORT_CHANNEL_LABEL;
  protected readonly statusMeta = SUPPORT_STATUS_META;

  protected readonly loading = signal(false);
  /** Falha ao CARREGAR a lista — banner no topo, acima dos filtros. */
  protected readonly error = signal<string | null>(null);
  /**
   * Falha da OPERAÇÃO de mudar status, ancorada no ticket que a causou: o banner
   * é renderizado dentro da própria linha, ao lado dos botões de ação. Inline e
   * nunca toast — `messageFor()` reivindica o erro e desarma a rede de segurança.
   */
  protected readonly actionError = signal<{ ticketId: string; message: string } | null>(null);
  protected readonly items = signal<SupportTicketDto[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly size = signal(20);
  protected readonly statusFilter = signal<SupportTicketStatus | ''>('');
  protected readonly expandedId = signal<string | null>(null);

  protected readonly hasNext = computed(
    () => (this.page() + 1) * this.size() < this.total(),
  );
  protected readonly hasPrev = computed(() => this.page() > 0);

  ngOnInit(): void {
    this.load();
  }

  /** Mensagem de erro de operação pertencente a esta linha, ou `null`. */
  protected actionErrorFor(ticketId: string): string | null {
    const current = this.actionError();
    return current && current.ticketId === ticketId ? current.message : null;
  }

  protected dismissActionError(): void {
    this.actionError.set(null);
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.actionError.set(null);
    this.service.adminList(this.statusFilter(), this.page(), this.size()).subscribe({
      next: (res) => {
        this.items.set(res.content ?? []);
        this.total.set(res.total ?? 0);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar os tickets.'));
        this.loading.set(false);
      },
    });
  }

  protected onFilterChange(status: string): void {
    this.statusFilter.set((status as SupportTicketStatus | '') || '');
    this.page.set(0);
    this.load();
  }

  protected toggleExpand(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  protected changeStatus(ticket: SupportTicketDto, next: SupportTicketStatus): void {
    if (ticket.status === next) return;
    this.actionError.set(null);
    this.service.adminUpdateStatus(ticket.id, { status: next }).subscribe({
      next: (updated) => {
        this.items.update((rows) =>
          rows.map((r) => (r.id === updated.id ? updated : r)),
        );
        this.notifications.success(
          `Ticket movido para "${this.statusMeta[updated.status].label}".`,
        );
      },
      error: (err: HttpErrorResponse) => {
        this.actionError.set({
          ticketId: ticket.id,
          message: this.apiErrors.messageFor(err, 'Falha ao atualizar status.'),
        });
      },
    });
  }

  protected nextPage(): void {
    if (!this.hasNext()) return;
    this.page.update((p) => p + 1);
    this.load();
  }

  protected prevPage(): void {
    if (!this.hasPrev()) return;
    this.page.update((p) => p - 1);
    this.load();
  }
}
