import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { MarkPaidDialog } from '../../components/core/mark-paid-dialog/mark-paid-dialog';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { InsurancesService } from '../../services/insurances.service';
import { InsuranceInstallment } from '../../types/insurance.types';
import { todayIso } from '../../components/vehicles/insurance-form-fields/insurance-utils';

/** Limite do backend para `installments` no POST do cronograma. */
const MAX_INSTALLMENTS = 120;

/**
 * Parcelamento do prêmio de uma apólice: gerar o cronograma, marcar/desmarcar
 * parcela paga e apagar o cronograma inteiro.
 *
 * TODA mutação devolve o cronograma COMPLETO — por isso nenhum método aqui faz
 * um GET de confirmação depois de escrever.
 *
 * Sobre o arredondamento: o backend distribui o resto da divisão centavo a
 * centavo nas PRIMEIRAS parcelas (R$ 1.000,00 em 3x → 333,34 / 333,33 / 333,33).
 * A soma fecha o prêmio exatamente. A tela EXPLICA isso em vez de "corrigir".
 */
@Component({
  selector: 'app-insurance-installments-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [ReactiveFormsModule, PageCard, ConfirmDialog, MarkPaidDialog, AlertBanner],
  template: `
    <app-page-card title="Parcelamento do prêmio">
      <div class="p-4 sm:p-6 space-y-4">
        @if (error(); as cardError) {
          <app-alert-banner variant="error" [message]="cardError" />
        }

        @if (!hasSchedule()) {
          <!-- Geração do cronograma. Mobile-first: campos empilhados, botão
               full-width; só a partir de sm vira linha. -->
          <form [formGroup]="form" (ngSubmit)="generate()" class="space-y-4">
            <p class="text-sm text-neutral-600">
              Nenhum cronograma gerado. Divida o prêmio de
              <strong class="text-neutral-900 tabular-nums">{{
                formatCurrency(premiumAmount())
              }}</strong>
              em parcelas para acompanhar os pagamentos.
            </p>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  for="insurance-installments-count"
                  class="block text-xs font-medium text-neutral-700 mb-1"
                >
                  Número de parcelas
                </label>
                <input
                  id="insurance-installments-count"
                  type="number"
                  inputmode="numeric"
                  min="1"
                  [max]="maxInstallments"
                  step="1"
                  formControlName="installments"
                  [attr.aria-invalid]="countInvalid() ? 'true' : null"
                  [attr.aria-describedby]="
                    countInvalid()
                      ? 'insurance-installments-count-error'
                      : 'insurance-installments-count-hint'
                  "
                  class="w-full bg-neutral-50 border rounded-xl px-4 py-3 text-neutral-800 tabular-nums
                         min-h-[48px] focus:ring-2 focus:ring-primary-600 focus:border-primary-600
                         transition-colors"
                />
                @if (countInvalid()) {
                  <p
                    id="insurance-installments-count-error"
                    class="text-xs text-rose-700 mt-1"
                    role="alert"
                  >
                    Informe um número inteiro entre 1 e {{ maxInstallments }}.
                  </p>
                } @else {
                  <p id="insurance-installments-count-hint" class="text-xs text-neutral-500 mt-1">
                    De 1 a {{ maxInstallments }} parcelas.
                  </p>
                }
              </div>

              <div>
                <label
                  for="insurance-installments-first-due"
                  class="block text-xs font-medium text-neutral-700 mb-1"
                >
                  Vencimento da 1ª parcela
                </label>
                <input
                  id="insurance-installments-first-due"
                  type="date"
                  formControlName="firstDueDate"
                  aria-describedby="insurance-installments-first-due-hint"
                  class="w-full bg-neutral-50 border rounded-xl px-4 py-3 text-neutral-800
                         min-h-[48px] focus:ring-2 focus:ring-primary-600 focus:border-primary-600
                         transition-colors"
                />
                <p
                  id="insurance-installments-first-due-hint"
                  class="text-xs text-neutral-500 mt-1"
                >
                  Opcional. Em branco, o sistema decide a partir da vigência.
                </p>
              </div>
            </div>

            <p class="text-xs text-neutral-500">
              As parcelas são calculadas automaticamente. Quando a divisão não é exata, os
              centavos que sobram entram nas primeiras parcelas — a soma fecha o prêmio.
            </p>

            <button
              type="submit"
              [disabled]="generating()"
              class="w-full sm:w-auto inline-flex items-center justify-center px-5 rounded-xl
                     bg-primary-700 hover:bg-primary-800 text-white text-sm font-semibold shadow-sm
                     transition-colors min-h-[48px] disabled:opacity-60 disabled:cursor-not-allowed
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600
                     focus-visible:ring-offset-2"
            >
              @if (generating()) {
                Gerando…
              } @else {
                Gerar cronograma
              }
            </button>
          </form>
        } @else {
          <!-- Totais em duas colunas já no mobile: quatro números legíveis em 375px. -->
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div class="rounded-2xl border border-neutral-200 bg-white p-3">
              <p class="text-xs uppercase tracking-wide text-neutral-500">Total parcelado</p>
              <p class="mt-1 text-base font-semibold text-neutral-900 tabular-nums">
                {{ formatCurrency(totalCents()) }}
              </p>
            </div>
            <div class="rounded-2xl border border-neutral-200 bg-white p-3">
              <p class="text-xs uppercase tracking-wide text-neutral-500">Pago</p>
              <p class="mt-1 text-base font-semibold text-neutral-900 tabular-nums">
                {{ formatCurrency(paidCents()) }}
              </p>
            </div>
            @if (hasOverpayment()) {
              <div class="rounded-2xl border border-amber-300 bg-amber-50 p-3">
                <p class="text-xs uppercase tracking-wide text-amber-800">Pago a mais</p>
                <p class="mt-1 text-base font-semibold text-amber-900 tabular-nums">
                  {{ formatCurrency(overpaidCents()) }}
                </p>
              </div>
            } @else {
              <div class="rounded-2xl border border-neutral-200 bg-white p-3">
                <p class="text-xs uppercase tracking-wide text-neutral-500">Em aberto</p>
                <p class="mt-1 text-base font-semibold text-neutral-900 tabular-nums">
                  {{ formatCurrency(openCents()) }}
                </p>
              </div>
            }
            <div class="rounded-2xl border border-neutral-200 bg-white p-3">
              <p class="text-xs uppercase tracking-wide text-neutral-500">Progresso</p>
              <p class="mt-1 text-base font-semibold text-neutral-900 tabular-nums">
                {{ paidCount() }}/{{ totalCount() }}
              </p>
              <div class="mt-2 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                <div
                  class="h-full bg-primary-600"
                  [style.width.%]="progressPct()"
                  aria-hidden="true"
                ></div>
              </div>
            </div>
          </div>

          <!-- Conferência com o prêmio: o operador precisa ver que fecha. -->
          @if (totalMatchesPremium()) {
            <p class="text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2">
              A soma das {{ totalCount() }} parcelas confere com o prêmio de
              <strong class="tabular-nums">{{ formatCurrency(premiumAmount()) }}</strong
              >. Diferenças de centavos entre parcelas são do arredondamento e são esperadas.
            </p>
          } @else {
            <p
              class="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
              role="status"
            >
              A soma das parcelas ({{ formatCurrency(totalCents()) }}) não bate com o prêmio
              atual ({{ formatCurrency(premiumAmount()) }}). O prêmio provavelmente mudou
              depois da geração — apague o cronograma e gere de novo.
            </p>
          }

          <!-- Pagamento acima do parcelado: visível em QUALQUER largura, não só
               na tabela do desktop. -->
          @if (hasOverpayment()) {
            <p
              class="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
              role="status"
            >
              O total pago ({{ formatCurrency(paidCents()) }}) passa o total parcelado
              ({{ formatCurrency(totalCents()) }}) em
              <strong class="tabular-nums">{{ formatCurrency(overpaidCents()) }}</strong
              >. Confira as parcelas destacadas e desfaça o pagamento com valor errado.
            </p>
          }

          <!-- Mobile: cards. A tabela abaixo só entra a partir de lg. -->
          <ul class="space-y-2 lg:hidden" role="list">
            @for (row of installments(); track row.id) {
              <li class="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-3 min-w-0">
                    <span class="text-xs text-neutral-500 tabular-nums w-8 shrink-0">
                      {{ row.number }}/{{ totalCount() }}
                    </span>
                    <div class="min-w-0">
                      <p class="text-sm font-medium text-neutral-900 tabular-nums">
                        {{ formatCurrency(row.amountCents) }}
                      </p>
                      <p class="text-xs text-neutral-500 tabular-nums">
                        Vence {{ formatDate(row.dueDate) }}
                        @if (row.paid) {
                          · Paga {{ formatDate(row.paidDate) }}
                        }
                      </p>
                      <!-- O valor PAGO também no card: sem ele, uma parcela
                           quitada com valor errado só aparecia na tabela do
                           desktop — invisível abaixo de 1024px. -->
                      @if (row.paid) {
                        <p class="text-xs tabular-nums" [class]="paidAmountClass(row)">
                          Pago {{ formatCurrency(paidAmountOf(row)) }}
                          @if (paidAmountDiverges(row)) {
                            · diferente do valor da parcela
                          }
                        </p>
                      }
                    </div>
                  </div>
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0"
                    [class]="chipFor(row).chip"
                  >
                    {{ chipFor(row).label }}
                  </span>
                </div>
                @if (row.paid) {
                  <button
                    type="button"
                    [disabled]="busyId() === row.id"
                    (click)="askUnpay(row)"
                    [attr.aria-label]="'Desfazer pagamento da parcela ' + row.number"
                    class="w-full inline-flex items-center justify-center px-3 rounded-lg text-xs
                           font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-50
                           transition-colors min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                  >
                    Desfazer pagamento
                  </button>
                } @else {
                  <button
                    type="button"
                    [disabled]="busyId() === row.id"
                    (click)="askPay(row)"
                    [attr.aria-label]="'Marcar parcela ' + row.number + ' como paga'"
                    class="w-full inline-flex items-center justify-center px-3 rounded-lg text-xs
                           font-semibold bg-emerald-700 hover:bg-emerald-800 text-white
                           transition-colors min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700
                           focus-visible:ring-offset-2"
                  >
                    Marcar como paga
                  </button>
                }
              </li>
            }
          </ul>

          <!-- Desktop: tabela -->
          <div class="hidden lg:block overflow-x-auto">
            <table class="min-w-full text-sm">
              <caption class="sr-only">
                Parcelas do prêmio do seguro
              </caption>
              <thead>
                <tr class="text-left text-xs text-neutral-600 uppercase border-b border-neutral-200">
                  <th scope="col" class="py-2 pr-4 font-medium">#</th>
                  <th scope="col" class="py-2 pr-4 font-medium">Vencimento</th>
                  <th scope="col" class="py-2 pr-4 font-medium">Valor</th>
                  <th scope="col" class="py-2 pr-4 font-medium">Pago em</th>
                  <th scope="col" class="py-2 pr-4 font-medium">Valor pago</th>
                  <th scope="col" class="py-2 pr-4 font-medium">Situação</th>
                  <th scope="col" class="py-2 pr-4 font-medium text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                @for (row of installments(); track row.id) {
                  <tr class="border-b border-neutral-100">
                    <td class="py-2.5 pr-4 tabular-nums text-neutral-600">{{ row.number }}</td>
                    <td class="py-2.5 pr-4 tabular-nums">{{ formatDate(row.dueDate) }}</td>
                    <td class="py-2.5 pr-4 tabular-nums font-medium">
                      {{ formatCurrency(row.amountCents) }}
                    </td>
                    <td class="py-2.5 pr-4 tabular-nums text-neutral-600">
                      {{ formatDate(row.paidDate) }}
                    </td>
                    <td class="py-2.5 pr-4 tabular-nums" [class]="paidAmountClass(row)">
                      @if (row.paid) {
                        {{ formatCurrency(paidAmountOf(row)) }}
                      } @else {
                        —
                      }
                    </td>
                    <td class="py-2.5 pr-4">
                      <span
                        class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
                        [class]="chipFor(row).chip"
                      >
                        {{ chipFor(row).label }}
                      </span>
                    </td>
                    <td class="py-2.5 pr-4 text-right">
                      @if (row.paid) {
                        <button
                          type="button"
                          [disabled]="busyId() === row.id"
                          (click)="askUnpay(row)"
                          [attr.aria-label]="'Desfazer pagamento da parcela ' + row.number"
                          class="px-3 py-1.5 rounded-lg text-xs font-medium border border-neutral-300
                                 text-neutral-700 hover:bg-neutral-50 transition-colors
                                 disabled:opacity-60 disabled:cursor-not-allowed
                                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                        >
                          Desfazer
                        </button>
                      } @else {
                        <button
                          type="button"
                          [disabled]="busyId() === row.id"
                          (click)="askPay(row)"
                          [attr.aria-label]="'Marcar parcela ' + row.number + ' como paga'"
                          class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-700
                                 hover:bg-emerald-800 text-white transition-colors
                                 disabled:opacity-60 disabled:cursor-not-allowed
                                 focus-visible:outline-none focus-visible:ring-2
                                 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
                        >
                          Marcar como paga
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div class="pt-1">
            <button
              type="button"
              [disabled]="deletingSchedule()"
              (click)="askDeleteSchedule()"
              class="w-full sm:w-auto inline-flex items-center justify-center px-4 rounded-xl
                     border border-rose-300 text-rose-700 text-sm font-medium hover:bg-rose-50
                     transition-colors min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              Apagar cronograma
            </button>
          </div>
        }
      </div>
    </app-page-card>

    <app-mark-paid-dialog
      [open]="payTarget() !== null"
      title="Marcar parcela como paga"
      [amountCents]="payTarget()?.amountCents ?? 0"
      [entityLabel]="payLabel()"
      [maxDate]="today"
      [defaultDate]="today"
      [busy]="busyId() !== null"
      (confirmed)="confirmPay($event)"
      (cancelled)="cancelPay()"
    />

    <app-confirm-dialog
      [open]="unpayTarget() !== null"
      title="Desfazer o pagamento?"
      [message]="unpayMessage()"
      confirmLabel="Desfazer"
      cancelLabel="Voltar"
      variant="warning"
      (confirmed)="confirmUnpay()"
      (cancelled)="cancelUnpay()"
    />

    <app-confirm-dialog
      [open]="deleteScheduleOpen()"
      title="Apagar o cronograma?"
      [message]="deleteScheduleMessage()"
      confirmLabel="Apagar cronograma"
      cancelLabel="Voltar"
      variant="danger"
      (confirmed)="confirmDeleteSchedule()"
      (cancelled)="cancelDeleteSchedule()"
    />
  `,
})
export class InsuranceInstallmentsCard {
  private readonly insurancesService = inject(InsurancesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);

