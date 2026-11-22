import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { openRentalConflict, openRentalMessage, openRentalReason } from './open-rental';

describe('open-rental ("Bloquear sempre")', () => {
  it('o motivo curto da lista', () => {
    expect(openRentalReason({ status: 'ACTIVE', startDate: '2026-11-01', endDate: '2026-11-30' })).toBe('Em aluguel até 30/11');
    expect(openRentalReason({ status: 'RESERVED', startDate: '2027-01-10', endDate: '2027-02-07' })).toBe(
      'Reservado de 10/01 a 07/02',
    );
    expect(openRentalReason({ status: 'ACTIVE', startDate: '2026-11-01', endDate: null })).toBe('Em aluguel');
    expect(openRentalReason({ status: 'RESERVED', startDate: '2027-01-10', endDate: null })).toBe('Reservado a partir de 10/01');
    expect(openRentalReason(null)).toBeNull();
    expect(openRentalReason(undefined)).toBeNull();
  });

  it('a mensagem do campo é a mesma do 409 do servidor', () => {
    expect(openRentalMessage('driver', { status: 'ACTIVE', startDate: '2026-11-01', endDate: '2026-11-30' })).toBe(
      'Este motorista já está em um aluguel (ativo até 30/11). Conclua ou cancele esse aluguel antes de criar outro.',
    );
    expect(openRentalMessage('vehicle', { status: 'RESERVED', startDate: '2027-01-10', endDate: '2027-02-07' })).toBe(
      'Este carro já está reservado de 10/01 a 07/02. Conclua ou cancele esse aluguel antes de criar outro.',
    );
    expect(openRentalMessage('driver', { status: 'RESERVED', startDate: '2027-01-10', endDate: null })).toContain(
      'já tem um aluguel reservado a partir de 10/01.',
    );
  });

  it('lê só os dois 409 da regra', () => {
    const conflict = (code: string, status = 409): HttpErrorResponse =>
      new HttpErrorResponse({ status, error: { code, message: 'texto do servidor' } });
    expect(openRentalConflict(conflict('DRIVER_HAS_OPEN_RENTAL'))).toEqual({
      field: 'driverId',
      code: 'DRIVER_HAS_OPEN_RENTAL',
      message: 'texto do servidor',
    });
    expect(openRentalConflict(conflict('VEHICLE_HAS_OPEN_RENTAL'))?.field).toBe('vehicleId');
    expect(openRentalConflict(conflict('VEHICLE_PERIOD_TAKEN'))).toBeNull();
    expect(openRentalConflict(conflict('DRIVER_HAS_OPEN_RENTAL', 400))).toBeNull();
    expect(openRentalConflict(null)).toBeNull();
  });
});
