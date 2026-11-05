import { StatusChipTone } from '../../components/core/status-chip/status-chip';
import { IpvaFleetRow } from '../../types/fleet-finance.types';
import { IpvaInstallmentStatus } from '../../types/vehicle-ipva.types';

/** Aba de situação da lista. `ALL` não vai na requisição. */
export type IpvaStatusFilter = 'ALL' | IpvaInstallmentStatus;

export const IPVA_STATUS_FILTERS: readonly { value: IpvaStatusFilter; label: string; short?: string }[] =
  [
    { value: 'ALL', label: 'Todos' },
    { value: 'PENDING', label: 'Em aberto', short: 'Aberto' },
    { value: 'OVERDUE', label: 'Vencidas' },
    { value: 'PAID', label: 'Pagas' },
  ];

/** Mesmas cores da Gerência do veículo: pago verde, vencido laranja, aberto neutro. */
export const IPVA_ROW_CHIP: Record<IpvaInstallmentStatus, { label: string; tone: StatusChipTone }> = {
  PAID: { label: 'Pago', tone: 'green' },
  OVERDUE: { label: 'Vencido', tone: 'orange' },
  PENDING: { label: 'Em aberto', tone: 'neutral' },
};

/** Quantos anos para trás a fileira de exercícios oferece, além do próximo. */
export const IPVA_PAST_YEARS = 2;

/** Próximo ano, o corrente e dois anteriores, do mais novo para o mais antigo. */
export function ipvaYearOptions(currentYear: number): number[] {
  const years: number[] = [];
  for (let y = currentYear + 1; y >= currentYear - IPVA_PAST_YEARS; y--) years.push(y);
  return years;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function brlCents(cents: number | null | undefined): string {
  return cents == null ? '—' : BRL.format(cents / 100);
}

/** `2026-03-15` → `15/03/2026`; sem `Date`, então o fuso nunca troca o dia. */
export function ptDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** `2026-03-15` → `15/03`, para o cartão do celular. */
export function ptDayMonth(iso: string | null | undefined): string {
  return iso ? ptDate(iso).slice(0, 5) : '—';
}

export function plateLabel(plate: string | null | undefined): string {
  const p = (plate ?? '').toUpperCase();
  return p.length === 7 ? `${p.slice(0, 3)}-${p.slice(3)}` : p || '—';
}

export interface IpvaFleetViewRow {
  readonly row: IpvaFleetRow;
  readonly plate: string;
  readonly model: string;
  readonly total: string;
  readonly paid: string;
  readonly open: string;
  readonly installments: string;
  /** 0..1 para a barra; 0 sem parcelas. */
  readonly progress: number;
  readonly nextDue: string;
  readonly nextDueShort: string;
  readonly chip: { label: string; tone: StatusChipTone };
  readonly overdueNote: string | null;
  readonly aria: string;
}

export function toViewRow(row: IpvaFleetRow): IpvaFleetViewRow {
  const plate = plateLabel(row.vehiclePlate);
  const chip = IPVA_ROW_CHIP[row.status] ?? IPVA_ROW_CHIP.PENDING;
  const allPaid = row.installmentsCount > 0 && row.paidCount === row.installmentsCount;
  const nextDue = row.nextDueDate ? ptDate(row.nextDueDate) : allPaid ? 'Tudo pago' : '—';
  return {
    row,
    plate,
    model: `${row.vehicleBrand ?? ''} ${row.vehicleModel ?? ''}`.trim(),
    total: brlCents(row.totalCents),
    paid: brlCents(row.paidCents),
    open: brlCents(row.openCents),
    installments: `${row.paidCount}/${row.installmentsCount}`,
    progress: row.installmentsCount > 0 ? row.paidCount / row.installmentsCount : 0,
    nextDue,
    nextDueShort: row.nextDueDate ? ptDayMonth(row.nextDueDate) : nextDue,
    chip,
    overdueNote:
      row.overdueCount > 0
        ? row.overdueCount === 1
          ? '1 parcela vencida'
          : `${row.overdueCount} parcelas vencidas`
        : null,
    aria: `Abrir o IPVA ${row.year} do veículo ${plate}`,
  };
}
