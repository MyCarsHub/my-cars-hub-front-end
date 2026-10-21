import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { MembersSheet } from '../company-settings/members/members-sheet';
import { NotificationService } from '../../services/notification.service';
import { applyPtBrMoneyMask } from '../../utils/ptbr-money-mask';
import {
  formatPtBrMoney,
  formatPtBrNumber,
  parsePtBrMoneyCents,
  parsePtBrNumber,
} from '../../utils/ptbr-number';
import { ArrowSelect } from './arrow-select';
import {
  EXPENSE_CATEGORIES,
  RIDE_APPS,
  RIDE_APP_LABEL,
  brl,
  ddmmyyyy,
  expenseLabel,
  integer,
} from './driver-finance.calc';
import { DriverFinanceClock } from './driver-finance.clock';
import { DriverFinanceSource } from './driver-finance.source';
import { LedgerItem, LedgerItemRequest, LedgerType, RideApp } from './driver-finance.types';

/** Server ceiling per entry: R$ 1.000.000,00 — a guard-rail against an extra zero. */
const MAX_AMOUNT_CENTS = 100_000_000;
/** Server ceilings of the ride details (`DriverLedgerEntryRequestDto`). */
export const MAX_RIDES = 1000;
export const MAX_KM = 5000;
export const MAX_HOURS = 24;
export const MAX_ODOMETER_KM = 2_000_000;

const CHIP =
  'min-h-11 px-4 rounded-full border text-sm font-medium cursor-pointer transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2';
const CHIP_ON = `${CHIP} bg-primary-500 border-primary-500 text-white`;
const CHIP_OFF = `${CHIP} bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50`;

type DetailField = 'rides' | 'hours' | 'km';

/**
 * Hours as the driver types them: "7", "7,5", "7,25" and also "7.5" (a phone keyboard
 * often only offers the dot). Two decimals at most, up to `MAX_HOURS`.
 */
export function parseHours(raw: string): { value: number | null; error: string | null } {
  const text = raw.trim();
  if (!text) return { value: null, error: null };
  const normalized = /^\d+\.\d{1,2}$/.test(text) ? text.replace('.', ',') : text;
  const { scaled } = parsePtBrNumber(normalized, 2);
  if (scaled === null) return { value: null, error: 'Use só números, como 7,5.' };
  const value = scaled / 100;
  if (value > MAX_HOURS) return { value: null, error: `No máximo ${MAX_HOURS} horas.` };
  return { value, error: null };
}

/** The message a refused save shows: a 400 is about the values, not about the connection. */
export function saveErrorMessage(error: unknown, action: 'salvar' | 'excluir'): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Sem conexão. Confira a internet e tente de novo.';
    if (error.status === 400 || error.status === 422) {
      return 'O servidor recusou o lançamento. Confira os valores e tente de novo.';
    }
    if (error.status === 404) return 'Este lançamento não existe mais. Atualize a tela.';
  }
  return `Não foi possível ${action}. Tente novamente.`;
}

/**
 * The launch popup of the driver's finance screens — "Novo ganho", "Novo custo", the
 * Dashboard's «Lançar» (with the Ganho/Custo tabs) and the edit of any row, which opens
 * this same popup with «Excluir» as the secondary destructive action.
 *
 * Bottom sheet on phones, 480px modal from `sm` (the shell is `MembersSheet`, which brings
 * the focus trap, Escape and the scroll lock). Focus lands on Valor, the only required
 * field, so "Lançar → valor → Salvar" is three touches.
 *
 * An edit sends back everything the UI does not show: the category or app the driver has
 * no chip for, the `rentalId`, the notes of a cost. The PUT replaces the whole entry, so
 * nothing may be coerced to a UI default on the way.
 */
