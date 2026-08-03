import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import {
  CaucaoRefundMethod,
  CaucaoRefundPayload,
  RentalResponseDto,
} from '../../../../types/rental.types';

/**
 * Payload emitido pelo dialog — mesma forma que o backend aceita em
 * complete/cancel. O caller decide se envia como completedAt/canceledAt.
 */
export interface EndRentalDialogPayload {
  date: string; // yyyy-MM-dd
  endReason?: string;
  caucaoRefund?: CaucaoRefundPayload;
  /** Opt-in: apagar também no Asaas as cobranças vencidas e não pagas. */
  removeOverdueCharges: boolean;
}

export type EndRentalIntent = 'complete' | 'cancel';

/**
 * Estado real da caução no encerramento. Deriva do que o backend consegue
 * executar — NÃO da flag `automaticCharge`, que não diz nada sobre a caução:
 *
 * - `GATEWAY`      há charge CAUCAO `PAID` e toda charge paga tem `externalId`.
 *                  Único estado em que `AUTOMATIC` realmente chama
 *                  `refundPayment` no Asaas (`AsaasChargeService:249-268`).
 * - `PAID_OFFLINE` a caução consta como paga, mas não existe cobrança
 *                  estornável no gateway — charge `PAID` sem `externalId`
 *                  (aluguel "importado em andamento", `insertHistoricalPaid`)
 *                  ou apenas a flag `caucaoPaid`. O backend rejeita
 *                  `AUTOMATIC` sem charge paga e, com charge sem `externalId`,
 *                  só marcaria RELEASED local sem mover dinheiro.
 * - `UNPAID`       há caução prevista, mas nenhum pagamento registrado
 *                  (`PENDING` / `PAST_DUE` / sem charge). O backend aceita
 *                  `MANUAL` porque `caucaoAmount > 0` (`RentalService:514-519`).
 * - `NO_CAUCAO`    `caucaoAmount` 0/ausente — não há o que devolver.
 */
export type CaucaoRefundState = 'GATEWAY' | 'PAID_OFFLINE' | 'UNPAID' | 'NO_CAUCAO';

/**
 * Dialog rico de encerramento (Concluir ou Cancelar). Coleta data,
 * motivo opcional e — sempre que houver caução — método + valor da devolução,
 * com a copy ajustada ao {@link CaucaoRefundState} real.
 */
@Component({
  selector: 'app-end-rental-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './end-rental-dialog.html',
  host: {
    '(document:keydown.escape)': 'onEscape($event)',
  },
  animations: [
    trigger('backdrop', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('150ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('dialog', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95) translateY(-8px)' }),
        animate(
          '200ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 1, transform: 'scale(1) translateY(0)' }),
        ),
      ]),
      transition(':leave', [
        animate(
          '150ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 0, transform: 'scale(0.95) translateY(-8px)' }),
        ),
      ]),
    ]),
  ],
})
export class EndRentalDialog {
  open = input.required<boolean>();
  rental = input.required<RentalResponseDto>();
  busy = input<boolean>(false);
  /** `complete` (verde, "Concluir aluguel") ou `cancel` (vermelho, "Cancelar aluguel"). */
  intent = input<EndRentalIntent>('complete');

  confirmed = output<EndRentalDialogPayload>();
  cancelled = output<void>();

  private readonly _today = todayIso();

  protected readonly selectedDate = signal<string>(this._today);
  protected readonly reason = signal<string>('');
  protected readonly refundMethod = signal<CaucaoRefundMethod>('AUTOMATIC');
  protected readonly refundAmountCents = signal<number>(0);
  /** Opt-in destrutivo — sempre reaberto desmarcado (ver `effect` no construtor). */
  protected readonly removeOverdueCharges = signal<boolean>(false);

  protected readonly minDate = computed(() => this.rental().startDate);
  protected readonly maxDate = computed(() => this._today);

  /** Charges CAUCAO já pagas. O backend age sobre a primeira que encontrar. */
  private readonly paidCaucaoCharges = computed(() =>
    this.rental().charges.filter((c) => c.kind === 'CAUCAO' && c.status === 'PAID'),
  );

  /** Caução prevista no contrato. 0 / ausente = não existe caução. */
  protected readonly caucaoAmountCents = computed<number>(() => this.rental().caucaoAmount ?? 0);

  /** Valor total da caução paga (somando charges CAUCAO com status=PAID). */
  protected readonly caucaoPaidCents = computed<number>(() => {
    const r = this.rental();
    const fromCharges = this.paidCaucaoCharges().reduce((acc, c) => acc + c.amount, 0);
    // Fallback: caução marcada manualmente (`caucaoPaid=true`) sem charge.
    if (fromCharges > 0) return fromCharges;
    if (r.caucaoPaid && r.caucaoAmount > 0) return r.caucaoAmount;
    return 0;
  });

