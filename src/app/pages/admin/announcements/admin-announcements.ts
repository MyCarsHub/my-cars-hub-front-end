import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BackLink } from '../../../components/core/back-link/back-link';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { PageCard } from '../../../components/core/page-card/page-card';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import type { FilterChipOption } from '../../../components/filter-chip-group/filter-chip-group';
import {
  DataList,
  DataListActions,
  DataListCell,
  type DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import { ListToolbar } from '../../../components/lists/list-toolbar/list-toolbar';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import { AdminAnnouncement, AnnouncementStatus } from '../../../types/announcement.types';
import { AdminAnnouncementsService } from './admin-announcements.service';
import {
  STATUS_LABEL,
  StatusChipStyle,
  audienceLabel,
  periodExact,
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
  /** "Publicada em 12/11/2026 às 10:00", no balão do período. */
  periodExact: string | null;
  status: string;
  chip: StatusChipStyle;
}

const COLUMNS: readonly DataListColumn<Row>[] = [
  { key: 'title', header: 'Novidade', primary: true, value: (r) => r.a.title },
  { key: 'audience', header: 'Público', optional: true, value: (r) => r.aud },
  { key: 'period', header: 'Período', value: (r) => `${r.period} (${r.periodSub})` },
  { key: 'status', header: 'Situação', kind: 'status', value: (r) => r.status },
  { key: 'reads', header: 'Leituras', optional: true, kind: 'integer', end: true, value: (r) => r.a.readCount ?? 0 },
];

/** Busca sem acento e sem caixa. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
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
 *
 * Padrão da plataforma (auditoria 18/11, D1): `app-page-card "Lista"` + `app-list-toolbar`
 * (busca e pílulas de situação) + `app-data-list` (tabela a partir de 1024px, cartões abaixo,
 * sem linhas, kebab por linha). A lista inteira vem de uma vez: filtrar aqui é exato.
 */
@Component({
  selector: 'app-admin-announcements',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    DefaultPageLayout,
    AlertBanner,
    BackLink,
    ConfirmDialog,
    PageCard,
    StatusChip,
    DataList,
    DataListActions,
    DataListCell,
    DataListMenuItem,
    ListToolbar,
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

  protected readonly columns = COLUMNS;
  protected readonly rowId = (row: Row): string => row.a.id;
  /** Each kebab is named after its row, so a screen reader can tell them apart. */
  protected readonly kebabLabel = (row: Row): string => `Ações da novidade ${row.a.title}`;
  protected readonly search = signal('');
  /** Troca a cada mudança de situação: a lista é refeita e a cascata de entrada recomeça. */
  private readonly epoch = signal(0);
  protected readonly epochs = computed(() => [{ id: this.epoch() }]);

  /** Lista já buscada pelo texto (título, texto e itens); a situação é aplicada depois. */
  private readonly searched = computed(() => {
    const t = normalize(this.search());
    if (!t) return this.items();
    return this.items().filter((a) =>
      [a.title, a.body, ...(a.items ?? [])].some((text) => normalize(text ?? '').includes(t)),
    );
  });

  /** Pílulas de situação; cada uma conta o que aparece ao escolhê-la (busca já aplicada). */
  protected readonly statusOptions = computed<readonly FilterChipOption<Filter>[]>(() => {
    const list = this.searched();
    const n = (s: AnnouncementStatus) => list.filter((a) => a.status === s).length;
    return [
      { value: 'ALL', label: 'Todas', count: list.length },
      { value: 'DRAFT', label: 'Rascunhos', count: n('DRAFT') },
      { value: 'PUBLISHED', label: 'Publicadas', count: n('PUBLISHED') },
      { value: 'EXPIRED', label: 'Encerradas', count: n('EXPIRED') },
    ];
  });

  protected readonly anyFilter = computed(
    () => this.search().trim() !== '' || this.filter() !== 'ALL',
  );

  protected readonly rows = computed<Row[]>(() => {
    const f = this.filter();
    return this.searched()
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
          periodExact: periodExact(a),
          status: STATUS_LABEL[a.status],
          chip: statusChip(a.status),
        };
      });
  });

  protected readonly confirmTitle = computed(() => {
    const c = this.confirm();
    if (c?.kind !== 'delete') return 'Encerrar novidade agora?';
    return c.a.status === 'DRAFT' ? 'Excluir rascunho?' : 'Excluir a novidade?';
  });
  protected readonly confirmMessage = computed(() => {
    const c = this.confirm();
    if (!c) return '';
    if (c.kind === 'unpublish') {
      return `"${c.a.title}" sai do ar agora para quem ainda não leu. Encerrada não volta; dá para duplicar como rascunho.`;
    }
    switch (c.a.status) {
      case 'DRAFT':
        return `"${c.a.title}" some da lista. Ninguém viu este rascunho. Esta ação não pode ser desfeita.`;
      case 'PUBLISHED':
        // Publicada inclui a agendada (início no futuro): as duas já estão no feed do público.
        return `"${c.a.title}" some do feed de todos os usuários agora, inclusive de quem ainda não leu. Esta ação não pode ser desfeita.`;
      default:
        return `"${c.a.title}" some da lista. Ela já saiu do ar. Esta ação não pode ser desfeita.`;
    }
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
    if (f === this.filter()) return;
    this.filter.set(f);
    this.epoch.update((n) => n + 1);
  }

  protected setQuery(q: string): void {
    this.search.set(q);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.setFilter('ALL');
  }

  protected openNew(): void {
    this.actionError.set(null);
    this.sheet.set({ announcement: null, duplicate: false });
  }

  protected open(a: AdminAnnouncement): void {
    this.actionError.set(null);
    this.sheet.set({ announcement: a, duplicate: false });
  }

  /** Toque/clique na linha (fora do título e do menu) abre a mesma folha do título. */
  protected openRow(row: Row): void {
    this.open(row.a);
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
    if (!c || this.confirmBusy()) return;
    this.confirmBusy.set(true);
    this.actionError.set(null);
    if (c.kind === 'delete') {
      this.runDelete(c.a);
      return;
    }
    this.service.unpublish(c.a.id).subscribe({
      next: () => {
        this.confirmBusy.set(false);
        this.confirm.set(null);
        this.notify.push('success', 'Novidade encerrada.');
        this.load();
      },
      error: (err: unknown) => {
        this.confirmBusy.set(false);
        this.confirm.set(null);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível encerrar a novidade.'));
      },
    });
  }

  /**
   * Excluir em qualquer situação. Sucesso tira a linha da lista na hora (sem recarregar) e fecha
   * a folha se ela estava aberta nessa novidade. 404 = alguém já excluiu: mesmo efeito, aviso
   * neutro. Outra falha (ex.: 409 de servidor antigo para publicada) fica no toast e a linha fica.
   */
  private runDelete(a: AdminAnnouncement): void {
    this.service.delete(a.id).subscribe({
      next: () => {
        this.dropFromList(a.id);
        this.notify.push('success', 'Novidade excluída.');
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.apiErrors.messageFor(err); // reivindica o erro: o toast genérico não sai
          this.dropFromList(a.id);
          this.notify.push('info', 'Esta novidade já tinha sido excluída.');
          return;
        }
        this.confirmBusy.set(false);
        this.confirm.set(null);
        this.notify.push('error', this.apiErrors.messageFor(err, 'Não foi possível excluir a novidade.'));
      },
    });
  }

  private dropFromList(id: string): void {
    this.confirmBusy.set(false);
    this.confirm.set(null);
    this.items.update((list) => list.filter((x) => x.id !== id));
    if (this.sheet()?.announcement?.id === id) this.sheet.set(null);
  }
}
