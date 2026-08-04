import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { DetailDialog } from '../../components/core/detail-dialog/detail-dialog';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '../../components/segmented-toggle/segmented-toggle';
import { FeedbackService } from '../../services/feedback.service';
import { SessionService } from '../../services/session.service';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { clearServerErrors } from '../../services/api-error';
import {
  FeedbackSort,
  FeedbackStatus,
  FeedbackTaskResponse,
} from '../../types/feedback.types';

interface Column {
  key: FeedbackStatus;
  label: string;
}

const BOARD_COLUMNS: Column[] = [
  { key: 'BACKLOG', label: 'Backlog' },
  { key: 'PLANNED', label: 'Planejado' },
  { key: 'IN_PROGRESS', label: 'Em Desenvolvimento' },
  { key: 'DONE', label: 'Concluído' },
];

const ADMIN_STATUS_OPTIONS: Array<{ value: FeedbackStatus; label: string }> = [
  { value: 'BACKLOG', label: 'Backlog' },
  { value: 'PLANNED', label: 'Planejado' },
  { value: 'IN_PROGRESS', label: 'Em Desenvolvimento' },
  { value: 'DONE', label: 'Concluído' },
  { value: 'REJECTED', label: 'Rejeitado' },
];

/**
 * Limite da descrição. Uma constante só, espelhada no validator, no `maxlength`
 * do textarea e no contador visível — antes o 2000 estava escrito em três lugares.
 */
const DESCRIPTION_MAX_LENGTH = 2000;

const STATUS_LABELS: Readonly<Record<FeedbackStatus, string>> = {
  BACKLOG: 'Backlog',
  PLANNED: 'Planejado',
  IN_PROGRESS: 'Em Desenvolvimento',
  DONE: 'Concluído',
  REJECTED: 'Rejeitado',
};

/**
 * Acento da opção marcada no seletor de ordenação: pill branco sobre o trilho
 * neutral-100. Fundo e sombra vão por `style` porque o `SegmentedToggle` sempre
 * escreve `background`/`box-shadow` inline — classe `bg-white`/`shadow-sm`
 * perderia para o inline. Valor da sombra = `--shadow-sm` do Tailwind v4.
 */
const SORT_ACTIVE_BACKGROUND = '#ffffff';
const SORT_ACTIVE_SHADOW = '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)';
/** Texto escuro do pill claro — substitui o `text-white` default do toggle. */
const SORT_ACTIVE_CLASS = 'text-neutral-900';

const SORT_OPTIONS: readonly SegmentedToggleOption<FeedbackSort>[] = [
  {
    value: 'fuel',
    label: 'Mais Combustível',
    activeBackground: SORT_ACTIVE_BACKGROUND,
    activeShadow: SORT_ACTIVE_SHADOW,
  },
  {
    value: 'new',
    label: 'Mais Novas',
    activeBackground: SORT_ACTIVE_BACKGROUND,
    activeShadow: SORT_ACTIVE_SHADOW,
  },
];

