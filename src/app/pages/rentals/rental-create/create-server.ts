import { RentalPreflightItem } from '../../../types/rental.types';
import { companySafe } from '../charges-flex/flex-errors';
import { messageWithAccepted } from '../rental-preflight';

/**
 * As recusas do servidor no Novo aluguel em uma página: a mesma leitura do passo a passo
 * (`rental-wizard.ts`), copiada aqui para esta tela não carregar o passo a passo junto.
 */

/** Campo do corpo (preflight / 400) → controle do formulário. */
export const CONTROL_BY_SERVER_FIELD: Readonly<Record<string, string>> = {
  vehicleId: 'vehicleId',
  driverId: 'driverId',
  startDate: 'startDate',
  endDate: 'endDate',
  pickupDate: 'pickupTime',
  billingFrequency: 'periodRateReais',
  periodRate: 'periodRateReais',
  firstPaymentDate: 'firstPaymentDate',
  caucaoAmount: 'caucaoReais',
  initialKm: 'initialKm',
  dailyInterestAmount: 'lateInterestPercent',
  lateInterestPercentPerMonth: 'lateInterestPercent',
  lateFineType: 'lateFineValue',
  lateFineValue: 'lateFineValue',
  franchiseKm: 'franchiseKm',
  extraKmPrice: 'extraKmPriceReais',
  returnFuelPolicy: 'customFuel',
};

/** Em que card (0-based) mora cada controle: "Mudar", "Ir" e as recusas do servidor. */
export const CARD_OF_CONTROL: Readonly<Record<string, number>> = {
  driverId: 0,
  vehicleId: 0,
  startDate: 1,
  pickupTime: 1,
  pickupDay: 1,
  endDate: 1,
  caucaoReais: 2,
  caucaoDiscount: 2,
  periodRateReais: 3,
  discountN: 3,
  discountValue: 3,
  firstPaymentDate: 4,
  initialKm: 4,
  customFuel: 4,
  franchiseKm: 4,
  extraKmPriceReais: 4,
  lateFineValue: 4,
  lateInterestPercent: 4,
  useContractTemplate: 5,
  automaticCharge: 6,
  notes: 7,
};

/**
 * Os controles de que depende o valor que o servidor recusou. A recusa só some quando UM deles
 * muda: a caução enviada é a líquida (valor − desconto, ou o valor cheio com "Recebi por fora"),
 * então mexer no desconto ou nas partes também a refaz. `$caucaoParts` = as partes da caução.
 */
export const CONTROLS_OF_SERVER_ERROR: Readonly<Record<string, readonly string[]>> = {
  caucaoReais: ['caucaoReais', 'caucaoDescOn', 'caucaoDiscount', 'caucaoPaid', 'caucaoSplit', '$caucaoParts'],
  periodRateReais: ['periodRateReais', 'billingFrequency'],
  pickupTime: ['pickupTime', 'pickupOtherDay', 'pickupDay', 'startDate'],
  lateFineValue: ['lateFineValue', 'lateFineType'],
  lateInterestPercent: ['lateInterestPercent'],
  customFuel: ['fuel', 'customFuel'],
  franchiseKm: ['franchiseKm', 'hasKmLimit'],
  extraKmPriceReais: ['extraKmPriceReais', 'hasKmLimit'],
};

/** Os controles de que uma recusa depende (sem entrada na tabela, só o próprio controle). */
export function controlsOfServerError(control: string): readonly string[] {
  return CONTROLS_OF_SERVER_ERROR[control] ?? [control];
}

/**
 * O card de um bloqueio da prévia. O bloqueio só traz código e texto: o que fala da caução,
 * ou um plano que só divide a caução, volta ao card Caução; o resto, ao card Cobranças.
 */
export function blockerCard(
  blocker: { code?: string | null; message?: string | null },
  plan: { discount: unknown; defaultSplit: unknown; overrides: ReadonlyArray<{ target: string }> | null } | null,
): number {
  if (/cau[cç][aã]o/i.test(blocker.message ?? '')) return 2;
  const overrides = plan?.overrides ?? [];
  const onlyCaucao =
    !!plan && !plan.discount && !plan.defaultSplit && overrides.length > 0 && overrides.every((o) => o.target === 'CAUCAO');
  return onlyCaucao ? 2 : 3;
}

