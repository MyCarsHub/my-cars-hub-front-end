import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { openRentalConflicts, openRentalMessage, openRentalReason } from './open-rental';

const TODAY = '2026-11-22';

describe('open-rental ("Bloquear sempre")', () => {
  it('o motivo curto da lista', () => {
    expect(openRentalReason({ status: 'ACTIVE', startDate: '2026-11-01', endDate: '2026-11-30' }, TODAY)).toBe(
      'Em aluguel até 30/11',
    );
    expect(openRentalReason({ status: 'RESERVED', startDate: '2026-12-01', endDate: '2026-12-20' }, TODAY)).toBe(
      'Reservado de 01/12 a 20/12',
    );
    // fora do ano corrente, a data leva o ano (a mesma regra do servidor)
    expect(openRentalReason({ status: 'RESERVED', startDate: '2026-12-20', endDate: '2027-01-10' }, TODAY)).toBe(
      'Reservado de 20/12 a 10/01/2027',
    );
    expect(openRentalReason({ status: 'ACTIVE', startDate: '2026-11-01', endDate: null }, TODAY)).toBe('Em aluguel');
    expect(openRentalReason({ status: 'RESERVED', startDate: '2027-01-10', endDate: null }, TODAY)).toBe(
      'Reservado a partir de 10/01/2027',
    );
    expect(openRentalReason(null)).toBeNull();
    expect(openRentalReason(undefined)).toBeNull();
  });

  it('a mensagem do campo é a mesma do 409 do servidor', () => {
    expect(openRentalMessage('driver', { status: 'ACTIVE', startDate: '2026-11-01', endDate: '2026-11-30' }, TODAY)).toBe(
      'Este motorista já está em um aluguel (ativo até 30/11). Conclua ou cancele esse aluguel antes de criar outro.',
    );
    expect(openRentalMessage('vehicle', { status: 'RESERVED', startDate: '2027-01-10', endDate: '2027-02-07' }, TODAY)).toBe(
      'Este carro já está reservado de 10/01/2027 a 07/02/2027. Conclua ou cancele esse aluguel antes de criar outro.',
    );
    expect(openRentalMessage('driver', { status: 'RESERVED', startDate: '2026-12-10', endDate: null }, TODAY)).toContain(
      'já tem um aluguel reservado a partir de 10/12.',
    );
  });

  it('lê só os dois 409 da regra', () => {
    const conflict = (code: string, status = 409): HttpErrorResponse =>
      new HttpErrorResponse({ status, error: { code, message: 'texto do servidor', fieldErrors: { x: 'y' } } });
    expect(openRentalConflicts(conflict('DRIVER_HAS_OPEN_RENTAL'))).toEqual([
      { field: 'driverId', code: 'DRIVER_HAS_OPEN_RENTAL', message: 'texto do servidor' },
    ]);
    expect(openRentalConflicts(conflict('VEHICLE_HAS_OPEN_RENTAL'))[0].field).toBe('vehicleId');
    expect(openRentalConflicts(conflict('VEHICLE_PERIOD_TAKEN'))).toEqual([]);
    expect(openRentalConflicts(conflict('DRIVER_HAS_OPEN_RENTAL', 400))).toEqual([]);
    expect(openRentalConflicts(null)).toEqual([]);
  });

  it('os dois presos num 409 só: um item por campo, com a frase de cada um', () => {
    const err = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'DRIVER_HAS_OPEN_RENTAL',
        message: 'os dois',
        fieldErrors: { driverId: 'frase do motorista', vehicleId: 'frase do carro' },
      },
    });
    expect(openRentalConflicts(err)).toEqual([
      { field: 'driverId', code: 'DRIVER_HAS_OPEN_RENTAL', message: 'frase do motorista' },
      { field: 'vehicleId', code: 'VEHICLE_HAS_OPEN_RENTAL', message: 'frase do carro' },
    ]);
  });
});
