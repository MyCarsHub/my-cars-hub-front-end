import {
  RentalChargePreviewBlockerDto,
  RentalChargePreviewDto,
  RentalChargePreviewItemDto,
} from '../types/rental.types';

/**
 * A prévia das cobranças do `POST /v1/rentals/charge-preview`, em duas camadas:
 *
 *  1. `normalizeChargePreview` — o ADAPTADOR. É o único lugar que lê o formato
 *     cru do backend. Tolera campo ausente (deriva de `charges`) em vez de
 *     estourar, porque o diálogo de confirmação não pode quebrar justamente na
 *     hora em que o dono vai decidir.
 *  2. `summarizeChargePreview` — o que o diálogo MOSTRA, já reduzido a poucos
 *     números. Pura: nada de formatação de moeda ou data aqui.
 *
 * Nada neste arquivo inventa um valor que o backend não mandou: contagem e total
 * ausentes são recalculados das linhas, nunca estimados.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function asCents(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function asItem(raw: unknown): RentalChargePreviewItemDto | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<RentalChargePreviewItemDto>;
  if (r.kind !== 'RENTAL_PERIOD' && r.kind !== 'CAUCAO') return null;
  if (typeof r.dueDate !== 'string' || !DAY_PATTERN.test(r.dueDate.slice(0, 10))) return null;
  return {
    kind: r.kind,
    index: typeof r.index === 'number' ? r.index : 0,
    dueDate: r.dueDate.slice(0, 10),
    amountCents: asCents(r.amountCents),
    destination: r.destination === 'LOCAL' ? 'LOCAL' : 'ASAAS',
  };
}

function asBlocker(raw: unknown): RentalChargePreviewBlockerDto | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<RentalChargePreviewBlockerDto>;
  const message = typeof r.message === 'string' ? r.message.trim() : '';
  const code = typeof r.code === 'string' ? r.code : '';
  if (!message && !code) return null;
  return { code, message: message || 'Não é possível criar o aluguel com estes dados.' };
}

export function normalizeChargePreview(raw: Partial<RentalChargePreviewDto> | null | undefined): RentalChargePreviewDto {
  const source = raw ?? {};
  const charges = (Array.isArray(source.charges) ? source.charges : [])
    .map(asItem)
    .filter((c): c is RentalChargePreviewItemDto => c !== null);

  const gatewayFromRows = charges.filter((c) => c.destination === 'ASAAS').length;
  const localFromRows = charges.length - gatewayFromRows;
  const gatewayCount = asCount(source.gatewayCount, gatewayFromRows);
  const localCount = asCount(source.localCount, localFromRows);
  const totalCents =
    typeof source.totalCents === 'number' && Number.isFinite(source.totalCents)
      ? source.totalCents
      : charges.reduce((acc, c) => acc + c.amountCents, 0);

  const dueDates = charges.map((c) => c.dueDate).sort();
  const firstDueDate =
    typeof source.firstDueDate === 'string' && DAY_PATTERN.test(source.firstDueDate.slice(0, 10))
      ? source.firstDueDate.slice(0, 10)
      : (dueDates[0] ?? null);

  return {
    automaticCharge: source.automaticCharge === true,
    willCreateInGateway:
      typeof source.willCreateInGateway === 'boolean' ? source.willCreateInGateway : gatewayCount > 0,
    charges,
    totalCents,
    gatewayCount,
    localCount,
    firstDueDate,
    blocker: asBlocker(source.blocker),
  };
}

export interface ChargePreviewSummary {
  /** Quando presente, o aluguel NÃO pode ser criado — o resumo não se aplica. */
  blocker: RentalChargePreviewBlockerDto | null;
  /** Falso quando nada vai ao gateway (ex.: todos os vencimentos já passaram). */
  willCreateInGateway: boolean;
  gatewayCount: number;
  /** Cobranças que ficam só registradas no app, sem ir ao gateway. */
  localCount: number;
  /** Primeiro vencimento entre TODAS as cobranças da prévia. */
  firstDueDate: string | null;
  /** Quantas são parcelas do período (a caução não conta aqui). */
  periodCount: number;
  /**
   * Valor único de cada parcela do período, ou `null` quando variam (a última
   * pode ser parcial) ou não há parcela — a tela então diz "valores variam".
   */
  uniformPeriodCents: number | null;
  totalCents: number;
  /** A caução, quando existe cobrança dela na prévia. */
  caucao: { amountCents: number; dueDate: string; destination: 'ASAAS' | 'LOCAL' } | null;
}

export function summarizeChargePreview(preview: RentalChargePreviewDto): ChargePreviewSummary {
  const period = preview.charges.filter((c) => c.kind === 'RENTAL_PERIOD');
  const caucaoRow = preview.charges.find((c) => c.kind === 'CAUCAO') ?? null;
  const amounts = new Set(period.map((c) => c.amountCents));
  return {
    blocker: preview.blocker,
    willCreateInGateway: preview.willCreateInGateway,
    gatewayCount: preview.gatewayCount,
    localCount: preview.localCount,
    firstDueDate: preview.firstDueDate,
    periodCount: period.length,
    uniformPeriodCents: amounts.size === 1 ? [...amounts][0] : null,
    totalCents: preview.totalCents,
    caucao: caucaoRow
      ? {
          amountCents: caucaoRow.amountCents,
          dueDate: caucaoRow.dueDate,
          destination: caucaoRow.destination,
        }
      : null,
  };
}
