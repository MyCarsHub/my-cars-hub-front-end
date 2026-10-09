import { computed, Injectable, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from '../../../services/session.service';
import { TenantCachesService } from '../../../services/tenant-caches.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { CompanySelectionService } from '../../../services/company-selection.service';
import { NotificationService } from '../../../services/notification.service';
import { MembershipsService } from '../../../services/memberships.service';
import { companyRoleLabel } from '../../../utils/role-labels';
import { IMPERSONATION_STATE_KEY } from '../../../services/impersonation.context';

export interface Tenant {
  id: string;
  name: string;
  role: string;
  initial: string;
}

/** One row of the 'Suas empresas' list, whatever its source (memberships endpoint or /auth/me). */
export interface SwitcherEntry {
  id: string;
  name: string;
  initial: string;
  role: string;
  roleLabel: string;
  status: 'ACTIVE' | 'ONBOARDING';
}

/** Where each role lands after a company switch. DRIVER cannot open the dashboard (403). */
export function homeRouteFor(role: string | null | undefined): string {
  return role === 'DRIVER' ? '/alugueis' : '/dashboard';
}

const FALLBACK_TENANT: Tenant = { id: '', name: 'Sem Empresa', role: '', initial: '-' };

@Injectable({ providedIn: 'root' })
export class LayoutStore {
  private readonly router = inject(Router);
  private readonly sessionService = inject(SessionService);
  private readonly tenantCaches = inject(TenantCachesService);
  private readonly companySelection = inject(CompanySelectionService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly membershipsService = inject(MembershipsService);

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

  /**
   * Company the SESSION is in (`selectedCompanyId`, written together with the token). The
   * switcher's 'current' marker reads this — never the position in a list, which the
   * backend orders by last use and which changes under the person's feet.
   */
  readonly currentCompanyId = signal<string | null>(this.sessionService.getItem('selectedCompanyId'));

  /**
   * Rows of the switcher: memberships when the endpoint answered, else the `userCompanies`
   * snapshot from /auth/me (today's behaviour).
   */
  readonly switcherEntries = computed<SwitcherEntry[]>(() => {
    // `tenants` is read first on purpose: `refreshTenants()` runs on entering/leaving an
    // impersonation, and re-evaluating here is what drops the admin's own memberships then.
    const tenants = this.tenants();
    if (this.membershipsService.status() === 'ready' && !this.isImpersonating()) {
      return this.membershipsService.memberships().map((m) => ({
        id: m.companyId,
        name: m.companyName,
        initial: m.companyName ? m.companyName.charAt(0).toUpperCase() : 'C',
        role: m.role,
        roleLabel: m.roleLabel || companyRoleLabel(m.role),
        status: m.status,
      }));
    }
    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      initial: t.initial,
      role: t.role,
      roleLabel: companyRoleLabel(t.role),
      status: 'ACTIVE' as const,
    }));
  });

  readonly pendingInvites = this.membershipsService.pendingInvites;

  /** The switcher entry exists only when there is something to switch to or to finish. */
  readonly showSwitcher = computed(
    () =>
      this.switcherEntries().length > 1 ||
      this.switcherEntries().some((e) => e.status === 'ONBOARDING') ||
      this.pendingInvites().length > 0,
  );

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
    const opening = !this.isTenantOpen();
    this.isTenantOpen.set(opening);
    // Lazy: the list is asked for when the person opens the switcher.
    if (opening && !this.isImpersonating()) this.membershipsService.load(true);
  }

  /** Lists the memberships once per session; the shell calls this on start. */
  ensureMembershipsLoaded(): void {
    if (this.isImpersonating()) return;
    this.membershipsService.load();
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
        // FIX-0363 — a troca é o momento em que a lista pode ter mudado (um
        // convite aceito desde o login). Best-effort de propósito: a troca JÁ
        // deu certo e o token novo já está gravado, então uma falha aqui só
        // significa "a lista continua a de antes" — nunca desfazer a troca nem
        // alarmar quem trocou de empresa com sucesso.
        this.refreshTenantsFromServer();
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
    this.currentCompanyId.set(tenant.id);
    this.isMobileOpen.set(false);
    this.isTenantOpen.set(false);

    // A troca de tenant só navega — o AppShell (e todo serviço `providedIn:
    // 'root'` dentro dele) NÃO é destruído, e este caminho não passa por
    // `SessionService.clear()`, então nenhum cache de raiz era descartado: a
    // empresa nova abria com a frota, os alertas, os relatórios e até a decisão
    // de bloqueio da anterior. Descarta ANTES de regravar as chaves, que é o
    // que deixa `syncTenant()` ainda enxergar a mudança de empresa e disparar um
    // tick imediato em vez de esperar o próximo poll de 60s (FIX-0272).
    // Só quando a empresa MUDA: reselecionar a mesma no menu não pode custar
    // um recarregamento de tudo — `syncTenant()` abaixo já é idempotente.
    //
    // O booleano e lido UMA vez e reusado na navegacao abaixo, porque as duas decisoes
    // respondem a mesma pergunta: "a empresa mudou?". Ler a chave de novo depois do
    // `setItem` daria sempre `false` e a segunda decisao nunca dispararia.
    const companyChanged = this.sessionService.getItem('selectedCompanyId') !== tenant.id;
    if (companyChanged) {
      this.tenantCaches.resetAll();
    }

    this.sessionService.setItem('selectedCompanyId', tenant.id);
    this.sessionService.setItem('selectedCompanyName', tenant.name);
    this.sessionService.setItem('selectedRole', tenant.role);

    this.tenantCaches.syncTenant();

    /*
     * RECRIAR, nao so navegar. Isto terminava em `navigate(['/dashboard'])`, e estando a
     * pessoa JA no dashboard — a tela inicial, logo o caso comum — a navegacao era um
     * NO-OP: o Angular reaproveita o componente, `ngOnInit` nao roda de novo, e nada
     * recarrega. O seletor passava a mostrar a empresa nova e os numeros continuavam sendo
     * os da anterior. Trocar estando em OUTRA tela funcionava, o que fazia o defeito
     * parecer intermitente.
     *
     * O conserto fica AQUI, no ponto unico da troca, e nao em cada tela: se a regra fosse
     * "cada tela reage ao tenant", toda tela nova precisaria LEMBRAR de reagir, e a que
     * esquecesse mostraria dado da empresa errada em silencio. Mesma doenca do cache por
     * empresa, que ja exige registro explicito.
     *
     * O pivo e uma rota inerte (`/trocando-empresa`) e nao `'/'`: medido, a rota raiz deste
     * app e a LANDING PAGE publica, com chunk proprio — montaria marketing no meio da troca.
     *
     * SO QUANDO A EMPRESA MUDA, pela mesma razao que o descarte de cache acima: reselecionar
     * a mesma empresa no menu nao pode custar a recriacao de todas as telas. Sem esta
     * condicao o pivo recriaria a arvore para confirmar o que ja estava na tela — e um clique
     * sem efeito pretendido passaria a ter o custo de um recarregamento.
     */
    if (companyChanged) {
      this.router
        .navigateByUrl('/trocando-empresa', { skipLocationChange: true })
        .then(() => this.router.navigate([homeRouteFor(tenant.role)]));
      return;
    }

    this.router.navigate([homeRouteFor(tenant.role)]);
  }

  /**
   * 'Concluir cadastro': asks the backend to select a company whose membership is still in
   * onboarding. The onboarding token lands in its own slot (never the session token) and the
   * person goes to the onboarding screen; the DRIVER variant shows that screen's 'em breve'
   * placeholder because the driver registration ships later.
   */
  resumeOnboarding(entry: SwitcherEntry): void {
    if (this.isImpersonating() || this._switchingTenantId() !== null) return;
    this._switchingTenantId.set(entry.id);
    this.companySelection.selectDetailed(entry.id).subscribe({
      next: (outcome) => {
        this._switchingTenantId.set(null);
        this.isTenantOpen.set(false);
        if (outcome.kind === 'INVITE_ONBOARDING') {
          void this.router.navigate(['/convite/cadastro']);
          return;
        }
        // The membership turned ACTIVE meanwhile: it behaves as a plain switch.
        this.commitTenant({ id: entry.id, name: entry.name, role: entry.role, initial: entry.initial });
      },
      error: (err: unknown) => {
        this._switchingTenantId.set(null);
        this.apiErrors.claim(err);
        this.notifications.error(
          `Não foi possível abrir o cadastro de ${entry.name}. Tente novamente.`,
        );
      },
    });
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
  /**
   * Busca as empresas em `/auth/me` e republica a lista do seletor.
   *
   * Silencioso por contrato — ver a chamada em `selectTenant`. O `catch` cobre
   * o caso de o observable emitir erro sem assinante de erro.
   */
  private refreshTenantsFromServer(): void {
    this.companySelection.refreshCompaniesFromMe().subscribe({
      next: () => this.refreshTenants(),
      error: () => void 0,
    });
  }

  refreshTenants(): void {
    const newTenants = this.loadTenantsFromStorage();
    this.tenants.set(newTenants);
    this.selectedTenant.set(this.loadSelectedTenantFromStorage(newTenants));
    this.currentCompanyId.set(this.sessionService.getItem('selectedCompanyId'));
  }

  setMobile(isMobile: boolean): void {
    this.isMobile.set(isMobile);
    if (!isMobile) {
      this.isMobileOpen.set(false);
    }
  }
}
