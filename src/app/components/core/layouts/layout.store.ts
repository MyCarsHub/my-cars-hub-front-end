import { computed, Injectable, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from '../../../services/session.service';
import { NotificationFeedService } from '../../../services/notification-feed.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { CompanySelectionService } from '../../../services/company-selection.service';
import { NotificationService } from '../../../services/notification.service';
import { IMPERSONATION_STATE_KEY } from '../../../services/impersonation.context';

export interface Tenant {
  id: string;
  name: string;
  role: string;
  initial: string;
}

const FALLBACK_TENANT: Tenant = { id: '', name: 'Sem Empresa', role: '', initial: '-' };

@Injectable({ providedIn: 'root' })
export class LayoutStore {
  private readonly router = inject(Router);
  private readonly sessionService = inject(SessionService);
  private readonly notificationFeed = inject(NotificationFeedService);
  private readonly companySelection = inject(CompanySelectionService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);

  /** Whether the sidebar is collapsed (desktop only) */
  readonly isCollapsed = signal(false);

  /** Whether the mobile drawer is open */
  readonly isMobileOpen = signal(false);

  /** Whether the tenant dropdown is open */
  readonly isTenantOpen = signal(false);

  /** Whether the viewport is mobile-sized */
  readonly isMobile = signal(false);

  /** Available tenants */
  readonly tenants = signal<Tenant[]>(this.loadTenantsFromStorage());

  /** Currently selected tenant */
  readonly selectedTenant = signal<Tenant>(this.loadSelectedTenantFromStorage(this.tenants()));

  /** Id da empresa cuja troca está em voo, ou `null` quando nada está pendente. */
  private readonly _switchingTenantId = signal<string | null>(null);
  readonly switchingTenantId = this._switchingTenantId.asReadonly();

  /** Current sidebar width token for animations */
  readonly sidebarWidth = computed(() => (this.isCollapsed() ? '72px' : '260px'));

  private loadTenantsFromStorage(): Tenant[] {
    try {
      const stored = this.sessionService.getItem('userCompanies');
      if (stored) {
        const companies = JSON.parse(stored) as any[];
        return companies.map(c => ({
          id: c.companyId,
          name: c.companyName,
          role: c.role,
          initial: c.companyName ? c.companyName.charAt(0).toUpperCase() : 'C'
        }));
      }
    } catch {
      // fail silent: corrupted userCompanies falls back to empty tenant list
    }
    return [];
  }

  private loadSelectedTenantFromStorage(tenants: Tenant[]): Tenant {
    const selectedId = this.sessionService.getItem('selectedCompanyId');
    if (selectedId) {
      const found = tenants.find(t => t.id === selectedId);
      if (found) return found;
    }
    return tenants.length > 0 ? tenants[0] : FALLBACK_TENANT;
  }

  toggleCollapse(): void {
    this.isCollapsed.update((v) => !v);
  }

  openMobile(): void {
    this.isMobileOpen.set(true);
  }

  closeMobile(): void {
    this.isMobileOpen.set(false);
  }

  toggleMobile(): void {
    this.isMobileOpen.update((v) => !v);
  }

  toggleTenant(): void {
    this.isTenantOpen.update((v) => !v);
  }

  closeTenant(): void {
    this.isTenantOpen.set(false);
  }

  selectTenant(tenant: Tenant): void {
    // Durante uma sessão de impersonação a lista de tenants é reescrita para a
    // empresa observada e só ela, mas o store é singleton de raiz: um clique
    // vindo de uma lista desatualizada gravaria id/nome/papel de OUTRA empresa
    // por cima da sessão ativa, e o banner passaria a afirmar uma empresa
    // enquanto o resto da interface mostra outra — a exata divergência que o
    // `reconcile()` existe para impedir. Fechar o seletor e não fazer nada.
    if (this.isImpersonating()) {
      this.isTenantOpen.set(false);
      return;
    }

    // Dois toques no mesmo item (ou em itens diferentes) enquanto a primeira troca
    // está em voo renderiam duas respostas fora de ordem — a última a chegar venceria
    // e poderia não ser a que o usuário tocou por último.
    if (this._switchingTenantId() !== null) return;

    this._switchingTenantId.set(tenant.id);

    // O backend resolve o tenant pelo claim `companyId` do TOKEN. Gravar a escolha no
    // armazenamento e navegar, sem pedir um token novo, mantinha TODAS as chamadas
    // seguintes na empresa anterior enquanto a interface anunciava a nova. Por isso o
    // estado local só muda DEPOIS do token — e, se o servidor recusar, nada muda.
    this.companySelection.select(tenant.id).subscribe({
      next: () => {
        this._switchingTenantId.set(null);
        this.commitTenant(tenant);
      },
      error: (err: unknown) => {
        this._switchingTenantId.set(null);
        // Reivindica o erro para o toast específico daqui não competir com a rede de
        // segurança genérica do `ApiErrorService`.
        this.apiErrors.claim(err);
        const atual = this.selectedTenant().name;
        this.notifications.error(
          `Não foi possível trocar para ${tenant.name}. Você continua em ${atual}.`,
        );
        // Seletor continua aberto de propósito: a troca não aconteceu, e tentar de
        // novo tem de ser um toque só.
      },
    });
  }

  /** Estado local + armazenamento, já com o token da empresa nova persistido. */
  private commitTenant(tenant: Tenant): void {
    this.selectedTenant.set(tenant);
    this.isTenantOpen.set(false);

    this.sessionService.setItem('selectedCompanyId', tenant.id);
    this.sessionService.setItem('selectedCompanyName', tenant.name);
    this.sessionService.setItem('selectedRole', tenant.role);

    // A troca de tenant só navega — o AppShell (e o sino dentro dele) NÃO é
    // destruído, então o feed manteria o contador e os títulos da empresa
    // anterior por até 60s. Zera o cache e força um tick imediato.
    this.notificationFeed.syncTenant();

    this.router.navigate(['/dashboard']);
  }

  /**
   * Lê a chave de sessão em vez de injetar o `ImpersonationService`: o serviço
   * já resolve este store sob demanda (para chamar `refreshTenants()` na
   * entrada e na saída da impersonação), e injetá-lo de volta fecharia um ciclo
   * de import entre os dois módulos. `impersonation.context` é folha, sem
   * dependências, e a chave só existe enquanto a sessão existe.
   */
  private isImpersonating(): boolean {
    return this.sessionService.getItem(IMPERSONATION_STATE_KEY) !== null;
  }

  /**
   * Relê `userCompanies` / `selectedCompanyId` do armazenamento.
   *
   * Obrigatório em toda troca de contexto que não destrói o shell — trocar de
   * empresa no onboarding, entrar e sair de impersonação. O store é singleton
   * de raiz e só leria o armazenamento uma vez, na construção: sem esta
   * chamada, a barra lateral do admin continuaria oferecendo as empresas dele
   * enquanto o banner anuncia a empresa observada.
   */
  refreshTenants(): void {
    const newTenants = this.loadTenantsFromStorage();
    this.tenants.set(newTenants);
    this.selectedTenant.set(this.loadSelectedTenantFromStorage(newTenants));
  }

  setMobile(isMobile: boolean): void {
    this.isMobile.set(isMobile);
    if (!isMobile) {
      this.isMobileOpen.set(false);
    }
  }
}