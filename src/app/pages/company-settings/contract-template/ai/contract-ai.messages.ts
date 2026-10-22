import { HttpErrorResponse } from '@angular/common/http';

/**
 * Texto-rascunho do aviso da tela 1. FEAT-0309 (aprovação do dono/advogado) troca por
 * este único ponto; o provedor é nomeado em FEAT-0308.
 */
export const AI_SEND_NOTICE = {
  sent: 'Este é o texto exato, já mascarado, que será enviado a um serviço de inteligência artificial de terceiros para localizar nomes, valores e datas.',
  consent: 'Entendi o que será enviado e autorizo o envio deste texto para análise.',
} as const;

export const LEGAL_DISCLAIMER =
  'O MyCarsHub não valida as cláusulas. Se tiver dúvida, peça para o seu advogado revisar.';

/** Códigos de `failureCode` do rascunho (status FAILED). */
const FAILURE_MESSAGES: Record<string, string> = {
  AI_DISABLED: 'A análise com IA está indisponível no momento.',
  AI_TIMEOUT: 'A análise demorou mais do que o esperado. Tente de novo em instantes.',
  AI_INVALID_RESPONSE: 'Não conseguimos entender a resposta da análise. Tente de novo.',
  NO_VALID_SUGGESTIONS:
    'Não encontramos nomes, valores ou datas para virar campos neste arquivo. Tente montar do zero.',
  SCANNED_PDF: 'Este arquivo parece ser uma imagem escaneada. Envie o contrato em Word (.docx).',
  FILE_INVALID: 'Não foi possível ler este arquivo. Envie o contrato em Word (.docx).',
  CONSENT_REQUIRED: 'A análise exige a sua autorização. Envie o arquivo de novo e autorize o envio.',
  DRAFT_EXPIRED: 'Esta análise expirou. Envie o arquivo de novo.',
};

const FAILURE_FALLBACK = 'Não foi possível ler este contrato. Tente de novo ou monte do zero.';

export function failureMessage(code: string | null): string {
  return (code && FAILURE_MESSAGES[code]) || FAILURE_FALLBACK;
}

/** Códigos de erro HTTP (corpo `{message, code}`) das chamadas do fluxo. */
const HTTP_MESSAGES: Record<string, string> = {
  AI_DISABLED: 'A análise com IA está indisponível no momento. Você pode montar o contrato do zero.',
  AI_BUSY: 'A análise está com muita fila agora. Tente de novo em alguns segundos.',
  DRAFT_LIMIT_REACHED:
    'Você já tem análises em andamento. Termine ou aguarde uma delas expirar antes de enviar outro arquivo.',
  PDF_NOT_SUPPORTED:
    'Arquivo em PDF ainda não dá para ler. Envie o contrato em Word (.docx) ou monte do zero.',
  INVALID_FILE_TYPE: 'Este arquivo não é do Word. Envie o contrato que termina em .docx.',
  FILE_REQUIRED: 'Escolha o arquivo do contrato antes de continuar.',
  FILE_TOO_LARGE: 'O arquivo é maior que 5 MB.',
  SUPPORT_SESSION_NOT_ALLOWED:
    'Em modo de suporte não dá para enviar o contrato da empresa para a IA.',
  CONTRACT_BASE_VERSION_CHANGED:
    'O modelo de contrato foi atualizado enquanto você montava. Já carregamos a versão nova: confira e salve de novo.',
  CONTRACT_BASE_UNKNOWN_CLAUSE:
    'Algumas cláusulas mudaram no modelo. Já atualizamos a lista: confira e salve de novo.',
  CONTRACT_BASE_FIXED_CLAUSE:
    'Algumas cláusulas mudaram no modelo. Já atualizamos a lista: confira e salve de novo.',
  CONTRACT_BASE_DUPLICATE_CLAUSE:
    'Algumas cláusulas mudaram no modelo. Já atualizamos a lista: confira e salve de novo.',
  CONTRACT_BASE_INVALID_REQUEST: 'Não foi possível salvar estas escolhas. Volte, confira as cláusulas e tente de novo.',
  CONTRACT_BASE_FORBIDDEN:
    'Só o dono ou o gerente da empresa pode salvar o contrato. Em modo de suporte, o contrato não pode ser alterado.',
  DOUBTS_PENDING: 'Ainda há dúvidas sem resposta.',
  DRAFT_ALREADY_SAVED: 'Este contrato já foi salvo.',
  DRAFT_FAILED: 'A análise deste arquivo falhou. Envie o arquivo de novo.',
  FILE_INVALID: 'Não foi possível ler este arquivo. Envie o contrato em Word (.docx).',
  CONSENT_VERSION_MISMATCH:
    'O texto de autorização foi atualizado. Leia de novo e autorize para continuar.',
  CONSENT_TEXT_MISMATCH: 'O texto mudou desde que você o viu. Leia de novo e autorize.',
  CONSENT_INCOMPLETE: 'Não foi possível confirmar a autorização. Tente de novo.',
  DRAFT_NOT_AWAITING_CONSENT: 'Este arquivo já foi autorizado ou não está mais disponível.',
  DRAFT_EXPIRING: 'Este rascunho está expirando. Envie o arquivo de novo.',
  DRAFT_NOT_DISCARDABLE: 'A análise está em andamento. Aguarde terminar para descartar.',
  DRAFT_NOT_READY: 'A análise ainda não terminou.',
  DRAFT_CHANGED: 'O rascunho mudou em outra aba. Atualizamos a tela para você.',
  TEMPLATE_APPLY_FAILED:
    'Não foi possível aplicar os campos escolhidos ao contrato. Nada foi alterado.',
};

