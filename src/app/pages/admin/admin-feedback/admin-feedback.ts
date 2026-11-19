import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BackLink } from '../../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { PillTabs, type PillTabOption } from '../../../components/core/pill-tabs/pill-tabs';
import type { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import {
  DataList,
  DataListActions,
  DataListCell,
  type DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import { ListToolbar } from '../../../components/lists/list-toolbar/list-toolbar';
import { FeedbackService } from '../../../services/feedback.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { clearServerErrors } from '../../../services/api-error';
import {
  FeedbackStatus,
  FeedbackTaskResponse,
} from '../../../types/feedback.types';
import { whenAgo, whenDay, whenExact, whenLong } from '../audit/admin-when';

type StatusFilter = FeedbackStatus | 'ALL';

interface StatusOption {
  value: FeedbackStatus;
  label: string;
  tone: StatusChipTone;
}

/**
 * "Backlog" é o nome da coluna no roadmap público (`pages/roadmap`); a tela do admin fala a
 * mesma língua que o autor da sugestão vê. Cor só no chip, e só de situação.
 */
const STATUS_OPTIONS: StatusOption[] = [
  { value: 'BACKLOG', label: 'Backlog', tone: 'neutral' },
  { value: 'PLANNED', label: 'Planejado', tone: 'blue' },
  { value: 'IN_PROGRESS', label: 'Em desenvolvimento', tone: 'amber' },
  { value: 'DONE', label: 'Concluído', tone: 'green' },
  { value: 'REJECTED', label: 'Rejeitado', tone: 'red' },
];

/** Linhas por página na lista (a tela carrega até `LOAD_SIZE` de uma vez). */
const PAGE_SIZE = 25;
/** Teto pedido ao servidor; acima disso a tela avisa que a contagem é parcial. */
const LOAD_SIZE = 200;

/** Busca sem acento e sem caixa: "acao" acha "Ação". */
function fold(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

@Component({
  selector: 'app-admin-feedback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BackLink,
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    AlertBanner,
    BottomSheet,
    PillTabs,
    FormField,
    FieldControl,
    DataList,
    DataListCell,
    DataListActions,
    DataListMenuItem,
    ListToolbar,
  ],
  templateUrl: './admin-feedback.html',
})
export class AdminFeedback implements OnInit {
  private readonly feedbackService = inject(FeedbackService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly fb = inject(FormBuilder);

  protected readonly statusOptions = STATUS_OPTIONS;

  protected readonly filter = signal<StatusFilter>('ALL');
  protected readonly query = signal('');
  protected readonly page = signal(0);
  protected readonly rowPending = signal<Record<string, boolean>>({});

  protected readonly tasks = this.feedbackService.tasks;
  protected readonly loading = this.feedbackService.loading;
  /** Total que o servidor diz existir; maior que o carregado = contagens parciais. */
  protected readonly serverTotal = signal<number | null>(null);
  protected readonly partial = computed(() => {
    const t = this.serverTotal();
    return t !== null && t > this.tasks().length;
  });

  /** Relógio do "há 3 dias", renovado a cada carga. */
  protected readonly now = signal(Date.now());

  /** Falha ao CARREGAR a lista — banner no topo do card. */
  protected readonly loadError = signal<string | null>(null);
  /**
   * Falha de uma OPERAÇÃO (status / exclusão). Banner único no nível da tela;
   * a mensagem cita o título da sugestão para não perder o contexto da linha.
   */
  protected readonly actionError = signal<string | null>(null);

  protected readonly rejectingTask = signal<FeedbackTaskResponse | null>(null);
  protected readonly deletingTask = signal<FeedbackTaskResponse | null>(null);
  private readonly rejectSheet = viewChild(BottomSheet);

  protected readonly rejectForm = this.fb.group({
    adminNote: ['', [Validators.required, Validators.maxLength(500)]],
  });
  protected readonly rejectSubmitting = signal(false);
  protected readonly rejectError = signal<string | null>(null);
  protected readonly adminNoteMessages: Readonly<Record<string, string>> = {
    required: 'Informe o motivo da rejeição.',
  };

  protected readonly totalByStatus = computed(() => {
    const counts: Record<FeedbackStatus, number> = {
      BACKLOG: 0,
      PLANNED: 0,
      IN_PROGRESS: 0,
      DONE: 0,
      REJECTED: 0,
    };
    for (const t of this.tasks()) counts[t.status]++;
    return counts;
  });

  /** Uma fileira de pílulas com contagem: o toque filtra (antes os números não filtravam). */
  protected readonly tabs = computed<PillTabOption<StatusFilter>[]>(() => {
    const counts = this.totalByStatus();
    return [
      { value: 'ALL', label: 'Todas', count: this.tasks().length },
      ...STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label, count: counts[o.value] })),
    ];
  });

  protected readonly filteredTasks = computed(() => {
    const f = this.filter();
    const q = fold(this.query().trim());
    return this.tasks().filter((t) => {
      if (f !== 'ALL' && t.status !== f) return false;
      if (!q) return true;
      return [t.title, t.description, t.authorName, t.adminNote].some((v) => fold(v).includes(q));
    });
  });

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredTasks().length / PAGE_SIZE)),
  );

  /** Só a página atual vai ao DOM (tabela e cartões desenham as duas formas). */
  protected readonly pageRows = computed(() => {
    const page = Math.min(this.page(), this.totalPages() - 1);
    return this.filteredTasks().slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  });

  protected readonly currentPage = computed(() => Math.min(this.page(), this.totalPages() - 1));

  protected readonly anyFilter = computed(() => this.filter() !== 'ALL' || !!this.query().trim());

  protected readonly emptyText = computed(() =>
    this.anyFilter() ? 'Nenhuma sugestão com esses filtros.' : 'Nenhuma sugestão enviada ainda.',
  );

  protected readonly columns: DataListColumn<FeedbackTaskResponse>[] = [
    { key: 'title', header: 'Sugestão', primary: true, value: (t) => t.title },
    {
      key: 'status',
      header: 'Situação',
      kind: 'status',
      value: (t) => this.statusLabel(t.status),
      tone: (t) => this.statusTone(t.status),
    },
    { key: 'author', header: 'Autor', optional: true, value: (t) => t.authorName ?? 'Anônimo' },
    { key: 'votes', header: 'Votos', optional: true, kind: 'integer', end: true, value: (t) => t.fuelCount },
    { key: 'sent', header: 'Enviada', value: (t) => whenExact(t.createdDate) ?? '—' },
    { key: 'note', header: 'Nota', optional: true, value: (t) => t.adminNote ?? '—' },
  ];

  protected readonly rowId = (t: FeedbackTaskResponse): string => t.id;
  /** Each kebab is named after its row, so a screen reader can tell them apart. */
  protected readonly kebabLabel = (t: FeedbackTaskResponse): string => `Ações da sugestão ${t.title}`;

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    this.loadError.set(null);
    this.actionError.set(null);
    this.feedbackService.loadTasks({ sort: 'new', size: LOAD_SIZE }).subscribe({
      next: (res) => {
        this.serverTotal.set(res?.total ?? null);
        this.now.set(Date.now());
      },
      error: (err: HttpErrorResponse) => {
        this.loadError.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar as sugestões.'),
        );
      },
    });
  }

  protected onFilterChange(value: StatusFilter): void {
    this.filter.set(value);
    this.page.set(0);
  }

  protected onQueryChange(value: string): void {
    this.query.set(value);
    this.page.set(0);
  }

  protected clearFilters(): void {
    this.filter.set('ALL');
    this.query.set('');
    this.page.set(0);
  }

  protected goToPage(page: number): void {
    this.page.set(Math.max(0, Math.min(page, this.totalPages() - 1)));
  }

  protected statusTone(status: FeedbackStatus): StatusChipTone {
    return STATUS_OPTIONS.find((o) => o.value === status)?.tone ?? 'neutral';
  }

  protected statusLabel(status: FeedbackStatus): string {
    return STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
  }

  protected day(value: string | null): string {
    return whenDay(value);
  }

  protected ago(value: string | null): string | null {
    return whenAgo(value, this.now());
  }

  protected long(value: string | null): string | null {
    return whenLong(value);
  }

  protected isRowPending(id: string): boolean {
    return !!this.rowPending()[id];
  }

  /**
   * Transições de status oferecidas no menu de ações — o status atual é omitido.
   * "Rejeitado" vira "Rejeitar…" porque abre a folha que pede a nota.
   */
  protected statusActions(
    current: FeedbackStatus,
  ): ReadonlyArray<{ value: FeedbackStatus; label: string }> {
    return STATUS_OPTIONS.filter((o) => o.value !== current).map((o) => ({
      value: o.value,
      label: o.value === 'REJECTED' ? 'Rejeitar…' : `Mover para ${o.label}`,
    }));
  }

  protected onStatusChange(task: FeedbackTaskResponse, next: FeedbackStatus): void {
    if (task.status === next) return;
    this.actionError.set(null);
    if (next === 'REJECTED') {
      this.openRejectDialog(task);
      return;
    }
    this.applyStatus(
      task.id,
      next,
      null,
      () => this.notifications.success('Status atualizado.'),
      (err) => {
        this.actionError.set(
          this.apiErrors.messageFor(
            err,
            `Não foi possível atualizar o status de «${task.title}».`,
          ),
        );
      },
    );
  }

  protected openRejectDialog(task: FeedbackTaskResponse): void {
    this.rejectForm.reset({ adminNote: task.adminNote ?? '' });
    clearServerErrors(this.rejectForm);
    this.rejectError.set(null);
    this.rejectingTask.set(task);
  }

  /** Fecha a folha com a animação de saída; o `closed` dela zera o estado. */
  protected dismissReject(force = false): void {
    const ref = this.rejectSheet();
    if (ref) ref.requestClose(force);
    else this.closeRejectDialog();
  }

  protected closeRejectDialog(): void {
    this.rejectingTask.set(null);
    this.rejectError.set(null);
  }

  protected submitReject(): void {
    const task = this.rejectingTask();
    if (!task) return;
    if (this.rejectForm.invalid) {
      this.rejectForm.markAllAsTouched();
      return;
    }
    this.rejectSubmitting.set(true);
    this.rejectError.set(null);
    clearServerErrors(this.rejectForm);
    const note = this.rejectForm.controls.adminNote.value?.trim() ?? '';
    this.applyStatus(task.id, 'REJECTED', note, () => {
      this.rejectSubmitting.set(false);
      this.dismissReject(true);
      this.notifications.success('Sugestão rejeitada.');
    }, (err) => {
      this.rejectSubmitting.set(false);
      const { formMessage } = this.apiErrors.handleForm(
        err,
        this.rejectForm,
        'Não foi possível rejeitar a sugestão.',
      );
      this.rejectError.set(formMessage);
    });
  }

  protected openDeleteDialog(task: FeedbackTaskResponse): void {
    this.deletingTask.set(task);
  }

  protected closeDeleteDialog(): void {
    this.deletingTask.set(null);
  }

  protected confirmDelete(): void {
    const task = this.deletingTask();
    if (!task) return;
    this.setPending(task.id, true);
    this.actionError.set(null);
    this.feedbackService.adminDelete(task.id).subscribe({
      next: () => {
        this.setPending(task.id, false);
        this.closeDeleteDialog();
        this.notifications.success('Sugestão excluída.');
      },
      error: (err: HttpErrorResponse) => {
        this.setPending(task.id, false);
        this.closeDeleteDialog();
        this.actionError.set(
          this.apiErrors.messageFor(err, `Não foi possível excluir «${task.title}».`),
        );
      },
    });
  }

  private applyStatus(
    id: string,
    status: FeedbackStatus,
    adminNote: string | null,
    onDone?: () => void,
    onError?: (err: HttpErrorResponse) => void,
  ): void {
    this.setPending(id, true);
    this.feedbackService.updateStatus(id, status, adminNote).subscribe({
      next: () => {
        this.setPending(id, false);
        onDone?.();
      },
      error: (err: HttpErrorResponse) => {
        this.setPending(id, false);
        onError?.(err);
      },
    });
  }

  private setPending(id: string, value: boolean): void {
    this.rowPending.update((state) => ({ ...state, [id]: value }));
  }
}
