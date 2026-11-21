import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Subject, catchError, debounceTime, map, of, switchMap } from 'rxjs';

import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { PaintedCard } from '../../../components/core/painted-card/painted-card';
import { RentalResponseDto } from '../../../types/rental.types';
import {
  RENEWAL_CODES,
  RenewRentalRequest,
  RenewalPreviewDto,
  RenewalUnit,
} from '../../../types/rental-renewal.types';
import { applyPtBrMoneyMaskToControl } from '../../../utils/ptbr-money-mask';
import { ptBrMoneyCents } from '../../../utils/validators/ptbr-money.validator';
import { brDate, brDayMonth, brl } from '../charges-flex/charges-flex';
import { centsText } from '../rental-create/create-form';
import { PreviewSheet } from '../rental-create/cards/preview-sheet';
import { periodWords } from '../rental-wizard/wizard-format';
import { RentalRenewalService } from './rental-renewal.service';
import {
  RENEWAL_AMOUNT_MAX,
  allowedUnits,
  chargesModel,
  defaultAmount,
  defaultUnit,
  fitToMax,
  newEndTail,
  previewErrorMessage,
  overdueText,
  rateHint,
  renewErrorMessage,
  sayText,
  takenMaxEnd,
  totalCaption,
  unitWord,
  vehicleTakenText,
} from './renewal';

/** Espera depois da última tecla antes de pedir a prévia ao servidor. */
export const RENEW_PREVIEW_DEBOUNCE_MS = 300;

/** O que a página recebe depois de renovar (RenR6). */
export interface RenewedResult {
  /** O aluguel renovado; `chargeSync` diz o que de fato foi ao Asaas. */
  rental: RentalResponseDto;
  /** Quantas a prévia mandaria ao Asaas (o aviso usa quando a resposta vem sem `chargeSync`). */
  gatewayCount: number;
}

type PreviewState =
  | { key: string; preview: RenewalPreviewDto; failed: false }
  | { key: string; preview: null; failed: true; message: string };

/**
 * "Renovar aluguel" (pranchas RenR2–R5 / RenD1): folha de baixo no celular, janela no centro no
 * computador (`app-bottom-sheet`). Quanto tempo a mais (quantidade + dias/semanas/meses), o
 * valor de cada período (preenchido com o atual), o total pintado de laranja e "Ver as N
 * cobranças" (RenR3, a folha de prévia do Novo aluguel). A prévia é do SERVIDOR
 * (`renew-preview`, com espera); o botão só envia o corpo que a prévia na tela mostrou.
 */