@Component({
  selector: 'app-ledger-entry-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MembersSheet, AlertBanner, ArrowSelect],
  template: `
    <app-members-sheet
      size="form"
      [open]="open()"
      [title]="title()"
      [subtitle]="subtitle()"
      (closed)="close()"
    >
      @if (showTabs()) {
        <div role="tablist" aria-label="Tipo de lançamento" appArrowSelect
          class="mx-4 sm:mx-6 mt-1 mb-4 grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1">
          <button type="button" role="tab" id="ledger-tab-INCOME" data-tab="INCOME"
            aria-controls="ledger-entry-form" [attr.aria-selected]="type() === 'INCOME'"
            [attr.tabindex]="type() === 'INCOME' ? 0 : -1" (click)="setType('INCOME')"
            [class]="type() === 'INCOME' ? tabOn : tabOff">Ganho</button>
          <button type="button" role="tab" id="ledger-tab-EXPENSE" data-tab="EXPENSE"
            aria-controls="ledger-entry-form" [attr.aria-selected]="type() === 'EXPENSE'"
            [attr.tabindex]="type() === 'EXPENSE' ? 0 : -1" (click)="setType('EXPENSE')"
            [class]="type() === 'EXPENSE' ? tabOn : tabOff">Custo</button>
        </div>
      }
      <form
        id="ledger-entry-form"
        novalidate
        [attr.role]="showTabs() ? 'tabpanel' : null"
        [attr.aria-labelledby]="showTabs() ? 'ledger-tab-' + type() : null"
        (submit)="$event.preventDefault(); save()"
        class="px-4 sm:px-6 pt-1 pb-4 flex flex-col gap-5"
      >
        @if (serverError(); as message) {
          <app-alert-banner variant="error" [message]="message" />
        }

        <div class="flex flex-col gap-2">
          <label for="ledger-amount" class="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Valor
          </label>
          <input
            #amountInput
            id="ledger-amount"
            data-field="amount"
            inputmode="decimal"
            autocomplete="off"
            placeholder="R$ 0,00"
            [value]="amount()"
            (input)="onAmount($event)"
            [attr.aria-invalid]="amountError() ? 'true' : null"
            [attr.aria-describedby]="amountError() ? 'ledger-amount-error' : null"
            class="min-h-14 w-full rounded-xl border bg-white px-4 text-2xl font-semibold tabular-nums
                   text-neutral-900 placeholder:text-neutral-400 focus:outline-none
                   focus-visible:ring-2 focus-visible:ring-primary-500"
            [class]="amountError() ? 'border-rose-400' : 'border-neutral-200'"
          />
          @if (amountError(); as message) {
            <span id="ledger-amount-error" class="text-xs text-rose-700" role="alert">{{ message }}</span>
          }
        </div>

        @if (type() === 'INCOME') {
          <div class="flex flex-col gap-2">
            <span id="ledger-app-label" class="text-xs font-medium uppercase tracking-wide text-neutral-500">App</span>
            <div role="radiogroup" aria-labelledby="ledger-app-label" appArrowSelect class="flex flex-wrap gap-2">
              @for (a of apps; track a; let first = $first) {
                <button type="button" role="radio" [attr.data-app]="a"
                  [attr.aria-checked]="app() === a" (click)="app.set(a)"
                  [attr.tabindex]="app() === a || (app() === null && first) ? 0 : -1"
                  [class]="app() === a ? chipOn : chipOff">{{ appLabels[a] }}</button>
              }
            </div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            @for (f of detailFields; track f.key) {
              <div class="flex flex-col gap-2 min-w-0">
                <label [for]="'ledger-' + f.key" class="text-xs font-medium uppercase tracking-wide text-neutral-500">{{ f.label }}</label>
                <input [id]="'ledger-' + f.key" [attr.data-field]="f.key" [attr.inputmode]="f.mode" placeholder="0"
                  [value]="detail(f.key)" (input)="onDetail(f.key, $event)"
                  [attr.aria-invalid]="fieldError(f.key) ? 'true' : null"
                  [attr.aria-describedby]="fieldError(f.key) ? 'ledger-' + f.key + '-error' : null"
                  [class]="inputClass + (fieldError(f.key) ? ' border-rose-400' : ' border-neutral-200')" />
                @if (fieldError(f.key); as message) {
                  <span [id]="'ledger-' + f.key + '-error'" role="alert" class="text-xs text-rose-700">{{ message }}</span>
                }
              </div>
            }
          </div>
          <div class="flex flex-col gap-2">
            <label for="ledger-notes" class="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Observação (opcional)
            </label>
            <input id="ledger-notes" maxlength="200" placeholder="Ex.: corrida paga em dinheiro"
              [value]="notes()" (input)="notes.set(text($event))" [class]="inputClass + ' border-neutral-200'" />
          </div>
        } @else {
          <div class="flex flex-col gap-2">
            <span id="ledger-cat-label" class="text-xs font-medium uppercase tracking-wide text-neutral-500">Categoria</span>
            <div role="radiogroup" aria-labelledby="ledger-cat-label" appArrowSelect class="flex flex-wrap gap-2">
              @for (c of categoryChips(); track c) {
                <button type="button" role="radio" [attr.data-category]="c"
                  [attr.aria-checked]="category() === c" (click)="category.set(c)"
                  [attr.tabindex]="category() === c ? 0 : -1"
                  [class]="category() === c ? chipOn : chipOff">{{ label(c) }}</button>
              }
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <label for="ledger-odometer" class="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Km atual do carro
            </label>
            <input id="ledger-odometer" inputmode="numeric" placeholder="Ex.: 48.320"
              [attr.aria-describedby]="odometerError() ? 'ledger-odometer-error ledger-odometer-hint' : 'ledger-odometer-hint'"
              [attr.aria-invalid]="odometerError() ? 'true' : null" [value]="odometer()"
              (input)="odometer.set(digits($event)); odometerError.set(null)"
              [class]="inputClass + (odometerError() ? ' border-rose-400' : ' border-neutral-200')" />
            @if (odometerError(); as message) {
              <span id="ledger-odometer-error" role="alert" class="text-xs text-rose-700">{{ message }}</span>
            }
            <span id="ledger-odometer-hint" class="text-xs text-neutral-500">{{ odometerHint() }}</span>
          </div>
        }
      </form>

      <div sheetFooter
        class="border-t border-neutral-100 px-4 sm:px-6 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] flex flex-col gap-2">
        @if (editing()) {
          <button type="button" data-action="remove" (click)="remove()" [disabled]="busy()"
            class="self-start min-h-11 px-1 text-sm font-semibold text-rose-700 cursor-pointer
                   hover:underline disabled:opacity-60 focus:outline-none focus-visible:ring-2
                   focus-visible:ring-rose-500 rounded">
            {{ type() === 'INCOME' ? 'Excluir ganho' : 'Excluir custo' }}
          </button>
        }
        <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" (click)="close()"
            class="min-h-11 w-full sm:w-auto px-5 rounded-xl border border-neutral-300 bg-white text-sm
                   font-semibold text-neutral-800 hover:bg-neutral-50 cursor-pointer focus:outline-none
                   focus-visible:ring-2 focus-visible:ring-neutral-400">
            Cancelar
          </button>
          <button type="submit" form="ledger-entry-form" data-action="save" [disabled]="busy()"
            class="min-h-11 w-full sm:w-auto px-6 rounded-xl bg-primary-500 text-sm font-semibold text-white
                   hover:bg-primary-600 cursor-pointer disabled:opacity-60 focus:outline-none
                   focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
            {{ saveLabel() }}
          </button>
        </div>
      </div>
    </app-members-sheet>
  `,
})
export class LedgerEntrySheet {
  private readonly source = inject(DriverFinanceSource);
  private readonly notify = inject(NotificationService);
  private readonly clock = inject(DriverFinanceClock);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Highest odometer in what the page loaded — the "Último registro" hint. */
  readonly lastOdometer = input<number | null>(null);

