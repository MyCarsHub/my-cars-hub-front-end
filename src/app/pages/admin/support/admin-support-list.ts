import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
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
  imports: [DatePipe, DefaultPageLayout, PageCard],
  templateUrl: './admin-support-list.html',
})
export class AdminSupportList implements OnInit {
  private readonly service = inject(SupportTicketService);

  protected readonly channelLabel = SUPPORT_CHANNEL_LABEL;
  protected readonly statusMeta = SUPPORT_STATUS_META;

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
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

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.adminList(this.statusFilter(), this.page(), this.size()).subscribe({
      next: (res) => {
        this.items.set(res.content ?? []);
        this.total.set(res.total ?? 0);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set('Não foi possível carregar os tickets.');
        this.loading.set(false);
        console.error(err);
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
    this.service.adminUpdateStatus(ticket.id, { status: next }).subscribe({
      next: (updated) => {
        this.items.update((rows) =>
          rows.map((r) => (r.id === updated.id ? updated : r)),
        );
      },
      error: () => this.error.set('Falha ao atualizar status.'),
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
