import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { CASHFLOW_KIND_META, CashflowDaySheet, cashflowKindMeta } from './cashflow-day-sheet';
import type { CashflowEventDto, CashflowKind } from '../../../types/dashboard.types';

describe('CashflowDaySheet — tipos de fluxo de caixa', () => {
  const NEW_KINDS: CashflowKind[] = [
    'IPVA_DUE',
    'IPVA_PAID',
    'INSURANCE_DUE',
    'INSURANCE_PAID',
    'FINANCING_DUE',
    'FINANCING_PAID',
  ];

  it('gives IPVA, insurance and financing the FINE_* look: paid = red, due = amber', () => {
    for (const kind of NEW_KINDS) {
      const ref = kind.endsWith('_PAID') ? CASHFLOW_KIND_META.FINE_PAID : CASHFLOW_KIND_META.FINE_DUE;
      expect(CASHFLOW_KIND_META[kind].color).toBe(ref.color);
      expect(CASHFLOW_KIND_META[kind].chip).toBe(ref.chip);
    }
    expect(CASHFLOW_KIND_META.IPVA_DUE.label).toBe('IPVA a vencer');
    expect(CASHFLOW_KIND_META.IPVA_PAID.label).toBe('IPVA pago');
    expect(CASHFLOW_KIND_META.INSURANCE_DUE.label).toBe('Seguro a vencer');
    expect(CASHFLOW_KIND_META.INSURANCE_PAID.label).toBe('Seguro pago');
    expect(CASHFLOW_KIND_META.FINANCING_DUE.label).toBe('Parcela de financiamento a vencer');
    expect(CASHFLOW_KIND_META.FINANCING_PAID.label).toBe('Parcela de financiamento paga');
    expect(CASHFLOW_KIND_META.IPVA_DUE.icon).toBe('ipva');
    expect(CASHFLOW_KIND_META.INSURANCE_PAID.icon).toBe('insurance');
    expect(CASHFLOW_KIND_META.FINANCING_DUE.icon).toBe('financing');
  });

  it('falls back to a neutral row with the raw name for a kind it does not know', () => {
    expect(cashflowKindMeta('SOMETHING_NEW').label).toBe('SOMETHING_NEW');
  });

  it('renders each new kind as a row with its label, icon chip and an OUT amount', () => {
    const events: CashflowEventDto[] = NEW_KINDS.map((kind, i) => ({
      date: '2026-11-10',
      kind,
      direction: 'OUT',
      amountCents: (i + 1) * 10000,
      label: `item ${i}`,
    }));
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(CashflowDaySheet);
    fixture.componentRef.setInput('date', '2026-11-10');
    fixture.componentRef.setInput('events', events);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    for (const kind of NEW_KINDS) {
      const row = host.querySelector(`[data-cashflow-kind="${kind}"]`);
      expect(row, kind).not.toBeNull();
      expect(row!.textContent).toContain(CASHFLOW_KIND_META[kind].label);
      expect(row!.querySelector('svg path, svg circle')).not.toBeNull();
    }
    // A pagar = soma das seis saídas (10+20+…+60 mil centavos = R$ 2.100,00).
    expect((host.textContent ?? '').replace(/\s+/g, ' ')).toContain('R$ 2.100,00');
  });

  it('FIX-0875: rent and caução receipts are labelled by charge state', () => {
    expect(cashflowKindMeta('RENTAL_RECEIPT_PAID').label).toBe('Aluguel recebido');
    expect(cashflowKindMeta('RENTAL_RECEIPT_OVERDUE').label).toBe('Aluguel em atraso');
    expect(cashflowKindMeta('RENTAL_RECEIPT_DUE').label).toBe('Aluguel a receber');
    expect(cashflowKindMeta('DEPOSIT_RECEIPT_PAID').label).toBe('Caução recebida');
    expect(cashflowKindMeta('DEPOSIT_RECEIPT_OVERDUE').label).toBe('Caução em atraso');
    expect(cashflowKindMeta('DEPOSIT_RECEIPT_DUE').label).toBe('Caução a receber');
  });
});
