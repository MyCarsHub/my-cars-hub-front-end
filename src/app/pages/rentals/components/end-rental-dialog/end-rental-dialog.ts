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
  OverdueFeeSummary,
  formatLocalDateTime,
  graceHoursLabel,
  multiplierLabel,
  overdueFeeFormula,
  overdueRuleLabel,
  toLocalDateTime,
} from '../../../../types/overdue.types';
import {
  CaucaoRefundMethod,
  CaucaoRefundPayload,
  RentalResponseDto,
} from '../../../../types/rental.types';
import { nowHhMmInBusinessTz, todayInBusinessTz } from '../../../../utils/business-clock';

/**
 * Payload emitido pelo dialog — mesma forma que o backend aceita em
 * complete/cancel. O caller decide se envia como completedAt/canceledAt.
 */
export interface EndRentalDialogPayload {
  date: string; // yyyy-MM-dd
  /**
   * Data e hora da devolução efetiva, local e sem offset. Só é preenchido na
   * conclusão — cancelamento não devolve veículo e não gera multa.
   */
  actualReturnAt?: string;
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
 *
 * **Multa por atraso (V53).** Na conclusão o dialog coleta também a HORA da
 * devolução (a tolerância é contada em horas; sem hora não haveria como
 * aplicá-la) e mostra a prévia da multa ANTES de o usuário confirmar. O
 * componente segue burro: não fala HTTP. Ele emite {@link returnAtChanged} a
 * cada mudança de data/hora e recebe de volta {@link overduePreview} — quem
 * busca é o `RentalDetail`.
 *
 * Duas garantias que a interface precisa manter:
 *  - devolução no prazo NÃO mostra multa nenhuma, nem um "R$ 0,00";
 *  - havendo multa a confirmar, o botão só destrava depois do "ciente" —
 *    cobrança que o cliente não entende é cobrança contestada.
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

  /**
   * Conta da multa para a data/hora atualmente escolhida, buscada pelo caller.
   * `null` = ainda não chegou (ou o intent é `cancel`, que não tem multa).
   */
  overduePreview = input<OverdueFeeSummary | null>(null);
  overduePreviewLoading = input<boolean>(false);
  overduePreviewError = input<string | null>(null);

  confirmed = output<EndRentalDialogPayload>();
  cancelled = output<void>();
  /** Data-e-hora local escolhida para a devolução — dispara a prévia no caller. */
  returnAtChanged = output<string>();

  /**
   * "Hoje" e "agora" em BRASÍLIA, reavaliados a cada abertura — o dialog vive
   * tanto quanto a página do aluguel, e um popup aberto antes da meia-noite não
   * pode propor a data de ontem.
   */
  protected readonly today = signal<string>(todayInBusinessTz());

  protected readonly selectedDate = signal<string>(this.today());
  /** Hora da devolução. Só entra no fluxo de conclusão. */
  protected readonly returnTime = signal<string>(nowHhMmInBusinessTz());
  /** "Ciente da multa" — exigido antes de confirmar quando há valor a cobrar. */
  protected readonly overdueAck = signal<boolean>(false);
  /**
   * "Ciente de que NÃO SEI o valor" — exigido quando a prévia falha. Deliberamente
   * separado do `overdueAck`: são riscos diferentes, e um consentimento dado
   * para um valor visível não pode valer como consentimento para um desconhecido.
   */
  protected readonly overdueBlindAck = signal<boolean>(false);
  /**
   * Incrementado por "Tentar de novo". Existe só para o `effect` da prévia ter
   * uma dependência que mude quando o instante escolhido NÃO mudou.
   */
  private readonly previewNonce = signal<number>(0);
  protected readonly reason = signal<string>('');
  protected readonly refundMethod = signal<CaucaoRefundMethod>('AUTOMATIC');
  protected readonly refundAmountCents = signal<number>(0);
  /** Opt-in destrutivo — sempre reaberto desmarcado (ver `effect` no construtor). */
  protected readonly removeOverdueCharges = signal<boolean>(false);

  protected readonly minDate = computed(() => this.rental().startDate);
  protected readonly maxDate = computed(() => this.today());

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

  /**
   * A data que REALMENTE vai ser enviada — a escolhida, já limitada à faixa
   * aceita. Fonte única: prévia, rótulo e payload leem daqui. Enquanto a prévia
   * era pedida com a data crua e o payload saía com a clampada, o valor
   * confirmado podia não ser o previsto.
   */
  protected readonly effectiveDate = computed<string>(() => this.clampDate(this.selectedDate()));

