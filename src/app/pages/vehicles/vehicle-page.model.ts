import { StatusChipTone } from '../../components/core/status-chip/status-chip';
import { PaintedStat, PaintedTone } from '../../components/core/painted-card/painted-card';
import { GerenciaFinanceChunk } from '../../types/gerencia-summary.types';
import {
  ChargeStatus,
  RentalChargeDto,
  RentalBillingFrequency,
  RentalListItemDto,
  RentalResponseDto,
  billingFrequencyLabel,
} from '../../types/rental.types';
import { VehiclePendencia, VehiclePendenciaType } from '../../types/vehicle-pendencia.types';
import { VehicleStatus } from '../../types/vehicle.types';
import { isOpenChargeStatus } from '../../utils/rental-charges';
import { VehicleIconName } from './components/vehicle-icon/vehicle-icon';

/*
 * A página só LÊ. Tudo aqui é conta de exibição sobre o que o backend respondeu:
 * urgência vem de `urgency`, Investido vem de `totalInvestedCents`, e nenhum dos dois é
 * recalculado neste arquivo.
 *
 * Uma exceção, de propósito: `expiredChip` lê a data do próprio carro. Sem ela, uma
 * leitura de pendências que falhou, ou um carro vendido fora da lista por regra, faria
 * um documento vencido parecer calmo.
 */

const ISO_DAY = 'T00:00:00';
const DAY_MS = 86_400_000;