@Component({
  selector: 'app-renew-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, PaintedCard, PreviewSheet, ReactiveFormsModule],
  styles: `
    .rn-body { display: flex; flex-direction: column; gap: 14px; }
    .rn-lb { display: block; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--color-fg-soft); margin-bottom: 6px; }
    .rn-req { color: var(--color-primary-500); }
    .rn-qty { display: grid; grid-template-columns: 110px 1fr; gap: 12px; }
    .rn-in, .rn-sel, .rn-mny {
      width: 100%; min-height: 48px; border-radius: 12px; border: 1px solid var(--color-edge-field);
      background: var(--color-surface); color: var(--color-fg); font: inherit; font-size: 16px; line-height: 24px;
    }
    .rn-in { padding: 11px 16px; font-variant-numeric: tabular-nums; }
    .rn-sel {
      padding: 11px 40px 11px 16px; appearance: none;
      background: var(--color-surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%238E8E97' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 14px center;
    }
    :host-context(.dark) .rn-sel { color-scheme: dark; }
    .rn-mny { display: flex; align-items: center; gap: 8px; padding: 0 16px; }
    .rn-mny .pre { color: var(--color-fg-faint); }
    .rn-mny input { flex: 1; min-width: 0; border: 0; background: transparent; padding: 11px 0; outline: none; font: inherit; color: inherit; font-variant-numeric: tabular-nums; }
    .rn-in:focus-visible, .rn-sel:focus-visible, .rn-mny:focus-within {
      outline: none; border-color: var(--color-primary-600); box-shadow: 0 0 0 1px var(--color-primary-600);
    }
    .rn-in.bad, .rn-mny.bad { border-color: #f43f5e; }
    .rn-h { margin: 6px 0 0; font-size: 14px; line-height: 20px; color: var(--color-fg-subtle); }
    .rn-h b { font-weight: 600; color: var(--color-fg); }
    .rn-err { margin: 6px 0 0; font-size: 14px; line-height: 20px; font-weight: 500; }
    .rn-tot { gap: 4px !important; padding: 16px !important; transition: opacity 200ms cubic-bezier(0.32, 0.72, 0, 1); }
    .rn-tot.wait { opacity: 0.6; }
    .rn-k { font-size: 13px; line-height: 20px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    .rn-v { font-size: 30px; line-height: 38px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .rn-c { font-size: 15px; line-height: 22px; }
    .rn-lnk {
      align-self: flex-start; min-height: 44px; padding: 0; border: 0; background: transparent; cursor: pointer; text-align: left;
      font: inherit; font-size: 16px; line-height: 24px; font-weight: 600; color: var(--color-primary-700);
    }
    :host-context(.dark) .rn-lnk { color: var(--color-primary-400); }
    .rn-warn { border-radius: 14px; padding: 14px 16px; background: var(--color-canvas); font-size: 15px; line-height: 22px; color: var(--color-fg-body); }
    .rn-warn b { font-weight: 600; color: var(--color-primary-700); }
    :host-context(.dark) .rn-warn b { color: var(--color-primary-400); }
    .rn-say { margin: 0; font-size: 15px; line-height: 22px; color: var(--color-fg-body); }
    .rn-say b { font-weight: 600; color: var(--color-fg); }
    .rn-act { display: flex; flex-direction: column; gap: 10px; }
    .rn-go {
      display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 52px; border: 0; border-radius: 12px;
      background: var(--color-primary-500); color: #fff; font: inherit; font-size: 17px; line-height: 24px; font-weight: 600; cursor: pointer;
    }
    .rn-go:disabled { opacity: 0.45; cursor: not-allowed; }
    .rn-no {
      width: 100%; min-height: 48px; border: 0; border-radius: 12px; background: transparent; cursor: pointer;
      font: inherit; font-size: 16px; font-weight: 600; color: var(--color-fg-muted);
    }
    .rn-go:focus-visible, .rn-no:focus-visible, .rn-lnk:focus-visible { outline: 2px solid var(--color-primary-400); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .rn-tot { transition: none; } }
  `,
  template: `
    @if (view() === 'form') {
      <app-bottom-sheet #sheet title="Renovar aluguel" size="lg" [busy]="saving()" (closed)="onSheetClosed()">
        <div class="rn-body" data-testid="renew-sheet">
          <div>
            <label class="rn-lb" for="rn-amount">Renovar por mais <span class="rn-req" aria-hidden="true">*</span></label>
            <div class="rn-qty">
              <input
                id="rn-amount"
                class="rn-in"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                data-testid="renew-amount"
                aria-required="true"
                [attr.data-autofocus]="backFromCharges() ? null : ''"
                [class.bad]="!!amountError()"
                [value]="amountText()"
                [attr.aria-invalid]="amountError() ? 'true' : null"
                [attr.aria-describedby]="amountError() ? 'rn-amount-err' : newEnd() ? 'rn-amount-hint' : null"
                (input)="onAmount($event)"
              />
              <select
                class="rn-sel"
                aria-label="Unidade"
                aria-required="true"
                data-testid="renew-unit"
                [value]="unit()"
                (change)="onUnit($event)"
              >
                @for (u of units(); track u) {
                  <option [value]="u" [selected]="u === unit()">{{ unitLabel(u) }}</option>
                }
              </select>
            </div>
            @if (amountError(); as m) {
              <p class="rn-err text-rose-700 dark:text-rose-300" role="alert" id="rn-amount-err">{{ m }}</p>
            } @else if (newEnd(); as end) {
              <p class="rn-h" id="rn-amount-hint" data-testid="renew-new-end">
                Novo fim: <b>{{ end.date }}</b> {{ end.tail }}
              </p>
            }
          </div>

          <div>
            <label class="rn-lb" for="rn-rate">Valor de cada {{ words().lower }} <span class="rn-req" aria-hidden="true">*</span></label>
            <div class="rn-mny" [class.bad]="!!rateError()">
              <span class="pre">R$</span>
              <input
                id="rn-rate"
                inputmode="decimal"
                autocomplete="off"
                placeholder="0,00"
                data-testid="renew-rate"
                aria-required="true"
                [formControl]="rate"
                [attr.aria-invalid]="rateError() ? 'true' : null"
                [attr.aria-describedby]="rateError() ? 'rn-rate-err' : 'rn-rate-hint'"
                (input)="onRate($event)"
              />
            </div>
            @if (rateError(); as m) {
              <p class="rn-err text-rose-700 dark:text-rose-300" role="alert" id="rn-rate-err">{{ m }}</p>
            } @else {
              <p class="rn-h" id="rn-rate-hint">{{ currentRateHint() }}</p>
            }
          </div>

          @if (taken(); as t) {
            <div class="rn-warn" data-testid="renew-taken" role="status">
              <b>{{ t.lead }}</b> {{ t.rest }}
            </div>
          } @else if (blockerMessage(); as m) {
            <div class="rn-warn" data-testid="renew-blocker" role="status">{{ m }}</div>
          } @else if (previewFailed(); as m) {
            <div class="rn-warn" data-testid="renew-preview-failed" role="status">
              {{ m }}
              <button type="button" class="rn-lnk" (click)="retryPreview()">Tentar de novo</button>
            </div>
          } @else if (shown(); as p) {
            <app-painted-card tone="orange" class="rn-tot" [class.wait]="!fresh()" data-testid="renew-total">
              <span class="rn-k">Renovação</span>
              <span class="rn-v">{{ money(p.addedTotalCents) }}</span>
              <span class="rn-c">{{ caption() }}</span>
            </app-painted-card>
            <button
              type="button"
              class="rn-lnk"
              data-testid="renew-see-charges"
              [attr.data-autofocus]="backFromCharges() ? '' : null"
              (click)="seeCharges()"
            >
              {{ seeChargesLabel() }}
            </button>
            @if (overdue(); as o) {
              <div class="rn-warn" data-testid="renew-overdue"><b>{{ o.lead }}</b> {{ o.rest }}</div>
            }
            @if (say(); as s) {
              <p class="rn-say" data-testid="renew-say">{{ s.before }}<b>{{ s.bold }}</b>{{ s.after }}</p>
            }
          }

          @if (error(); as m) {
            <p class="rn-err text-rose-700 dark:text-rose-300" role="alert" data-testid="renew-error">{{ m }}</p>
          }
          <p class="sr-only" aria-live="polite" data-testid="renew-live">{{ liveText() }}</p>
        </div>
        <div sheetFooter class="rn-act">
          @if (takenMax() && !fitting()) {
            @if (fit()) {
              <button type="button" class="rn-go" data-testid="renew-fit" (click)="applyFit()">
                Renovar até {{ takenUntil() }}
              </button>
            }
            <button type="button" class="rn-no" data-testid="renew-back" (click)="close()">Voltar</button>
          } @else {
            <button
              type="button"
              class="rn-go"
              data-testid="renew-submit"
              [disabled]="!canSubmit()"
              [attr.aria-busy]="saving() || fitting() ? 'true' : null"
              (click)="submit()"
            >
              {{ saving() || fitting() ? 'Renovando…' : 'Renovar e criar cobranças' }}
            </button>
            <button type="button" class="rn-no" data-testid="renew-cancel" [disabled]="saving()" (click)="close()">Cancelar</button>
          }
        </div>
      </app-bottom-sheet>
    } @else if (chargesPreview(); as m) {
      <app-rc-preview-sheet title="Cobranças da renovação" [model]="m" testId="renew-charges" (closed)="backToForm()" />
    }
  `,
})
export class RenewSheet implements OnInit {
  private readonly api = inject(RentalRenewalService);

