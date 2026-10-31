/** Contratos de API do fluxo com IA (backend: ContractDraftController / ContractDraftDecisionController). */

export type DraftStatus =
  | 'AWAITING_CONSENT'
  | 'ANALYZING'
  | 'NEEDS_REVIEW'
  | 'READY'
  | 'FAILED'
  | 'SAVED'
  | 'EXPIRED';

export interface FieldOption {
  field: string;
  label: string;
}

/** Trecho, contexto e motivo chegam MASCARADOS do backend (ex.: [CPF_1]). */
export interface SuggestionView {
  id: string;
  paragraphId: string;
  field: string;
  fieldLabel: string;
  excerpt: string;
  context: string;
  confidence: number;
  reason: string;
  alternatives: FieldOption[] | null;
  /** O servidor não ligou o dado ao motorista: pergunta sem resposta sugerida. Sem resposta, fica fixo. */
  askParty?: boolean;
}

export interface DraftStatusResponse {
  draftId: string;
  status: DraftStatus;
  failureCode: string | null;
  filename: string | null;
  layoutSimplified: boolean;
  certain: SuggestionView[];
  doubts: SuggestionView[];
  /** Campos que o contrato enviado JÁ traz como `{{campo}}`. Ausente até a análise terminar. */
  existingFields?: FieldOption[];
}

export interface DraftSubmittedResponse {
  draftId: string;
  status: DraftStatus;
}

export interface DraftDecisionsResponse {
  draftId: string;
  status: DraftStatus;
  acceptedCount: number;
  pendingDoubtIds: string[];
}

export interface MaskedTextResponse {
  draftId: string;
  paragraphs: { id: string; text: string }[];
  maskedTextSha256: string;
  consentVersion: string;
  notMasked: { code: string; label: string }[];
  /**
   * A quem o texto vai (provedor:modelo[>escalonamento], vírgula entre provedores). Volta no
   * POST do consentimento EXATAMENTE como veio: o aceite só vale para esses provedores e modelos.
   */
  aiRoute: string;
  /** A mesma rota, legível: um item por provedor com os modelos. */
  aiProviders: AiProviderView[];
}

export interface AiProviderView {
  provider: string;
  label: string;
  models: string[];
}

export interface DraftDecision {
  id: string;
  field: string;
  accept: boolean;
}

export type FlowStep =
  | 'intro'
  | 'consent'
  | 'progress'
  | 'doubts'
  | 'preview'
  | 'fields'
  | 'failed'
  | 'expired'
  | 'saved';
