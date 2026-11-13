import { Injectable, computed, inject } from '@angular/core';

import { SessionService } from './session.service';
import { SessionResetRegistry } from './session-reset.registry';
import { ImpersonationService } from './impersonation.service';
import { featuresSessionVersion, markFeaturesChanged } from './features-session';

/**
 * Chave de `sessionStorage` com a lista crua (JSON) devolvida por `GET /auth/me`. Quem
 * grava é `AuthService.writeSession` (literal `'features'`, para este serviço não entrar no
 * bundle inicial).
 */
export const FEATURES_SESSION_KEY = 'features';

/** FEAT-0573 — Cobranças flexíveis (plano na criação, acordo, recebida por fora). */
export const CHARGES_FLEX_FEATURE = 'CHARGES_FLEX';

/**
 * Recursos liberados por conta, lidos do campo aditivo `features` de `GET /auth/me`.
 *
 * Fonte única para a interface decidir se mostra um recurso em liberação gradual. NÃO é a
 * defesa: o backend recusa (403 `CHARGES_FLEX_DISABLED`) toda rota do recurso para quem não
 * está na lista. Fail-closed: lista ausente, nula, vazia ou ilegível = nada liberado.
 *
 * Na sessão de suporte ("ver como empresa") nada é liberado: o backend recusa o recurso para
 * o token de impersonação (`CHARGES_FLEX_SUPPORT_SESSION`), então a tela fica como hoje.
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlagsService {
  private readonly session = inject(SessionService);
  private readonly impersonation = inject(ImpersonationService);
  /**
   * Relida da sessão sempre que ela muda (login, `/auth/me`, logout) — nunca presa no valor
   * da construção do serviço.
   */
  private readonly features = computed<readonly string[]>(() => {
    featuresSessionVersion();
    return this.readStored();
  });

  readonly chargesFlex = computed(
    () => !this.impersonation.active() && this.features().includes(CHARGES_FLEX_FEATURE),
  );

  constructor() {
    // A sessão foi zerada (logout e afins): relê, agora vazia.
    inject(SessionResetRegistry).register(() => markFeaturesChanged());
  }

  /** Relê a sessão (ex.: algo gravou `features` por fora do `AuthService`). */
  refresh(): void {
    markFeaturesChanged();
  }

  /** Grava e aplica uma lista (testes e quem já tem o `/auth/me` em mãos). */
  setFromMe(features: readonly string[] | null | undefined): void {
    const list = Array.isArray(features)
      ? features.filter((f): f is string => typeof f === 'string')
      : [];
    this.session.setItem(FEATURES_SESSION_KEY, JSON.stringify(list));
    markFeaturesChanged();
  }

  private readStored(): readonly string[] {
    const raw = this.session.getItem(FEATURES_SESSION_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string') : [];
    } catch {
      return [];
    }
  }
}
