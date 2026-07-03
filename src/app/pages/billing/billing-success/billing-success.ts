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
import { BillingService } from '../../../services/billing.service';

type State = 'polling' | 'active' | 'timeout' | 'error';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

@Component({
  selector: 'app-billing-success',
  imports: [CommonModule, RouterLink, DefaultPageLayout],
  templateUrl: './billing-success.html',
  styleUrl: './billing-success.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BillingSuccess implements OnInit, OnDestroy {
  private readonly billingService = inject(BillingService);
  private readonly router = inject(Router);

  protected readonly state = signal<State>('polling');
  protected readonly subscription = this.billingService.subscription;

  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.pollOnce();
    this.intervalHandle = setInterval(() => this.pollOnce(), POLL_INTERVAL_MS);
    this.timeoutHandle = setTimeout(() => {
      if (this.state() === 'polling') {
        this.state.set('timeout');
      }
      this.stopPolling();
    }, POLL_TIMEOUT_MS);
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  protected goToBilling(): void {
    this.router.navigate(['/billing']);
  }

  private pollOnce(): void {
    this.billingService.loadSubscription().subscribe({
      next: (sub) => {
        if (sub && sub.status === 'ACTIVE') {
          this.state.set('active');
          this.stopPolling();
        }
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