  readonly saved = output<{ item: LedgerItem; created: boolean }>();
  readonly removed = output<string>();

  protected readonly apps = RIDE_APPS;
  protected readonly appLabels = RIDE_APP_LABEL;
  protected readonly label = expenseLabel;
  protected readonly chipOn = CHIP_ON;
  protected readonly chipOff = CHIP_OFF;
  protected readonly detailFields: readonly { key: DetailField; label: string; mode: string }[] = [
    { key: 'rides', label: 'Corridas', mode: 'numeric' },
    { key: 'hours', label: 'Horas', mode: 'decimal' },
    { key: 'km', label: 'Km', mode: 'numeric' },
  ];
  protected readonly tabOn =
    'min-h-11 rounded-lg bg-white text-sm font-semibold text-neutral-900 shadow-sm cursor-pointer ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
  protected readonly tabOff =
    'min-h-11 rounded-lg text-sm font-semibold text-neutral-600 cursor-pointer hover:text-neutral-900 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
  protected readonly inputClass =
    'min-h-12 w-full rounded-xl border bg-white px-3 text-base text-neutral-800 ' +
    'placeholder:text-neutral-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  readonly open = signal(false);
  protected readonly showTabs = signal(false);
  protected readonly editing = signal<LedgerItem | null>(null);
  protected readonly type = signal<LedgerType>('INCOME');
  protected readonly amount = signal('');
  /** `null` = an entry saved without app: stays without one unless the driver picks one. */
  protected readonly app = signal<RideApp | null>('UBER');
  private readonly details = signal<Record<DetailField, string>>({ rides: '', hours: '', km: '' });
  private readonly detailErrors = signal<Record<DetailField, string | null>>({
    rides: null,
    hours: null,
    km: null,
  });
  protected readonly notes = signal('');
  protected readonly category = signal<string>('FUEL');
  protected readonly odometer = signal('');
  protected readonly odometerError = signal<string | null>(null);
  protected readonly amountError = signal<string | null>(null);
  protected readonly serverError = signal<string | null>(null);
  protected readonly busy = signal(false);