export function errorCode(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse)) return null;
  const body: unknown = err.error;
  if (body && typeof body === 'object' && 'code' in body) {
    const code = (body as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export function httpErrorMessage(err: unknown, fallback: string): string {
  const code = errorCode(err);
  if (code === 'AI_BUSY' && err instanceof HttpErrorResponse) {
    const secs = Number.parseInt(err.headers?.get('Retry-After') ?? '', 10);
    if (Number.isFinite(secs) && secs > 0) {
      return `A análise está com muita fila agora. Tente novamente em ${Math.min(secs, 300)} segundos.`;
    }
  }
  if (code && HTTP_MESSAGES[code]) return HTTP_MESSAGES[code];
  if (err instanceof HttpErrorResponse) {
    if (err.status === 413) return 'O arquivo é maior que 5 MB. Envie um arquivo menor.';
    if (err.status === 429)
      return 'Muitas análises seguidas. Aguarde alguns minutos e tente de novo.';
    if (err.status === 0)
      return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  }
  return fallback;
}

export const CONFIRM_OVERWRITE_CODES: readonly string[] = [
  'ACTIVE_TEMPLATE_CHANGED',
  'ACTIVE_TEMPLATE_CHANGED_SINCE_ANALYSIS',
];

/**
 * Rótulos pt-BR dos campos da lista fechada (espelho de ContractFieldLabels no backend).
 * A API já devolve `fieldLabel`; este mapa cobre o que a tela mostra sem sugestão.
 */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  companyName: 'Nome da locadora',
  companyCnpj: 'CNPJ da locadora',
  companyPhone: 'Telefone da locadora',
  companyEmail: 'E-mail da locadora',
  companyAddress: 'Endereço da locadora',
  companyCep: 'CEP da locadora',
  companyCity: 'Cidade da empresa',
  companyRepresentative: 'Representante da locadora',
  companyRepresentativeRole: 'Cargo do representante',
  driverName: 'Nome do motorista',
  driverCpf: 'CPF do motorista',
  driverRg: 'RG do motorista',
  driverEmail: 'E-mail do motorista',
  driverPhone: 'Telefone do motorista',
  driverLicense: 'Número da CNH',
  driverLicenseCategory: 'Categoria da CNH',
  driverLicenseExpiry: 'Validade da CNH',
  driverAddress: 'Endereço do motorista',
  driverCep: 'CEP do motorista',
  vehiclePlate: 'Placa',
  vehicleBrand: 'Marca',
  vehicleModel: 'Modelo',
  vehicleYear: 'Ano',
  vehicleColor: 'Cor',
  vehicleChassi: 'Chassi',
  vehicleRenavam: 'Renavam',
  vehicleMileage: 'Quilometragem do veículo',
  vehicleFuel: 'Combustível',
  rentalId: 'Número do contrato',
  contractDate: 'Data do contrato',
  startDate: 'Início do aluguel',
  endDate: 'Fim do aluguel',
  totalAmount: 'Valor total',
  caucaoAmount: 'Caução',
  periodRate: 'Valor por período',
  billingFrequency: 'Frequência de cobrança',
  initialKm: 'Km inicial',
  pickupDate: 'Data de retirada',
  firstPaymentDate: 'Data do primeiro pagamento',
  dailyInterest: 'Juros por dia de atraso',
  lateFine: 'Multa por atraso',
  franchiseKm: 'Km de franquia',
  returnFuelPolicy: 'Combustível na devolução',
};

/** Rótulo pt-BR; nunca devolve o nome técnico cru. */
export function fieldLabel(field: string, apiLabel?: string | null): string {
  return apiLabel?.trim() || FIELD_LABELS[field] || 'Campo do contrato';
}

/**
 * Texto vindo de arquivo ou da API para exibicao: remove caracteres de controle e de
 * direcao (bidi) / largura zero, que permitem disfarcar o nome do arquivo ou o trecho.
 */
export function safeText(value: string | null | undefined): string {
  let out = '';
  for (const ch of value ?? '') {
    if (!isHiddenCode(ch.codePointAt(0) ?? 0, false)) out += ch;
  }
  return out;
}

/**
 * Controle (C0/C1), hífen suave, largura zero e bidi. `keepLayout` preserva \n e \t, que o
 * texto do consentimento mostra como quebra real.
 */
function isHiddenCode(c: number, keepLayout: boolean): boolean {
  if (keepLayout && (c === 0x09 || c === 0x0a)) return false;
  return (
    c <= 0x1f ||
    (c >= 0x7f && c <= 0x9f) ||
    c === 0xad ||
    (c >= 0x200b && c <= 0x200f) ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2060 && c <= 0x2064) ||
    (c >= 0x2066 && c <= 0x2069) ||
    c === 0xfeff
  );
}

export interface TextSegment {
  text: string;
  marker: boolean;
}

/**
 * Para o texto EXATO do consentimento: preserva quebra de linha e tab, e torna VISÍVEIS os
 * caracteres de controle, largura zero e bidi como marcadores ⟦U+XXXX⟧ (só exibição).
 */
export function revealInvisible(value: string): { segments: TextSegment[]; invisible: number } {
  const text = value.replace(/\r\n/g, '\n');
  const segments: TextSegment[] = [];
  let buf = '';
  let invisible = 0;
  for (const ch of text) {
    if (isHiddenCode(ch.codePointAt(0) ?? 0, true)) {
      if (buf) segments.push({ text: buf, marker: false });
      buf = '';
      const hex = (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
      segments.push({ text: `⟦U+${hex}⟧`, marker: true });
      invisible += 1;
    } else {
      buf += ch;
    }
  }
  if (buf) segments.push({ text: buf, marker: false });
  return { segments, invisible };
}
