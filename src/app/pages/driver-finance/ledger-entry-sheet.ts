import { DOCUMENT, isPlatformBrowser } from '@angular/common';
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
import { formatPtBrMoney, formatPtBrNumber, parsePtBrMoneyCents, parsePtBrNumber } from '../../utils/ptbr-number';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_LABEL,
  RIDE_APPS,
  RIDE_APP_LABEL,
  brl,
  ddmmyyyy,
  integer,
} from './driver-finance.calc';
import { DRIVER_FINANCE_TODAY, DriverFinanceSource } from './driver-finance.source';
import {
  ExpenseCategory,
  LedgerItem,
  LedgerItemRequest,
  LedgerType,
  RideApp,
} from './driver-finance.types';

/** Server ceiling per entry: R$ 1.000.000,00 — a guard-rail against an extra zero. */
const MAX_AMOUNT_CENTS = 100_000_000;

const CHIP =
  'min-h-11 px-4 rounded-full border text-sm font-medium cursor-pointer transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2';
const CHIP_ON = `${CHIP} bg-primary-500 border-primary-500 text-white`;
const CHIP_OFF = `${CHIP} bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50`;

/**
 * The launch popup of the driver's finance screens — "Novo ganho", "Novo custo", the
 * Dashboard's «Lançar» (with the Ganho/Custo tabs) and the edit of any row, which opens
 * this same popup with «Excluir» as the secondary destructive action.
 *
 * Bottom sheet on phones, 480px modal from `sm` (the shell is `MembersSheet`, which brings
 * the focus trap, Escape and the scroll lock). Focus lands on Valor, the only required
 * field, so "Lançar → valor → Salvar" is three touches.
 *
 * It talks to `DriverFinanceSource` itself and tells the page what changed through
 * `saved` / `removed`; the page re-reads or patches its list.
 */