  private readonly amountInput = viewChild<ElementRef<HTMLInputElement>>('amountInput');

  /** The UI's chips, plus the entry's own category when the UI has no chip for it. */
  protected readonly categoryChips = computed(() => {
    const own = this.editing()?.type === 'EXPENSE' ? this.editing()!.category : null;
    const chips: string[] = [...EXPENSE_CATEGORIES];
    if (own && !chips.includes(own)) chips.push(own);
    return chips;
  });

  protected readonly title = computed(() => {
    if (this.showTabs()) return 'Lançar';
    const edit = this.editing() !== null;
    if (this.type() === 'INCOME') return edit ? 'Editar ganho' : 'Novo ganho';
    return edit ? 'Editar custo' : 'Novo custo';
  });

  protected readonly subtitle = computed(() => {
    const today = this.clock.today();
    const date = this.editing()?.date ?? today;
    return date === today ? `Hoje, ${ddmmyyyy(date)}` : ddmmyyyy(date);
  });

  protected readonly saveLabel = computed(() => {
    if (!this.showTabs()) return 'Salvar';
    return this.type() === 'INCOME' ? 'Salvar ganho' : 'Salvar custo';
  });

  protected readonly odometerHint = computed(() => {
    const last = this.lastOdometer();
    return last ? `Último registro: ${integer(last)} km.` : 'Último registro: nenhum.';
  });

  protected detail(key: DetailField): string {
    return this.details()[key];
  }

  protected fieldError(key: DetailField): string | null {
    return this.detailErrors()[key];
  }

  /** New entry. `withTabs` is the Dashboard's «Lançar», where the driver picks the type. */
  openCreate(type: LedgerType, withTabs = false): void {
    this.reset();
    this.type.set(type);
    this.showTabs.set(withTabs);
    this.show();
  }

  openEdit(item: LedgerItem): void {
    this.reset();
    this.editing.set(item);
    this.type.set(item.type);
    this.amount.set(formatPtBrMoney(item.amount));
    if (item.type === 'INCOME') {
      this.app.set(item.app);
      this.details.set({
        rides: item.rides !== null ? String(item.rides) : '',
        hours: item.hours !== null
          ? formatPtBrNumber(Math.round(item.hours * 100), 2, { trailingZeros: false })
          : '',
        km: item.km !== null ? String(item.km) : '',
      });
      this.notes.set(item.notes ?? '');
    } else {
      this.category.set(item.category);
      this.odometer.set(item.odometerKm !== null ? String(item.odometerKm) : '');
    }
    this.show();
  }

  close(): void {
    if (this.busy()) return;
    this.open.set(false);
  }

  protected setType(type: LedgerType): void {
    this.type.set(type);
    this.amountError.set(null);
  }

  protected onAmount(event: Event): void {
    this.amount.set(applyPtBrMoneyMask(event, this.amount()).value);
    this.amountError.set(null);
  }

  protected onDetail(key: DetailField, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = key === 'hours' ? raw.slice(0, 6) : raw.replace(/\D/g, '').slice(0, 6);
    this.details.update((d) => ({ ...d, [key]: value }));
    this.detailErrors.update((e) => ({ ...e, [key]: null }));
  }

