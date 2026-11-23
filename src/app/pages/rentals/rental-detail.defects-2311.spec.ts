import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../environments/environment';
import { ImpersonationService } from '../../services/impersonation.service';
import type { RentalChargeDto, RentalResponseDto } from '../../types/rental.types';
import { RentalDetail } from './rental-detail';

/**
 * Defeitos do plano de teste de 23/11 (decisão do dono, 23/11) no detalhe do aluguel:
 * F5 (estorno da caução não confirmado), F7 (caução no Asaas em aluguel manual),
 * F8 ("Gerar de novo" em FAILED vencida) e F14 (renegociar aluguel concluído).
 */

const BASE = `${environment.apiUrl}/rentals`;
const RENTAL_ID = 'r-1';

const RENTAL: RentalResponseDto = {
  id: RENTAL_ID,
  vehicleId: 'v-1',
  driverId: 'd-1',
  startDate: '2020-01-06',
  endDate: '2099-12-31',
  periodRate: 75_000,
  totalAmount: 900_000,
  caucaoAmount: 0,
  caucaoPaid: false,
  status: 'ACTIVE',
  billingFrequency: 'WEEKLY',
  automaticCharge: true,
  notes: null,
  initialKm: null,
  pickupDate: null,
  firstPaymentDate: null,
  dailyInterestAmount: null,
  lateFineType: 'FIXED',
  lateFineValue: 5_000,
  contractSource: null,
  franchiseKm: null,
  returnFuelPolicy: null,
  charges: [],
  createdAt: '2020-01-06T00:00:00Z',
  modifiedAt: '2020-01-06T00:00:00Z',
};

const route = {
  snapshot: {
    paramMap: { get: (k: string) => (k === 'id' ? RENTAL_ID : null) },
    queryParamMap: { get: () => null },
  },
};

function charge(overrides: Partial<RentalChargeDto> = {}): RentalChargeDto {
  return {
    id: 'c-1',
    kind: 'RENTAL_PERIOD',
    amount: 75_000,
    status: 'PENDING',
    provider: 'ASAAS',
    externalId: 'pay_1',
    checkoutUrl: 'https://sandbox.asaas.com/i/1',
    paidAt: null,
    dueDate: '2099-12-07',
    periodIndex: 3,
    ...overrides,
  };
}

function signIn(role: string, features: string[] | null): void {
  const payload = { role, exp: Math.floor(Date.now() / 1000) + 3600 };
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  sessionStorage.setItem('token', `header.${b64}.signature`);
  if (features) sessionStorage.setItem('features', JSON.stringify(features));
}

async function mount(opts: {
  flex?: boolean;
  charges: RentalChargeDto[];
  rental?: Partial<RentalResponseDto>;
}): Promise<{ fixture: ComponentFixture<RentalDetail>; http: HttpTestingController }> {
  TestBed.resetTestingModule();
  sessionStorage.clear();
  signIn('OWNER', opts.flex ? ['CHARGES_FLEX'] : []);
  TestBed.configureTestingModule({
    imports: [RentalDetail],
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideNoopAnimations(),
      { provide: ActivatedRoute, useValue: route },
      {
        provide: ImpersonationService,
        useValue: { active: () => false, editMode: () => false, readOnly: () => false, reconcile: vi.fn() },
      },
    ],
  });
  const fixture = TestBed.createComponent(RentalDetail);
  const http = TestBed.inject(HttpTestingController);
  await settle(fixture);
  http.expectOne(`${BASE}/${RENTAL_ID}`).flush({ ...RENTAL, ...opts.rental, charges: opts.charges });
  await settle(fixture);
  for (const req of http.match((r) => r.method === 'GET')) {
    if (req.request.url.endsWith('/agreements')) req.flush([]);
    else req.flush(req.request.url.includes('signature') ? null : []);
  }
  await settle(fixture);
  return { fixture, http };
}

