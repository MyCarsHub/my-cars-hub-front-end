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
  /** Dado de pessoa ou empresa: pergunta ao dono, sem resposta sugerida. Sem resposta, fica fixo. */
  question?: QuestionView;
  /** Bloco de dados de pessoa: a etapa pergunta a parte do bloco inteiro. */
  block?: BlockView;
  /** Dado de um bloco (só na folha): acende junto com o bloco em foco. */
  blockId?: string;
  /** Dado de um bloco (só na folha): todos os lugares onde o valor aparece. */
  places?: QuestionPlace[];
}

export interface QuestionPlace {
  paragraphId: string;
  excerpt: string;
}

export type NearbyWhere = 'COLUMN' | 'ROW' | 'BEFORE' | 'AFTER';

export interface QuestionNearby {
  where: NearbyWhere;
  text: string;
}

/** Um valor distinto do contrato. A resposta vale para todas as `places`. Texto mascarado. */
export interface QuestionView {
  id: string;
  kind: string;
  excerpt: string;
  context: string;
  places: QuestionPlace[];
  options: FieldOption[];
  nearby: QuestionNearby[];
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
  /** Ausente num backend anterior às perguntas: esta tela segue funcionando com ele. */
  questions?: QuestionView[];
  /**
   * Os MESMOS dados de `questions`, agrupados como o dono responde: confirmar o bloco (CONFIRM) ou
   * escolher de quem é (QUESTION/CONFLICT). Presente: a tela pergunta por bloco, não por valor.
   */
  blocks?: BlockView[];
}

/** Parte de um dado de pessoa. NONE = «deixar fixo» (só na resposta). */
export type Party = 'DRIVER' | 'COMPANY' | 'THIRD';
export type BlockAnswer = Party | 'NONE';
export type BlockKind = 'CONFIRM' | 'QUESTION' | 'CONFLICT';

export interface PartyOption {
  party: Party;
  label: string;
}

/** Um dado do bloco, com o texto REAL. `fieldsByParty`: o campo em cada parte (ausente = fixo). */
export interface BlockItemView {
  id: string;
  kind: string;
  excerpt: string;
  context: string;
  places: QuestionPlace[];
  fieldsByParty: Partial<Record<Party, FieldOption[]>>;
}

export interface BlockView {
  id: string;
  kind: BlockKind;
  /** Parte que o documento deu (só em CONFIRM). */
  party: Party | null;
  partyLabel: string | null;
  /** O que a IA propôs: só pré-seleciona, nunca é aplicado sem o toque do dono. */
  aiParty: Party | null;
  aiEvidence: string | null;
  source: string;
  /** Título ou rótulo que deu a parte («Informações do Locador»). */
  label: string | null;
  sectionPath: string[];
  options: PartyOption[];
  /** «Esta resposta vale para N itens». */
  appliesTo: number;
  items: BlockItemView[];
}

/** Trecho do texto real que vira marcador antes de ir à IA. */
export interface ProtectedSpan {
  start: number;
  end: number;
  kind: string;
}

export interface DocumentParagraph {
  id: string;
  text: string;
  headingLevel: number;
  bold: boolean;
  structural: boolean;
  sectionPath: string[];
  cell: { table: number; row: number; column: number } | null;
  protectedSpans: ProtectedSpan[];
}

/** GET /drafts/{id}/document: o contrato REAL do rascunho, para a folha. */
export interface DraftDocumentResponse {
  draftId: string;
  status: DraftStatus;
  paragraphs: DocumentParagraph[];
  /** Valores distintos escondidos da IA, por tipo (CPF, NAME, ADDRESS…). */
  maskedCounts: Record<string, number>;
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
  /** Valores distintos escondidos, por tipo. Ausente num backend anterior. */
  maskedCounts?: Record<string, number>;
}

export interface AiProviderView {
  provider: string;
  label: string;
  models: string[];
}

export interface DraftDecision {
  id: string;
  field: string | null;
  accept: boolean;
  /** Só na resposta a uma pergunta: o backend recusa o aceite sem isto. */
  confirmed?: boolean;
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