  readonly rental = input.required<RentalResponseDto>();
  readonly closed = output<void>();
  readonly renewed = output<RenewedResult>();
  /**
   * `RENEWAL_STALE`/`RENEWAL_NOT_ACTIVE` (na prévia ou no envio): a página relê o aluguel por
   * trás da folha; o fim novo entra no corpo e a prévia roda de novo sozinha.
   */
  readonly stale = output<void>();

  /** Só as unidades que fecham períodos inteiros da frequência do aluguel. */
  protected readonly units = computed(() => allowedUnits(this.rental().billingFrequency));
  protected readonly view = signal<'form' | 'charges'>('form');
  private readonly sheet = viewChild<BottomSheet>('sheet');
  /** Para onde a folha vai depois da animação de saída. */
  private next: 'charges' | 'exit' = 'exit';
  /** Voltou de "Cobranças da renovação": o foco volta ao link que abriu a lista. */
  protected readonly backFromCharges = signal(false);

  // ------------------------------------------------------------------ campos
  protected readonly unit = signal<RenewalUnit>('WEEKS');
  protected readonly amountText = signal('1');
  protected readonly rate = new FormControl('', { nonNullable: true });
  private readonly rateText = toSignal(this.rate.valueChanges, { initialValue: '' });

  protected readonly words = computed(() => periodWords(this.rental().billingFrequency));
  protected readonly amount = computed(() => {
    const t = this.amountText().trim();
    return /^\d+$/.test(t) ? Number(t) : null;
  });
  protected readonly amountError = computed(() => {
    const n = this.amount();
    if (n === null || n < 1) return 'Informe ao menos 1.';
    if (n > RENEWAL_AMOUNT_MAX) return `Use no máximo ${RENEWAL_AMOUNT_MAX}.`;
    return null;
  });
  private readonly rateCents = computed(() => ptBrMoneyCents(this.rateText()));
  protected readonly rateError = computed(() => {
    const c = this.rateCents();
    return c === null || c <= 0 ? `Digite o valor de cada ${this.words().lower}, por exemplo 600,00.` : null;
  });
  protected readonly currentRateHint = computed(() =>
    rateHint(this.rental().periodRate, this.rental().billingFrequency),
  );