@Component({
  selector: 'app-roadmap',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    DetailDialog,
    AlertBanner,
    FormField,
    FieldControl,
    SegmentedToggle,
  ],
  templateUrl: './roadmap.html',
  styleUrl: './roadmap.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Roadmap implements OnInit {
  private readonly feedbackService = inject(FeedbackService);
  private readonly sessionService = inject(SessionService);
  private readonly fb = inject(FormBuilder);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  protected readonly columns = BOARD_COLUMNS;
  protected readonly statusOptions = ADMIN_STATUS_OPTIONS;
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly sortActiveClass = SORT_ACTIVE_CLASS;
  protected readonly skeletons = [0, 1, 2];

  protected readonly tasks = this.feedbackService.tasks;
  protected readonly loading = this.feedbackService.loading;

  /**
   * Screen-level banner. Actions (delete / vote / status) claim their own error here so
   * nothing is swallowed and the interceptor safety net never doubles the message.
   */
  private readonly actionError = signal<string | null>(null);
  protected readonly error = computed(() => this.actionError() ?? this.feedbackService.error());

  protected readonly sort = signal<FeedbackSort>('fuel');
  protected readonly rejectedOpen = signal(false);
  protected readonly fuelPending = signal<Record<string, boolean>>({});

  protected readonly showTaskDialog = signal(false);
  protected readonly editingTaskId = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly showDeleteDialog = signal(false);
  protected readonly pendingDeleteId = signal<string | null>(null);
  protected readonly pendingDeleteIsAdmin = signal(false);

  protected readonly showRejectDialog = signal(false);
  protected readonly rejectTaskId = signal<string | null>(null);
  protected readonly rejectNote = signal('');

  /**
   * Sugestão aberta no diálogo de leitura. O card corta o texto com `line-clamp`;
   * este é o caminho para ver a mensagem inteira.
   */
  protected readonly detailTask = signal<FeedbackTaskResponse | null>(null);
  protected readonly detailOpen = computed(() => this.detailTask() !== null);
  protected readonly detailTitle = computed(() => this.detailTask()?.title ?? '');
  protected readonly detailSubtitle = computed(() => {
    const task = this.detailTask();
    return task ? STATUS_LABELS[task.status] : '';
  });

  protected readonly currentUserId = computed(() =>
    this.sessionService.getUserId(),
  );
  protected readonly systemRole = computed(() =>
    this.sessionService.getSystemRole(),
  );
  protected readonly isAdmin = computed(
    () => this.systemRole() === 'PLATFORM_ADMIN',
  );

  protected readonly backlogTasks = computed(() =>
    this.filterByStatus('BACKLOG'),
  );
  protected readonly plannedTasks = computed(() =>
    this.filterByStatus('PLANNED'),
  );
  protected readonly inProgressTasks = computed(() =>
    this.filterByStatus('IN_PROGRESS'),
  );
  protected readonly doneTasks = computed(() => this.filterByStatus('DONE'));
  protected readonly rejectedTasks = computed(() =>
    this.filterByStatus('REJECTED'),
  );

  protected readonly taskForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', [Validators.maxLength(DESCRIPTION_MAX_LENGTH)]],
  });

  protected readonly descriptionMaxLength = DESCRIPTION_MAX_LENGTH;

  private readonly taskFormValue = toSignal(this.taskForm.valueChanges, {
    initialValue: this.taskForm.getRawValue(),
  });

  /** Alimenta o contador `N / 2000` do textarea (mesmo padrão de `pages/support`). */
  protected readonly descriptionLength = computed(
    () => (this.taskFormValue()?.description ?? '').length,
  );

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly titleMessages: Readonly<Record<string, string>> = {
    required: 'Informe um título.',
    maxlength: 'Use no máximo 120 caracteres.',
  };
  protected readonly descriptionMessages: Readonly<Record<string, string>> = {
    maxlength: `Use no máximo ${DESCRIPTION_MAX_LENGTH} caracteres.`,
  };

  ngOnInit(): void {
    this.reload();
  }

  private reload(): void {
    this.actionError.set(null);
    this.feedbackService.loadTasks({ sort: this.sort(), size: 100 }).subscribe({
      error: (err: HttpErrorResponse) =>
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar as sugestões. Tente novamente.'),
        ),
    });
  }

  private filterByStatus(status: FeedbackStatus): FeedbackTaskResponse[] {
    const list = this.tasks().filter((t) => t.status === status);
    const sorted = [...list];
    if (this.sort() === 'fuel') {
      sorted.sort((a, b) => b.fuelCount - a.fuelCount);
    } else {
      sorted.sort(
        (a, b) =>
          new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime(),
      );
    }
    return sorted;
  }

  protected columnTasksFor(status: FeedbackStatus): FeedbackTaskResponse[] {
    switch (status) {
      case 'BACKLOG':
        return this.backlogTasks();
      case 'PLANNED':
        return this.plannedTasks();
      case 'IN_PROGRESS':
        return this.inProgressTasks();
      case 'DONE':
        return this.doneTasks();
      case 'REJECTED':
        return this.rejectedTasks();
    }
  }

  protected setSort(sort: FeedbackSort): void {
    if (this.sort() === sort) return;
    this.sort.set(sort);
    this.reload();
  }

  protected toggleRejected(): void {
    this.rejectedOpen.update((v) => !v);
  }

  protected isAuthor(task: FeedbackTaskResponse): boolean {
    const uid = this.currentUserId();
    return !!uid && uid === task.authorId;
  }

  protected canEdit(task: FeedbackTaskResponse): boolean {
    return this.isAuthor(task) && task.status === 'BACKLOG';
  }

  protected canDelete(task: FeedbackTaskResponse): boolean {
    return (
      this.isAuthor(task) &&
      task.status === 'BACKLOG' &&
      task.fuelCount <= 1
    );
  }

  protected isFuelPending(id: string): boolean {
    return !!this.fuelPending()[id];
  }

  private setFuelPending(id: string, pending: boolean): void {
    this.fuelPending.update((map) => {
      const next = { ...map };
      if (pending) next[id] = true;
      else delete next[id];
      return next;
    });
  }

  protected toggleFuel(task: FeedbackTaskResponse): void {
    if (this.isFuelPending(task.id)) return;
    this.setFuelPending(task.id, true);
    this.actionError.set(null);
    const done = () => this.setFuelPending(task.id, false);
    const fail = (err: HttpErrorResponse) => {
      done();
      this.actionError.set(
        this.apiErrors.messageFor(err, 'Não foi possível registrar seu voto. Tente novamente.'),
      );
    };
    if (task.hasVoted) {
      this.feedbackService.unfuel(task.id).subscribe({ next: done, error: fail });
    } else {
      this.feedbackService.fuel(task.id).subscribe({ next: done, error: fail });
    }
  }

  protected openDetail(task: FeedbackTaskResponse): void {
    this.detailTask.set(task);
  }

  protected closeDetail(): void {
    this.detailTask.set(null);
  }

  protected statusLabel(status: FeedbackStatus): string {
    return STATUS_LABELS[status];
  }

  protected openCreate(): void {
    this.editingTaskId.set(null);
    this.taskForm.reset({ title: '', description: '' });
    this.formError.set(null);
    this.showTaskDialog.set(true);
  }

  protected openEdit(task: FeedbackTaskResponse): void {
    this.editingTaskId.set(task.id);
    this.taskForm.reset({
      title: task.title,
      description: task.description ?? '',
    });
    this.formError.set(null);
    this.showTaskDialog.set(true);
  }

  protected closeTaskDialog(): void {
    if (this.submitting()) return;
    this.showTaskDialog.set(false);
    this.editingTaskId.set(null);
    this.formError.set(null);
  }

  protected submitTask(): void {
    if (this.submitting()) return;
    if (this.taskForm.invalid) {
      this.taskForm.markAllAsTouched();
      return;
    }
    const raw = this.taskForm.getRawValue();
    const title = raw.title.trim();
    const description = raw.description.trim();
    if (!title) return;

    this.submitting.set(true);
    this.formError.set(null);
    clearServerErrors(this.taskForm);

    const editingId = this.editingTaskId();
    const payload = {
      title,
      description: description.length > 0 ? description : null,
    };

    const onSuccess = () => {
      this.submitting.set(false);
      this.showTaskDialog.set(false);
      this.editingTaskId.set(null);
      this.notifications.success(
        editingId ? 'Sugestão atualizada.' : 'Sugestão publicada.',
      );
    };
    /**
     * One message, one place: backend `fieldErrors` land under the field and only what is
     * left over goes to the dialog banner. Previously the banner showed a generic text
     * while the interceptor toast showed the real one.
     */
    const onError = (err: HttpErrorResponse) => {
      this.submitting.set(false);
      const { formMessage } = this.apiErrors.handleForm(
        err,
        this.taskForm,
        'Não foi possível salvar a sugestão. Tente novamente.',
      );
      this.formError.set(formMessage);
    };

    if (editingId) {
      this.feedbackService
        .update(editingId, payload)
        .subscribe({ next: onSuccess, error: onError });
    } else {
      this.feedbackService
        .create(payload)
        .subscribe({ next: onSuccess, error: onError });
    }
  }

  protected askDelete(task: FeedbackTaskResponse, admin: boolean): void {
    this.pendingDeleteId.set(task.id);
    this.pendingDeleteIsAdmin.set(admin);
    this.showDeleteDialog.set(true);
  }

  protected onDeleteConfirmed(): void {
    const id = this.pendingDeleteId();
    if (!id) {
      this.showDeleteDialog.set(false);
      return;
    }
    const isAdmin = this.pendingDeleteIsAdmin();
    this.actionError.set(null);
    const request$ = isAdmin
      ? this.feedbackService.adminDelete(id)
      : this.feedbackService.remove(id);
    request$.subscribe({
      next: () => {
        this.showDeleteDialog.set(false);
        this.pendingDeleteId.set(null);
        this.notifications.success('Sugestão excluída.');
      },
      error: (err: HttpErrorResponse) => {
        this.showDeleteDialog.set(false);
        this.pendingDeleteId.set(null);
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível excluir a sugestão.'),
        );
      },
    });
  }

  protected onDeleteDismissed(): void {
    this.showDeleteDialog.set(false);
    this.pendingDeleteId.set(null);
  }

  protected onAdminStatusChange(task: FeedbackTaskResponse, event: Event): void {
    const value = (event.target as HTMLSelectElement).value as FeedbackStatus;
    if (!value || value === task.status) return;
    if (value === 'REJECTED') {
      this.rejectTaskId.set(task.id);
      this.rejectNote.set('');
      this.showRejectDialog.set(true);
      (event.target as HTMLSelectElement).value = task.status;
      return;
    }
    this.actionError.set(null);
    this.feedbackService.updateStatus(task.id, value).subscribe({
      next: () => this.notifications.success('Status atualizado.'),
      error: (err: HttpErrorResponse) => {
        (event.target as HTMLSelectElement).value = task.status;
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível atualizar o status.'),
        );
      },
    });
  }

  protected onRejectNoteInput(event: Event): void {
    this.rejectNote.set((event.target as HTMLTextAreaElement).value);
  }

  protected confirmReject(): void {
    const id = this.rejectTaskId();
    if (!id) {
      this.showRejectDialog.set(false);
      return;
    }
    const note = this.rejectNote().trim();
    this.actionError.set(null);
    this.feedbackService
      .updateStatus(id, 'REJECTED', note.length > 0 ? note : null)
      .subscribe({
        next: () => {
          this.showRejectDialog.set(false);
          this.rejectTaskId.set(null);
          this.rejectNote.set('');
          this.notifications.success('Sugestão rejeitada.');
        },
        error: (err: HttpErrorResponse) => {
          this.showRejectDialog.set(false);
          this.rejectTaskId.set(null);
          this.rejectNote.set('');
          this.actionError.set(
            this.apiErrors.messageFor(err, 'Não foi possível rejeitar a sugestão.'),
          );
        },
      });
  }

  protected cancelReject(): void {
    this.showRejectDialog.set(false);
    this.rejectTaskId.set(null);
    this.rejectNote.set('');
  }

  protected trackByColumnKey(_i: number, col: Column): string {
    return col.key;
  }

  protected trackByTaskId(_i: number, task: FeedbackTaskResponse): string {
    return task.id;
  }

  protected trackByIndex(i: number): number {
    return i;
  }

  protected trackByStatusValue(
    _i: number,
    option: { value: FeedbackStatus },
  ): string {
    return option.value;
  }

  protected authorInitial(task: FeedbackTaskResponse): string {
    const name = task.authorName ?? '';
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  protected dialogTitle(): string {
    return this.editingTaskId() ? 'Editar sugestão' : 'Nova sugestão';
  }

  protected submitLabel(): string {
    if (this.submitting()) return 'Salvando...';
    return this.editingTaskId() ? 'Salvar alterações' : 'Publicar sugestão';
  }
}
