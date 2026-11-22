import type { OpenRental } from '../../types/driver.types';

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

/** "2026-11-30" → "30/11". */
function dayMonth(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

/** O motivo curto embaixo do nome na lista: "Em aluguel até 30/11" / "Reservado de 10/01 a 07/02". */
export function openRentalReason(open: OpenRental | null | undefined): string | null {
  if (!open) return null;
  if (open.status === 'ACTIVE') return open.endDate ? `Em aluguel até ${dayMonth(open.endDate)}` : 'Em aluguel';
  return open.endDate
    ? `Reservado de ${dayMonth(open.startDate)} a ${dayMonth(open.endDate)}`
    : `Reservado a partir de ${dayMonth(open.startDate)}`;
}

/**
 * O erro do campo quando a escolha (ex.: de um rascunho) já está presa: o mesmo texto que o 409 do
 * servidor traz, para a tela dizer a mesma coisa antes e depois do envio.
 */
export function openRentalMessage(kind: 'driver' | 'vehicle', open: OpenRental): string {
  const who = kind === 'driver' ? 'Este motorista' : 'Este carro';
  let situation: string;
  if (open.status === 'ACTIVE') {
    situation = open.endDate ? ` já está em um aluguel (ativo até ${dayMonth(open.endDate)}).` : ' já está em um aluguel ativo.';
  } else {
    const period = open.endDate
      ? `de ${dayMonth(open.startDate)} a ${dayMonth(open.endDate)}`
      : `a partir de ${dayMonth(open.startDate)}`;
    situation = kind === 'driver' ? ` já tem um aluguel reservado ${period}.` : ` já está reservado ${period}.`;
  }
  return `${who}${situation} Conclua ou cancele esse aluguel antes de criar outro.`;
}

/** O 409 da regra: o campo e a mensagem do servidor; `null` para qualquer outra recusa. */
export function openRentalConflict(err: unknown): { field: 'driverId' | 'vehicleId'; code: string; message: string } | null {
  const e = err as { status?: number; error?: unknown } | null;
  if (!e || e.status !== 409 || typeof e.error !== 'object' || e.error === null) return null;
  const body = e.error as { code?: unknown; message?: unknown };
  const field = typeof body.code === 'string' ? OPEN_RENTAL_FIELD_BY_CODE[body.code] : undefined;
  if (!field || typeof body.message !== 'string' || !body.message) return null;
  return { field, code: body.code as string, message: body.message };
}
