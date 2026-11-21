import { ChargePlanInstalment, RentalBillingFrequency } from '../../../types/rental.types';
import { WizardCharge } from '../rental-wizard/wizard-math';
import { brl, dShort, periodWords, plural, weekdayLong } from '../rental-wizard/wizard-format';
import { periodLastDay } from './create-plan';
import { PreviewModel, PreviewRow } from './cards/preview-sheet';

/** As prévias dos cards 3 e 4, na conta local (na hora). Funções puras: o spec lê as linhas. */

export interface CaucaoPreviewInput {
  netCents: number;
  discountCents: number;
  /** Partes (≥ 2) ou `null` = uma cobrança em `singleDue`. */
  parts: readonly ChargePlanInstalment[] | null;
  singleDue: string;
  /** Dia em que ele pega o carro ("Junto com a retirada"). */
  pickupDay: string;
}

function row(key: string, due: string, title: string, sub: string | null, amount: number, discount: string | null): PreviewRow {
  return { key, day: dShort(due), weekday: weekdayLong(due), title, sub, amount: brl(amount), discount };
}

export function caucaoPreview(input: CaucaoPreviewInput): PreviewModel | null {
  if (input.netCents <= 0) return null;
  const withPickup = (due: string): string | null => (due && due === input.pickupDay ? 'Junto com a retirada' : null);
  const parts = input.parts && input.parts.length >= 2 ? input.parts : null;
  const rows = parts
    ? parts.map((p, k) => row(`c${k}`, p.dueDate, `Parte ${k + 1} de ${parts.length}`, withPickup(p.dueDate), p.amountCents, null))
    : [row('c0', input.singleDue, 'Caução', withPickup(input.singleDue), input.netCents, null)];
  const how = parts ? `Em ${parts.length} partes` : 'Uma cobrança';
  const off = input.discountCents > 0 ? `, já com ${brl(input.discountCents)} de desconto` : '';
  return {
    tone: 'green',
    label: 'Caução',
    total: brl(input.netCents),
    caption: `${how}${off}. Volta para ele no fim, se estiver tudo certo.`,
    rows,
    note: parts
      ? 'Cada parte vira uma cobrança, enviada para ele na data.'
      : 'A caução vira uma cobrança, enviada para ele na data.',
  };
}

export interface ChargesPreviewInput {
  frequency: RentalBillingFrequency;
  startDate: string;
  endDate: string;
  firstDue: string;
  discount: { valueCents: number; firstPeriods: number } | null;
  charges: readonly WizardCharge[];
  /** "Fica pelo menos até uma data" (RenCobK5): "Mínimo previsto" e a linha da renovação no fim. */
  minimum?: boolean;
}

export function chargesPreview(input: ChargesPreviewInput): PreviewModel | null {
  const rent = input.charges.filter((c) => c.kind === 'RENTAL_PERIOD');
  if (!rent.length) return null;
  const w = periodWords(input.frequency);
  const d = input.discount;
  const cadence =
    input.frequency === 'WEEKLY'
      ? `toda ${weekdayLong(input.firstDue)}`
      : input.frequency === 'MONTHLY'
        ? 'a cada 30 dias'
        : 'todo dia';
  const rows = rent.map((c) => {
    const part = c.instalmentCount > 1 ? ` · parte ${c.instalmentIndex} de ${c.instalmentCount}` : '';
    const discounted = !!d && d.valueCents > 0 && c.index < d.firstPeriods && c.instalmentIndex === 1;
    return row(
      `p${c.index}-${c.instalmentIndex}`,
      c.dueDate,
      `${w.one} ${c.index + 1}${part}`,
      `até ${dShort(periodLastDay(input.startDate, input.endDate, c.index, input.frequency))}`,
      c.amountCents,
      discounted && d ? `− ${brl(d.valueCents)}` : null,
    );
  });
  const total = brl(rent.reduce((a, c) => a + c.amountCents, 0));
  if (input.minimum) {
    const periods = new Set(rent.map((c) => c.index)).size;
    return {
      tone: 'orange',
      label: 'Mínimo previsto',
      total,
      caption: `${plural(periods, w.lower, w.lowerMany)} até ${dShort(input.endDate)}. Sem a caução. Depois você renova.`,
      rows: [
        ...rows,
        {
          key: 'renew',
          day: dShort(input.endDate),
          weekday: 'fim',
          title: 'Renovação',
          sub: 'Você escolhe por quanto tempo e o valor',
          amount: '—',
          discount: null,
        },
      ],
      note: '',
    };
  }
  return {
    tone: 'orange',
    label: 'Total previsto',
    total,
    caption: `${plural(rent.length, 'cobrança', 'cobranças')}, ${cadence}. Sem a caução.`,
    rows,
    note: `O aluguel acaba em ${dShort(input.endDate)}. Nenhuma cobrança depois disso.`,
  };
}