  /** O corpo de agora; `null` com campo inválido (sem prévia). */
  protected readonly request = computed<RenewRentalRequest | null>(() => {
    const n = this.amount();
    const rate = this.rateCents();
    if (this.amountError() || this.rateError() || n === null || rate === null) return null;
    return { additionalAmount: n, unit: this.unit(), periodRate: rate, expectedEndDate: this.rental().endDate };
  });
  private readonly requestKey = computed(() => {
    const r = this.request();
    return r ? JSON.stringify(r) : '';
  });

  // ------------------------------------------------------------------ prévia do servidor
  private readonly state = signal<PreviewState | null>(null);
  protected readonly loading = signal(false);
  private readonly requests = new Subject<{ key: string; body: RenewRentalRequest } | null>();
  /** 409 `VEHICLE_PERIOD_TAKEN` no envio (a prévia anterior ainda não sabia da reserva). */
  private readonly conflictMax = signal<string | null>(null);

  /** A última prévia que deu certo (fica na tela, apagada, enquanto a nova chega). */
  protected readonly shown = computed(() => {
    const s = this.state();
    return s && !s.failed ? s.preview : null;
  });
  protected readonly fresh = computed(() => {
    const s = this.state();
    return !!s && !s.failed && s.key === this.requestKey() && !this.loading();
  });
  /** A prévia do corpo de agora falhou: a frase do servidor (400) ou a genérica. */
  protected readonly previewFailed = computed(() => {
    const s = this.state();
    return s && s.failed && s.key === this.requestKey() && !this.loading() ? s.message : null;
  });
  private readonly blocker = computed(() => (this.fresh() ? (this.shown()?.blocker ?? null) : null));
  protected readonly takenMax = computed(() => {
    const b = this.blocker();
    if (b?.code === RENEWAL_CODES.VEHICLE_PERIOD_TAKEN && b.maxEndDate) return b.maxEndDate;
    return this.conflictMax();
  });
  protected readonly fit = computed(() => {
    const max = this.takenMax();
    return max ? fitToMax(this.rental().endDate, max, this.unit(), this.units()) : null;
  });
  protected readonly takenUntil = computed(() => brDayMonth(this.takenMax()));
  protected readonly taken = computed(() => {
    const max = this.takenMax();
    return max ? vehicleTakenText(max, this.fit()) : null;
  });
  /** Qualquer outro bloqueio, inclusive o carro ocupado sem `maxEndDate`: a frase do servidor. */
  protected readonly blockerMessage = computed(() => {
    const b = this.blocker();
    if (!b) return null;
    return b.code === RENEWAL_CODES.VEHICLE_PERIOD_TAKEN && b.maxEndDate ? null : b.message;
  });
  /** "Novo fim" sai SEMPRE da prévia do servidor (períodos inteiros depois do último cobrado). */
  protected readonly newEnd = computed(() => {
    const p = this.fresh() ? this.shown() : null;
    const r = this.request();
    if (!p || !r || p.blocker) return null;
    return { date: brDate(p.newEndDate), tail: newEndTail(p.previousEndDate, r.additionalAmount, r.unit) };
  });
  protected readonly caption = computed(() => {
    const p = this.shown();
    return p ? totalCaption(p, this.rental().billingFrequency) : '';
  });
  protected readonly seeChargesLabel = computed(() => {
    const n = this.shown()?.periods.length ?? 0;
    return n === 1 ? 'Ver a cobrança' : `Ver as ${n} cobranças`;
  });
  /** O total pintado muda sem foco: o leitor de tela ouve a prévia nova quando ela chega. */
  protected readonly liveText = computed(() => {
    const p = this.fresh() ? this.shown() : null;
    if (!p || p.blocker) return '';
    return `Renovação: ${brl(p.addedTotalCents)}. ${this.caption()}. Novo fim: ${brDate(p.newEndDate)}.`;
  });
  protected readonly overdue = computed(() => overdueText(this.shown()?.overdueCount ?? 0));
  protected readonly say = computed(() => {
    const p = this.shown();
    return p ? sayText(p) : null;
  });
  protected readonly chargesPreview = computed(() => {
    const p = this.shown();
    return p ? chargesModel(p, this.rental().billingFrequency) : null;
  });

