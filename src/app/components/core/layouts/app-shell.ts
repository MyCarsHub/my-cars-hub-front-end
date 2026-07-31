import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { Sidebar } from '../../sidebar/sidebar';
import { LayoutStore } from './layout.store';
import { BillingAccessService } from '../../../services/billing-access.service';
import { SessionService } from '../../../services/session.service';
import { PaywallDialog } from '../../paywall-dialog/paywall-dialog';
import { NotificationBell } from '../../notification-bell/notification-bell';

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Sidebar, PaywallDialog, NotificationBell],
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
        class="relative flex-1 overflow-y-auto transition-none"
        [@contentMargin]="contentState()"
      >
        @if (showBell()) {
          <!--
            O shell não tem barra de header própria. O sino vive num header
            posicionado em absolute dentro do scroller do main: ocupa o espaço
            que o default-page-layout já reserva no topo (pt-20 lg:pt-10),
            respeita a mesma coluna de conteúdo dos cards (max-w-8xl +
            px-4/sm:px-6/lg:px-10) e rola junto com a página — sem position
            fixed, portanto sem disputar z-index com os elementos sticky das
            páginas.
          -->
          <header class="pointer-events-none absolute inset-x-0 top-0 z-10">
            <div class="max-w-8xl mx-auto flex justify-end px-4 pt-4 sm:px-6 lg:px-10 lg:pt-10">
              <app-notification-bell class="pointer-events-auto" />
            </div>
          </header>
        }
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

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /**
   * O sino só monta (e só então começa o polling do contador) depois do
   * onboarding concluído: em `/onboarding` o usuário ainda não tem empresa, e
   * pedir o feed sem tenant é ruído garantido. `sessionStorage` não é reativo,
   * por isso o cálculo é reavaliado a cada navegação via `currentUrl()`.
   */
  protected readonly showBell = computed(() => {
    const url = this.currentUrl();
    if (url.startsWith('/onboarding')) return false;
    return this.session.isOnboardingCompleted();
  });

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
    // Trava scroll do body — só o main scrolla; sem isso ficam dois scrollbars.
    document.body.classList.add('app-shell-active');
  }

  ngOnDestroy(): void {
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
    }
    document.body.classList.remove('app-shell-active');
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
