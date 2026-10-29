import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../environments/environment';
import { ImpersonationService } from '../../services/impersonation.service';
import { impersonationInterceptor } from '../../services/impersonation.interceptor';
import type {
  ChargeCancelOutcome,
  RentalChargeDto,
  RentalResponseDto,
} from '../../types/rental.types';
import { RentalDetail } from './rental-detail';

const BASE = `${environment.apiUrl}/rentals`;
const RENTAL_ID = 'r-1';

const RENTAL: RentalResponseDto = {
  id: RENTAL_ID,
  vehicleId: 'v-1',
  driverId: 'd-1',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  periodRate: 10_000,
  totalAmount: 300_000,
  caucaoAmount: 50_000,
  caucaoPaid: false,
  status: 'ACTIVE',
  billingFrequency: 'MONTHLY',
  automaticCharge: true,
  notes: null,
  initialKm: null,
  pickupDate: null,
  firstPaymentDate: null,
  dailyInterestAmount: null,
  lateFineType: null,
  lateFineValue: null,
  contractSource: null,
  franchiseKm: null,
  returnFuelPolicy: null,
  charges: [],
  createdAt: '2026-08-01T00:00:00Z',
  modifiedAt: '2026-08-01T00:00:00Z',
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
    kind: 'CAUCAO',
    amount: 50_000,
    status: 'PENDING',
    provider: 'ASAAS',
    externalId: 'pay_1',
    checkoutUrl: null,
    paidAt: null,
    dueDate: '2099-12-31',
    periodIndex: null,
    ...overrides,
  };
}

function signInAs(role: string): void {
  const payload = { role, exp: Math.floor(Date.now() / 1000) + 3600 };
  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  sessionStorage.setItem('token', `header.${b64}.signature`);
}

type Impersonation = {
  active: () => boolean;
  editMode: () => boolean;
  readOnly: () => boolean;
  reconcile: () => void;
};