  /** Ver {@link CaucaoRefundState}. */
  protected readonly caucaoRefundState = computed<CaucaoRefundState>(() => {
    if (this.caucaoAmountCents() <= 0) return 'NO_CAUCAO';
    const paid = this.paidCaucaoCharges();
    if (paid.length > 0) {
      // Conservador de propósito: UMA charge paga sem `externalId` já basta
      // para o estorno via gateway deixar de ser garantido, porque o backend
      // escolhe a primeira PAID e, sem `externalId`, apenas marca RELEASED
      // local — nenhuma chamada ao Asaas, nenhum dinheiro devolvido.
      const everyChargeRefundable = paid.every((c) => c.provider === 'ASAAS' && !!c.externalId);
      return everyChargeRefundable ? 'GATEWAY' : 'PAID_OFFLINE';
    }
    // Sem charge paga: ou o owner marcou "recebi por fora", ou não foi paga.
    return this.rental().caucaoPaid ? 'PAID_OFFLINE' : 'UNPAID';
  });

  /** Sempre que existir caução há o que perguntar — só some quando não existe. */
  protected readonly showRefundSection = computed<boolean>(
    () => this.caucaoRefundState() !== 'NO_CAUCAO',
  );

  /**
   * Só `GATEWAY` pode oferecer `AUTOMATIC`: o backend rejeita `AUTOMATIC` sem
   * charge CAUCAO `PAID` (`RentalService:511-513`) e, mesmo aceitando, sem
   * `externalId` nada seria estornado.
   */
  protected readonly canRefundViaGateway = computed<boolean>(
    () => this.caucaoRefundState() === 'GATEWAY',
  );

  /**
   * Teto do campo "valor a devolver". O backend rejeita
   * `amount > rental.caucaoAmount`; quando conhecemos o valor pago, usamos o
   * menor dos dois para nunca prometer um estorno maior que a cobrança.
   */
  protected readonly refundMaxCents = computed<number>(() => {
    const cap = this.caucaoAmountCents();
    const paid = this.caucaoPaidCents();
    return paid > 0 ? Math.min(paid, cap) : cap;
  });

  /** Diferença em dias entre a data escolhida e o endDate programado. */
  protected readonly daysBeforeEnd = computed<number>(() => {
    const r = this.rental();
    const chosen = this.selectedDate();
    if (!chosen) return 0;
    const chosenMs = new Date(chosen + 'T00:00:00').getTime();
    const endMs = new Date(r.endDate + 'T00:00:00').getTime();
    return Math.round((endMs - chosenMs) / 86_400_000);
  });

  protected readonly previewLabel = computed<string>(() => {
    const chosen = this.selectedDate();
    if (!chosen) return '';
    const chosenLabel = new Date(chosen + 'T00:00:00').toLocaleDateString('pt-BR');
    if (this.intent() === 'cancel') {
      return `Cancelamento em ${chosenLabel}`;
    }
    const diff = this.daysBeforeEnd();
    if (diff <= 0) return `Concluído em ${chosenLabel} (dentro do prazo)`;
    return `Concluído em ${chosenLabel} — ${diff} dia(s) antes do fim programado`;
  });

  /**
   * Aviso sobre o destino das cobranças no encerramento. Comunica as três
   * garantias: pagas nunca saem, em aberto não vencidas saem sempre, vencidas
   * só saem se o opt-in abaixo for marcado.
   */
  protected readonly chargesNotice = computed<string>(() => {
    const base =
      'As cobranças em aberto que ainda não venceram serão apagadas no Asaas. As vencidas e não pagas permanecem cobráveis; as já pagas permanecem e não são estornadas.';
    // A frase da exceção só é verdadeira quando existe uma charge CAUCAO PAGA:
    // é ela que o encerramento nunca apaga. Caução ainda não paga segue as
    // mesmas regras das demais cobranças — prometer exceção seria mentira.
    return this.paidCaucaoCharges().length > 0
      ? `${base} A caução é a exceção — você decide a devolução abaixo.`
      : base;
  });

  protected readonly formattedRefund = computed(() => formatBRL(this.refundAmountCents()));
  protected readonly formattedRefundMax = computed(() => formatBRL(this.refundMaxCents()));

  /** Resumo ao lado do título — nunca afirma um pagamento que não existe. */
  protected readonly caucaoSummaryLabel = computed<string>(() =>
    this.caucaoRefundState() === 'UNPAID'
      ? `Prevista: ${formatBRL(this.caucaoAmountCents())}`
      : `Paga: ${formatBRL(this.caucaoPaidCents())}`,
  );

  /**
   * Aviso do estado. Vazio em `GATEWAY` (as opções já se explicam); nos demais
   * deixa explícito que devolver o dinheiro é etapa manual, fora do sistema.
   */
  protected readonly refundStateNotice = computed<string>(() => {
    switch (this.caucaoRefundState()) {
      case 'PAID_OFFLINE':
        return 'Esta caução não tem cobrança no Asaas para estornar. Devolver o dinheiro é uma etapa manual, feita por você fora do sistema — aqui você só registra o que devolveu.';
      case 'UNPAID':
        return 'O sistema não tem registro de pagamento desta caução. Se você recebeu o valor por fora, devolver é uma etapa manual, feita por você fora do sistema — aqui você só registra o que devolveu.';
      default:
        return '';
    }
  });

