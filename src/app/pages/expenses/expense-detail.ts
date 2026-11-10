import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { DetailActions } from '../../components/core/detail-actions/detail-actions';
import { PaintedCard } from '../../components/core/painted-card/painted-card';
import { StatusChip } from '../../components/core/status-chip/status-chip';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../services/api-error.service';
import { ExpensesService } from '../../services/expenses.service';
import { NotificationService } from '../../services/notification.service';
import { formatBRL } from '../../types/dashboard.types';
import { Expense } from '../../types/expense.types';
import { formatPlate } from '../../utils/display-format';
import { monthName, monthOf } from '../../utils/expenses-view';

/** Detalhe do gasto: valor em cartão laranja, depois o gasto, o veículo e o efeito no painel. */
@Component({
  selector: 'app-expense-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DefaultPageLayout,
    PaintedCard,
    StatusChip,
    DetailActions,
    ConfirmDialog,
    AlertBanner,
  ],
  templateUrl: './expense-detail.html',
})
export class ExpenseDetail implements OnInit {
  private readonly expensesService = inject(ExpensesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly expense = signal<Expense | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);

  protected readonly monthLabel = computed(() => {
    const e = this.expense();
    return e ? monthName(monthOf(e.expenseDate)) : '';
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Gasto não encontrado.');
      return;
    }
    this.loading.set(true);
    this.expensesService.getOne(id).subscribe({
      next: (e) => {
        this.expense.set(e);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Gasto não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  protected money(cents: number): string {
    return formatBRL(cents);
  }

  protected date(iso: string): string {
    return iso.split('-').reverse().join('/');
  }

  protected plate(e: Expense): string {
    return e.vehicleLabel ? formatPlate(e.vehicleLabel.split(' · ')[0]) : '';
  }

  protected model(e: Expense): string {
    return e.vehicleLabel ? e.vehicleLabel.split(' · ').slice(1).join(' · ') : '';
  }

  protected askDelete(): void {
    this.deleteOpen.set(true);
  }

  protected cancelDelete(): void {
    if (this.deleting()) return;
    this.deleteOpen.set(false);
  }

  protected confirmDelete(): void {
    const e = this.expense();
    if (!e) return;
    this.actionError.set(null);
    this.deleting.set(true);
    this.expensesService.remove(e.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.notifications.success('Gasto excluído.');
        this.router.navigate(['/gastos']);
      },
      error: (err: unknown) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível excluir o gasto.'));
      },
    });
  }
}