async function mount(opts: {
  role?: string;
  charges: RentalChargeDto[];
  impersonation?: Impersonation;
  rental?: Partial<RentalResponseDto>;
}): Promise<{ fixture: ComponentFixture<RentalDetail>; http: HttpTestingController }> {
  TestBed.resetTestingModule();
  sessionStorage.clear();
  signInAs(opts.role ?? 'OWNER');
  TestBed.configureTestingModule({
    imports: [RentalDetail],
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(withInterceptors([impersonationInterceptor])),
      provideHttpClientTesting(),
      provideRouter([]),
      provideNoopAnimations(),
      { provide: ActivatedRoute, useValue: route },
      {
        provide: ImpersonationService,
        useValue: opts.impersonation ?? {
          active: () => false,
          editMode: () => false,
          readOnly: () => false,
          reconcile: vi.fn(),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(RentalDetail);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  await fixture.whenStable();
  http
    .expectOne(`${BASE}/${RENTAL_ID}`)
    .flush({ ...RENTAL, ...opts.rental, charges: opts.charges });
  fixture.detectChanges();
  await fixture.whenStable();
  drain(http);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, http };
}

function drain(http: HttpTestingController): void {
  for (const req of http.match((r) => r.method === 'GET')) {
    req.flush(req.request.url.includes('signature') ? null : []);
  }
}

function el(fixture: ComponentFixture<RentalDetail>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function rowButton(fixture: ComponentFixture<RentalDetail>): HTMLButtonElement | null {
  // O item vive dentro do menu de três pontos (só existe no DOM com o menu aberto).
  const triggers = Array.from(
    el(fixture).querySelectorAll('[aria-haspopup="menu"]'),
  ) as HTMLButtonElement[];
  for (const trigger of triggers) {
    trigger.click();
    fixture.detectChanges();
    const item = el(fixture).querySelector<HTMLButtonElement>('[data-testid="cancel-charge-item"]');
    trigger.click();
    fixture.detectChanges();
    if (item) return item;
  }
  return null;
}

function menuItem(fixture: ComponentFixture<RentalDetail>, testId: string): HTMLButtonElement | null {
  const triggers = Array.from(
    el(fixture).querySelectorAll('[aria-haspopup="menu"]'),
  ) as HTMLButtonElement[];
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

async function settle(fixture: ComponentFixture<RentalDetail>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
}

function dialogButton(fixture: ComponentFixture<RentalDetail>, label: string): HTMLButtonElement {
  const buttons = Array.from(
    el(fixture).querySelectorAll('[role="dialog"] button'),
  ) as HTMLButtonElement[];
  const found = buttons.find((b) => (b.textContent ?? '').includes(label));
  if (!found) throw new Error(`botão "${label}" não encontrado no dialog`);
  return found;
}

describe('RentalDetail — cancelar cobrança da caução', () => {
  afterEach(() => sessionStorage.clear());

  it('oferece o item no menu (alvo de 44 px) para caução aberta', async () => {
    const { fixture } = await mount({ charges: [charge()] });

    const button = rowButton(fixture);
    expect(button).not.toBeNull();
    expect(button?.getAttribute('role')).toBe('menuitem');
    expect(button?.className).toContain('min-h-[44px]');
  });

  it.each([
    ['PENDING', true],
    ['PAST_DUE', true],
    ['FAILED', true],
    ['PAID', false],
    ['CANCELED', false],
    ['DISPUTED', false],
    ['REFUNDED', false],
    ['RELEASED', false],
  ] as const)('caução %s -> botão visível: %s', async (status, visible) => {
    const { fixture } = await mount({ charges: [charge({ status })] });

    expect(rowButton(fixture) !== null).toBe(visible);
  });

  it('não oferece em cobrança que não é caução', async () => {
    const { fixture } = await mount({
      charges: [
        charge({ id: 'c-2', kind: 'RENTAL_PERIOD', periodIndex: 0 }),
        charge({ id: 'c-3', kind: 'OVERDUE_FEE', externalId: null }),
      ],
      rental: { caucaoAmount: 0 },
    });

    expect(rowButton(fixture)).toBeNull();
  });

  it('esconde para o MOTORISTA', async () => {
    const { fixture } = await mount({ role: 'DRIVER', charges: [charge()] });

    expect(rowButton(fixture)).toBeNull();
  });

  it('confirma uma vez, envia a observação e mostra o aviso do desfecho com o hint', async () => {
    const { fixture, http } = await mount({ charges: [charge()] });

    rowButton(fixture)?.click();
    await settle(fixture);
    expect(el(fixture).textContent).toContain(
      'A cobrança será removida do Asaas; se o motorista já pagou, nada é cancelado.',
    );
    const note = el(fixture).querySelector('#cancel-charge-note') as HTMLTextAreaElement;
    note.value = '  Cobrança duplicada  ';
    note.dispatchEvent(new Event('input'));
    await settle(fixture);

    dialogButton(fixture, 'Confirmar cancelamento').click();
    await settle(fixture);

    const calls = http.match(`${BASE}/${RENTAL_ID}/charges/c-1/cancel`);
    expect(calls.length).toBe(1);
    expect(calls[0].request.method).toBe('POST');
    expect(calls[0].request.body).toEqual({ note: 'Cobrança duplicada' });
    calls[0].flush({ outcome: 'REMOVED_AT_GATEWAY', status: 'CANCELED', hint: 'Veja o extrato.' });
    await settle(fixture);
    http.expectOne(`${BASE}/${RENTAL_ID}`).flush({
      ...RENTAL,
      charges: [charge({ status: 'CANCELED' })],
    });
    drain(http);
    await settle(fixture);

    const result = el(fixture).querySelector('[data-testid="cancel-charge-result"]');
    expect(result?.textContent).toContain('cancelada e removida do Asaas');
    expect(result?.textContent).toContain('Veja o extrato.');
    // (3) cancelada a caução, o card oferece gerar outra
    expect(el(fixture).querySelector('[data-testid="generate-caucao-charge"]')).not.toBeNull();
  });

  it.each<[ChargeCancelOutcome, string]>([
    ['REMOVED_AT_GATEWAY', 'removida do Asaas'],
    ['NO_GATEWAY_LINK', 'não tinha vínculo com o Asaas'],
    ['REMOVAL_PENDING_SWEEP', 'remoção no Asaas ainda está pendente'],
    ['ALREADY_CLOSED', 'já estava encerrada'],
    ['ALREADY_PAID', 'motorista já pagou'],
  ])('desfecho %s tem mensagem própria', async (outcome, fragment) => {
    const { fixture, http } = await mount({ charges: [charge()] });
    rowButton(fixture)?.click();
    await settle(fixture);
    dialogButton(fixture, 'Confirmar cancelamento').click();
    await settle(fixture);

    http
      .expectOne(`${BASE}/${RENTAL_ID}/charges/c-1/cancel`)
      .flush({ outcome, status: 'CANCELED', hint: null });
    await settle(fixture);

    const result = el(fixture).querySelector('[data-testid="cancel-charge-result"]');
    expect(result?.textContent).toContain(fragment);
  });

  it('em sessão de LEITURA os botões somem, com explicação, e a API NÃO é chamada', async () => {
    const { fixture, http } = await mount({
      charges: [charge()],
      impersonation: {
        active: () => true,
        editMode: () => false,
        readOnly: () => true,
        reconcile: vi.fn(),
      },
    });

    expect(rowButton(fixture)).toBeNull();
    expect(el(fixture).querySelector('[data-testid="cancel-charge-readonly-note"]')).not.toBeNull();
    http.expectNone(`${BASE}/${RENTAL_ID}/charges/c-1/cancel`);
  });

  it('em EDIÇÃO, recusa do interceptor global não vira segundo aviso na tela', async () => {
    const { fixture, http } = await mount({
      charges: [charge()],
      impersonation: {
        active: () => true,
        editMode: () => true,
        readOnly: () => false,
        reconcile: vi.fn(),
      },
    });
    rowButton(fixture)?.click();
    await settle(fixture);
    dialogButton(fixture, 'Confirmar cancelamento').click();
    await settle(fixture);

    http
      .expectOne(`${BASE}/${RENTAL_ID}/charges/c-1/cancel`)
      .flush(
        { code: 'SUPPORT_EDIT_ROUTE_NOT_ALLOWED', message: 'x' },
        { status: 403, statusText: 'Forbidden' },
      );
    await settle(fixture);

    expect(el(fixture).textContent).not.toContain('Não foi possível cancelar a cobrança');
  });

  it('em sessão de EDIÇÃO a chamada sai', async () => {
    const { fixture, http } = await mount({
      charges: [charge()],
      impersonation: {
        active: () => true,
        editMode: () => true,
        readOnly: () => false,
        reconcile: vi.fn(),
      },
    });
    rowButton(fixture)?.click();
    await settle(fixture);
    dialogButton(fixture, 'Confirmar cancelamento').click();
    await settle(fixture);

    expect(http.match(`${BASE}/${RENTAL_ID}/charges/c-1/cancel`).length).toBe(1);
  });
  // ---- Admin v2 P1 (dono, 29/10/2026): "recebida por fora" saiu da locadora — é só do admin.

  it('NÃO oferece "Cancelar no Asaas e marcar como recebida por fora"; o cancelamento simples continua', async () => {
    const { fixture } = await mount({ charges: [charge({ dueDate: '2026-10-26' })] });

    expect(menuItem(fixture, 'cancel-and-mark-received-item')).toBeNull();
    expect(el(fixture).textContent).not.toContain('marcar como recebida por fora');
    expect(menuItem(fixture, 'cancel-charge-item')).not.toBeNull();
  });

  it('recusa do servidor (409): o motivo real aparece no card da caução', async () => {
    const { fixture, http } = await mount({ charges: [charge()] });
    rowButton(fixture)?.click();
    await settle(fixture);
    dialogButton(fixture, 'Confirmar cancelamento').click();
    await settle(fixture);

    http
      .expectOne(`${BASE}/${RENTAL_ID}/charges/c-1/cancel`)
      .flush(
        { message: 'O pagamento no Asaas não está em um estado que permita cancelamento. Nada foi cancelado.' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle(fixture);

    const result = el(fixture).querySelector('[data-testid="cancel-charge-result"]');
    expect(result?.textContent).toContain(
      'O pagamento no Asaas não está em um estado que permita cancelamento.',
    );
    expect(result?.querySelector('[role="alert"]')).not.toBeNull();
  });
});

