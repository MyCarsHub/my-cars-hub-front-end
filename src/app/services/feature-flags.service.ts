import { Injectable, computed, inject, signal } from '@angular/core';

import { SessionService } from './session.service';
import { SessionResetRegistry } from './session-reset.registry';
import { ImpersonationService } from './impersonation.service';

/** Chave de `sessionStorage` com a lista crua (JSON) devolvida por `GET /auth/me`. */
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
  private readonly features = signal<readonly string[]>(this.readStored());

  readonly chargesFlex = computed(
    () => !this.impersonation.active() && this.features().includes(CHARGES_FLEX_FEATURE),
  );

  constructor() {
    inject(SessionResetRegistry).register(() => this.features.set([]));
  }

  /** Chamado por `AuthService.writeSession` com o `features` do `/auth/me`. */
  setFromMe(features: readonly string[] | null | undefined): void {
    const list = Array.isArray(features)
      ? features.filter((f): f is string => typeof f === 'string')
      : [];
    this.session.setItem(FEATURES_SESSION_KEY, JSON.stringify(list));
    this.features.set(list);
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