@Component({
  selector: 'app-ledger-entry-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MembersSheet, AlertBanner],
  template: `
    <app-members-sheet
      size="form"
      [open]="open()"
      [title]="title()"
      [subtitle]="subtitle()"
      (closed)="close()"
    >
      <form
        id="ledger-entry-form"
        novalidate
        (submit)="$event.preventDefault(); save()"
        class="px-4 sm:px-6 pt-1 pb-4 flex flex-col gap-5"
      >
        @if (showTabs()) {
          <div role="tablist" aria-label="Tipo de lançamento"
            class="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1">
            <button type="button" role="tab" data-tab="INCOME"
              [attr.aria-selected]="type() === 'INCOME'" (click)="setType('INCOME')"
              [class]="type() === 'INCOME' ? tabOn : tabOff">Ganho</button>
            <button type="button" role="tab" data-tab="EXPENSE"
              [attr.aria-selected]="type() === 'EXPENSE'" (click)="setType('EXPENSE')"
              [class]="type() === 'EXPENSE' ? tabOn : tabOff">Custo</button>
          </div>
        }

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
            <div role="radiogroup" aria-labelledby="ledger-app-label" class="flex flex-wrap gap-2">
              @for (a of apps; track a) {
                <button type="button" role="radio" [attr.data-app]="a"
                  [attr.aria-checked]="app() === a" (click)="app.set(a)"
                  [class]="app() === a ? chipOn : chipOff">{{ appLabels[a] }}</button>
              }
            </div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div class="flex flex-col gap-2 min-w-0">
              <label for="ledger-rides" class="text-xs font-medium uppercase tracking-wide text-neutral-500">Corridas</label>
              <input id="ledger-rides" inputmode="numeric" placeholder="0" [value]="rides()"
                (input)="rides.set(digits($event))" [class]="inputClass" />
            </div>
            <div class="flex flex-col gap-2 min-w-0">
              <label for="ledger-hours" class="text-xs font-medium uppercase tracking-wide text-neutral-500">Horas</label>
              <input id="ledger-hours" inputmode="decimal" placeholder="0" [value]="hours()"
                (input)="hours.set(text($event))" [class]="inputClass" />
            </div>
            <div class="flex flex-col gap-2 min-w-0">
              <label for="ledger-km" class="text-xs font-medium uppercase tracking-wide text-neutral-500">Km</label>
              <input id="ledger-km" inputmode="numeric" placeholder="0" [value]="km()"
                (input)="km.set(digits($event))" [class]="inputClass" />
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <label for="ledger-notes" class="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Observação (opcional)
            </label>
            <input id="ledger-notes" maxlength="200" placeholder="Ex.: corrida paga em dinheiro"
              [value]="notes()" (input)="notes.set(text($event))" [class]="inputClass" />
          </div>
        } @else {
          <div class="flex flex-col gap-2">
            <span id="ledger-cat-label" class="text-xs font-medium uppercase tracking-wide text-neutral-500">Categoria</span>
            <div role="radiogroup" aria-labelledby="ledger-cat-label" class="flex flex-wrap gap-2">
              @for (c of categories; track c) {
                <button type="button" role="radio" [attr.data-category]="c"
                  [attr.aria-checked]="category() === c" (click)="category.set(c)"
                  [class]="category() === c ? chipOn : chipOff">{{ categoryLabels[c] }}</button>
              }
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <label for="ledger-odometer" class="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Km atual do carro
            </label>
            <input id="ledger-odometer" inputmode="numeric" placeholder="Ex.: 48.320"
              aria-describedby="ledger-odometer-hint" [value]="odometer()"
              (input)="odometer.set(digits($event))" [class]="inputClass" />
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
  private readonly today = inject(DRIVER_FINANCE_TODAY);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Highest odometer the driver already typed — the "Último registro" hint. */
  readonly lastOdometer = input<number | null>(null);

  readonly saved = output<{ item: LedgerItem; created: boolean }>();
  readonly removed = output<string>();

  protected readonly apps = RIDE_APPS;
  protected readonly appLabels = RIDE_APP_LABEL;
  protected readonly categories = EXPENSE_CATEGORIES;
  protected readonly categoryLabels = EXPENSE_LABEL;
  protected readonly chipOn = CHIP_ON;
  protected readonly chipOff = CHIP_OFF;
  protected readonly tabOn =
    'min-h-11 rounded-lg bg-white text-sm font-semibold text-neutral-900 shadow-sm cursor-pointer ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
  protected readonly tabOff =
    'min-h-11 rounded-lg text-sm font-semibold text-neutral-600 cursor-pointer hover:text-neutral-900 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
  protected readonly inputClass =
    'min-h-12 w-full rounded-xl border border-neutral-200 bg-white px-3 text-base text-neutral-800 ' +
    'placeholder:text-neutral-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  readonly open = signal(false);
  protected readonly showTabs = signal(false);
  protected readonly editing = signal<LedgerItem | null>(null);
  protected readonly type = signal<LedgerType>('INCOME');
  protected readonly amount = signal('');
  protected readonly app = signal<RideApp>('UBER');
  protected readonly rides = signal('');
  protected readonly hours = signal('');
  protected readonly km = signal('');
  protected readonly notes = signal('');
  protected readonly category = signal<ExpenseCategory>('FUEL');
  protected readonly odometer = signal('');
  protected readonly amountError = signal<string | null>(null);
  protected readonly serverError = signal<string | null>(null);
  protected readonly busy = signal(false);

  private readonly amountInput = viewChild<ElementRef<HTMLInputElement>>('amountInput');

  protected readonly title = computed(() => {
    if (this.showTabs()) return 'Lançar';
    const edit = this.editing() !== null;
    if (this.type() === 'INCOME') return edit ? 'Editar ganho' : 'Novo ganho';
    return edit ? 'Editar custo' : 'Novo custo';
  });

  protected readonly subtitle = computed(() => {
    const date = this.editing()?.date ?? this.today();
    return date === this.today() ? `Hoje, ${ddmmyyyy(date)}` : ddmmyyyy(date);
  });

  protected readonly saveLabel = computed(() => {
    if (!this.showTabs()) return 'Salvar';
    return this.type() === 'INCOME' ? 'Salvar ganho' : 'Salvar custo';
  });

  protected readonly odometerHint = computed(() => {
    const last = this.lastOdometer();
    return last ? `Último registro: ${integer(last)} km.` : 'Último registro: nenhum.';
  });

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
      this.app.set(item.app ?? 'OUTRO');
      this.rides.set(item.rides ? String(item.rides) : '');
      this.hours.set(item.hours ? formatPtBrNumber(Math.round(item.hours * 10), 1, { trailingZeros: false }) : '');
      this.km.set(item.km ? String(item.km) : '');
      this.notes.set(item.notes ?? '');
    } else {
      this.category.set((EXPENSE_CATEGORIES as readonly string[]).includes(item.category)
        ? (item.category as ExpenseCategory)
        : 'OTHER');
      this.odometer.set(item.odometerKm ? String(item.odometerKm) : '');
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
      this.focusAmount();
      return;
    }
    if (scaled > MAX_AMOUNT_CENTS) {
      this.amountError.set('Valor acima de R$ 1.000.000,00. Confira os zeros.');
      this.focusAmount();
      return;
    }
    const request = this.request(scaled);
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
      error: () => {
        this.busy.set(false);
        this.serverError.set('Não foi possível salvar. Confira a conexão e tente novamente.');
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
      error: () => {
        this.busy.set(false);
        this.serverError.set('Não foi possível excluir. Tente novamente.');
      },
    });
  }

  private request(amount: number): LedgerItemRequest {
    const editing = this.editing();
    const date = editing?.date ?? this.today();
    const toInt = (v: string): number | null => (v ? Number(v) || null : null);
    if (this.type() === 'INCOME') {
      const hours = parsePtBrNumber(this.hours().trim(), 1).scaled;
      return {
        date,
        type: 'INCOME',
        category: 'RIDES',
        amount,
        app: this.app(),
        rides: toInt(this.rides()),
        hours: hours ? hours / 10 : null,
        km: toInt(this.km()),
        odometerKm: null,
        notes: this.notes().trim() || null,
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
      odometerKm: toInt(this.odometer()),
      notes: editing?.notes ?? null,
    };
  }

  private reset(): void {
    this.editing.set(null);
    this.amount.set('');
    this.app.set('UBER');
    this.rides.set('');
    this.hours.set('');
    this.km.set('');
    this.notes.set('');
    this.category.set('FUEL');
    this.odometer.set('');
    this.amountError.set(null);
    this.serverError.set(null);
    this.busy.set(false);
  }

  private show(): void {
    this.open.set(true);
    this.focusAmount();
  }

  /** After the sheet focused its own panel (its effect runs first), Valor takes the focus. */
  private focusAmount(): void {
    if (!this.isBrowser) return;
    setTimeout(() => {
      const el = this.amountInput()?.nativeElement ?? this.document.getElementById('ledger-amount');
      el?.focus({ preventScroll: true });
    });
  }
}
