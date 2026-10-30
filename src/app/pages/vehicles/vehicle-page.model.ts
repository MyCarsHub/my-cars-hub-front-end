import { StatusChipTone } from '../../components/core/status-chip/status-chip';
import { PaintedStat, PaintedTone } from '../../components/core/painted-card/painted-card';
import { GerenciaFinanceChunk } from '../../types/gerencia-summary.types';
import {
  RentalChargeDto,
  RentalBillingFrequency,
  RentalListItemDto,
  RentalResponseDto,
  billingFrequencyLabel,
} from '../../types/rental.types';
import { VehiclePendencia, VehiclePendenciaType } from '../../types/vehicle-pendencia.types';
import { VehicleStatus } from '../../types/vehicle.types';
import { VehicleIconName } from './components/vehicle-icon/vehicle-icon';

/*
 * A página só LÊ. Tudo aqui é conta de exibição sobre o que o backend respondeu:
 * urgência vem de `urgency`, Investido vem de `totalInvestedCents`, e nenhum dos dois é
 * recalculado neste arquivo.
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
        c.dueDate !== null &&
        RENT_KINDS.has(c.kind) &&
        (c.status === 'PENDING' || c.status === 'PAST_DUE'),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return open[0] ?? null;
}

/** A atrasada mais antiga, de qualquer tipo: caução e multa de atraso também contam. */
export function oldestLateCharge(charges: readonly RentalChargeDto[]): RentalChargeDto | null {
  const late = charges
    .filter((c) => c.status === 'PAST_DUE')
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  return late[0] ?? null;
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
  readonly late: boolean;
  readonly ring: { percent: number; days: number; unit: string; aria: string };
  readonly stats: readonly PaintedStat[];
}

