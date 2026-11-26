import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SessionService } from '../../services/session.service';
import { AsaasIntegrationService } from '../../pages/company-settings/integrations/asaas-integration.service';
import { isImpersonationToken } from '../../pages/company-settings/integrations/asaas-integration.viewer';

/**
 * Faixa amarela no topo de todas as telas quando a chave Asaas ATIVA da empresa é a de testes.
 * Só o PLATFORM_ADMIN vê, e só para ele o status é pedido — uma vez, sem toast em caso de falha.
 * Dono, gerente, motorista e a sessão "ver como empresa" não disparam requisição nenhuma.
 *
 * Lê o mesmo sinal da página do Asaas (`AsaasIntegrationService.status`): a troca de ambiente,
 * a conexão e a desconexão já gravam ali, então a faixa acende e apaga sem recarregar.
 */
@Component({
  selector: 'app-asaas-test-mode-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (visible()) {
      <div
        role="status"
        data-testid="asaas-testbar"
        class="flex shrink-0 items-center justify-center gap-2 px-4 py-2 text-center text-[13px] font-bold
               bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200"
      >
        <svg
          viewBox="0 0 24 24"
          class="h-4 w-4 flex-none"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3" />
          <path d="M7 15h10" />
        </svg>
        Asaas de testes: as cobranças não são reais
      </div>
    }
  `,
})
export class AsaasTestModeBar {
  private readonly session = inject(SessionService);
  private readonly asaas = inject(AsaasIntegrationService);

  /** Admin de verdade (não a sessão de suporte) e com empresa no token: sem empresa não há chave. */
  private readonly eligible = this.computeEligible();

  protected readonly visible = computed(() => {
    if (!this.eligible) return false;
    const s = this.asaas.status();
    if (!s?.connected) return false;
    const active = s.activeEnvironment !== undefined ? s.activeEnvironment : s.environment;
    return active === 'SANDBOX';
  });

  constructor() {
    if (this.eligible) this.asaas.loadQuietly();
  }

  /**
   * Fail-closed: a faixa é um extra da casca e nada nela pode derrubá-la. Qualquer falha ao ler a
   * sessão (token ilegível, sessão sem esses métodos num ambiente reduzido) vale "não é admin".
   */
  private computeEligible(): boolean {
    try {
      return (
        !isImpersonationToken(this.session.getToken()) &&
        this.session.isPlatformAdmin() &&
        this.session.getCompanyIdFromToken() !== null
      );
    } catch {
      return false;
    }
  }
}
