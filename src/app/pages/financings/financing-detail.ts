import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { MarkPaidDialog } from '../../components/core/mark-paid-dialog/mark-paid-dialog';
import { NotificationService } from '../../services/notification.service';
import { VehiclesService } from '../../services/vehicles.service';
import {
  FinancingDetail as FinancingDetailDto,
  FinancingInstallment,
} from '../../types/vehicle.types';

@Component({
  selector: 'app-financing-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DefaultPageLayout, PageCard, ConfirmDialog, MarkPaidDialog],
  templateUrl: './financing-detail.html',
})
export class FinancingDetail implements OnInit {
  private readonly vehiclesService = inject(VehiclesService);
  private readonly notifications = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);

  protected readonly financing = signal<FinancingDetailDto | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  /**
   * Id da parcela em processo de pagamento. Usado só pra desabilitar o
   * botão da linha correspondente e evitar double-submit — o payload de
   * marcar como paga é otimizado (sem confirmação extra).
   */
  protected readonly paying = signal<string | null>(null);

  /** Parcelas reais vindas do backend (V24). Vazio = sem cronograma. */
  protected readonly installments = computed<FinancingInstallment[]>(
    () => this.financing()?.schedule ?? [],
  );

  protected readonly hasSchedule = computed<boolean>(() => this.installments().length > 0);

  protected readonly paidCents = computed<number>(() =>
    this.installments().reduce((acc, r) => acc + (r.paidAmountCents ?? 0), 0),
  );

  protected readonly totalDueCents = computed<number>(() => {
    const rows = this.installments();
    if (rows.length > 0) {
      return rows.reduce((acc, r) => acc + r.amountCents, 0);
    }
    const f = this.financing();
    if (!f) return 0;
    if (f.installmentAmount != null && f.installments != null) {
      return f.installmentAmount * f.installments;
    }
    return f.totalFinanced ?? f.purchasePrice ?? 0;
  });

  protected readonly remainingCents = computed<number>(() =>
    Math.max(0, this.totalDueCents() - this.paidCents()),
  );

  protected readonly progressPct = computed<number>(() => {
    const total = this.totalDueCents();
    if (total <= 0) return 0;
    return Math.min(100, Math.round((this.paidCents() / total) * 100));
  });

  protected readonly paidCount = computed<number>(
    () => this.installments().filter((r) => r.status === 'PAID').length,
  );

  protected readonly overdueCount = computed<number>(
    () => this.installments().filter((r) => r.status === 'OVERDUE').length,
  );

  protected readonly totalCount = computed<number>(() => this.installments().length);

  protected readonly nextDueDate = computed<string | null>(() => {
    const next = this.installments().find((r) => r.status !== 'PAID');
    return next?.dueDate ?? null;
  });

  protected readonly lastInstallmentDate = computed<string | null>(() => {
    const rows = this.installments();
    if (rows.length > 0) return rows[rows.length - 1].dueDate;
    // Fallback pra financings sem backfill: contract_date + N meses.
    const f = this.financing();
    if (!f || !f.contractDate || !f.installments) return null;
    return this.addMonthsIso(f.contractDate, f.installments);
  });

  protected readonly statusBadge = computed<{ label: string; chip: string }>(() => {
    const f = this.financing();
    if (!f) return { label: '—', chip: 'bg-neutral-100 text-neutral-700' };
    if (f.status === 'PAID_OFF') {
      return { label: 'Quitado', chip: 'bg-emerald-100 text-emerald-800' };
    }
    if (this.overdueCount() > 0) {
      return { label: 'Atrasado', chip: 'bg-rose-100 text-rose-700' };
    }
    return { label: 'Em dia', chip: 'bg-blue-100 text-blue-700' };
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.vehiclesService.getFleetFinancing(id).subscribe({
      next: (f) => {
        this.financing.set(f);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.extractError(err, 'Financiamento não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  // ------- Marcar como paga com data escolhida -------
  protected readonly markPaidTarget = signal<FinancingInstallment | null>(null);
  protected readonly markPaidBusy = signal(false);

  protected askMarkPaid(row: FinancingInstallment): void {
    if (row.status === 'PAID') return;
    this.markPaidTarget.set(row);
  }

  protected cancelMarkPaid(): void {
    if (this.markPaidBusy()) return;
    this.markPaidTarget.set(null);
  }

  protected readonly markPaidEntityLabel = computed<string>(() => {
    const row = this.markPaidTarget();
    const total = this.financing()?.installments ?? this.totalCount();
    if (!row) return '';
    return `Parcela ${row.number}/${total}`;
  });

  private todayIso(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * minDate = contractDate quando disponível (é o mais folgado — parcelas
   * começam a partir do contrato). Undefined = sem lower bound.
   */
  protected readonly markPaidMinDate = computed<string | undefined>(
    () => this.financing()?.contractDate ?? undefined,
  );
  protected readonly markPaidMaxDate = computed<string>(() => this.todayIso());
  protected readonly markPaidDefaultDate = computed<string>(() => this.todayIso());

  protected confirmMarkPaid(paidAt: string): void {
    const f = this.financing();
    const target = this.markPaidTarget();
    if (!f || !target || this.markPaidBusy()) return;
    this.markPaidBusy.set(true);
    this.paying.set(target.id);
    this.vehiclesService
      .payFinancingInstallment(f.id, target.id, { paidAt })
      .subscribe({
        next: (updated) => {
          this.financing.set(updated);
          this.markPaidBusy.set(false);
          this.markPaidTarget.set(null);
          this.paying.set(null);
          this.notifications.push('success', 'Parcela marcada como paga.');
        },
        error: (err: HttpErrorResponse) => {
          this.markPaidBusy.set(false);
          this.markPaidTarget.set(null);
          this.paying.set(null);
          this.notifications.push(
            'error',
            this.extractError(err, 'Não foi possível marcar a parcela.'),
          );
        },
      });
  }

  // ------- Desmarcar pagamento -------
  protected readonly unmarkPaidTarget = signal<FinancingInstallment | null>(null);
  protected readonly unmarkPaidBusy = signal(false);

  protected askUnmarkPaid(row: FinancingInstallment): void {
    if (row.status !== 'PAID') return;
    this.unmarkPaidTarget.set(row);
  }

  protected cancelUnmarkPaid(): void {
    if (this.unmarkPaidBusy()) return;
    this.unmarkPaidTarget.set(null);
  }

  protected readonly unmarkPaidMessage = computed<string>(() => {
    const row = this.unmarkPaidTarget();
    const total = this.financing()?.installments ?? this.totalCount();
    if (!row) return '';
    return `Desmarcar a parcela ${row.number}/${total} como paga? O status voltará para pendente e a data de pagamento será limpa.`;
  });

  protected confirmUnmarkPaid(): void {
    const f = this.financing();
    const target = this.unmarkPaidTarget();
    if (!f || !target || this.unmarkPaidBusy()) return;
    this.unmarkPaidBusy.set(true);
    this.paying.set(target.id);
    this.vehiclesService.unpayFinancingInstallment(f.id, target.id).subscribe({
      next: (updated) => {
        this.financing.set(updated);
        this.unmarkPaidBusy.set(false);
        this.unmarkPaidTarget.set(null);
        this.paying.set(null);
        this.notifications.push('success', 'Pagamento desmarcado.');
      },
      error: (err: HttpErrorResponse) => {
        this.unmarkPaidBusy.set(false);
        this.unmarkPaidTarget.set(null);
        this.paying.set(null);
        this.notifications.push(
          'error',
          this.extractError(err, 'Não foi possível desmarcar o pagamento.'),
        );
      },
    });
  }

  protected installmentChip(status: FinancingInstallment['status']): {
    label: string;
    chip: string;
  } {
    switch (status) {
      case 'PAID':
        return { label: 'Paga', chip: 'bg-emerald-100 text-emerald-800' };
      case 'OVERDUE':
        return { label: 'Atrasada', chip: 'bg-rose-100 text-rose-700' };
      default:
        return { label: 'Prevista', chip: 'bg-neutral-100 text-neutral-600' };
    }
  }

  protected trackInstallment(_: number, r: FinancingInstallment): string {
    return r.id;
  }

  protected formatPlate(plate: string | undefined | null): string {
    const p = (plate ?? '').toUpperCase();
    if (p.length === 7) return `${p.slice(0, 3)}-${p.slice(3)}`;
    return p || '—';
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    if (iso.length === 10) return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  protected formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100);
  }

  /**
   * Fallback usado apenas quando o financing não tem cronograma na tabela
   * (financing antigo cadastrado antes da V24 e sem dados pra backfill).
   */
  private addMonthsIso(iso: string, months: number): string {
    const base = new Date(iso + 'T00:00:00');
    const d = new Date(base);
    d.setMonth(d.getMonth() + months);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
