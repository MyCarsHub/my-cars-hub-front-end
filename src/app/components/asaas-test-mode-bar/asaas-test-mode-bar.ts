import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { SessionService } from '../../services/session.service';
import { ImpersonationService } from '../../services/impersonation.service';
import { AsaasIntegrationService } from '../../pages/company-settings/integrations/asaas-integration.service';
import { isImpersonationToken } from '../../pages/company-settings/integrations/asaas-integration.viewer';

/**
 * Faixa amarela no topo de todas as telas quando a chave Asaas ATIVA da empresa é a de testes.
 * Só o PLATFORM_ADMIN vê, e só para ele o status é pedido — sem toast em caso de falha. Dono,
 * gerente, motorista e a sessão "ver como empresa" não disparam requisição nenhuma.
 *
 * ## Reativa ao contexto
 *
 * A casca não é recriada ao entrar/sair de "ver como empresa" nem ao trocar de empresa: o token
 * troca no lugar. Por isso quem pode ver a faixa é recalculado a cada troca de contexto
 * (`AsaasIntegrationService.epoch`, que sobe no `TenantResetRegistry`), a cada mudança da
 * impersonação e a cada navegação — e a faixa só confia num status lido com o token ATUAL
 * (`statusToken`), então nunca mostra o ambiente de outra empresa.
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
  private readonly impersonating = inject(ImpersonationService).active;
  private readonly navigations = toSignal(
    inject(Router).events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => (e as NavigationEnd).urlAfterRedirects),
    ),
    { initialValue: null },
  );

  /** Token atual de quem pode ver a faixa, ou `null`. Reavaliado a cada troca de contexto. */
  private readonly eligibleToken = computed(() => {
    this.asaas.epoch();
    this.impersonating();
    this.navigations();
    return this.readEligibleToken();
  });

  protected readonly visible = computed(() => {
    const token = this.eligibleToken();
    if (!token || this.asaas.statusToken() !== token) return false;
    const s = this.asaas.status();
    if (!s?.connected) return false;
    const active = s.activeEnvironment !== undefined ? s.activeEnvironment : s.environment;
    return active === 'SANDBOX';
  });

  constructor() {
    // Uma leitura por sessão/token: o efeito só depende de `eligibleToken`. `untracked` impede
    // que cada mudança do status (que `loadQuietly` lê) reabra o efeito e repita a requisição.
    effect(() => {
      if (this.eligibleToken()) untracked(() => this.asaas.loadQuietly());
    });
  }

  /**
   * Admin de verdade (impersonação fora, pelo claim, antes do papel) e com empresa no token.
   * Fail-closed: a faixa é um extra da casca e nada nela pode derrubá-la.
   */
  private readEligibleToken(): string | null {
    try {
      if (this.impersonating()) return null;
      const token = this.session.getToken();
      if (!token || isImpersonationToken(token)) return null;
      if (!this.session.isPlatformAdmin() || this.session.getCompanyIdFromToken() === null)
        return null;
      return token;
    } catch {
      return null;
    }
  }
}