  protected readonly manualOptionTitle = computed<string>(() =>
    this.canRefundViaGateway() ? 'Manual' : 'Registrar devolução feita por fora',
  );

  protected readonly manualOptionDescription = computed<string>(() =>
    this.canRefundViaGateway()
      ? 'Devolvi por fora (dinheiro / PIX manual).'
      : 'Você devolve o dinheiro por fora; o sistema registra o valor e a data.',
  );

  protected readonly noneOptionDescription = computed<string>(() =>
    this.caucaoRefundState() === 'UNPAID'
      ? 'Nada a devolver, ou o valor fica retido.'
      : 'Reter o valor da caução.',
  );

  protected readonly confirmLabel = computed(() =>
    this.intent() === 'cancel' ? 'Cancelar aluguel' : 'Concluir aluguel',
  );

  protected readonly cancelLabel = computed(() =>
    this.intent() === 'cancel' ? 'Voltar' : 'Cancelar',
  );

  protected readonly titleLabel = computed(() =>
    this.intent() === 'cancel' ? 'Cancelar aluguel' : 'Concluir aluguel',
  );

  protected readonly confirmBtnClass = computed(() =>
    this.intent() === 'cancel'
      ? 'bg-red-500 hover:bg-red-600 focus-visible:ring-red-400'
      : 'bg-emerald-500 hover:bg-emerald-600 focus-visible:ring-emerald-400',
  );

  protected readonly iconBgClass = computed(() =>
    this.intent() === 'cancel' ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500',
  );

  constructor() {
    // Reset a cada abertura: hoje / campos limpos / refund default.
    effect(() => {
      if (this.open()) {
        this.selectedDate.set(this._today);
        this.reason.set('');
        this.removeOverdueCharges.set(false);
        // Nunca pré-selecionar devolução: `NONE` em todos os estados.
        this.refundMethod.set('NONE');
        this.refundAmountCents.set(0);
      }
    });

    // Rede de segurança: se o rental for recarregado com o dialog aberto e a
    // caução deixar de ser estornável pelo gateway, um `AUTOMATIC` já marcado
    // viraria 400 no backend. Volta para `NONE` — visível para o usuário.
    effect(() => {
      if (!this.canRefundViaGateway() && this.refundMethod() === 'AUTOMATIC') {
        this.refundMethod.set('NONE');
        this.refundAmountCents.set(0);
      }
    });
  }

  protected onDateInput(event: Event): void {
    this.selectedDate.set((event.target as HTMLInputElement).value);
  }

  protected onReasonInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.reason.set(value.slice(0, 500));
  }

  protected onRemoveOverdueToggle(event: Event): void {
    this.removeOverdueCharges.set((event.target as HTMLInputElement).checked);
  }

  protected onRefundMethodChange(method: CaucaoRefundMethod): void {
    this.refundMethod.set(method);
    if (method === 'NONE') {
      this.refundAmountCents.set(0);
    } else if (this.refundAmountCents() === 0) {
      // Volta ao teto devolvível quando ativa AUTOMATIC / MANUAL.
      this.refundAmountCents.set(this.refundMaxCents());
    }
  }

  protected onRefundAmountInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const digits = raw.replace(/\D/g, '');
    const cents = digits === '' ? 0 : Number(digits);
    this.refundAmountCents.set(Math.min(cents, this.refundMaxCents()));
  }

  protected onConfirm(): void {
    if (this.busy()) return;
    const chosen = this.clampDate(this.selectedDate());
    const reason = this.reason().trim();
    const payload: EndRentalDialogPayload = {
      date: chosen,
      removeOverdueCharges: this.removeOverdueCharges(),
    };
    if (reason.length > 0) payload.endReason = reason;
    if (this.showRefundSection()) {
      const method = this.refundMethod();
      // `UNPAID` + `NONE` = nada aconteceu com a caução. Gravar o metadata faria
      // o detalhe do aluguel exibir "Retida pelo locador" (rental-detail.html:103)
      // para um valor que o sistema nunca registrou como recebido.
      const nothingHappened = method === 'NONE' && this.caucaoRefundState() === 'UNPAID';
      if (!nothingHappened) {
        payload.caucaoRefund = {
          method,
          amount: method === 'NONE' ? 0 : this.refundAmountCents(),
        };
      }
    }
    this.confirmed.emit(payload);
  }

  protected onCancel(): void {
    if (this.busy()) return;
    this.cancelled.emit();
  }

  protected onEscape(event: Event): void {
    if (!this.open() || this.busy()) return;
    event.preventDefault();
    this.cancelled.emit();
  }

  protected onBackdrop(): void {
    this.onCancel();
  }

  private clampDate(value: string): string {
    let clamped = value;
    const min = this.minDate();
    const max = this.maxDate();
    if (min && clamped < min) clamped = min;
    if (max && clamped > max) clamped = max;
    return clamped;
  }
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format((cents ?? 0) / 100);
}