export function brl(cents: number): string {
  const amount = (Math.abs(cents) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${cents < 0 ? '−' : ''}R$ ${amount}`;
}

/** `+R$ 8.160,00`, `−R$ 19.790,00`: resultado sempre diz o sinal. */
export function signedBrl(cents: number): string {
  return `${cents > 0 ? '+' : ''}${brl(cents)}`;
}

/** `R$ 13.650` e `,00`, para os centavos saírem menores no hero. */
export function splitBrl(cents: number): { whole: string; decimals: string } {
  const [whole, decimals] = brl(cents).split(',');
  return { whole, decimals: `,${decimals}` };
}

export function dayMonth(iso: string): string {
  return new Date(iso + ISO_DAY).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function fullDate(iso: string): string {
  return new Date(iso + ISO_DAY).toLocaleDateString('pt-BR');
}

/** Dias corridos de hoje até `iso`, no fuso local. Negativo = já passou. */
export function daysFromToday(iso: string, now: Date = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((new Date(iso + ISO_DAY).getTime() - today) / DAY_MS);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------- pendências

interface PendenciaMeta {
  readonly title: string;
  readonly icon: VehicleIconName;
  /** Concordância do chip: "Multa atrasada", "Licenciamento atrasado". */
  readonly late: 'Atrasada' | 'Atrasado';
}

const PENDENCIA_META: Record<VehiclePendenciaType, PendenciaMeta> = {
  FINE: { title: 'Multa', icon: 'fine', late: 'Atrasada' },
  MAINTENANCE: { title: 'Manutenção', icon: 'maintenance', late: 'Atrasada' },
  INSURANCE: { title: 'Seguro', icon: 'insurance', late: 'Atrasado' },
  LICENSING: { title: 'Licenciamento', icon: 'document', late: 'Atrasado' },
  IPVA: { title: 'IPVA', icon: 'card', late: 'Atrasado' },
  FINANCING_INSTALLMENT: { title: 'Parcela', icon: 'money', late: 'Atrasada' },
  INSURANCE_INSTALLMENT: { title: 'Parcela do seguro', icon: 'insurance', late: 'Atrasada' },
  INSPECTION: { title: 'Vistoria', icon: 'inspection', late: 'Atrasada' },
};

export function pendenciaTitle(p: VehiclePendencia): string {
  return PENDENCIA_META[p.type].title;
}

export function pendenciaIcon(p: VehiclePendencia): VehicleIconName {
  return PENDENCIA_META[p.type].icon;
}

/** O chip LÊ `urgency` para a cor e `daysUntilDue` para o texto. */
export function pendenciaChip(p: VehiclePendencia): { label: string; tone: StatusChipTone } {
  switch (p.urgency) {
    case 'OVERDUE':
      return {
        tone: 'orange',
        label:
          p.daysUntilDue !== null && p.daysUntilDue < 0
            ? `${PENDENCIA_META[p.type].late} há ${plural(-p.daysUntilDue, 'dia', 'dias')}`
            : 'Km atingido',
      };
    case 'NO_DATE':
      return { tone: 'neutral', label: 'Sem data' };
    case 'DUE_SOON':
      return { tone: 'amber', label: inDays(p.daysUntilDue) };
    case 'LATER':
      return { tone: 'neutral', label: inDays(p.daysUntilDue) };
  }
}

function inDays(days: number | null): string {
  if (days === null) return 'Sem data';
  return days === 0 ? 'Vence hoje' : `Em ${plural(days, 'dia', 'dias')}`;
}

/** Sólido quando atrasou, tingido quando está perto, neutro no resto. */
export function pendenciaTile(p: VehiclePendencia): 'hot' | 'tint' | '' {
  if (p.urgency === 'OVERDUE') return 'hot';
  return p.urgency === 'DUE_SOON' ? 'tint' : '';
}

/** O complemento da linha do celular: valor, ou a data, ou o km do plano. */
export function pendenciaDetail(p: VehiclePendencia): string {
  const extra =
    p.amountCents !== null
      ? brl(p.amountCents)
      : p.dueDate !== null
        ? dayMonth(p.dueDate)
        : p.dueHodometer !== null
          ? pendenciaKm(p.dueHodometer)
          : null;
  return extra ? `${p.description}, ${extra}` : p.description;
}

export function pendenciaKm(km: number): string {
  return `${km.toLocaleString('pt-BR')} km`;
}

/** Onde a linha se resolve (contrato A). */
export function pendenciaRoute(p: VehiclePendencia): string[] {
  switch (p.type) {
    case 'FINE':
      return ['/multas', p.targetId ?? ''];
    case 'MAINTENANCE':
      return ['/manutencoes', p.targetId ?? ''];
    case 'INSURANCE':
    case 'INSURANCE_INSTALLMENT':
      return ['/seguros', p.targetId ?? ''];
    case 'FINANCING_INSTALLMENT':
      return ['/financiamentos', p.targetId ?? ''];
    case 'LICENSING':
    case 'IPVA':
      return ['/veiculos', p.targetId ?? '', 'editar'];
    case 'INSPECTION':
      return p.targetId ? ['/vistorias', p.targetId] : ['/vistorias'];
  }
}

/** A data já passou: vale para pendência que não veio, por falha ou por regra. */
export function expiredChip(
  iso: string,
  now: Date = new Date(),
): { label: string; tone: StatusChipTone } | null {
  const days = daysFromToday(iso, now);
  return days < 0 ? { tone: 'orange', label: `Vencido há ${plural(-days, 'dia', 'dias')}` } : null;
}

export function overdueLabel(items: readonly VehiclePendencia[]): string | null {
  const late = items.filter((p) => p.urgency === 'OVERDUE').length;
  if (late === 0) return null;
  return late === 1 ? '1 atrasada' : `${late} atrasadas`;
}

// ------------------------------------------------------------------- cobranças

const RENT_KINDS = new Set(['RENTAL_PERIOD', 'RENTAL_TOTAL']);

export function nextCharge(charges: readonly RentalChargeDto[]): RentalChargeDto | null {
  const open = charges
    .filter(
      (c): c is RentalChargeDto & { dueDate: string } =>
        c.dueDate !== null && RENT_KINDS.has(c.kind) && isOpenChargeStatus(c.status),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return open[0] ?? null;
}

/**
 * O que pede atenção, nesta ordem. A frase diz só o que o status prova: `FAILED` também
 * cobre vencida promovida por rotina e estorno, então ela não fala em causa. O motivo mora
 * no detalhe do aluguel.
 */
const ATTENTION: readonly { status: ChargeStatus; dated: string; undated: string }[] = [
  { status: 'FAILED', dated: 'Cobrança com falha: ', undated: 'Há cobrança com falha.' },
  { status: 'DISPUTED', dated: 'Cobrança contestada: ', undated: 'Há cobrança contestada.' },
  { status: 'PAST_DUE', dated: 'Cobrança atrasada desde ', undated: 'Há cobrança atrasada.' },
];

function chargeWhen(dueDate: string, charge: RentalChargeDto): string {
  return `${dayMonth(dueDate)}, ${brl(charge.amount)}`;
}

/**
 * Verde e "em dia" andam juntos, e só com evidência: as cobranças foram lidas, nenhuma está
 * em estado ruim e existe ao menos uma de aluguel paga ou a vencer. Caução paga sozinha, ou
 * tudo cancelado, não diz que o aluguel está sendo cobrado. Qualquer outra coisa é laranja
 * com a frase do que foi visto. Abertas usam `isOpenChargeStatus`, a mesma regra do detalhe
 * do aluguel.
 */
function chargeHealth(detail: RentalResponseDto | null): { ok: boolean; line: string } {
  if (!detail) return { ok: false, line: 'Não foi possível ler as cobranças agora.' };
  const charges = detail.charges ?? [];
  if (charges.length === 0) {
    return { ok: false, line: 'Nenhuma cobrança registrada neste aluguel.' };
  }
  for (const rule of ATTENTION) {
    const [oldest] = charges
      .filter((c) => c.status === rule.status)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    if (oldest) {
      const line = oldest.dueDate
        ? `${rule.dated}${chargeWhen(oldest.dueDate, oldest)}.`
        : rule.undated;
      return { ok: false, line };
    }
  }
  const next = nextCharge(charges);
  if (next?.dueDate) {
    return { ok: true, line: `Cobranças em dia. Próxima em ${chargeWhen(next.dueDate, next)}.` };
  }
  const undated = charges.find((c) => isOpenChargeStatus(c.status) && !c.dueDate);
  if (undated) {
    return { ok: false, line: `Cobrança em aberto sem vencimento, ${brl(undated.amount)}.` };
  }
  const billed = charges.some(
    (c) => RENT_KINDS.has(c.kind) && (c.status === 'PAID' || c.status === 'PENDING'),
  );
  return billed
    ? { ok: true, line: 'Cobranças em dia.' }
    : { ok: false, line: 'Nenhuma cobrança de aluguel ativa ou paga.' };
}

const PER_PERIOD: Record<RentalBillingFrequency, string> = {
  DAILY: 'por dia',
  WEEKLY: 'por semana',
  MONTHLY: 'por mês',
};

// ------------------------------------------------------------ hero do veículo

export interface RentedHero {
  readonly kind: 'rented';
  readonly tone: PaintedTone;
  readonly rentalId: string;
  readonly driver: string;
  readonly line: string;
  readonly ring: { percent: number; days: number; unit: string; aria: string };
  readonly stats: readonly PaintedStat[];
}

export function rentedHero(
  rental: RentalListItemDto,
  detail: RentalResponseDto | null,
  now: Date = new Date(),
): RentedHero {
  const health = chargeHealth(detail);
  const total = daysFromToday(rental.endDate, new Date(rental.startDate + ISO_DAY));
  const days = Math.max(0, daysFromToday(rental.endDate, now));
  const unit = days === 1 ? 'dia' : 'dias';

  return {
    kind: 'rented',
    tone: health.ok ? 'green' : 'orange',
    rentalId: rental.id,
    driver: rental.driverName ?? 'Motorista',
    line: health.line,
    ring: {
      percent: total > 0 ? (days / total) * 100 : 0,
      days,
      unit,
      aria: `${days} ${unit} para a devolução`,
    },
    stats: [
      { label: 'início', value: dayMonth(rental.startDate) },
      { label: 'devolução', value: dayMonth(rental.endDate) },
      { label: 'frequência', value: billingFrequencyLabel(rental.billingFrequency) },
      {
        label: PER_PERIOD[rental.billingFrequency],
        value: detail ? brl(detail.periodRate) : '—',
      },
    ],
  };
}

/** O carro parado: pátio, oficina ou inativo. Sempre laranja, nunca cinza. */
export interface IdleHero {
  readonly kind: 'idle';
  readonly label: string;
  readonly big: string;
  readonly line: string;
  readonly action: {
    readonly label: string;
    readonly icon: VehicleIconName;
    readonly link: string[];
    readonly query: Record<string, string> | null;
  } | null;
}

export type VehicleHero = RentedHero | IdleHero;

/** O que as leituras de aluguel disseram sobre um carro sem aluguel ativo. */
export interface IdleRentals {
  readonly vehicleId: string;
  /** `null`: nenhum concluído. `undefined`: a leitura não respondeu. */
  readonly lastEnd: string | null | undefined;
  readonly reserved: RentalListItemDto | null;
  readonly failed: boolean;
}

function reservedHero(rental: RentalListItemDto): IdleHero {
  return {
    kind: 'idle',
    label: 'Reservado',
    big: rental.driverName ?? 'Motorista',
    line: `A partir de ${fullDate(rental.startDate)}, até ${fullDate(rental.endDate)}.`,
    action: { label: 'Ver reserva', icon: 'key', link: ['/alugueis', rental.id], query: null },
  };
}

/** Sem leitura não se sabe se há reserva: calar aqui pareceria que não há. */
function rentalsNote(rentals: IdleRentals): string {
  if (rentals.failed) return ' Não foi possível ler os aluguéis agora.';
  if (!rentals.reserved) return '';
  const who = rentals.reserved.driverName ?? 'um motorista';
  return ` Reservado para ${who} a partir de ${fullDate(rentals.reserved.startDate)}.`;
}

export function idleHero(
  status: VehicleStatus,
  rentals: IdleRentals,
  now: Date = new Date(),
): IdleHero {
  const { vehicleId, lastEnd, reserved, failed } = rentals;
  const ofThisCar = { vehicleId };
  switch (status) {
    case 'MAINTENANCE':
      return {
        kind: 'idle',
        label: 'Em manutenção',
        big: 'Na oficina',
        line: `Fora da frota de aluguel até você marcar disponível.${rentalsNote(rentals)}`,
        action: {
          label: 'Ver manutenções',
          icon: 'maintenance',
          link: ['/veiculos', vehicleId, 'gerencia', 'manutencoes'],
          query: null,
        },
      };
    case 'INACTIVE':
      return {
        kind: 'idle',
        label: 'Inativo',
        big: 'Fora de operação',
        line: `Para voltar a alugar, marque como disponível em Ações.${rentalsNote(rentals)}`,
        action: null,
      };
    case 'RENTED':
      if (reserved) return reservedHero(reserved);
      return {
        kind: 'idle',
        label: 'Alugado',
        big: failed ? 'Aluguel em curso' : 'Sem aluguel ativo',
        line: failed
          ? 'Não foi possível ler o aluguel agora.'
          : 'Nenhum aluguel ativo encontrado para este carro.',
        action: { label: 'Ver aluguéis', icon: 'key', link: ['/alugueis'], query: ofThisCar },
      };
    case 'AVAILABLE': {
      if (reserved) return reservedHero(reserved);
      const action = {
        label: 'Novo aluguel',
        icon: 'plus' as const,
        link: ['/alugueis', 'novo'],
        query: ofThisCar,
      };
      if (lastEnd) {
        const days = Math.max(0, -daysFromToday(lastEnd, now));
        return {
          kind: 'idle',
          label: 'No pátio',
          big: plural(days, 'dia', 'dias'),
          line: `Sem alugar desde ${dayMonth(lastEnd)}, quando terminou o último aluguel.`,
          action,
        };
      }
      return {
        kind: 'idle',
        label: 'No pátio',
        big: 'Disponível',
        line: failed
          ? 'Não foi possível ler os aluguéis agora.'
          : 'Este carro ainda não tem aluguel concluído.',
        action,
      };
    }
  }
}

/** A reserva que vem primeiro: a lista vem por criação, não pela data do aluguel. */
export function earliestStart(rentals: readonly RentalListItemDto[]): RentalListItemDto | null {
  return rentals.reduce<RentalListItemDto | null>(
    (first, r) => (first === null || r.startDate < first.startDate ? r : first),
    null,
  );
}

/** O fim mais recente: a lista vem por criação, e um aluguel lançado tarde a embaralha. */
export function latestEnd(rentals: readonly RentalListItemDto[]): string | null {
  return rentals.reduce<string | null>(
    (latest, r) => (latest === null || r.endDate > latest ? r.endDate : latest),
    null,
  );
}

// ------------------------------------------------------------ hero do dinheiro

export interface MoneyColumn {
  readonly label: 'Recebido' | 'Contratado';
  readonly amount: { whole: string; decimals: string };
  /** Sem Investido não há régua: entra a legenda no lugar dela. */
  readonly caption: string;
  readonly percent: number | null;
  readonly result: string | null;
}

export interface MoneyHero {
  readonly tone: PaintedTone;
  readonly title: string;
  readonly line: string;
  readonly sale: string | null;
  readonly ring: { percent: number; value: string; aria: string } | null;
  readonly columns: readonly [MoneyColumn, MoneyColumn];
  readonly stats: readonly PaintedStat[] | null;
  readonly empty: {
    readonly title: string;
    readonly line: string;
    readonly action: string;
    readonly target: 'edit' | 'financing';
  } | null;
}

function composition(f: GerenciaFinanceChunk): readonly PaintedStat[] {
  const money = (cents: number | null | undefined) => (cents == null ? '—' : brl(cents));
  const parts: PaintedStat[] = f.financed
    ? [
        { label: 'entrada', value: money(f.downPaymentCents) },
        { label: 'parcelas pagas', value: money(f.totalFinancingPaidCents) },
      ]
    : [{ label: 'compra', value: money(f.purchaseCostCents) }];
  return [
    { label: 'investido', value: money(f.totalInvestedCents) },
    ...parts,
    { label: 'manutenções', value: money(f.totalMaintenanceExpenseCents) },
  ];
}

function column(
  label: MoneyColumn['label'],
  amount: number,
  caption: string,
  invested: number | null | undefined,
  /* `==` de propósito: backend sem o campo manda `undefined`, e aí sairia "R$ NaN". */
  result: number | null | undefined,
): MoneyColumn {
  const known = invested != null && invested > 0;
  const percent = known ? Math.round((amount / invested) * 100) : null;
  return {
    label,
    amount: splitBrl(amount),
    caption: percent === null ? caption : `${percent}% do investido`,
    percent,
    result: result == null ? null : signedBrl(result),
  };
}

function moneyLine(contracted: number, received: number): string {
  // Contratado ignora aluguel cancelado e Recebido não: quem terminou antes do fim
  // deixa dinheiro recebido sem contrato ao lado.
  if (received > contracted) return 'O recebido inclui aluguéis encerrados antes do fim.';
  if (contracted === 0) return 'Nenhum contrato neste carro ainda.';
  const toReceive = contracted - received;
  return toReceive > 0
    ? `${brl(toReceive)} do contratado ainda não entrou.`
    : 'Todo o contratado já entrou.';
}

function saleLine(f: GerenciaFinanceChunk, resultsShown: boolean): string | null {
  if (f.saleValueCents == null) return null;
  const when = f.saleDate ? ` em ${fullDate(f.saleDate)}` : '';
  return resultsShown
    ? `Resultado inclui a venda de ${brl(f.saleValueCents)}${when}.`
    : `Vendido por ${brl(f.saleValueCents)}${when}.`;
}

function moneyEmpty(f: GerenciaFinanceChunk): MoneyHero['empty'] {
  if (f.purchasePriceMissing) {
    return {
      title: 'Falta o valor de compra',
      line: 'Com ele aparece o resultado deste carro.',
      action: 'Informar valor de compra',
      target: 'edit',
    };
  }
  if (f.financingPayoffUnknown) {
    return {
      title: 'Falta o valor da quitação',
      line: 'O valor pago na quitação não foi registrado, então não dá para calcular o Investido.',
      action: 'Ver financiamento',
      target: 'financing',
    };
  }
  if (f.financingDataIncomplete) {
    const noEntrada = f.downPaymentCents == null;
    return {
      title: noEntrada ? 'Falta a entrada do financiamento' : 'Faltam as parcelas do financiamento',
      line: `Sem ${noEntrada ? 'ela' : 'elas'} não dá para calcular o Investido deste carro.`,
      action: 'Ver financiamento',
      target: 'financing',
    };
  }
  return null;
}

/** Os vazios saem das flags do backend, nunca de `purchaseCostCents` ou `resultCents`. */
export function moneyHero(f: GerenciaFinanceChunk): MoneyHero {
  const contracted = f.totalRentalRevenueCents;
  const received = f.totalRentalReceivedCents;
  const empty = moneyEmpty(f);
  const paidOff = !empty && (f.resultReceivedCents ?? 0) > 0;
  const share =
    contracted > 0 && received <= contracted ? Math.round((received / contracted) * 100) : null;
  const invested = empty ? null : f.totalInvestedCents;
  const resultsShown = !empty && f.resultCents != null;

  return {
    tone: paidOff ? 'green' : 'orange',
    title: f.purchasePriceMissing
      ? 'Sem valor de compra'
      : f.financingPayoffUnknown
        ? 'Quitação sem valor'
        : f.financingDataIncomplete
          ? 'Financiamento incompleto'
          : paidOff
            ? 'Já se pagou'
            : 'Ainda não se pagou',
    line: moneyLine(contracted, received),
    sale: saleLine(f, resultsShown),
    ring:
      share === null
        ? null
        : { percent: share, value: `${share}%`, aria: `${share}% do contratado recebido` },
    columns: [
      column('Recebido', received, 'Cobranças pagas', invested, empty ? null : f.resultReceivedCents),
      column('Contratado', contracted, 'Soma dos contratos', invested, empty ? null : f.resultCents),
    ],
    stats: empty ? null : composition(f),
    empty,
  };
}
