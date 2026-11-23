import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, expect, it } from 'vitest';

import type { RentalChargeDto, RentalResponseDto } from '../../../types/rental.types';
import { ChargesFlexService } from './charges-flex.service';
import { RenegotiableOption, RenegotiateSheet } from './renegotiate-sheet';

/** N22 (reteste de 23/11) — a nota da multa fala de parcelas só quando há parcelas. */

const RENTAL = {
  id: 'r-1',
  automaticCharge: false,
  lateFineType: 'FIXED',
  lateFineValue: 2_000,
} as RentalResponseDto;

const CHARGE = {
  id: 'w4',
  kind: 'RENTAL_PERIOD',
  amount: 60_000,
  status: 'PENDING',
  provider: 'INTERNAL',
  externalId: null,
  checkoutUrl: null,
  paidAt: null,
  dueDate: '2026-12-15',
  periodIndex: 3,
} as RentalChargeDto;

const OPTION: RenegotiableOption = {
  charge: CHARGE,
  label: 'Semana 4',
  dueLabel: 'Vence em 15/12/2026',
  chip: { label: 'Pendente', chip: '' },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function atStep2(mode: 'ONCE' | 'SPLIT'): Promise<ComponentFixture<RenegotiateSheet>> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [RenegotiateSheet],
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideNoopAnimations(),
      { provide: ChargesFlexService, useValue: {} },
    ],
  });
  const fixture = TestBed.createComponent(RenegotiateSheet);
  fixture.componentRef.setInput('rental', RENTAL);
  fixture.componentRef.setInput('options', [OPTION]);
  fixture.componentRef.setInput('preselectedId', 'w4');
  fixture.componentRef.setInput('today', '2026-11-23');
  const cmp = fixture.componentInstance as Any;
  cmp.step.set(2);
  cmp.amount.setValue('600,00');
  cmp.setPayMode(mode);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

function note(fixture: ComponentFixture<RenegotiateSheet>): string {
  const el = (fixture.nativeElement as HTMLElement).ownerDocument.querySelector(
    '[data-testid="renegotiate-fine-note"]',
  );
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('RenegotiateSheet — nota da multa (N22)', () => {
  it('à vista: fala do pagamento único, sem "parcelas"', async () => {
    const text = note(await atStep2('ONCE'));
    expect(text).toContain('vale para este pagamento');
    expect(text).not.toContain('parcela');
  });

  it('parcelado: a multa se divide pelas parcelas', async () => {
    const text = note(await atStep2('SPLIT'));
    expect(text).toContain('se divide pelas parcelas');
  });
});
