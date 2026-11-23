import type { OpenRental } from '../../types/driver.types';
import { todayInBusinessTz } from '../../utils/business-clock';

/**
 * "Bloquear sempre" (dono, 21/11): motorista ou carro com um aluguel RESERVED/ACTIVE não entra em
 * outro, quaisquer que sejam as datas. A REGRA é do backend (409 `DRIVER_HAS_OPEN_RENTAL` /
 * `VEHICLE_HAS_OPEN_RENTAL`); aqui só os textos que a lista e o campo mostram a partir do
 * `openRental` que a lista já trouxe.
 */

/** Os dois 409 da regra, com o campo do formulário de cada um. */
export const OPEN_RENTAL_FIELD_BY_CODE: Readonly<Record<string, 'driverId' | 'vehicleId'>> = {
  DRIVER_HAS_OPEN_RENTAL: 'driverId',
  VEHICLE_HAS_OPEN_RENTAL: 'vehicleId',
};

/** "2026-11-30" → "30/11" no ano corrente; "2027-01-10" → "10/01/2027" fora dele (mesma regra do servidor). */
function dayMonth(iso: string, today: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y === today.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
}

/** O motivo curto embaixo do nome na lista: "Em aluguel até 30/11" / "Reservado de 10/01 a 07/02". */
export function openRentalReason(open: OpenRental | null | undefined, today = todayInBusinessTz()): string | null {
  if (!open) return null;
  if (open.status === 'ACTIVE') return open.endDate ? `Em aluguel até ${dayMonth(open.endDate, today)}` : 'Em aluguel';
  return open.endDate
    ? `Reservado de ${dayMonth(open.startDate, today)} a ${dayMonth(open.endDate, today)}`
    : `Reservado a partir de ${dayMonth(open.startDate, today)}`;
}

/**
 * O erro do campo quando a escolha (ex.: de um rascunho) já está presa: o mesmo texto que o 409 do
 * servidor traz, para a tela dizer a mesma coisa antes e depois do envio.
 */
export function openRentalMessage(kind: 'driver' | 'vehicle', open: OpenRental, today = todayInBusinessTz()): string {
  const who = kind === 'driver' ? 'Este motorista' : 'Este carro';
  let situation: string;
  if (open.status === 'ACTIVE') {
    situation = open.endDate
      ? ` já está em um aluguel (ativo até ${dayMonth(open.endDate, today)}).`
      : ' já está em um aluguel ativo.';
  } else {
    const period = open.endDate
      ? `de ${dayMonth(open.startDate, today)} a ${dayMonth(open.endDate, today)}`
      : `a partir de ${dayMonth(open.startDate, today)}`;
    situation = kind === 'driver' ? ` já tem um aluguel reservado ${period}.` : ` já está reservado ${period}.`;
  }
  return `${who}${situation} Conclua ou cancele esse aluguel antes de criar outro.`;
}

export interface OpenRentalConflict {
  field: 'driverId' | 'vehicleId';
  code: string;
  message: string;
}

/**
 * O 409 da regra: um item por campo preso. Motorista E carro presos chegam num só 409 com
 * `fieldErrors` nos dois campos; um só, com `code` + `message`. Vazio para qualquer outra recusa.
 */
export function openRentalConflicts(err: unknown): OpenRentalConflict[] {
  const e = err as { status?: number; error?: unknown } | null;
  if (!e || e.status !== 409 || typeof e.error !== 'object' || e.error === null) return [];
  const body = e.error as { code?: unknown; message?: unknown; fieldErrors?: unknown };
  const field = typeof body.code === 'string' ? OPEN_RENTAL_FIELD_BY_CODE[body.code] : undefined;
  if (!field) return [];
  const out: OpenRentalConflict[] = [];
  if (typeof body.fieldErrors === 'object' && body.fieldErrors !== null) {
    const fields = body.fieldErrors as Record<string, unknown>;
    for (const [code, f] of Object.entries(OPEN_RENTAL_FIELD_BY_CODE)) {
      const message = fields[f];
      if (typeof message === 'string' && message) out.push({ field: f, code, message });
    }
  }
  if (out.length > 1) return out;
  return typeof body.message === 'string' && body.message
    ? [{ field, code: body.code as string, message: body.message }]
    : out;
}