export const INTEGRATION_CODES: ReadonlySet<string> = new Set([
  'AUTOMATIC_CHARGE_NO_INTEGRATION',
  'ASAAS_KEY_REVOKED',
  'ASAAS_WEBHOOK_NOT_REGISTERED',
  'ASAAS_DAILY_QUOTA_INSUFFICIENT',
  'ASAAS_LIMITS_UNAVAILABLE',
]);

/** Copy própria para os códigos de integração (o texto do servidor cita o provedor). */
const INTEGRATION_COPY: Readonly<Record<string, string>> = {
  AUTOMATIC_CHARGE_NO_INTEGRATION:
    'A cobrança por Pix ainda não está ligada na sua conta. Ligue em Configurações > Integrações ou escolha "Eu recebo por fora".',
  ASAAS_KEY_REVOKED: 'A ligação da cobrança por Pix foi recusada. Refaça a ligação em Configurações > Integrações.',
  ASAAS_WEBHOOK_NOT_REGISTERED:
    'A cobrança por Pix não está recebendo os avisos de pagamento. Refaça a ligação em Configurações > Integrações.',
  ASAAS_DAILY_QUOTA_INSUFFICIENT: 'O limite diário de cobranças por Pix acabou. Tente amanhã ou escolha "Eu recebo por fora".',
  ASAAS_LIMITS_UNAVAILABLE: 'Não deu para conferir os limites da cobrança por Pix agora. Tente de novo em instantes.',
};

export const SERVER_FALLBACK = 'O sistema recusou um dos dados. Confira os cards e tente de novo.';
export const CREATE_FALLBACK = 'Não foi possível criar o aluguel. Tente de novo.';
export const CONTACT_STILL_INCOMPLETE_COPY =
  'Os dados de contato da locadora ainda estão incompletos. Confira em Configurações > Dados de contato e tente de novo.';

export function serverIssueText(item: RentalPreflightItem): string {
  return INTEGRATION_COPY[item.code] ?? companySafe(messageWithAccepted(item), SERVER_FALLBACK);
}

/** Um motivo do "Não dá para criar ainda": o texto e, quando ajuda, um atalho. */
export interface BlockReason {
  key: string;
  text: string;
  /** Card (0-based) onde se corrige; `null` = fora da página. */
  card: number | null;
  link: { label: string; commands: string[] } | null;
}

/**
 * As recusas do preflight/400: o que tem campo vira erro do campo (mostrado no card); tudo vira
 * um motivo do aviso, com o atalho para Integrações ou para o cadastro do motorista.
 */
export function readServerIssues(
  items: readonly RentalPreflightItem[],
  driverId: string,
): { fields: Record<string, string>; reasons: BlockReason[] } {
  const fields: Record<string, string> = {};
  const reasons: BlockReason[] = [];
  for (const item of items) {
    if (item.severity === 'WARNING') continue;
    const text = serverIssueText(item);
    const control = item.field ? CONTROL_BY_SERVER_FIELD[item.field] : undefined;
    if (control && !fields[control]) fields[control] = text;
    const isDriver = (item.field?.startsWith('driver.') ?? false) || item.code.startsWith('DRIVER_');
    const link = INTEGRATION_CODES.has(item.code)
      ? { label: 'Abrir Configurações > Integrações', commands: ['/configuracoes/integracoes'] }
      : isDriver && item.code !== 'DRIVER_NOT_FOUND' && driverId
        ? { label: 'Abrir o cadastro do motorista', commands: ['/motoristas', driverId, 'editar'] }
        : null;
    const card = control ? (CARD_OF_CONTROL[control] ?? null) : INTEGRATION_CODES.has(item.code) ? 6 : isDriver ? 0 : null;
    reasons.push({ key: `${item.code}-${item.field ?? ''}-${reasons.length}`, text, card, link });
  }
  return { fields, reasons };
}
