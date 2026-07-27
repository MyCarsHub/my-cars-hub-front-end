import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
 *
 * `unknown` is the honest verdict when we have NO target plan at all (no
 * `?plan=`, no per-tab marker). Stripe's `cancel_url` also lands here, so this
 * state must claim neither a charge nor an abandonment — it only points the
 * user at `/billing`, which reads the backend truth.
 */
type State = 'polling' | 'active' | 'unconfirmed' | 'timeout' | 'unknown';

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
 * Query parameter the backend appends to Stripe's `success_url` — e.g.
 * `/billing/success?plan=PRO_MONTHLY_STRIPE`. It is the PRIMARY proof-of-target
 * because, unlike sessionStorage, it survives the external-browser hop and the
 * `noopener` fallback link that our mobile cohort actually goes through.
 *
 * It is client-supplied and therefore FORGEABLE. It is a UI hint only: it says
 * WHICH plan to compare against, never that the plan was paid for. Entitlement
 * still comes from the backend subscription read below.
 */
const PLAN_QUERY_PARAM = 'plan';

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
  private readonly route = inject(ActivatedRoute);

  protected readonly state = signal<State>('polling');
  protected readonly subscription = this.billingService.subscription;

  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Plan the checkout was opened for. Stripe sends the customer BACK HERE for
   * both success and cancel, so without it a user who was already ACTIVE and
   * abandoned the checkout was congratulated for a payment that never happened.
   *
   * Sources, in order: `?plan=` (survives everything) → the per-tab marker →
   * nothing, which is `unknown` and never a success.
   */
  private checkoutPlanCode: string | null = null;
  private unconfirmedReads = 0;
  private firstUnconfirmedAt: number | null = null;

  ngOnInit(): void {
    this.checkoutPlanCode = this.resolveTargetPlanCode();
    // The gateway always returns to this page, so this page owns the cleanup.
    // Leaving the marker behind made a later visit to /billing re-enter
    // "verificando pagamento" for a round-trip that is already over.
    // NOTE: CHECKOUT_PLAN_CODE_KEY is deliberately NOT cleared here — it is
    // what makes "verificar novamente" (and a plain reload) still able to
    // recognise the payment. Only a CONFIRMED payment retires it.
    this.session.removeItem(CHECKOUT_PENDING_KEY);

    // No target plan means we cannot compare anything, so no read of the
    // subscription could ever prove this round-trip paid. Polling for 30s would
    // only end in "ainda processando", which implies a payment we cannot see.
    if (!this.checkoutPlanCode) {
      this.state.set('unknown');
      return;
    }

    this.startPolling();
  }

  /**
   * `?plan=` first: it is the only source that survives Stripe opening the
   * external browser on mobile and the `noopener` manual fallback link, both of
   * which lose sessionStorage entirely. The per-tab marker is the fallback for
   * checkouts started before the backend began appending the parameter.
   */
  private resolveTargetPlanCode(): string | null {
    const fromQuery = this.route.snapshot.queryParamMap.get(PLAN_QUERY_PARAM)?.trim();
    if (fromQuery) return fromQuery;
    return this.session.getItem(CHECKOUT_PLAN_CODE_KEY)?.trim() || null;
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
    // Without a target plan there is nothing to compare a fresh read against —
    // re-polling would spin and land on the same non-answer.
    if (!this.checkoutPlanCode) return;
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
    // Unreachable without a target (ngOnInit short-circuits to `unknown`), but
    // stated explicitly: no target, no success claim. Ever.
    if (!this.checkoutPlanCode) return false;
    if (sub.status !== 'ACTIVE') return false;
    if (sub.pendingPlanCode) return false;
    return sub.planCode === this.checkoutPlanCode;
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