async function settle(fixture: ComponentFixture<RentalDetail>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function el(fixture: ComponentFixture<RentalDetail>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/** Abre os ⋮ um a um e devolve o primeiro item com o `data-testid` (o menu fica aberto). */
function menuItem(fixture: ComponentFixture<RentalDetail>, testId: string): HTMLButtonElement | null {
  const triggers = Array.from(el(fixture).querySelectorAll('[aria-haspopup="menu"]')) as HTMLButtonElement[];
  for (const trigger of triggers) {
    trigger.click();
    fixture.detectChanges();
    const item = el(fixture).querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    if (item) return item;
    trigger.click();
    fixture.detectChanges();
  }
  return null;
}

/** Abre os ⋮ um a um e diz se algum item tem o texto. */
function anyMenuItemWithText(fixture: ComponentFixture<RentalDetail>, text: string): boolean {
  const triggers = Array.from(el(fixture).querySelectorAll('[aria-haspopup="menu"]')) as HTMLButtonElement[];
  for (const trigger of triggers) {
    trigger.click();
    fixture.detectChanges();
    const found = Array.from(el(fixture).querySelectorAll('[role="menuitem"]')).some((b) =>
      (b.textContent ?? '').includes(text),
    );
    trigger.click();
    fixture.detectChanges();
    if (found) return true;
  }
  return false;
}

function byTestId<T extends HTMLElement = HTMLElement>(fixture: ComponentFixture<RentalDetail>, id: string): T | null {
  return el(fixture).querySelector<T>(`[data-testid="${id}"]`);
}

describe('RentalDetail — defeitos de 23/11', () => {
  afterEach(() => sessionStorage.clear());

  // ------------------------------------------------------------------ F8
  it('F8 — FAILED com vencimento no passado não oferece "Gerar de novo" (permanece em atraso)', async () => {
    const { fixture } = await mount({
      charges: [charge({ id: 'f-old', status: 'FAILED', externalId: null, checkoutUrl: null, dueDate: '2020-01-13' })],
    });
    expect(anyMenuItemWithText(fixture, 'Gerar de novo')).toBe(false);
  });

  it('F8 — FAILED que ainda não venceu continua com "Gerar de novo"', async () => {
    const { fixture } = await mount({
      charges: [charge({ id: 'f-new', status: 'FAILED', externalId: null, checkoutUrl: null, dueDate: '2099-12-07' })],
    });
    expect(anyMenuItemWithText(fixture, 'Gerar de novo')).toBe(true);
  });

  // ------------------------------------------------------------------ F14
  it('F14 — aluguel concluído não oferece "Renegociar"', async () => {
    const { fixture } = await mount({
      flex: true,
      rental: { status: 'COMPLETED', completedAt: '2026-11-20T12:00:00' },
      charges: [charge({ id: 'w2', periodIndex: 1, dueDate: '2020-01-13', status: 'PAST_DUE' })],
    });
    expect(menuItem(fixture, 'charge-menu-renegotiate')).toBeNull();
  });

  it('F14 — aluguel ativo segue oferecendo "Renegociar"', async () => {
    const { fixture } = await mount({
      flex: true,
      charges: [charge({ id: 'w2', periodIndex: 1, dueDate: '2020-01-13', status: 'PAST_DUE' })],
    });
    expect(menuItem(fixture, 'charge-menu-renegotiate')).not.toBeNull();
  });

  // ------------------------------------------------------------------ F7
  it('F7 — aluguel manual com a caução cancelada não oferece "Gerar nova cobrança da caução"', async () => {
    const { fixture } = await mount({
      rental: { automaticCharge: false, caucaoAmount: 50_000 },
      charges: [charge({ id: 'cc', kind: 'CAUCAO', status: 'CANCELED', periodIndex: null, amount: 50_000 })],
    });
    expect(byTestId(fixture, 'generate-caucao-charge')).toBeNull();
  });

  it('F7 — aluguel automático com a caução cancelada continua oferecendo', async () => {
    const { fixture } = await mount({
      rental: { automaticCharge: true, caucaoAmount: 50_000 },
      charges: [charge({ id: 'cc', kind: 'CAUCAO', status: 'CANCELED', periodIndex: null, amount: 50_000 })],
    });
    expect(byTestId(fixture, 'generate-caucao-charge')).not.toBeNull();
  });

  // ------------------------------------------------------------------ F5
  const PAID_CAUCAO = charge({
    id: 'cc',
    kind: 'CAUCAO',
    status: 'PAID',
    periodIndex: null,
    amount: 50_000,
    paidAt: '2026-11-01T12:00:00',
    checkoutUrl: null,
  });
  const ENDED_PENDING_REFUND: Partial<RentalResponseDto> = {
    status: 'COMPLETED',
    completedAt: '2026-11-20T12:00:00',
    caucaoAmount: 50_000,
    caucaoPaid: true,
    caucaoRefundMethod: 'AUTOMATIC',
    caucaoRefundedAmount: 50_000,
    caucaoRefundedAt: null,
  };

  it('F5 — estorno automático não confirmado: aviso no card, resumo honesto e as duas saídas no menu', async () => {
    const { fixture } = await mount({ rental: ENDED_PENDING_REFUND, charges: [PAID_CAUCAO] });

    expect(byTestId(fixture, 'caucao-refund-pending-banner')?.textContent).toContain(
      'O Asaas não confirmou o estorno da caução',
    );
    expect(byTestId(fixture, 'caucao-refund-pending-summary')?.textContent).toContain('Estorno não confirmado');
    expect(menuItem(fixture, 'charge-menu-refund-retry')).not.toBeNull();
    expect(byTestId(fixture, 'charge-menu-refund-manual')).not.toBeNull();
  });

  it('F5 — "Registrar devolução por fora" confirma e chama o endpoint com MANUAL', async () => {
    const { fixture, http } = await mount({ rental: ENDED_PENDING_REFUND, charges: [PAID_CAUCAO] });

    menuItem(fixture, 'charge-menu-refund-manual')!.click();
    await settle(fixture);
    const confirm = Array.from(el(fixture).querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Registrar devolução',
    ) as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    confirm.click();
    await settle(fixture);

    const req = http.expectOne(`${BASE}/${RENTAL_ID}/caucao-refund`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ method: 'MANUAL' });
    req.flush({
      ...RENTAL,
      ...ENDED_PENDING_REFUND,
      caucaoRefundMethod: 'MANUAL',
      caucaoRefundedAt: '2026-11-23T10:00:00',
      charges: [{ ...PAID_CAUCAO, status: 'REFUNDED' }],
    });
    await settle(fixture);
    expect(byTestId(fixture, 'caucao-refund-pending-banner')).toBeNull();
  });

  it('F5 — estorno que deu certo (caução RELEASED) não mostra aviso nem as saídas', async () => {
    const { fixture } = await mount({
      rental: { ...ENDED_PENDING_REFUND, caucaoRefundedAt: '2026-11-20T12:00:00' },
      charges: [{ ...PAID_CAUCAO, status: 'RELEASED' }],
    });
    expect(byTestId(fixture, 'caucao-refund-pending-banner')).toBeNull();
    expect(menuItem(fixture, 'charge-menu-refund-retry')).toBeNull();
  });
});