  readonly insuranceId = input.required<string>();
  /** Prêmio da apólice em centavos — base da conferência do total. */
  readonly premiumAmount = input<number>(0);
  /** Cronograma vindo do `GET /v1/insurances/{id}`. */
  readonly schedule = input<InsuranceInstallment[]>([]);
  /** Emite o cronograma após cada mutação, para o pai manter seu estado. */
  readonly changed = output<InsuranceInstallment[]>();

  protected readonly maxInstallments = MAX_INSTALLMENTS;
  protected readonly today = todayIso();

  /**
   * Estado local semeado pelo input. Toda mutação devolve o cronograma inteiro,
   * então `set()` com a resposta é a atualização completa — nenhum GET extra.
   */
  protected readonly installments = linkedSignal<InsuranceInstallment[]>(() => this.schedule());

  protected readonly error = signal<string | null>(null);
  protected readonly generating = signal(false);
  /** Id da parcela em mutação — trava só o botão daquela linha. */
  protected readonly busyId = signal<string | null>(null);
  protected readonly deletingSchedule = signal(false);

  protected readonly payTarget = signal<InsuranceInstallment | null>(null);
  protected readonly unpayTarget = signal<InsuranceInstallment | null>(null);
  protected readonly deleteScheduleOpen = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    installments: [
      12,
      [Validators.required, Validators.min(1), Validators.max(MAX_INSTALLMENTS)],
    ],
    firstDueDate: [''],
  });

  protected readonly hasSchedule = computed<boolean>(() => this.installments().length > 0);
  protected readonly totalCount = computed<number>(() => this.installments().length);

  protected readonly totalCents = computed<number>(() =>
    this.installments().reduce((acc, r) => acc + r.amountCents, 0),
  );

  /**
   * Soma o que foi efetivamente pago. `paidAmountCents` pode vir nulo numa
   * parcela paga sem valor informado — nesse caso vale o valor da parcela.
   */
  protected readonly paidCents = computed<number>(() =>
    this.installments()
      .filter((r) => r.paid)
      .reduce((acc, r) => acc + (r.paidAmountCents ?? r.amountCents), 0),
  );

  /**
   * Saldo bruto, SEM piso em zero: se o total pago passou do parcelado, o valor
   * fica negativo e a tela mostra isso. O `Math.max(0, …)` que existia aqui
   * transformava um pagamento a maior em "R$ 0,00 em aberto" — o único formato
   * onde a divergência aparecia era a tabela do desktop.
   */
  protected readonly remainingCents = computed<number>(
    () => this.totalCents() - this.paidCents(),
  );

  protected readonly hasOverpayment = computed<boolean>(() => this.remainingCents() < 0);

  /** Quanto passou do devido, sempre positivo — o negativo já é `remainingCents`. */
  protected readonly overpaidCents = computed<number>(() => Math.max(0, -this.remainingCents()));

  /** Em aberto nunca é negativo; o excedente tem seu próprio número. */
  protected readonly openCents = computed<number>(() => Math.max(0, this.remainingCents()));

  protected readonly paidCount = computed<number>(
    () => this.installments().filter((r) => r.paid).length,
  );

  protected readonly progressPct = computed<number>(() => {
    const total = this.totalCount();
    if (total <= 0) return 0;
    return Math.round((this.paidCount() / total) * 100);
  });

  /** O cronograma tem que fechar o prêmio ao centavo — é o teste do operador. */
  protected readonly totalMatchesPremium = computed<boolean>(
    () => this.totalCents() === this.premiumAmount(),
  );

  protected readonly countInvalid = computed<boolean>(() => {
    const control = this.form.controls.installments;
    return control.invalid && (control.touched || control.dirty);
  });

  protected readonly payLabel = computed<string>(() => {
    const row = this.payTarget();
    if (!row) return '';
    return `Parcela ${row.number}/${this.totalCount()}`;
  });

  protected readonly unpayMessage = computed<string>(() => {
    const row = this.unpayTarget();
    if (!row) return '';
    return (
      `Desfazer o pagamento da parcela ${row.number}/${this.totalCount()}? ` +
      'Ela volta a contar como em aberto e a data de pagamento é apagada.'
    );
  });

  protected readonly deleteScheduleMessage = computed<string>(() => {
    if (this.paidCount() > 0) {
      return (
        `Este cronograma tem ${this.paidCount()} parcela(s) já paga(s) e por isso não pode ` +
        'ser apagado. Desfaça os pagamentos antes de tentar de novo.'
      );
    }
    return (
      `As ${this.totalCount()} parcelas serão apagadas e o parcelamento do prêmio volta ao ` +
      'início. Esta ação não pode ser desfeita.'
    );
  });

  protected generate(): void {
    if (this.generating()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Verifique o número de parcelas e tente novamente.');
      return;
    }
    const raw = this.form.getRawValue();
    this.error.set(null);
    this.generating.set(true);
    this.insurancesService
      .generateInstallments(this.insuranceId(), {
        installments: Number(raw.installments),
        firstDueDate: raw.firstDueDate || null,
      })
      .subscribe({
        next: (schedule) => {
          this.generating.set(false);
          this.applySchedule(schedule);
          this.notifications.success('Cronograma gerado.');
        },
        error: (err: HttpErrorResponse) => {
          this.generating.set(false);
          const { formMessage } = this.apiErrors.handleForm(
            err,
            this.form,
            'Não foi possível gerar o cronograma.',
          );
          this.error.set(formMessage);
        },
      });
  }

  protected askPay(row: InsuranceInstallment): void {
    if (row.paid) return;
    this.payTarget.set(row);
  }

  protected cancelPay(): void {
    if (this.busyId()) return;
    this.payTarget.set(null);
  }

  protected confirmPay(paidDate: string): void {
    const row = this.payTarget();
    if (!row || this.busyId()) return;
    this.error.set(null);
    this.busyId.set(row.id);
    this.insurancesService
      .payInstallment(this.insuranceId(), row.id, { paidDate })
      .subscribe({
        next: (schedule) => {
          this.busyId.set(null);
          this.payTarget.set(null);
          this.applySchedule(schedule);
          this.notifications.success('Parcela marcada como paga.');
        },
        error: (err: HttpErrorResponse) => {
          this.busyId.set(null);
          this.payTarget.set(null);
          this.error.set(this.apiErrors.messageFor(err, 'Não foi possível marcar a parcela.'));
        },
      });
  }

  protected askUnpay(row: InsuranceInstallment): void {
    if (!row.paid) return;
    this.unpayTarget.set(row);
  }

  protected cancelUnpay(): void {
    if (this.busyId()) return;
    this.unpayTarget.set(null);
  }

  protected confirmUnpay(): void {
    const row = this.unpayTarget();
    if (!row || this.busyId()) return;
    this.error.set(null);
    this.busyId.set(row.id);
    this.insurancesService.unpayInstallment(this.insuranceId(), row.id).subscribe({
      next: (schedule) => {
        this.busyId.set(null);
        this.unpayTarget.set(null);
        this.applySchedule(schedule);
        this.notifications.success('Pagamento desfeito.');
      },
      error: (err: HttpErrorResponse) => {
        this.busyId.set(null);
        this.unpayTarget.set(null);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível desfazer o pagamento.'));
      },
    });
  }

  protected askDeleteSchedule(): void {
    this.deleteScheduleOpen.set(true);
  }

  protected cancelDeleteSchedule(): void {
    if (this.deletingSchedule()) return;
    this.deleteScheduleOpen.set(false);
  }

  protected confirmDeleteSchedule(): void {
    if (this.deletingSchedule()) return;
    this.error.set(null);
    this.deletingSchedule.set(true);
    this.insurancesService.deleteInstallments(this.insuranceId()).subscribe({
      next: () => {
        this.deletingSchedule.set(false);
        this.deleteScheduleOpen.set(false);
        this.applySchedule([]);
        this.notifications.success('Cronograma apagado.');
      },
      error: (err: HttpErrorResponse) => {
        this.deletingSchedule.set(false);
        this.deleteScheduleOpen.set(false);
        this.error.set(this.deleteScheduleErrorMessage(err));
      },
    });
  }

  /**
   * O backend recusa apagar um cronograma com parcela paga (409, e 400 em
   * alguns caminhos de validação). A mensagem genérica de erro não diz ao
   * operador o que fazer; esta diz — e só cai no extrator compartilhado para os
   * demais status.
   */
  private deleteScheduleErrorMessage(err: HttpErrorResponse): string {
    if (err.status === 409 || err.status === 400) {
      this.apiErrors.claim(err);
      return (
        'Não é possível apagar um cronograma com parcelas já pagas. ' +
        'Desfaça os pagamentos e tente de novo.'
      );
    }
    return this.apiErrors.messageFor(err, 'Não foi possível apagar o cronograma.');
  }

  /** Ponto único de escrita do cronograma: estado local + aviso ao pai. */
  private applySchedule(schedule: InsuranceInstallment[]): void {
    this.installments.set(schedule);
    this.changed.emit(schedule);
  }

  /**
   * Valor efetivamente pago de uma parcela. `paidAmountCents` pode vir nulo numa
   * parcela paga sem valor informado — mesma regra de `paidCents()`, para que a
   * linha e o total nunca contem coisas diferentes.
   */
  protected paidAmountOf(row: InsuranceInstallment): number {
    return row.paidAmountCents ?? row.amountCents;
  }

  /** Parcela quitada com valor diferente do devido — precisa saltar aos olhos. */
  protected paidAmountDiverges(row: InsuranceInstallment): boolean {
    return row.paid && this.paidAmountOf(row) !== row.amountCents;
  }

  protected paidAmountClass(row: InsuranceInstallment): string {
    return this.paidAmountDiverges(row) ? 'text-amber-800 font-semibold' : 'text-neutral-600';
  }

  protected chipFor(row: InsuranceInstallment): { label: string; chip: string } {
    if (row.paid) return { label: 'Paga', chip: 'bg-emerald-100 text-emerald-800' };
    if (row.dueDate < this.today) return { label: 'Atrasada', chip: 'bg-rose-100 text-rose-700' };
    return { label: 'Prevista', chip: 'bg-neutral-100 text-neutral-700' };
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
}
