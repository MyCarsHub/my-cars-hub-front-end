import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it } from 'vitest';

import { environment } from '../../../../environments/environment';
import { DriverRentalChargesService } from '../../../services/driver-rental-charges.service';
import type { DriverCharge } from '../../../types/driver-charges.types';
import { driverChargeKindLabel } from '../../../utils/driver-charges';
import { buildChargeList, chargeTitle } from './driver-rental-view';

/** FEAT-0573 — jornada F: o que o motorista vê depois do acordo. */
describe('Motorista — Cobranças flexíveis (FEAT-0573)', () => {
  const TODAY = '2026-12-03';

  function c(over: Partial<DriverCharge>): DriverCharge {
    return {
      id: 'x',
      kind: 'RENTAL_PERIOD',
      amount: 75_000,
      status: 'PENDING',
      dueDate: '2026-12-07',
      periodIndex: 3,
      paidAt: null,
      checkoutUrl: 'https://sandbox.asaas.com/i/x',
      ...over,
    };
  }

  it('RENEGOTIATED do servidor continua Renegociada (não vira Pendente com botão)', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    let got: DriverCharge[] = [];
    TestBed.inject(DriverRentalChargesService).list('r-1').subscribe((list) => (got = list));
    http.expectOne(`${environment.apiUrl}/rentals/r-1/charges`).flush([
      { id: 'w2', kind: 'RENTAL_PERIOD', amount: 75_000, status: 'RENEGOTIATED', dueDate: '2026-11-23', periodIndex: 1, paidAt: null, checkoutUrl: null },
      { id: 'a1', kind: 'AGREEMENT', amount: 40_000, status: 'PENDING', dueDate: '2026-12-09', periodIndex: null, paidAt: null, checkoutUrl: 'https://sandbox.asaas.com/i/a1', instalmentIndex: 1, instalmentCount: 4, agreementSeq: 1 },
    ]);
    expect(got[0].status).toBe('RENEGOTIATED');
    expect(got[1]).toMatchObject({ kind: 'AGREEMENT', instalmentIndex: 1, instalmentCount: 4, agreementSeq: 1 });
    http.verify();
  });

  it('títulos: "Acordo · parcela 1 de 4", parcela de semana e parte da caução; a inteira fica igual', () => {
    expect(chargeTitle(c({ kind: 'AGREEMENT', periodIndex: null, instalmentIndex: 1, instalmentCount: 4, agreementSeq: 1 }), 'WEEKLY')).toBe(
      'Acordo · parcela 1 de 4',
    );
    expect(chargeTitle(c({ periodIndex: 0, instalmentIndex: 2, instalmentCount: 3 }), 'WEEKLY')).toBe(
      'Semana 1 · Aluguel semanal · parcela 2 de 3',
    );
    expect(chargeTitle(c({ kind: 'CAUCAO', periodIndex: null, instalmentIndex: 1, instalmentCount: 2 }), 'WEEKLY')).toBe(
      'Caução · parte 1 de 2',
    );
    expect(chargeTitle(c({ periodIndex: 3 }), 'WEEKLY')).toBe('Semana 4 · Aluguel semanal');
    expect(driverChargeKindLabel('AGREEMENT')).toBe('Acordo');
  });

  it('F2 — renegociadas aparecem como Renegociada, sem Pagar; a parcela do acordo é paga como qualquer outra', () => {
    const list = buildChargeList(
      [
        c({ id: 'w1', periodIndex: 0, status: 'PAID', paidAt: '2026-11-16T10:42:00', dueDate: '2026-11-16', checkoutUrl: null }),
        c({ id: 'w2', periodIndex: 1, status: 'RENEGOTIATED', dueDate: '2026-11-23', checkoutUrl: null }),
        c({ id: 'w3', periodIndex: 2, status: 'RENEGOTIATED', dueDate: '2026-11-30', checkoutUrl: null }),
        c({ id: 'a1', kind: 'AGREEMENT', periodIndex: null, amount: 40_000, dueDate: '2026-12-09', instalmentIndex: 1, instalmentCount: 4 }),
      ],
      TODAY,
      'WEEKLY',
    );
    const reneg = list.rows.filter((r) => r.chipLabel === 'Renegociada');
    expect(reneg.map((r) => r.charge.id)).toEqual(['w2', 'w3']);
    expect(reneg.every((r) => !r.payable)).toBe(true);
    expect(reneg[0].sub).toBe('Venceu em 23/11/2026');
    const agreementRow = list.rows.find((r) => r.charge.id === 'a1')!;
    expect(agreementRow.payable).toBe(true);
    expect(agreementRow.title).toBe('Acordo · parcela 1 de 4');
    // Renegociada não conta como aberta nem como paga.
    expect(list.openCount).toBe(1);
    expect(list.paidCount).toBe(1);
  });
});
