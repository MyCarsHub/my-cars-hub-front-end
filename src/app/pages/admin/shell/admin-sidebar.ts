import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LayoutStore } from '../../../components/core/layouts/layout.store';
import { NavItem, Sidebar, SidebarHeaderCard } from '../../../components/sidebar/sidebar';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { SessionService } from '../../../services/session.service';
import { homeRouteForRole } from '../../../utils/home-route';
import { buildAdminNavItems, visibleAdminMenu } from './admin-menu';

const ICON_SHIELD = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6z"/></svg>`;
const ICON_BACK = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6l-6 6l6 6M4 12h16"/></svg>`;
const ICON_PROFILE = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

/**
 * Menu da administração (FIX-0864): NÃO tem visual próprio. É a `app-sidebar` do app, a mesma de
 * item, grupo, ativo, Recolher e gaveta, alimentada com o modelo de menu da administração e com o
 * cartão da pessoa no lugar do seletor de empresa. O `AppShell` monta este no lugar do menu de
 * empresa quando a URL está em `/admin`.
 *
 * Os itens seguem a capacidade do papel (`AdminCapabilitiesService`); sem resposta do servidor,
 * nenhum item aparece: falha fechada. O servidor confere de novo em toda rota.
 */
@Component({
  selector: 'app-admin-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sidebar],
  host: { class: 'contents' },
  template: `
    <app-sidebar
      [navModel]="navModel()"
      [headerCard]="headerCard()"
      [modalDrawer]="true"
      menuLabel="Menu da administração"
    />
  `,
})
export class AdminSidebar {
  private readonly layout = inject(LayoutStore);
  private readonly caps = inject(AdminCapabilitiesService);
  private readonly session = inject(SessionService);

  /** Volta para a casa do papel na empresa do admin; relido a cada troca de credencial. */
  private readonly appHome = computed(() => {
    this.layout.selectedTenant();
    return homeRouteForRole(this.session.getCompanyRoleFromToken());
  });

  protected readonly headerCard = computed<SidebarHeaderCard>(() => {
    const identity = this.session.getIdentityFromToken();
    const name = identity?.name || identity?.email || 'Administrador';
    return {
      initial: name.trim().charAt(0).toUpperCase() || 'A',
      name,
      subtitle: this.caps.self()?.adminRoleLabel ?? '',
    };
  });

  protected readonly navModel = computed<NavItem[]>(() => {
    // `capabilities()` é lido para o menu recalcular quando o papel chega; sem `self`, nada de
    // item de administração (falha fechada) — só a saída da área e o Perfil.
    this.caps.capabilities();
    const adminItems = this.caps.self()
      ? buildAdminNavItems(visibleAdminMenu((code) => this.caps.can(code)))
      : [];
    return [
      { route: '/admin', label: 'Administração', icon: ICON_SHIELD, areaPill: true },
      ...adminItems,
      { route: this.appHome(), label: 'Voltar ao app', icon: ICON_BACK, pinBottom: true },
      { route: '/perfil', label: 'Perfil', icon: ICON_PROFILE, pinBottom: true },
    ];
  });

  constructor() {
    this.caps.ensureLoaded().subscribe();
  }
}
