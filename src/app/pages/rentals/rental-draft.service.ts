import { Injectable, inject } from '@angular/core';
import { SessionService } from '../../services/session.service';

/**
 * Rascunho do formulário de "Novo aluguel".
 *
 * Motivação: os cards de integração (Contrato / Cobrança) levam o usuário pra
 * `/configuracoes/contratos` e `/configuracoes/integracoes/asaas` via router.
 * O `RentalForm` é destruído nessa navegação e todo o preenchimento se perdia.
 * Persistimos o valor bruto do form em `sessionStorage` e restauramos na volta.
 *
 * Isolamento: a chave inclui usuário + empresa ativa, e o payload repete os dois
 * pra revalidação na leitura. Trocar de usuário ou de empresa nunca restaura o
 * rascunho do outro. `sessionStorage` (e não `localStorage`) mantém o rascunho
 * preso à aba/sessão, seguindo o resto da app (`SessionService`).
 */

const KEY_PREFIX = 'rentalDraft';
const VERSION = 1;

/** Valor bruto do form — pares controle→valor, sem tipagem forte por design. */
export type RentalDraftValue = Record<string, unknown>;

interface StoredDraft {
  v: number;
  userId: string;
  companyId: string;
  value: RentalDraftValue;
}

@Injectable({ providedIn: 'root' })
export class RentalDraftService {
  private readonly session = inject(SessionService);

  /**
   * `null` quando não há usuário/empresa na sessão — nesse caso não gravamos
   * nada, pra não criar um rascunho órfão que outro login poderia herdar.
   */
  private scope(): { key: string; userId: string; companyId: string } | null {
    const userId = this.session.getItem('id');
    const companyId = this.session.getItem('selectedCompanyId');
    if (!userId || !companyId) return null;
    return { key: `${KEY_PREFIX}:${userId}:${companyId}`, userId, companyId };
  }

  save(value: RentalDraftValue): void {
    const scope = this.scope();
    if (!scope) return;
    const payload: StoredDraft = {
      v: VERSION,
      userId: scope.userId,
      companyId: scope.companyId,
      value,
    };
    try {
      this.session.setItem(scope.key, JSON.stringify(payload));
    } catch {
      // Quota cheia ou storage indisponível — perder o rascunho é aceitável,
      // quebrar a digitação do usuário não é.
    }
  }

  load(): RentalDraftValue | null {
    const scope = this.scope();
    if (!scope) return null;
    const raw = this.session.getItem(scope.key);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const draft = parsed as Partial<StoredDraft>;
      if (draft.v !== VERSION) return null;
      // Defesa em profundidade: a chave já é por usuário/empresa, mas
      // revalidamos o dono antes de devolver qualquer coisa.
      if (draft.userId !== scope.userId || draft.companyId !== scope.companyId) return null;
      if (!draft.value || typeof draft.value !== 'object') return null;
      return draft.value;
    } catch {
      return null;
    }
  }

  clear(): void {
    const scope = this.scope();
    if (!scope) return;
    this.session.removeItem(scope.key);
  }
}