export function rentedHero(
  rental: RentalListItemDto,
  detail: RentalResponseDto | null,
  now: Date = new Date(),
): RentedHero {
  const charges = detail?.charges ?? [];
  const late = oldestLateCharge(charges);
  const total = daysFromToday(rental.endDate, new Date(rental.startDate + ISO_DAY));
  const days = Math.max(0, daysFromToday(rental.endDate, now));
  const unit = days === 1 ? 'dia' : 'dias';

  return {
    kind: 'rented',
    tone: late ? 'orange' : 'green',
    rentalId: rental.id,
    driver: rental.driverName ?? 'Motorista',
    late: late !== null,
    line: rentedLine(detail, late, nextCharge(charges)),
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

function rentedLine(
  detail: RentalResponseDto | null,
  late: RentalChargeDto | null,
  next: RentalChargeDto | null,
): string {
  if (!detail) return 'Não foi possível ler as cobranças agora.';
  if (late) {
    return late.dueDate
      ? `Cobrança atrasada desde ${chargeWhen(late.dueDate, late)}.`
      : 'Há cobrança atrasada.';
  }
  return next?.dueDate
    ? `Cobranças em dia. Próxima em ${chargeWhen(next.dueDate, next)}.`
    : 'Cobranças em dia.';
}

function chargeWhen(dueDate: string, charge: RentalChargeDto): string {
  return `${dayMonth(dueDate)}, ${brl(charge.amount)}`;
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

export function idleHero(
  vehicleId: string,
  status: VehicleStatus,
  /** `undefined` quando a leitura falhou: não dá para dizer "nunca foi alugado". */
  lastRentalEnd: string | null | undefined,
  now: Date = new Date(),
): IdleHero {
  const rentals = { vehicleId };
  switch (status) {
    case 'MAINTENANCE':
      return {
        kind: 'idle',
        label: 'Em manutenção',
        big: 'Na oficina',
        line: 'Fora da frota de aluguel até você marcar disponível.',
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
        line: 'Para voltar a alugar, marque como disponível em Ações.',
        action: null,
      };
    case 'RENTED':
      return {
        kind: 'idle',
        label: 'Alugado',
        big: 'Aluguel em curso',
        line: 'Não foi possível ler o aluguel agora.',
        action: { label: 'Ver aluguéis', icon: 'key', link: ['/alugueis'], query: rentals },
      };
    case 'AVAILABLE': {
      const action = {
        label: 'Novo aluguel',
        icon: 'plus' as const,
        link: ['/alugueis', 'novo'],
        query: rentals,
      };
      if (lastRentalEnd) {
        const days = Math.max(0, -daysFromToday(lastRentalEnd, now));
        return {
          kind: 'idle',
          label: 'No pátio',
          big: plural(days, 'dia', 'dias'),
          line: `Sem alugar desde ${dayMonth(lastRentalEnd)}, quando terminou o último aluguel.`,
          action,
        };
      }
      return {
        kind: 'idle',
        label: 'No pátio',
        big: 'Disponível',
        line:
          lastRentalEnd === null
            ? 'Este carro ainda não tem aluguel concluído.'
            : 'Pronto para o próximo aluguel.',
        action,
      };
    }
  }
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
  const money = (cents: number | null) => (cents === null ? '—' : brl(cents));
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
  invested: number | null,
  result: number | null,
): MoneyColumn {
  const known = invested !== null && invested > 0;
  const percent = known ? Math.round((amount / invested) * 100) : null;
  return {
    label,
    amount: splitBrl(amount),
    caption: percent === null ? caption : `${percent}% do investido`,
    percent,
    result: result === null ? null : signedBrl(result),
  };
}

/** Os dois vazios saem das flags do backend, nunca de `purchaseCostCents` ou `resultCents`. */
export function moneyHero(f: GerenciaFinanceChunk): MoneyHero {
  const contracted = f.totalRentalRevenueCents;
  const received = f.totalRentalReceivedCents;
  const toReceive = Math.max(0, contracted - received);
  const noPrice = f.purchasePriceMissing;
  const incomplete = f.financingDataIncomplete;
  const paidOff = !noPrice && !incomplete && (f.resultReceivedCents ?? 0) > 0;
  const share = contracted > 0 ? Math.round((received / contracted) * 100) : null;

  return {
    tone: paidOff ? 'green' : 'orange',
    title: noPrice
      ? 'Sem valor de compra'
      : incomplete
        ? 'Financiamento incompleto'
        : paidOff
          ? 'Já se pagou'
          : 'Ainda não se pagou',
    line:
      contracted === 0
        ? 'Nenhum contrato neste carro ainda.'
        : toReceive > 0
          ? `${brl(toReceive)} do contratado ainda não entrou.`
          : 'Todo o contratado já entrou.',
    sale:
      f.saleValueCents === null
        ? null
        : `Resultado inclui a venda de ${brl(f.saleValueCents)}` +
          (f.saleDate ? ` em ${fullDate(f.saleDate)}.` : '.'),
    ring:
      share === null
        ? null
        : { percent: share, value: `${share}%`, aria: `${share}% do contratado recebido` },
    columns: [
      column(
        'Recebido',
        received,
        'Cobranças pagas',
        f.totalInvestedCents,
        f.resultReceivedCents,
      ),
      column('Contratado', contracted, 'Soma dos contratos', f.totalInvestedCents, f.resultCents),
    ],
    stats: noPrice || incomplete ? null : composition(f),
    empty: noPrice
      ? {
          title: 'Falta o valor de compra',
          line: 'Com ele aparece o resultado deste carro.',
          action: 'Informar valor de compra',
          target: 'edit',
        }
      : incomplete
        ? {
            title:
              f.downPaymentCents === null
                ? 'Falta a entrada do financiamento'
                : 'Faltam as parcelas do financiamento',
            line: `Sem ${f.downPaymentCents === null ? 'ela' : 'elas'} não dá para calcular o Investido deste carro.`,
            action: 'Ver financiamento',
            target: 'financing',
          }
        : null,
  };
}
