import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { BackLink } from '../../../components/core/back-link/back-link';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { PillTabOption, PillTabs } from '../../../components/core/pill-tabs/pill-tabs';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import { AdminAnnouncement, AnnouncementStatus } from '../../../types/announcement.types';
import { AdminAnnouncementsService } from './admin-announcements.service';
import {
  STATUS_LABEL,
  StatusChipStyle,
  audienceLabel,
  periodLabel,
  periodSub,
  statusChip,
  titleSub,
  todayIso,
} from './announcement-copy';
import { AnnouncementSheet } from './announcement-sheet';

type Filter = 'ALL' | AnnouncementStatus;

interface Row {
  a: AdminAnnouncement;
  sub: string;
  aud: string;
  audSub: string;
  period: string;
  periodSub: string;
  status: string;
  chip: StatusChipStyle;
}

interface SheetState {
  announcement: AdminAnnouncement | null;
  duplicate: boolean;
}

interface ConfirmState {
  kind: 'unpublish' | 'delete';
  a: AdminAnnouncement;
}

/**
 * Admin → Novidades (prancha NovidadesAdmin): lista com filtro por situação, ações da linha no
 * menu ⋮ (mudam conforme a situação), folha com prévia para criar/editar. Só o Dono
 * (`novidades.gerir`); a rota e o menu escondem, o servidor confere de novo.
 */
@Component({
  selector: 'app-admin-announcements',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    DefaultPageLayout,
    AlertBanner,
    ActionsMenu,
    BackLink,
    ConfirmDialog,
    PillTabs,
    StatusChip,
    AnnouncementSheet,
  ],
  templateUrl: './admin-announcements.html',
})
export class AdminAnnouncements implements OnInit {
  private readonly service = inject(AdminAnnouncementsService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notify = inject(NotificationService);

  protected readonly loading = signal(true);
  /** Falha ao carregar a lista (estado de erro da prancha). */
  protected readonly loadError = signal(false);
  /** Falha de uma ação da linha. */
  protected readonly actionError = signal<string | null>(null);
  protected readonly items = signal<AdminAnnouncement[]>([]);
  protected readonly filter = signal<Filter>('ALL');
  protected readonly sheet = signal<SheetState | null>(null);
  protected readonly confirm = signal<ConfirmState | null>(null);
  protected readonly confirmBusy = signal(false);

  private readonly today = todayIso();

  protected readonly tabs = computed<readonly PillTabOption<Filter>[]>(() => {
    const list = this.items();
    const n = (s: AnnouncementStatus) => list.filter((a) => a.status === s).length;
    return [
      { value: 'ALL', label: 'Todas', count: list.length, testId: 'tab-ALL' },
      { value: 'DRAFT', label: 'Rascunhos', count: n('DRAFT'), testId: 'tab-DRAFT' },
      { value: 'PUBLISHED', label: 'Publicadas', count: n('PUBLISHED'), testId: 'tab-PUBLISHED' },
      { value: 'EXPIRED', label: 'Encerradas', count: n('EXPIRED'), testId: 'tab-EXPIRED' },
    ];
  });

  protected readonly rows = computed<Row[]>(() => {
    const f = this.filter();
    return this.items()
      .filter((a) => f === 'ALL' || a.status === f)
      .map((a) => {
        const aud = audienceLabel(a.audiences ?? []);
        return {
          a,
          sub: titleSub(a),
          aud: aud.main,
          audSub: aud.sub,
          period: periodLabel(a),
          periodSub: periodSub(a, this.today),
          status: STATUS_LABEL[a.status],
          chip: statusChip(a.status),
        };
      });
  });

  protected readonly footer = computed(() => {
    const n = this.rows().length;
    return `${n} ${n === 1 ? 'novidade' : 'novidades'} · a mais recente primeiro`;
  });

  protected readonly confirmTitle = computed(() =>
    this.confirm()?.kind === 'delete' ? 'Excluir rascunho?' : 'Encerrar novidade agora?',
  );
  protected readonly confirmMessage = computed(() => {
    const c = this.confirm();
    if (!c) return '';
    return c.kind === 'delete'
      ? `"${c.a.title}" some da lista. Ninguém viu este rascunho.`
      : `"${c.a.title}" sai do ar agora para quem ainda não leu. Encerrada não volta; dá para duplicar como rascunho.`;
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.service.list().subscribe({
      next: (list) => {
        this.items.set(list ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set(true);
      },
    });
  }

  protected setFilter(f: Filter): void {
    this.filter.set(f);
  }

  protected openNew(): void {
    this.actionError.set(null);
    this.sheet.set({ announcement: null, duplicate: false });
  }

  protected open(a: AdminAnnouncement): void {
    this.actionError.set(null);
    this.sheet.set({ announcement: a, duplicate: false });
  }

  protected duplicate(a: AdminAnnouncement): void {
    this.actionError.set(null);
    this.sheet.set({ announcement: a, duplicate: true });
  }

  protected closeSheet(): void {
    this.sheet.set(null);
  }

  protected onSaved(a: AdminAnnouncement): void {
    this.notify.push(
      'success',
      a.status === 'PUBLISHED' ? 'Novidade publicada.' : 'Rascunho salvo.',
    );
    this.load();
  }

  /** Publicar direto do menu. Sem público, abre a folha (o botão Publicar explica). */
  protected publish(a: AdminAnnouncement): void {
    if (!a.audiences?.length) {
      this.open(a);
      return;
    }
    this.actionError.set(null);
    this.service.publish(a.id).subscribe({
      next: () => {
        this.notify.push('success', 'Novidade publicada.');
        this.load();
      },
      error: (err: unknown) =>
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível publicar a novidade.')),
    });
  }

  protected askUnpublish(a: AdminAnnouncement): void {
    this.confirm.set({ kind: 'unpublish', a });
  }

  protected askDelete(a: AdminAnnouncement): void {
    this.confirm.set({ kind: 'delete', a });
  }

  protected cancelConfirm(): void {
    if (this.confirmBusy()) return;
    this.confirm.set(null);
  }

  protected doConfirm(): void {
    const c = this.confirm();
    if (!c) return;
    this.confirmBusy.set(true);
    this.actionError.set(null);
    const call: Observable<unknown> =
      c.kind === 'delete' ? this.service.delete(c.a.id) : this.service.unpublish(c.a.id);
    call.subscribe({
      next: () => {
        this.confirmBusy.set(false);
        this.confirm.set(null);
        this.notify.push('success', c.kind === 'delete' ? 'Rascunho excluído.' : 'Novidade encerrada.');
        this.load();
      },
      error: (err: unknown) => {
        this.confirmBusy.set(false);
        this.confirm.set(null);
        this.actionError.set(
          this.apiErrors.messageFor(
            err,
            c.kind === 'delete' ? 'Não foi possível excluir o rascunho.' : 'Não foi possível encerrar a novidade.',
          ),
        );
      },
    });
  }
}
