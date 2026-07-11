import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { Sidebar } from '../../sidebar/sidebar';
import { LayoutStore } from './layout.store';
import { BillingAccessService } from '../../../services/billing-access.service';
import { SessionService } from '../../../services/session.service';
import { PaywallDialog } from '../../paywall-dialog/paywall-dialog';

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Sidebar, PaywallDialog],
  animations: [
    trigger('contentMargin', [
      state('expanded', style({ marginLeft: '260px' })),
      state('collapsed', style({ marginLeft: '72px' })),
      state('mobile', style({ marginLeft: '0' })),
      transition('expanded <=> collapsed', animate('300ms cubic-bezier(0.4, 0, 0.2, 1)')),
      transition('* => mobile', animate('0ms')),
      transition('mobile => *', animate('0ms')),
    ]),
  ],
  template: `
    <div class="flex h-screen overflow-hidden bg-gray-50">
      <app-sidebar />
      <main
        class="flex-1 overflow-y-auto transition-none"
        [@contentMargin]="contentState()"
      >
        <div>
          <router-outlet />
        </div>
      </main>
    </div>
    <app-paywall-dialog
      [open]="paywallOpen()"
      [reason]="access.reason()"
      [hardBlock]="true"
      (confirmed)="goToBilling()"
    />
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
  `,
})
export class AppShell implements OnInit, OnDestroy {
  protected readonly layout = inject(LayoutStore);
  protected readonly access = inject(BillingAccessService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly paywallOpen = signal(false);

  private resizeListener: (() => void) | null = null;

  constructor() {
    // Lazy-load access status once the authenticated shell mounts.
    this.access.load().subscribe({ error: () => void 0 });

    // React to blocked-state transitions and show the paywall once per
    // session/day (brief §5.3).
    effect(() => {
      const blocked = this.access.isBlocked();
      if (!blocked) {
        this.paywallOpen.set(false);
        return;
      }
      if (this.wasShownThisSession()) return;
      this.markShown();
      this.paywallOpen.set(true);
    });
  }

  protected contentState(): string {
    if (this.layout.isMobile()) {
      return 'mobile';
    }
    return this.layout.isCollapsed() ? 'collapsed' : 'expanded';
  }

  protected goToBilling(): void {
    this.paywallOpen.set(false);
    this.router.navigate(['/billing'], {
      queryParams: { reason: this.access.reason() ?? 'BLOCKED' },
    });
  }

  ngOnInit(): void {
    this.checkBreakpoint();
    this.resizeListener = () => this.checkBreakpoint();
    window.addEventListener('resize', this.resizeListener);
  }

  ngOnDestroy(): void {
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
    }
  }

  private checkBreakpoint(): void {
    this.layout.setMobile(window.innerWidth < 1024);
  }

  private storageKey(): string {
    const companyId = this.session.getItem('selectedCompanyId') ?? 'none';
    const today = new Date().toISOString().slice(0, 10);
    return `mch:paywall-shown:${companyId}:${today}`;
  }

  private wasShownThisSession(): boolean {
    return this.session.getItem(this.storageKey()) === 'true';
  }

  private markShown(): void {
    this.session.setItem(this.storageKey(), 'true');
  }
}