  /** Diferença em dias entre a data efetiva e o endDate programado. */
  protected readonly daysBeforeEnd = computed<number>(() => {
    const r = this.rental();
    const chosen = this.effectiveDate();
    if (!chosen) return 0;
    const chosenMs = new Date(chosen + 'T00:00:00').getTime();
    const endMs = new Date(r.endDate + 'T00:00:00').getTime();
    return Math.round((endMs - chosenMs) / 86_400_000);
  });

  protected readonly previewLabel = computed<string>(() => {
    const chosen = this.effectiveDate();
    if (!chosen) return '';
    const chosenLabel = new Date(chosen + 'T00:00:00').toLocaleDateString('pt-BR');
    if (this.intent() === 'cancel') {
      return `Cancelamento em ${chosenLabel}`;
    }
    const diff = this.daysBeforeEnd();
    if (diff > 0) return `Concluído em ${chosenLabel} — ${diff} dia(s) antes do fim programado`;
    // "Dentro do prazo" só quando a prévia confirma. Antes desta feature a
    // frase saía de `endDate - data escolhida <= 0`, que é devolução PONTUAL ou
    // ATRASADA — e o rodapé jurava "dentro do prazo" logo abaixo do painel que
    // mostrava a multa.
    if (this.hasOverdueFee()) return `Concluído em ${chosenLabel} — devolução em atraso`;
    if (this.onTimeConfirmed()) return `Concluído em ${chosenLabel} (dentro do prazo)`;
    return `Concluído em ${chosenLabel}`;
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

  // ------------------------------------------------------------------
  // Multa por devolução em atraso (V53). Nada disso existe no cancelamento.
  // ------------------------------------------------------------------

  /** `2026-07-22T23:00:00` — local, sem offset, como o backend espera. */
  protected readonly actualReturnAt = computed<string>(() =>
    toLocalDateTime(this.effectiveDate(), this.returnTime()),
  );

  protected readonly isComplete = computed(() => this.intent() === 'complete');

  /** Prévia relevante: só na conclusão, e só depois que o caller a entregou. */
  protected readonly overdue = computed<OverdueFeeSummary | null>(() =>
    this.isComplete() ? this.overduePreview() : null,
  );

  /**
   * **NÃO SEI o valor.** Terceiro estado, e o mais perigoso: a prévia falhou.
   *
   * "Não consegui calcular" não é "não há multa". O backend aplica a regra na
   * conclusão de qualquer jeito — a falha é da CONSULTA, não da cobrança. Sem
   * este estado, o erro zerava a prévia, `hasOverdueFee` virava `false`, o
   * "ciente" desaparecia e o botão destravava: o cliente era cobrado sem que o
   * valor tivesse aparecido na tela uma única vez.
   */
  protected readonly overdueUnknown = computed<boolean>(
    () => this.isComplete() && this.overduePreviewError() !== null,
  );

  /**
   * Há multa a mostrar. Multa de zero centavo o backend nunca lança.
   * Nunca verdadeiro sem prévia — com erro, o que vale é {@link overdueUnknown}.
   */
  protected readonly hasOverdueFee = computed<boolean>(() => {
    const preview = this.overdue();
    return !this.overdueUnknown() && preview !== null && preview.overdue && preview.amount > 0;
  });

  /**
   * Devolução no prazo: mostramos a confirmação SEM valor nenhum. Exibir
   * "R$ 0,00" só ensinaria o operador a ignorar o bloco quando ele importa.
   *
   * Exige prévia RESPONDIDA: afirmar "dentro do prazo" com a consulta quebrada
   * seria a tela garantindo algo que ela não sabe.
   */
  protected readonly onTimeConfirmed = computed<boolean>(() => {
    const preview = this.overdue();
    return !this.overdueUnknown() && preview !== null && !this.hasOverdueFee();
  });

  /** Multa já lançada — a tela informa, não pede novo consentimento. */
  protected readonly overdueAlreadyCharged = computed<boolean>(
    () => this.hasOverdueFee() && this.overdue()?.chargeId != null,
  );

  /** O "ciente" só é exigido para uma multa que ainda vai ser criada. */
  protected readonly requiresOverdueAck = computed<boolean>(
    () => this.hasOverdueFee() && !this.overdueAlreadyCharged(),
  );

  /** `2 diárias × R$ 100,00 × 1,5x = R$ 300,00`. */
  protected readonly overdueFormula = computed<string>(() => {
    const preview = this.overdue();
    return preview ? overdueFeeFormula(preview) : '';
  });

  /** Só o total, para o destaque e para a frase do "ciente". */
  protected readonly overdueFormulaTotal = computed<string>(() =>
    formatBRL(this.overdue()?.amount ?? 0),
  );

  protected readonly overdueDueAtLabel = computed<string>(() =>
    formatLocalDateTime(this.overdue()?.dueAt),
  );

  protected readonly overdueReturnedAtLabel = computed<string>(() =>
    formatLocalDateTime(this.overdue()?.returnedAt),
  );

  /** Regra em vigor, legível por qualquer membro — inclusive quem não edita. */
  protected readonly overdueRule = computed<string>(() => {
    const preview = this.overdue();
    if (!preview) return '';
    return overdueRuleLabel(preview.multiplierBps, preview.graceHours);
  });

  protected readonly overdueGraceLabel = computed<string>(() =>
    graceHoursLabel(this.overdue()?.graceHours ?? 0),
  );

  protected readonly overdueMultiplierLabel = computed<string>(() =>
    multiplierLabel(this.overdue()?.multiplierBps ?? 0),
  );

  /**
   * Trava do botão. Além do "ciente", segura enquanto a prévia está em voo:
   * confirmar no meio do recálculo geraria uma cobrança que o usuário não viu.
   *
   * Com a prévia QUEBRADA a trava não some — troca de dono. Bloquear para
   * sempre não é opção defensável: o veículo já voltou, e uma indisponibilidade
   * do preview deixaria o aluguel `ACTIVE` faturando. Então o caminho existe,
   * mas só através de uma ciência própria e explícita — ver {@link overdueBlindAck}.
   */
  protected readonly canConfirm = computed<boolean>(() => {
    if (this.busy() || !this.selectedDate()) return false;
    if (!this.isComplete()) return true;
    if (this.overduePreviewLoading()) return false;
    if (this.overdueUnknown()) return this.overdueBlindAck();
    return !this.requiresOverdueAck() || this.overdueAck();
  });

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
        // Releitura do relógio de Brasília: a instância sobrevive à página.
        const today = todayInBusinessTz();
        this.today.set(today);
        this.selectedDate.set(today);
        this.returnTime.set(nowHhMmInBusinessTz());
        this.reason.set('');
        this.removeOverdueCharges.set(false);
        // O "ciente" nunca sobrevive a uma reabertura: o valor pode ter mudado.
        this.overdueAck.set(false);
        this.overdueBlindAck.set(false);
        // Nunca pré-selecionar devolução: `NONE` em todos os estados.
        this.refundMethod.set('NONE');
        this.refundAmountCents.set(0);
      }
    });

    // Pede a prévia ao caller sempre que o instante da devolução muda — e já na
    // abertura, para o valor estar na tela antes do primeiro clique.
    effect(() => {
      if (!this.open() || !this.isComplete()) return;
      // Lido para o "Tentar de novo" reemitir o MESMO instante após uma falha.
      this.previewNonce();
      const at = this.actualReturnAt();
      if (at) this.returnAtChanged.emit(at);
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
    // O valor da multa muda com a data: um "ciente" antigo não vale para ele.
    this.dropOverdueConsent();
  }

  protected onReturnTimeInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    // `<input type="time">` devolve '' enquanto o usuário digita — manter o
    // último horário válido evita disparar prévia com data-e-hora quebrada.
    if (!value) return;
    this.returnTime.set(value);
    this.dropOverdueConsent();
  }

  protected onOverdueAckToggle(event: Event): void {
    this.overdueAck.set((event.target as HTMLInputElement).checked);
  }

  protected onOverdueBlindAckToggle(event: Event): void {
    this.overdueBlindAck.set((event.target as HTMLInputElement).checked);
  }

  /**
   * Repete o pedido da prévia para o instante já escolhido. É o caminho barato
   * de sair do estado "não sei": sem ele, a única saída seria mexer na hora da
   * devolução — o que muda a própria cobrança — ou concluir às cegas.
   */
  protected retryPreview(): void {
    if (this.busy()) return;
    this.previewNonce.update((n) => n + 1);
  }

  /**
   * Qualquer mudança no instante invalida os DOIS consentimentos: o valor
   * consentido some junto com a conta que o produziu.
   */
  private dropOverdueConsent(): void {
    this.overdueAck.set(false);
    this.overdueBlindAck.set(false);
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
    if (!this.canConfirm()) return;
    const chosen = this.effectiveDate();
    const reason = this.reason().trim();
    const payload: EndRentalDialogPayload = {
      date: chosen,
      removeOverdueCharges: this.removeOverdueCharges(),
    };
    // Mesmíssimo `computed` que alimentou a prévia — é o que garante que o valor
    // cobrado seja o valor mostrado.
    if (this.isComplete()) {
      payload.actualReturnAt = this.actualReturnAt();
    }
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

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format((cents ?? 0) / 100);
}
