import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import {
  BillingService,
  CHECKOUT_PENDING_KEY,
  CHECKOUT_PLAN_CODE_KEY,
} from '../../../services/billing.service';
import { BillingAccessService } from '../../../services/billing-access.service';
import { SessionService } from '../../../services/session.service';
import { SubscriptionResponse } from '../../../types/billing.types';

/**
 * `unconfirmed` is deliberately NOT called "abandoned": from the browser we can
 * never prove a charge did not happen (the backend clears the pending marker on
 * cancel AND on a webhook that has not promoted the plan yet). It is a
 * RECOVERABLE state — `checkAgain()` resumes polling.
 */
type State = 'polling' | 'active' | 'unconfirmed' | 'timeout';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

/**
 * How many consecutive reads must agree before we stop waiting. The webhook and
 * the subscription row settle independently, so a single read showing "no
 * pending checkout, old plan" can still be a race.
 */
const UNCONFIRMED_CONFIRMATIONS = 3;

/**
 * …and those reads must span at least this long. At a 2s interval three reads
 * take 4 SECONDS, which is far inside the window where a real Stripe payment is
 * still settling. Money is involved: wait a meaningful amount of time before
 * telling the user we could not see their payment.
 */
const UNCONFIRMED_MIN_ELAPSED_MS = 15000;

/**
 * How fresh `currentPeriodStart` must be to read as "this checkout just paid".
 * Only used as a FALLBACK when the per-tab checkout marker is gone.
 */
const RECENT_PERIOD_START_MS = 15 * 60 * 1000;

@Component({
  selector: 'app-billing-success',
  imports: [CommonModule, RouterLink, DefaultPageLayout],
  templateUrl: './billing-success.html',
  styleUrl: './billing-success.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BillingSuccess implements OnInit, OnDestroy {
  private readonly billingService = inject(BillingService);
  private readonly access = inject(BillingAccessService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly state = signal<State>('polling');
  protected readonly subscription = this.billingService.subscription;

  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Plan the checkout was opened for. Stripe sends the customer BACK HERE for
   * both success and cancel, so without it a user who was already ACTIVE and
   * abandoned the checkout was congratulated for a payment that never happened.
   */
  private checkoutPlanCode: string | null = null;
  private unconfirmedReads = 0;
  private firstUnconfirmedAt: number | null = null;

  ngOnInit(): void {
    this.checkoutPlanCode = this.session.getItem(CHECKOUT_PLAN_CODE_KEY);
    // The gateway always returns to this page, so this page owns the cleanup.
    // Leaving the marker behind made a later visit to /billing re-enter
    // "verificando pagamento" for a round-trip that is already over.
    // NOTE: CHECKOUT_PLAN_CODE_KEY is deliberately NOT cleared here — it is
    // what makes "verificar novamente" (and a plain reload) still able to
    // recognise the payment. Only a CONFIRMED payment retires it.
    this.session.removeItem(CHECKOUT_PENDING_KEY);

    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  protected goToBilling(): void {
    this.router.navigate(['/billing']);
  }

  /**
   * Escape hatch out of `unconfirmed` / `timeout`. Neither state is terminal:
   * a webhook that lands two minutes late must still be able to turn this page
   * into a success without the user having to guess what to do.
   */
  protected checkAgain(): void {
    if (this.state() === 'active') return;
    this.startPolling();
  }

  private startPolling(): void {
    this.stopPolling();
    this.unconfirmedReads = 0;
    this.firstUnconfirmedAt = null;
    this.state.set('polling');

    this.pollOnce();
    this.intervalHandle = setInterval(() => this.pollOnce(), POLL_INTERVAL_MS);
    this.timeoutHandle = setTimeout(() => {
      if (this.state() === 'polling') {
        this.state.set('timeout');
      }
      this.stopPolling();
    }, POLL_TIMEOUT_MS);
  }

  /**
   * The payment landed only when the subscription is ACTIVE, carries NO pending
   * checkout, and sits on the plan this checkout was for. `status === 'ACTIVE'`
   * alone was true for everyone who already had a subscription.
   */
  private isPaymentConfirmed(sub: SubscriptionResponse): boolean {
    if (sub.status !== 'ACTIVE') return false;
    if (sub.pendingPlanCode) return false;
    if (this.checkoutPlanCode) return sub.planCode === this.checkoutPlanCode;
    // No recorded target. sessionStorage is PER TAB and Stripe routinely returns
    // through an external browser / a new tab on mobile — our main cohort. A
    // paid subscription that just started its period is the strongest signal we
    // have left; without it these users sat 30s in polling with an ACTIVE, paid
    // subscription and were then told we could not confirm anything.
    return this.startedRecently(sub.currentPeriodStart);
  }

  /** `currentPeriodStart` within minutes of now — i.e. this period just opened. */
  private startedRecently(iso: string | null): boolean {
    if (!iso) return false;
    const ms = new Date(iso).getTime();
    if (Number.isNaN(ms)) return false;
    // Absolute delta: the backend clock can sit slightly ahead of the browser's.
    return Math.abs(Date.now() - ms) <= RECENT_PERIOD_START_MS;
  }

  /**
   * ACTIVE on a DIFFERENT plan with nothing pending. This is what an abandoned
   * checkout looks like — but it is ALSO what a paid checkout looks like while
   * the webhook is late, so it never licenses a claim about the money.
   */
  private looksUnconfirmed(sub: SubscriptionResponse): boolean {
    if (!this.checkoutPlanCode) return false;
    if (sub.pendingPlanCode) return false;
    return sub.status === 'ACTIVE' && sub.planCode !== this.checkoutPlanCode;
  }

  private pollOnce(): void {
    this.billingService.loadSubscription().subscribe({
      next: (sub) => {
        if (!sub) return;
        if (this.isPaymentConfirmed(sub)) {
          this.state.set('active');
          this.stopPolling();
          this.session.removeItem(CHECKOUT_PLAN_CODE_KEY);
          // Re-fetch access-status so the guard/paywall unblock immediately,
          // then bounce the user to the default landing route.
          this.access.invalidate();
          this.access.refresh().subscribe({
            next: () => {
              if (!this.access.isBlocked()) {
                this.router.navigate(['/dashboard']);
              }
            },
            error: () => void 0,
          });
          return;
        }
        if (this.looksUnconfirmed(sub)) {
          this.unconfirmedReads += 1;
          this.firstUnconfirmedAt ??= Date.now();
          const elapsed = Date.now() - this.firstUnconfirmedAt;
          if (
            this.unconfirmedReads >= UNCONFIRMED_CONFIRMATIONS &&
            elapsed >= UNCONFIRMED_MIN_ELAPSED_MS
          ) {
            // Stop the noise, but keep the checkout marker: `checkAgain()` and a
            // plain reload must both still be able to recognise a late payment.
            this.state.set('unconfirmed');
            this.stopPolling();
          }
          return;
        }
        this.unconfirmedReads = 0;
        this.firstUnconfirmedAt = null;
      },
      error: () => {
        // keep polling on transient errors; timeout guard will resolve
      },
    });
  }

  private stopPolling(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
}
