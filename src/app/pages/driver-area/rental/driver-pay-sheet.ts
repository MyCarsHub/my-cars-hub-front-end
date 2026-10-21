import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, catchError, map, of, startWith, switchMap } from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { DetailDialog } from '../../../components/core/detail-dialog/detail-dialog';
import { ApiErrorService } from '../../../services/api-error.service';
import { DriverRentalChargesService } from '../../../services/driver-rental-charges.service';
import { ExternalNavigationService } from '../../../services/external-navigation.service';
import { NotificationService } from '../../../services/notification.service';
import { DriverCharge } from '../../../types/driver-charges.types';
import { BUSINESS_TIME_ZONE } from '../../../utils/business-clock';
import { DRIVER_RENTAL_TODAY, fullDate, isOverdue, money } from './driver-rental-view';

export const PIX_COPIED = 'Código Pix copiado. Cole no app do seu banco.';
export const PIX_COPY_FALLBACK =
  'Não deu para copiar sozinho. O código está selecionado: toque e segure para copiar.';
const PIX_ERROR = 'Não foi possível gerar o código Pix agora.';

const VALID_UNTIL = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BUSINESS_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** "Válido até 22/10, 23:59", read in the business zone; empty when absent or unreadable. */
export function validUntil(expiresAt: string | null): string {
  if (!expiresAt) return '';
  const when = new Date(expiresAt);
  if (Number.isNaN(when.getTime())) return '';
  const parts = Object.fromEntries(VALID_UNTIL.formatToParts(when).map((p) => [p.type, p.value]));
  return `Válido até ${parts['day']}/${parts['month']}, ${parts['hour']}:${parts['minute']}`;
}

/** Only a base64 PNG becomes an image source: nothing else is interpolated into `src`. */
function qrSource(base64: string | null): string {
  const clean = (base64 ?? '').replace(/\s+/g, '');
  return clean && /^[A-Za-z0-9+/]+={0,2}$/.test(clean) ? `data:image/png;base64,${clean}` : '';
}

/** A second tap inside this window is the same tap: it would open the page twice. */
const DOUBLE_TAP_LOCK_MS = 1000;

type PixState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly payload: string;
      readonly qrSrc: string;
      readonly validUntil: string;
    }
  | { readonly kind: 'error'; readonly message: string };

/**
 * "Pagar cobrança" — the driver's popup to pay ONE open charge: the value, the Pix QR code
 * and "copia e cola", and the gateway invoice ("Ver fatura"). Bottom sheet on the phone,
 * 480px box from `sm` up (the app's `DetailDialog`, which already traps focus, locks the
 * scroll and closes on Esc).
 *
 * The Pix is asked for when the popup opens (`GET .../charges/{id}/pix`). On a 404/409/503
 * the server's pt-BR message is shown as it came and the invoice page (`checkoutUrl`) is
 * offered instead. There is no bank slip: charges are issued as Pix. Late fees are not
 * computed here: the backend does not send them.
 */
@Component({
  selector: 'app-driver-pay-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, DetailDialog],
  templateUrl: './driver-pay-sheet.html',
})
export class DriverPaySheet {
  readonly rentalId = input.required<string>();
  /** The charge to pay; `null` keeps the popup closed. */
  readonly charge = input<DriverCharge | null>(null);
  /** How the charge is called on the screen ("Aluguel semanal · semana 10"). */
  readonly chargeTitle = input<string>('');
  readonly closed = output<void>();

  private readonly service = inject(DriverRentalChargesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly externalNav = inject(ExternalNavigationService);
  private readonly notifications = inject(NotificationService);
  private readonly document = inject(DOCUMENT);
  private readonly today = inject(DRIVER_RENTAL_TODAY);

  private readonly codeRef = viewChild<ElementRef<HTMLElement>>('pixCode');

  protected readonly pix = signal<PixState>({ kind: 'idle' });
  protected readonly pixPayload = computed(() => {
    const state = this.pix();
    return state.kind === 'ready' ? state.payload : '';
  });
  protected readonly pixQr = computed(() => {
    const state = this.pix();
    return state.kind === 'ready' ? state.qrSrc : '';
  });
  protected readonly pixValidUntil = computed(() => {
    const state = this.pix();
    return state.kind === 'ready' ? state.validUntil : '';
  });
  protected readonly pixError = computed(() => {
    const state = this.pix();
    return state.kind === 'error' ? state.message : '';
  });
  protected readonly copyHint = signal<string | null>(null);
  protected readonly linkLocked = signal(false);
  private lockTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly amount = computed(() => {
    const c = this.charge();
    return c ? money(c.amount) : '';
  });

  protected readonly overdue = computed(() => {
    const c = this.charge();
    return c ? isOverdue(c, this.today()) : false;
  });

  protected readonly subtitle = computed(() => {
    const c = this.charge();
    if (!c) return '';
    if (!c.dueDate) return this.chargeTitle();
    const when = this.overdue() ? 'venceu em' : 'vence';
    return `${this.chargeTitle()} · ${when} ${fullDate(c.dueDate)}`;
  });

  protected readonly checkoutUrl = computed(() => this.charge()?.checkoutUrl ?? null);

  private readonly request$ = new Subject<DriverCharge | null>();

  constructor() {
    this.request$
      .pipe(
        switchMap((charge) => {
          if (!charge) return of<PixState>({ kind: 'idle' });
          return this.service.pix(this.rentalId(), charge.id).pipe(
            map(
              (res): PixState => ({
                kind: 'ready',
                payload: res.payload,
                qrSrc: qrSource(res.qrCodeBase64),
                validUntil: validUntil(res.expiresAt),
              }),
            ),
            catchError((err: unknown) =>
              of<PixState>({ kind: 'error', message: this.apiErrors.messageFor(err, PIX_ERROR) }),
            ),
            startWith<PixState>({ kind: 'loading' }),
          );
        }),
        catchError(() => EMPTY),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.pix.set(state));

    effect(() => {
      const charge = this.charge();
      this.copyHint.set(null);
      this.request$.next(charge);
    });

    inject(DestroyRef).onDestroy(() => {
      if (this.lockTimer) clearTimeout(this.lockTimer);
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  protected async copy(): Promise<void> {
    const state = this.pix();
    if (state.kind !== 'ready') return;
    const clipboard = this.document.defaultView?.navigator?.clipboard;
    try {
      if (!clipboard?.writeText) throw new Error('sem clipboard');
      await clipboard.writeText(state.payload);
      this.notifications.success(PIX_COPIED);
      this.closed.emit();
    } catch {
      // No clipboard (old browser, http, denied permission): leave the code selected so
      // the driver copies it from the phone's own menu. Never pretend it was copied.
      this.selectCode();
      this.copyHint.set(PIX_COPY_FALLBACK);
    }
  }

  /** "Ver fatura" and, after a Pix failure, "Abrir página de pagamento": the same page. */
  protected openCheckout(): void {
    this.openOnce(this.checkoutUrl());
  }

  private openOnce(url: string | null): void {
    if (!url || this.linkLocked()) return;
    this.linkLocked.set(true);
    this.externalNav.openExternal(url);
    this.lockTimer = setTimeout(() => this.linkLocked.set(false), DOUBLE_TAP_LOCK_MS);
  }

  private selectCode(): void {
    const el = this.codeRef()?.nativeElement;
    const selection = this.document.defaultView?.getSelection();
    if (!el || !selection) return;
    const range = this.document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
