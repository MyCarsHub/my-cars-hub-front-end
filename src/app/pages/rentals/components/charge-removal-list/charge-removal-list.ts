import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatBRL } from '../../../../types/dashboard.types';
import {
  ChargeKind,
  ChargeRemovalOutcome,
  RentalChargeRemovalDto,
  chargeKindLabel,
} from '../../../../types/rental.types';

interface RemovalRow {
  id: string;
  kind: string;
  amount: string;
  label: string;
  message: string;
  pending: boolean;
  tone: string;
}

const OUTCOME_LABEL: Record<ChargeRemovalOutcome, string> = {
  REMOVED_AT_GATEWAY: 'Removida do Asaas',
  NO_GATEWAY_LINK: 'Sem cobrança no Asaas',
  REMOVAL_REFUSED: 'Recusada pelo Asaas',
  ALREADY_CLOSED: 'Já estava encerrada',
  NOT_CANCELED: 'Não foi cancelada',
  KEPT_PAID: 'Mantida: já paga',
  KEPT_OVERDUE: 'Mantida: vencida e não paga',
  KEPT_DISPUTED: 'Mantida: em disputa',
  KEPT_CLOSED: 'Mantida: já encerrada',
};

/** Desfechos que deixam trabalho para o operador: o link pode seguir vivo no Asaas. */
const PENDING: ReadonlySet<ChargeRemovalOutcome> = new Set(['REMOVAL_REFUSED', 'NOT_CANCELED']);

/**
 * FEAT-0347 — o que aconteceu com cada cobrança quando o admin cancelou/excluiu o aluguel.
 * Lista curta e legível no celular (uma linha-cartão por cobrança, texto >= 16px); as
 * recusadas vão para o topo, em destaque, como ação pendente.
 */
@Component({
  selector: 'app-charge-removal-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (pendingCount() > 0) {
      <p
        role="alert"
        data-testid="removal-pending-summary"
        class="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-base font-semibold text-rose-800"
      >
        {{ pendingText() }}
      </p>
    }
    @if (rows().length === 0) {
      <p class="text-base text-neutral-600">Este aluguel não tinha cobranças.</p>
    } @else {
      <ul class="space-y-2" data-testid="removal-list">
        @for (row of rows(); track row.id) {
          <li
            [class]="row.tone"
            class="rounded-xl border p-3 text-base"
            [attr.data-outcome-pending]="row.pending ? 'true' : null"
          >
            <div class="flex items-start justify-between gap-2">
              <span class="min-w-0 font-medium text-neutral-900">{{ row.kind }}</span>
              <span class="shrink-0 font-medium text-neutral-900">{{ row.amount }}</span>
            </div>
            <p class="mt-1 font-semibold" data-testid="removal-label">{{ row.label }}</p>
            @if (row.message) {
              <p class="mt-1 break-words text-neutral-700">{{ row.message }}</p>
            }
          </li>
        }
      </ul>
    }
  `,
})
export class ChargeRemovalList {
  readonly removals = input.required<readonly RentalChargeRemovalDto[]>();

  protected readonly rows = computed<RemovalRow[]>(() => {
    const rows = this.removals().map((r): RemovalRow => {
      const pending = PENDING.has(r.outcome);
      const kept = r.outcome.startsWith('KEPT_');
      return {
        id: r.chargeId,
        kind: chargeKindLabel(r.kind as ChargeKind) ?? r.kind,
        amount: formatBRL(r.amount),
        label: OUTCOME_LABEL[r.outcome] ?? r.outcome,
        message: r.message,
        pending,
        tone: pending
          ? 'border-rose-300 bg-rose-50'
          : kept
            ? 'border-neutral-200 bg-neutral-50'
            : 'border-emerald-200 bg-emerald-50',
      };
    });
    return [...rows.filter((r) => r.pending), ...rows.filter((r) => !r.pending)];
  });

  protected readonly pendingCount = computed(() => this.rows().filter((r) => r.pending).length);

  protected readonly pendingText = computed(() =>
    this.pendingCount() === 1
      ? '1 cobrança ainda precisa de ação no Asaas.'
      : `${this.pendingCount()} cobranças ainda precisam de ação no Asaas.`,
  );
}
