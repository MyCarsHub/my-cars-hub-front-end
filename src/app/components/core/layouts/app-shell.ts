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
import { ImpersonationService } from '../../../services/impersonation.service';
import { TourSpotlight } from '../../tour/tour-spotlight';
import { TourService } from '../../tour/tour.service';
import { DriverTopBar } from '../../sidebar/driver-top-bar';
import { ThemeToggle } from '../../theme-toggle/theme-toggle';
import { ThemeService } from '../../../services/theme.service';
import { PastDueBannerStore } from '../../past-due-banner/past-due-banner';
import { formatDayMonthTime, parseServerTime } from '../../../utils/server-time';

/** "Depois" no aviso de atraso vale 24h; nas últimas 24h do prazo ele não sai. */
const PAST_DUE_SNOOZE_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Sidebar, PaywallDialog, NotificationBell, TourSpotlight, DriverTopBar, ThemeToggle],
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
    <!--
      pt-14 reserva os 56px da barra de impersonação (fixed no topo, montada na
      raiz da aplicação). Com box-sizing border-box, a altura do quadro continua
      valendo e é o CONTEÚDO que encolhe — sem isso a barra cobriria o topo da
      sidebar e o botão do menu no mobile.

      A altura é 100dvh MENOS a faixa do banner de cookies (\`--consent-banner-h\`, que o
      próprio banner publica): aqui dentro o body não rola, então o respiro que o banner
      dá ao body não chega ao <main>, e o fim de toda tela ficava por baixo dele.
    -->
    <!--
      Abaixo de lg (qualquer papel): coluna com a barra de topo do protótipo NO FLUXO e o conteúdo
      embaixo. \`--page-top\` troca a folga que o default-page-layout reserva para o ☰
      flutuante (que o motorista não tem) pelo respiro do protótipo (o ☰ não flutua mais sobre a página). \`--page-fill-offset\` é
      quanto do 100dvh fica ACIMA do conteúdo (a barra de topo + a \`--page-top\`): a tela que
      ocupa a altura toda (captura guiada da vistoria) desconta isso e cabe sem rolar.
    -->
    <div
      class="flex h-[calc(100dvh-var(--consent-banner-h,0px))] overflow-hidden bg-canvas"
      [class.pt-14]="impersonating()"
      [class.flex-col]="layout.mobileTopBar()"
      [style.--page-top]="layout.mobileTopBar() ? '1.25rem' : null"
      [style.--page-fill-offset]="layout.mobileTopBar() ? 'calc(4.75rem + env(safe-area-inset-top) + env(safe-area-inset-bottom) + var(--consent-banner-h, 0px))' : null"
      [style.--page-header-end]="headerEnd()"
    >
      @if (layout.mobileTopBar()) {
        <app-driver-top-bar />
      }
      <app-sidebar />
      <main
        class="relative min-h-0 flex-1 overflow-y-auto transition-none"
        [@contentMargin]="contentState()"
      >
        <!-- O botão de tema aparece SEMPRE (dono, gerente e motorista; também no onboarding);
             o sino continua só depois do onboarding concluído. -->
          <!--
            O shell não tem barra de header própria. O sino vive num header
            posicionado em absolute dentro do scroller do main: ocupa o espaço
            que o default-page-layout já reserva no topo (pt-20 lg:pt-10),
            respeita a mesma coluna de conteúdo dos cards (max-w-8xl +
            px-4/sm:px-6/lg:px-10) e rola junto com a página — sem position
            fixed, portanto sem disputar z-index com os elementos sticky das
            páginas.
          -->
          <!--
            Abaixo de lg: o <main> já começa ABAIXO da barra de topo, que consumiu o
            recorte do aparelho. Somar o safe-area aqui de novo derrubaria o sino sobre a
            descrição; ele se alinha à mesma --page-top do título, e --page-header-end (no
            frame) reserva a coluna dele para o título e a descrição não correrem por baixo.
          -->
          <header class="pointer-events-none absolute inset-x-0 top-0 z-10">
            <div
              class="max-w-8xl mx-auto flex justify-end px-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-6 lg:px-10 lg:pt-10"
              [style.padding-top]="layout.mobileTopBar() ? 'var(--page-top)' : null"
              data-bell-row
            >
              <div class="pointer-events-auto flex items-center gap-2">
                <app-theme-toggle />
                @if (showBell()) {
                  <app-notification-bell />
                }
              </div>
            </div>
          </header>
        <div>
          <router-outlet />
        </div>
      </main>
    </div>
    <app-paywall-dialog
      [open]="paywallOpen()"
      [reason]="access.reason()"
      [hardBlock]="true"
      [canRegularize]="paywallCanRegularize()"
      [planName]="paywallPlanName()"
      [amountDue]="paywallAmount()"
      (confirmed)="goToBilling()"
      (changeCard)="goToBilling({ cartao: '1' })"
      (contactSupport)="goToSupport()"
      (acknowledged)="paywallOpen.set(false)"
    />
    <!--
      Fora do main de propósito: o holofote usa coordenadas de viewport
      (position: fixed) e precisa cobrir o drawer do mobile, que também é
      fixed. Aninhá-lo no scroller do conteúdo o colocaria abaixo da sidebar na
      pilha de empilhamento.
    -->
    <app-tour-spotlight />
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
  private readonly theme = inject(ThemeService);
  protected readonly access = inject(BillingAccessService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly tour = inject(TourService);
  private readonly pastDue = inject(PastDueBannerStore);
  /** "Depois" esconde o aviso de atraso até este instante (por empresa, nesta aba). */
  private readonly pastDueSnoozedUntil = signal(0);

  /** Reserva de espaço para a barra de impersonação — ver o comentário no template. */
  protected readonly impersonating = inject(ImpersonationService).active;

  protected readonly paywallOpen = signal(false);
  /**
   * Only the OWNER can regularize the plan. Read from the TOKEN when the dialog opens — the
   * same source `roleGuard` and `billingAccessGuard` use — so the copy never offers
   * `/billing` to someone those guards will bounce away from it.
   */
  protected readonly paywallCanRegularize = signal(true);

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
  /**
   * Folga à direita do título (`--page-header-end`, lida pelo default-page-layout) para a
   * coluna do header: 44px do botão de tema, mais 8px + 44px do sino quando ele monta, mais
   * 4px de respiro. Vale no celular e no desktop — o título e as ações da página não correm
   * por baixo dos botões.
   */
  protected readonly headerEnd = computed(() => (this.showBell() ? '6.25rem' : '3.25rem'));

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
      this.paywallCanRegularize.set(this.session.getCompanyRoleFromToken() === 'OWNER');
      this.paywallOpen.set(true);
    });

    // Aviso de cobrança recusada (dentro da carência), com o prazo de
    // `/access-status`. Bloqueado é o paywall; a Assinatura esconde o aviso.
    this.pastDue.payNow = () =>
      void this.router.navigate(['/billing'], { queryParams: { pagar: '1' } });
    this.pastDue.later = () => {
      const until = Date.now() + PAST_DUE_SNOOZE_MS;
      this.session.setItem(this.pastDueSnoozeKey(), String(until));
      this.pastDueSnoozedUntil.set(until);
    };
    effect(() => {
      const st = this.access.status();
      this.pastDueSnoozedUntil();
      const end = parseServerTime(st?.graceEndsAt ?? null);
      if (!st || st.status !== 'PAST_DUE' || st.blocked || !end) {
        this.pastDue.notice.set(null);
        return;
      }
      const lastDay = end.getTime() - Date.now() <= PAST_DUE_SNOOZE_MS;
      const snoozed = Number(this.session.getItem(this.pastDueSnoozeKey()) ?? 0) > Date.now();
      if (snoozed && !lastDay) {
        this.pastDue.notice.set(null);
        return;
      }
      this.pastDue.notice.set({
        deadline: formatDayMonthTime(end),
        canPay: this.session.getCompanyRoleFromToken() === 'OWNER',
        canDismiss: !lastDay,
      });
    });
    effect(() => this.pastDue.hidden.set(this.currentUrl().startsWith('/billing')));

    // Tour guiado: só no dashboard, nunca dentro de `/onboarding` (o wizard
    // obrigatório) — a checagem de URL cobre os dois casos de uma vez. O
    // efeito reavalia a cada navegação; a trava de "uma vez por aba" e a
    // decisão de quem merece ver o tour vivem no próprio serviço.
    effect(() => {
      if (!this.currentUrl().startsWith('/dashboard')) return;
      this.tour.maybeAutoStart();
    });
  }

  protected contentState(): string {
    if (this.layout.isMobile()) {
      return 'mobile';
    }
    return this.layout.isCollapsed() ? 'collapsed' : 'expanded';
  }

  /** Plano e valor da fatura em aberto, para o paywall de atraso. */
  protected readonly paywallPlanName = computed(() => {
    const name = this.access.status()?.plan?.name ?? null;
    return name ? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() : null;
  });
  protected readonly paywallAmount = computed(() => {
    const price = this.access.status()?.plan?.price ?? null;
    return price && price > 0
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price).replace(/\u00A0/g, ' ')
      : null;
  });

  protected goToBilling(extra?: Record<string, string>): void {
    this.paywallOpen.set(false);
    const reason = this.access.reason();
    // Quem deve vai direto para o pagamento (mockup 07), nunca para a grade de planos.
    const owing = reason === 'PAYMENT_FAILED' || reason === 'PAST_DUE';
    const queryParams = extra ?? (owing ? { pagar: '1' } : { reason: reason ?? 'BLOCKED' });
    this.router.navigate(['/billing'], { queryParams });
  }

  protected goToSupport(): void {
    this.paywallOpen.set(false);
    this.router.navigate(['/suporte']);
  }

  ngOnInit(): void {
    this.checkBreakpoint();
    // The store is a root singleton and may already exist from BEFORE the session: the cookie
    // banner in the root component injects it on the login page, with an empty storage, and
    // login does not reload the page. Without this re-read the sidebar said "Sem Empresa" to
    // someone who owns companies (and, after logout + login, kept the previous user's). The
    // shell mounting is the one moment every session start passes through.
    this.layout.refreshTenants();
    this.layout.ensureMembershipsLoaded();
    this.resizeListener = () => this.checkBreakpoint();
    window.addEventListener('resize', this.resizeListener);
    // Trava scroll do body — só o main scrolla; sem isso ficam dois scrollbars.
    document.body.classList.add('app-shell-active');
    // Dentro do shell vale a preferência de tema; fora dele a página é sempre clara.
    this.theme.enterApp();
  }

  ngOnDestroy(): void {
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
    }
    document.body.classList.remove('app-shell-active');
    this.theme.leaveApp();
  }

  private checkBreakpoint(): void {
    this.layout.setMobile(window.innerWidth < 1024);
  }

  private storageKey(): string {
    const companyId = this.session.getItem('selectedCompanyId') ?? 'none';
    const today = new Date().toISOString().slice(0, 10);
    return `mch:paywall-shown:${companyId}:${today}`;
  }

  private pastDueSnoozeKey(): string {
    return `mch:past-due-later:${this.session.getItem('selectedCompanyId') ?? 'none'}`;
  }

  private wasShownThisSession(): boolean {
    return this.session.getItem(this.storageKey()) === 'true';
  }

  private markShown(): void {
    this.session.setItem(this.storageKey(), 'true');
  }
}