  protected digits(event: Event): string {
    return (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 7);
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  save(): void {
    if (this.busy()) return;
    const { scaled } = parsePtBrMoneyCents(this.amount().trim());
    if (!scaled) {
      this.amountError.set('Informe o valor.');
      this.focus('ledger-amount');
      return;
    }
    if (scaled > MAX_AMOUNT_CENTS) {
      this.amountError.set('Valor acima de R$ 1.000.000,00. Confira os zeros.');
      this.focus('ledger-amount');
      return;
    }
    const details = this.type() === 'INCOME' ? this.validateDetails() : null;
    if (details === undefined) return;
    if (this.type() === 'EXPENSE' && this.odometer() !== '' && Number(this.odometer()) > MAX_ODOMETER_KM) {
      this.odometerError.set(`No máximo ${integer(MAX_ODOMETER_KM)} km.`);
      this.focus('ledger-odometer');
      return;
    }
    const request = this.request(scaled, details);
    const editing = this.editing();
    this.busy.set(true);
    this.serverError.set(null);
    const call = editing ? this.source.update(editing.id, request) : this.source.create(request);
    call.subscribe({
      next: (item) => {
        this.busy.set(false);
        this.open.set(false);
        this.saved.emit({ item, created: !editing });
        const noun = item.type === 'INCOME' ? 'Ganho' : 'Custo';
        this.notify.success(editing ? `${noun} atualizado.` : `${noun} de ${brl(item.amount)} lançado.`);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.serverError.set(saveErrorMessage(error, 'salvar'));
      },
    });
  }

  remove(): void {
    const editing = this.editing();
    if (!editing || this.busy()) return;
    this.busy.set(true);
    this.serverError.set(null);
    this.source.remove(editing.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.open.set(false);
        this.removed.emit(editing.id);
        this.notify.success(editing.type === 'INCOME' ? 'Ganho removido.' : 'Custo removido.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.serverError.set(saveErrorMessage(error, 'excluir'));
      },
    });
  }

  /** Rides, hours and km against the server's ceilings; `undefined` = an error is on screen. */
  private validateDetails(): { rides: number | null; hours: number | null; km: number | null } | undefined {
    const d = this.details();
    const errors: Record<DetailField, string | null> = { rides: null, hours: null, km: null };
    // Zero is a value ("0 corridas"), not "empty": only an empty field becomes null.
    const rides = d.rides !== '' ? Number(d.rides) : null;
    const km = d.km !== '' ? Number(d.km) : null;
    const hours = parseHours(d.hours);
    if (rides !== null && rides > MAX_RIDES) errors.rides = `No máximo ${integer(MAX_RIDES)}.`;
    if (km !== null && km > MAX_KM) errors.km = `No máximo ${integer(MAX_KM)} km.`;
    errors.hours = hours.error;
    this.detailErrors.set(errors);
    const first = this.detailFields.find((f) => errors[f.key]);
    if (first) {
      this.focus(`ledger-${first.key}`);
      return undefined;
    }
    return { rides, hours: hours.value, km };
  }

  private request(
    amount: number,
    details: { rides: number | null; hours: number | null; km: number | null } | null,
  ): LedgerItemRequest {
    const editing = this.editing();
    const date = editing?.date ?? this.clock.today();
    const rentalId = editing?.rentalId ?? null;
    if (this.type() === 'INCOME') {
      return {
        date,
        type: 'INCOME',
        // An income category with no chip (DELIVERIES, OTHER_INCOME) survives the edit.
        category: editing?.type === 'INCOME' ? editing.category : 'RIDES',
        amount,
        app: this.app(),
        rides: details?.rides ?? null,
        hours: details?.hours ?? null,
        km: details?.km ?? null,
        odometerKm: null,
        notes: this.notes().trim() || null,
        rentalId,
      };
    }
    return {
      date,
      type: 'EXPENSE',
      category: this.category(),
      amount,
      app: null,
      rides: null,
      hours: null,
      km: null,
      odometerKm: this.odometer() !== '' ? Number(this.odometer()) : null,
      // Costs have no notes field on screen: the edit keeps what was there.
      notes: editing?.type === 'EXPENSE' ? editing.notes : null,
      rentalId,
    };
  }

  private reset(): void {
    this.editing.set(null);
    this.showTabs.set(false);
    this.amount.set('');
    this.app.set('UBER');
    this.details.set({ rides: '', hours: '', km: '' });
    this.detailErrors.set({ rides: null, hours: null, km: null });
    this.notes.set('');
    this.category.set('FUEL');
    this.odometer.set('');
    this.odometerError.set(null);
    this.amountError.set(null);
    this.serverError.set(null);
    this.busy.set(false);
  }

  private show(): void {
    this.open.set(true);
    this.focus('ledger-amount');
  }

  /** After the sheet focused its own panel (its effect runs first), the field takes the focus. */
  private focus(id: string): void {
    if (!this.isBrowser) return;
    setTimeout(() => {
      const el =
        id === 'ledger-amount'
          ? (this.amountInput()?.nativeElement ?? this.document.getElementById(id))
          : this.document.getElementById(id);
      el?.focus({ preventScroll: true });
    });
  }
}
