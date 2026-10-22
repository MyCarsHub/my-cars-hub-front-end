/**
 * Contrato de API do «Montar do zero» (backend em paralelo).
 *
 * - `GET  /v1/settings/contract-template/base`      → `ContractBase`
 *   404 com `code: CONTRACT_BASE_DISABLED` quando a flag está desligada.
 * - `POST /v1/settings/contract-template/base/save` com `ContractBaseSaveRequest`
 *   → gera o DOCX, substitui o contrato atual e devolve o mesmo corpo do `GET` do template.
 */
export interface ContractBaseClause {
  id: string;
  title: string;
  description: string;
  /** Sempre no contrato (sem checkbox). */
  fixed: boolean;
  /** Opcional que já vem marcada. */
  defaultOn: boolean;
  /**
   * Markdown com campos `{{campo}}` (os mesmos de `FIELD_LABELS`). Um `## TÍTULO` marca a cláusula
   * como numerada; a tela renumera ao vivo. `# ` é o título do contrato.
   */
  text: string;
}

export interface ContractBase {
  version: string;
  /** Texto ainda não revisado juridicamente: selo «Rascunho, aguardando revisão jurídica». */
  draft: boolean;
  clauses: ContractBaseClause[];
}

export interface ContractBaseSaveRequest {
  version: string;
  optionalClauseIds: string[];
}

export const CONTRACT_BASE_DISABLED = 'CONTRACT_BASE_DISABLED';
