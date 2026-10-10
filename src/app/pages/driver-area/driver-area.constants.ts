import { DateRangePresetKey } from '../../components/date-range-picker/date-range-picker';

/**
 * The period chips of the driver's area: the fleet Dashboard's, minus the projections
 * ("Próximos 30 dias", "Próximos 90 dias") that mean nothing for money that already moved,
 * and minus the long windows a day-to-day ledger does not need. The order is the picker's
 * own, which is the order the owner asked for: Mês atual, Hoje, 7 dias, 30 dias, Mês
 * passado, Personalizado.
 */
export const DRIVER_PERIOD_PRESETS: readonly DateRangePresetKey[] = [
  'monthCurrent',
  'today',
  '7d',
  '30d',
  'monthPast',
  'custom',
];

/** Message of a custom period the server would refuse (366 days). */
export const PERIOD_TOO_LONG_MESSAGE =
  'Escolha um período de até um ano (366 dias). Para ver mais, escolha o período em partes.';

/** How many entries the home's "recentes" window shows; the full list is a page of its own. */
export const RECENT_ENTRIES = 5;

/** Entries per page on `/meu-painel/lancamentos`. */
export const ENTRIES_PAGE_SIZE = 20;
