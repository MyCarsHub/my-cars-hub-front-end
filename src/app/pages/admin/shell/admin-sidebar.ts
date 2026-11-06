import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LayoutStore } from '../../../components/core/layouts/layout.store';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { SessionService } from '../../../services/session.service';
import { homeRouteForRole } from '../../../utils/home-route';
import { visibleAdminMenu } from './admin-menu';

/**
 * Menu da administração: coluna fixa no desktop, gaveta pela esquerda no celular (aberta pelo ☰ da
 * barra de topo do shell, via `LayoutStore.isMobileOpen`). É o que o `AppShell` monta no lugar do
 * menu de empresa quando a URL está em `/admin` — a mesma casca, outro menu.
 *
 * Os itens seguem a capacidade do papel (`AdminCapabilitiesService`); sem resposta do servidor,
 * nenhum item aparece: falha fechada. O servidor confere de novo em toda rota.
 */
@Component({
  selector: 'app-admin-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive],
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
  styles: `
    :host { display: contents; }
    .scrim { animation: admin-scrim-in 200ms ease-out both; }
    .drawer { animation: admin-drawer-in 320ms cubic-bezier(0.32, 0.72, 0, 1) both; will-change: transform; }
    @keyframes admin-scrim-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes admin-drawer-in { from { transform: translate3d(-100%, 0, 0); } to { transform: translate3d(0, 0, 0); } }
    @media (prefers-reduced-motion: reduce) {
      .scrim, .drawer { animation: none; }
    }
  `,
  template: `
    @if (!layout.isMobile()) {
      <aside
        class="fixed top-0 left-0 z-30 flex h-[calc(100dvh-var(--consent-banner-h,0px))] w-[260px]
               flex-col overflow-hidden border-r border-edge bg-surface"
        data-admin-sidebar
      >
        <ng-container *ngTemplateOutlet="content" />
      </aside>
    } @else if (layout.isMobileOpen()) {
      <div
        class="scrim fixed inset-0 z-40 bg-black/50"
        (click)="layout.closeMobile()"
        aria-hidden="true"
      ></div>
      <aside
        #drawer
        (keydown)="trapTab($event)"
        class="drawer fixed top-0 left-0 z-50 flex h-[calc(100dvh-var(--consent-banner-h,0px))] w-[280px]
               max-w-[85vw] flex-col overflow-hidden border-r border-edge bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Menu da administração"
        data-admin-drawer
      >
        <button
          #closeButton
          type="button"
          (click)="layout.closeMobile()"
          aria-label="Fechar menu"
          data-drawer-close
          class="absolute top-2 right-2 flex h-11 w-11 items-center justify-center rounded-xl
                 text-fg-subtle hover:bg-surface-sunken hover:text-fg focus:outline-none
                 focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <ng-container *ngTemplateOutlet="content" />
      </aside>
    }

    <ng-template #content>
      <div class="flex shrink-0 items-center gap-2 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3">
        <img src="svg/logo-my-cars-hub-complete.svg" class="h-6 dark:hidden" alt="MyCarsHub" />
        <img src="svg/logo-my-cars-hub-complete-dark.svg" class="hidden h-6 dark:block" alt="MyCarsHub" />
        <span class="rounded-lg bg-primary-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wider
                     text-primary-700 dark:text-primary-400">ADMIN</span>
      </div>

      <nav class="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-2" aria-label="Menu da administração">
        @for (group of groups(); track group.label) {
          <div class="space-y-0.5" role="group" [attr.aria-label]="group.label">
            <p class="px-3 pb-1 text-[10px] font-semibold tracking-wider text-fg-subtle" aria-hidden="true">
              {{ group.label }}
            </p>
            @for (item of group.items; track item.id) {
              <a
                [routerLink]="item.route"
                routerLinkActive="bg-primary-500/10 text-primary-700 dark:text-primary-400 font-semibold"
                [routerLinkActiveOptions]="{ exact: !!item.exact }"
                ariaCurrentWhenActive="page"
                (click)="onNavigate()"
                [attr.data-admin-item]="item.id"
                class="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-fg-body
                       transition-colors hover:bg-surface-sunken focus:outline-none
                       focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                  stroke-linejoin="round" class="shrink-0" aria-hidden="true">
                  <path [attr.d]="item.icon" />
                </svg>
                <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
              </a>
            }
          </div>
        }
      </nav>

      <div class="shrink-0 space-y-1 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        @if (roleLabel(); as role) {
          <p class="px-3 text-xs text-fg-subtle" data-admin-role>{{ role }}</p>
        }
        <!-- Saída da área, não item de menu: volta para a casa do papel na empresa do admin. -->
        <a
          [routerLink]="appHome()"
          (click)="onNavigate()"
          data-admin-exit
          class="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-fg-muted
                 transition-colors hover:bg-surface-sunken hover:text-fg focus:outline-none
                 focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round" class="shrink-0" aria-hidden="true">
            <path d="M15 18l-6-6l6-6" />
          </svg>
          <span>Sair da administração</span>
        </a>
      </div>
    </ng-template>
  `,
})
export class AdminSidebar {
  protected readonly layout = inject(LayoutStore);
  private readonly caps = inject(AdminCapabilitiesService);
  private readonly session = inject(SessionService);
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly drawer = viewChild<ElementRef<HTMLElement>>('drawer');

  protected readonly groups = computed(() => {
    // `capabilities()` é lido para o menu recalcular quando o papel chega.
    this.caps.capabilities();
    return visibleAdminMenu((code) => this.caps.can(code));
  });

  protected readonly roleLabel = computed(() => this.caps.self()?.adminRoleLabel ?? '');

  protected readonly appHome = computed(() => {
    this.layout.selectedTenant();
    return homeRouteForRole(this.session.getCompanyRoleFromToken());
  });

  constructor() {
    this.caps.ensureLoaded().subscribe();
    // Gaveta aberta: o foco vai para o botão Fechar; fechada, volta para o ☰ de quem abriu.
    let wasOpen = false;
    effect(() => {
      const open = this.layout.isMobile() && this.layout.isMobileOpen();
      if (open && !wasOpen) {
        afterNextRender(() => this.closeButton()?.nativeElement.focus(), {
          injector: this.injector,
        });
      } else if (!open && wasOpen) {
        this.doc.querySelector<HTMLElement>('[data-driver-top-bar] button')?.focus();
      }
      wasOpen = open;
    });
  }

  protected onNavigate(): void {
    if (this.layout.isMobile()) this.layout.closeMobile();
  }

  /**
   * Mantém o Tab dentro da gaveta (aria-modal). Mesmo algoritmo e mesmo seletor de foco do
   * `core/bottom-sheet`; lá o método é interno ao componente, então não há o que importar.
   */
  protected trapTab(event: Event): void {
    // `(keydown.tab)` não dispara com Shift pressionado (o Angular casa "shift.tab"), por isso
    // o ouvinte é o `keydown` inteiro e a tecla é conferida aqui.
    if ((event as KeyboardEvent).key !== 'Tab') return;
    const panel = this.drawer()?.nativeElement;
    if (!panel) return;
    const items = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const shift = (event as KeyboardEvent).shiftKey;
    if (shift && this.doc.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!shift && this.doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected onEscape(): void {
    if (this.layout.isMobile() && this.layout.isMobileOpen()) this.layout.closeMobile();
  }
}
