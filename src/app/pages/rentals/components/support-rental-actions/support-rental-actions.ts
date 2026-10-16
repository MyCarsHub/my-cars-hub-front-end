import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { AlertBanner } from '../../../../components/alert-banner/alert-banner';
import { ConfirmDialog } from '../../../../components/core/confirm-dialog/confirm-dialog';
import { ApiErrorService } from '../../../../services/api-error.service';
import { parseApiError } from '../../../../services/api-error';
import {
  RentalChargeRemovalDto,
  RentalResponseDto,
  RentalSupportCancelResponse,
  RentalSupportDeleteResponse,
} from '../../../../types/rental.types';
import { RentalService } from '../../rental.service';
import { ChargeRemovalList } from '../charge-removal-list/charge-removal-list';

export const PAID_CHARGES_WOULD_BE_LOST = 'PAID_CHARGES_WOULD_BE_LOST';
export const OPEN_CHARGES_MUST_BE_CANCELED_FIRST = 'OPEN_CHARGES_MUST_BE_CANCELED_FIRST';

export const REASON_OPEN_CHARGES = 'OPEN_CHARGES';
export const REASON_PENDING_GATEWAY_REMOVAL = 'PENDING_GATEWAY_REMOVAL';
const PENDING_REMOVAL_HINT =
  'Aguarde a varredura automática ou remova a cobrança no painel do Asaas e tente de novo.';

/** `reason` do 409 (campo estável do corpo); `null` quando ausente (backend antigo). */
function conflictReason(err: HttpErrorResponse): string | null {
  const body: unknown = err.error;
  if (typeof body !== 'object' || body === null) return null;
  const reason = (body as Record<string, unknown>)['reason'];
  return typeof reason === 'string' && reason.length > 0 ? reason : null;
}

const CANCEL_MESSAGE =
  'Cobranças pendentes ou falhadas são removidas do Asaas. ' +
  'Cobranças vencidas e não pagas são MANTIDAS, a menos que você marque a opção abaixo. ' +
  'Cobranças já pagas ficam intocadas, sem estorno.';
const DELETE_MESSAGE =
  'Excluir apaga o aluguel e não dá para desfazer. ' +
  'Se ainda houver cobrança aberta no Asaas, é preciso cancelar o aluguel antes.';
const ACK_MESSAGE =
  'Este aluguel tem cobranças pagas (ou estornadas/liberadas). Se você continuar, o histórico ' +
  'delas será perdido aqui; os pagamentos continuam existindo no Asaas. Não dá para desfazer.';

/**
 * FEAT-0347 — ações do admin na sessão de EDIÇÃO: cancelar (inclusive aluguel ATIVO) e excluir.
 * A tela só renderiza este componente em modo edição; o dono/gerente nunca o vê.
 * O desfecho de cada cobrança vem do servidor (`chargeRemovals`) e é mostrado como veio.
 */
@Component({
  selector: 'app-support-rental-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, ConfirmDialog, ChargeRemovalList],
  host: { class: 'block' },
  templateUrl: './support-rental-actions.html',
})
export class SupportRentalActions {
  private readonly rentalService = inject(RentalService);
  private readonly apiErrors = inject(ApiErrorService);

  readonly rental = input.required<RentalResponseDto>();
  /** Aluguel cancelado: a tela troca o aluguel pelo devolvido. */
  readonly canceled = output<RentalSupportCancelResponse>();
  /** Aluguel excluído: a tela deixa de ter o que mostrar e exibe o resultado. */
  readonly deleted = output<RentalSupportDeleteResponse>();

  protected readonly cancelMessage = CANCEL_MESSAGE;
  protected readonly deleteMessage = DELETE_MESSAGE;
  protected readonly ackMessage = ACK_MESSAGE;

  protected readonly canCancel = computed(() => {
    const status = this.rental().status;
    return status === 'ACTIVE' || status === 'RESERVED';
  });

  protected readonly cancelOpen = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly ackOpen = signal(false);
  protected readonly removeOverdue = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** 409: há cobrança aberta no Asaas; a saída é cancelar o aluguel primeiro. */
  protected readonly needsCancelFirst = signal(false);
  /** Orientação extra quando a remoção no Asaas está pendente (sem botão de cancelar). */
  protected readonly hint = signal<string | null>(null);
  protected readonly cancelResult = signal<readonly RentalChargeRemovalDto[] | null>(null);

  protected readonly showCancelFirst = computed(() => this.needsCancelFirst() && this.canCancel());

  protected askCancel(): void {
    this.removeOverdue.set(false);
    this.error.set(null);
    this.hint.set(null);
    this.needsCancelFirst.set(false);
    this.cancelOpen.set(true);
  }

  protected askDelete(): void {
    this.removeOverdue.set(false);
    this.error.set(null);
    this.needsCancelFirst.set(false);
    this.cancelResult.set(null);
    this.hint.set(null);
    this.deleteOpen.set(true);
  }

  protected closeDialogs(): void {
    if (this.busy()) return;
    this.cancelOpen.set(false);
    this.deleteOpen.set(false);
    this.ackOpen.set(false);
  }

  protected confirmCancel(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.rentalService.supportCancel(this.rental().id, this.removeOverdue()).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.cancelOpen.set(false);
        this.cancelResult.set(res.chargeRemovals);
        this.canceled.emit(res);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.cancelOpen.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível cancelar o aluguel.'));
      },
    });
  }

  protected confirmDelete(): void {
    this.sendDelete(false);
  }

  protected confirmDeleteAfterAck(): void {
    this.sendDelete(true);
  }

  private sendDelete(acknowledgePaidChargesLoss: boolean): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.rentalService
      .supportRemove(this.rental().id, {
        removeOverdueCharges: this.removeOverdue(),
        acknowledgePaidChargesLoss,
      })
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.deleteOpen.set(false);
          this.ackOpen.set(false);
          this.deleted.emit(res);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          const code = parseApiError(err).code;
          if (code === PAID_CHARGES_WOULD_BE_LOST && !acknowledgePaidChargesLoss) {
            this.apiErrors.claim(err);
            this.deleteOpen.set(false);
            this.ackOpen.set(true);
            return;
          }
          this.deleteOpen.set(false);
          this.ackOpen.set(false);
          const reason = conflictReason(err);
          // Só OPEN_CHARGES (ou `reason` ausente) significa "cancele o aluguel primeiro".
          this.needsCancelFirst.set(
            code === OPEN_CHARGES_MUST_BE_CANCELED_FIRST &&
              (reason === null || reason === REASON_OPEN_CHARGES),
          );
          this.hint.set(reason === REASON_PENDING_GATEWAY_REMOVAL ? PENDING_REMOVAL_HINT : null);
          this.error.set(this.apiErrors.messageFor(err, 'Não foi possível excluir o aluguel.'));
        },
      });
  }
}
