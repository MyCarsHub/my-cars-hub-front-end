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
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { FeedbackService } from '../../../services/feedback.service';
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
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
  ],
  templateUrl: './admin-feedback.html',
})
export class AdminFeedback implements OnInit {
  private readonly feedbackService = inject(FeedbackService);
  private readonly fb = inject(FormBuilder);

  protected readonly filterOptions = FILTER_OPTIONS;
  protected readonly statusOptions = STATUS_OPTIONS;

  protected readonly filter = signal<StatusFilter>('ALL');
  protected readonly rowPending = signal<Record<string, boolean>>({});
  protected readonly rowError = signal<Record<string, string>>({});

  protected readonly tasks = this.feedbackService.tasks;
  protected readonly loading = this.feedbackService.loading;
  protected readonly error = this.feedbackService.error;

  protected readonly rejectingTask = signal<FeedbackTaskResponse | null>(null);
  protected readonly deletingTask = signal<FeedbackTaskResponse | null>(null);

  protected readonly rejectForm = this.fb.group({
    adminNote: ['', [Validators.required, Validators.maxLength(500)]],
  });
  protected readonly rejectSubmitting = signal(false);
  protected readonly rejectError = signal<string | null>(null);

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
    this.feedbackService
      .loadTasks({ sort: 'new', size: 200 })
      .subscribe({ error: () => {} });
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

  protected getRowError(id: string): string | null {
    return this.rowError()[id] ?? null;
  }

  protected dismissRowError(id: string): void {
    this.rowError.update((state) => {
      const next = { ...state };
      delete next[id];
      return next;
    });
  }

  protected onStatusChange(task: FeedbackTaskResponse, next: FeedbackStatus): void {
    if (task.status === next) return;
    this.dismissRowError(task.id);
    if (next === 'REJECTED') {
      this.openRejectDialog(task);
      return;
    }
    this.applyStatus(task.id, next, null, undefined, (err) => {
      this.setRowError(
        task.id,
        this.extractError(err, 'Não foi possível atualizar o status.'),
      );
    });
  }

  protected openRejectDialog(task: FeedbackTaskResponse): void {
    this.rejectForm.reset({ adminNote: task.adminNote ?? '' });
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
    const note = this.rejectForm.controls.adminNote.value?.trim() ?? '';
    this.applyStatus(task.id, 'REJECTED', note, () => {
      this.rejectSubmitting.set(false);
      this.closeRejectDialog();
    }, (err) => {
      this.rejectSubmitting.set(false);
      this.rejectError.set(this.extractError(err, 'Não foi possível rejeitar.'));
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
    this.feedbackService.adminDelete(task.id).subscribe({
      next: () => {
        this.setPending(task.id, false);
        this.closeDeleteDialog();
      },
      error: () => {
        this.setPending(task.id, false);
        this.closeDeleteDialog();
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

  private setRowError(id: string, message: string): void {
    this.rowError.update((state) => ({ ...state, [id]: message }));
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
