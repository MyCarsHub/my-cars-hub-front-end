import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import { FeedbackService } from '../../../services/feedback.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { clearServerErrors } from '../../../services/api-error';
import {
  FeedbackStatus,
  FeedbackTaskResponse,
} from '../../../types/feedback.types';

type StatusFilter = FeedbackStatus | 'ALL';

interface StatusOption {
  value: FeedbackStatus;
  label: string;
  chip: string;
}

const STATUS_OPTIONS: StatusOption[] = [
  { value: 'BACKLOG', label: 'Backlog', chip: 'bg-gray-100 text-gray-700' },
  { value: 'PLANNED', label: 'Planejado', chip: 'bg-blue-100 text-blue-700' },
  {
    value: 'IN_PROGRESS',
    label: 'Em Desenvolvimento',
    chip: 'bg-amber-100 text-amber-700',
  },
  { value: 'DONE', label: 'Concluído', chip: 'bg-emerald-100 text-emerald-700' },
  { value: 'REJECTED', label: 'Rejeitado', chip: 'bg-red-100 text-red-700' },
];

const FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'Todas' },
  ...STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
];

@Component({
  selector: 'app-admin-feedback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    AlertBanner,
    FormField,
    FieldControl,
  ],
  templateUrl: './admin-feedback.html',
})
export class AdminFeedback implements OnInit {
  private readonly feedbackService = inject(FeedbackService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly fb = inject(FormBuilder);

  protected readonly filterOptions = FILTER_OPTIONS;
  protected readonly statusOptions = STATUS_OPTIONS;

  protected readonly filter = signal<StatusFilter>('ALL');
  protected readonly rowPending = signal<Record<string, boolean>>({});

  protected readonly tasks = this.feedbackService.tasks;
  protected readonly loading = this.feedbackService.loading;

  /** Falha ao CARREGAR a lista — banner no topo do card. */
  protected readonly loadError = signal<string | null>(null);
  /**
   * Falha de uma OPERAÇÃO (status / exclusão). Banner único no nível da tela;
   * a mensagem cita o título da sugestão para não perder o contexto da linha.
   */
  protected readonly actionError = signal<string | null>(null);

  protected readonly rejectingTask = signal<FeedbackTaskResponse | null>(null);
  protected readonly deletingTask = signal<FeedbackTaskResponse | null>(null);

  protected readonly rejectForm = this.fb.group({
    adminNote: ['', [Validators.required, Validators.maxLength(500)]],
  });
  protected readonly rejectSubmitting = signal(false);
  protected readonly rejectError = signal<string | null>(null);
  protected readonly adminNoteMessages: Readonly<Record<string, string>> = {
    required: 'Informe o motivo da rejeição.',
  };

  protected readonly filteredTasks = computed(() => {
    const f = this.filter();
    const all = this.tasks();
    if (f === 'ALL') return all;
    return all.filter((t) => t.status === f);
  });

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

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    this.loadError.set(null);
    this.actionError.set(null);
    this.feedbackService.loadTasks({ sort: 'new', size: 200 }).subscribe({
      error: (err: HttpErrorResponse) => {
        this.loadError.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar as sugestões.'),
        );
      },
    });
  }

  protected onFilterChange(value: StatusFilter): void {
    this.filter.set(value);
  }

  protected chipClass(status: FeedbackStatus): string {
    return (
      STATUS_OPTIONS.find((o) => o.value === status)?.chip ??
      'bg-gray-100 text-gray-700'
    );
  }

  protected statusLabel(status: FeedbackStatus): string {
    return STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
  }

  protected isRowPending(id: string): boolean {
    return !!this.rowPending()[id];
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
      this.closeRejectDialog();
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