  // ------------------------------------------------------------------ envio
  protected readonly saving = signal(false);
  /** "Renovar até DD/MM" em curso: ajusta a quantidade, espera a prévia ajustada e renova. */
  protected readonly fitting = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Um POST de renovação em voo: nunca dois (o botão também fica desabilitado). */
  private sending = false;
  /** A prévia já avisou a página deste corpo desatualizado (uma vez por corpo). */
  private staleKey: string | null = null;

  protected readonly canSubmit = computed(
    () =>
      this.fresh() &&
      !this.saving() &&
      !this.fitting() &&
      !this.blocker() &&
      !this.conflictMax() &&
      (this.shown()?.periods.length ?? 0) > 0,
  );

  constructor() {
    this.requests
      .pipe(
        debounceTime(RENEW_PREVIEW_DEBOUNCE_MS),
        switchMap((req) => {
          if (!req) return of(null);
          return this.api.preview(this.rental().id, req.body).pipe(
            map((preview): PreviewState => ({ key: req.key, preview, failed: false })),
            catchError((err: unknown) =>
              of<PreviewState>({ key: req.key, preview: null, failed: true, message: previewErrorMessage(err) }),
            ),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((s) => {
        this.loading.set(false);
        if (s) this.state.set(s);
      });

    // Cada corpo novo pede uma prévia nova (com espera); campo inválido não pede nada.
    effect(() => {
      const body = this.request();
      const key = this.requestKey();
      untracked(() => this.ask(body, key));
    });

    // Prévia que diz "o fim mudou" / "não está ativo": a página relê o aluguel por trás.
    effect(() => {
      const code = this.blocker()?.code;
      if (code !== RENEWAL_CODES.STALE && code !== RENEWAL_CODES.NOT_ACTIVE) return;
      const key = untracked(() => this.requestKey());
      if (key === this.staleKey) return;
      this.staleKey = key;
      untracked(() => this.stale.emit());
    });

    // "Renovar até": a prévia ajustada chegou; renova, tira mais um período, ou para.
    effect(() => {
      if (!this.fitting() || !this.fresh()) return;
      untracked(() => this.continueFit());
    });
  }

  /** Valores iniciais: a unidade da frequência, o tempo mínimo nela, o valor de hoje. */
  ngOnInit(): void {
    const r = this.rental();
    const unit = defaultUnit(r.billingFrequency);
    this.unit.set(unit);
    this.amountText.set(String(defaultAmount(r.minimumTermDays, unit)));
    this.rate.setValue(centsText(r.periodRate));
  }

  private ask(body: RenewRentalRequest | null, key: string): void {
    this.conflictMax.set(null);
    this.loading.set(!!body);
    this.requests.next(body ? { key, body } : null);
  }

  protected retryPreview(): void {
    this.ask(this.request(), this.requestKey());
  }

  protected unitLabel(u: RenewalUnit): string {
    return unitWord(u, this.amount() ?? 2);
  }

  protected money(cents: number): string {
    return brl(cents);
  }

  protected onAmount(event: Event): void {
    this.error.set(null);
    this.fitting.set(false);
    this.amountText.set((event.target as HTMLInputElement).value);
  }

  protected onUnit(event: Event): void {
    this.error.set(null);
    this.fitting.set(false);
    this.unit.set((event.target as HTMLSelectElement).value as RenewalUnit);
  }

  protected onRate(event: Event): void {
    this.error.set(null);
    this.fitting.set(false);
    applyPtBrMoneyMaskToControl(event, this.rate);
  }

  /**
   * RenR5 — "Renovar até 05/01": põe a quantidade que cabe, espera a prévia ajustada e renova,
   * com a mesma trava de envio duplo do botão laranja.
   */
  protected applyFit(): void {
    const f = this.fit();
    if (!f || this.fitting() || this.sending) return;
    const sameBody = f.unit === this.unit() && String(f.amount) === this.amountText().trim();
    this.error.set(null);
    this.fitting.set(true);
    this.unit.set(f.unit);
    this.amountText.set(String(f.amount));
    // Mesmo corpo de antes (o 409 veio no envio): nada muda, então a prévia é pedida de novo.
    if (sameBody) this.retryPreview();
  }

  private continueFit(): void {
    const b = this.blocker();
    if (!b) {
      this.fitting.set(false);
      this.submit();
      return;
    }
    const n = this.amount() ?? 0;
    if (b.code === RENEWAL_CODES.VEHICLE_PERIOD_TAKEN && n > 1) {
      // O palpite não coube (o último período cobrado vai além do fim): um período a menos.
      this.amountText.set(String(n - 1));
      return;
    }
    this.fitting.set(false);
  }

  protected seeCharges(): void {
    this.next = 'charges';
    this.sheet()?.requestClose();
  }

  protected backToForm(): void {
    this.backFromCharges.set(true);
    this.view.set('form');
  }

  protected close(): void {
    this.next = 'exit';
    this.fitting.set(false);
    this.sheet()?.requestClose();
  }

  protected onSheetClosed(): void {
    if (this.next === 'charges') {
      this.next = 'exit';
      this.view.set('charges');
      return;
    }
    this.closed.emit();
  }

  protected submit(): void {
    if (this.sending || !this.canSubmit()) return;
    const body = this.request();
    const preview = this.shown();
    if (!body || !preview) return;
    this.sending = true;
    this.saving.set(true);
    this.error.set(null);
    this.api.renew(this.rental().id, body).subscribe({
      next: (rental) => {
        this.sending = false;
        this.saving.set(false);
        this.renewed.emit({ rental, gatewayCount: preview.gatewayCount });
        this.next = 'exit';
        this.sheet()?.requestClose(true);
      },
      error: (err: unknown) => {
        this.sending = false;
        this.saving.set(false);
        const max = takenMaxEnd(err);
        if (max) {
          this.conflictMax.set(max);
          return;
        }
        this.error.set(renewErrorMessage(err));
        const code = (err as { error?: { code?: unknown } } | null)?.error?.code;
        if (code === RENEWAL_CODES.STALE || code === RENEWAL_CODES.NOT_ACTIVE) this.stale.emit();
      },
    });
  }
}
