import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../environments/environment';
import { impersonationInterceptor } from '../../services/impersonation.interceptor';
import { ImpersonationService } from '../../services/impersonation.service';
import { NotificationService } from '../../services/notification.service';
import type {
  RentalChargeRemovalDto,
  RentalPreflightRequest,
  RentalResponseDto,
} from '../../types/rental.types';
import { RentalDetail } from './rental-detail';
import { RentalService } from './rental.service';

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

const REMOVALS: RentalChargeRemovalDto[] = [
  {
    chargeId: 'c-ok',
    kind: 'RENTAL_PERIOD',
    amount: 10_000,
    outcome: 'REMOVED_AT_GATEWAY',
    message: 'Removida do Asaas.',
  },
  {
    chargeId: 'c-paid',
    kind: 'CAUCAO',
    amount: 50_000,
    outcome: 'KEPT_PAID',
    message: 'Paga: mantida.',
  },
  {
    chargeId: 'c-refused',
    kind: 'RENTAL_PERIOD',
    amount: 10_000,
    outcome: 'REMOVAL_REFUSED',
    message: 'O Asaas recusou a remoção: pagamento em processamento.',
  },
];

const route = {
  snapshot: {
    paramMap: { get: (k: string) => (k === 'id' ? RENTAL_ID : null) },
    queryParamMap: { get: () => null },
  },
};

type Mode = 'OWNER' | 'EDIT' | 'READ';

function signInAs(role: string): void {
  const payload = { role, exp: Math.floor(Date.now() / 1000) + 3600 };
  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  sessionStorage.setItem('token', `header.${b64}.signature`);
}

function el(fixture: ComponentFixture<unknown>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
}

function drain(http: HttpTestingController): void {
  for (const req of http.match((r) => r.method === 'GET')) {
    req.flush(req.request.url.includes('signature') ? null : []);
  }
}

async function mount(
  mode: Mode,
  rental: Partial<RentalResponseDto> = {},
): Promise<{ fixture: ComponentFixture<RentalDetail>; http: HttpTestingController }> {
  TestBed.resetTestingModule();
  sessionStorage.clear();
  localStorage.clear();
  signInAs('OWNER');
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
        useValue: {
          active: () => mode !== 'OWNER',
          editMode: () => mode === 'EDIT',
          readOnly: () => mode === 'READ',
          reconcile: vi.fn(),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(RentalDetail);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  await fixture.whenStable();
  http.expectOne(`${BASE}/${RENTAL_ID}`).flush({ ...RENTAL, ...rental });
  await settle(fixture);
  drain(http);
  await settle(fixture);
  return { fixture, http };
}

function byTestId(fixture: ComponentFixture<unknown>, id: string): HTMLElement | null {
  return el(fixture).querySelector(`[data-testid="${id}"]`);
}

function click(fixture: ComponentFixture<unknown>, id: string): Promise<void> {
  const target = byTestId(fixture, id);
  if (!target) throw new Error(`data-testid "${id}" não encontrado`);
  target.click();
  return settle(fixture);
}

function dialogButton(fixture: ComponentFixture<unknown>, label: string): HTMLButtonElement {
  const buttons = Array.from(
    el(fixture).querySelectorAll('[role="dialog"] button'),
  ) as HTMLButtonElement[];
  const found = buttons.find((b) => (b.textContent ?? '').includes(label));
  if (!found) throw new Error(`botão "${label}" não encontrado no dialog`);
  return found;
}

function dialogText(fixture: ComponentFixture<unknown>): string {
  return Array.from(el(fixture).querySelectorAll('[role="dialog"]'))
    .map((d) => d.textContent ?? '')
    .join(' ');
}

describe('RentalDetail — ações do administrador na sessão de EDIÇÃO (FEAT-0347)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('o dono/gerente NÃO vê o bloco do administrador', async () => {
    const { fixture } = await mount('OWNER');

    expect(byTestId(fixture, 'support-rental-actions')).toBeNull();
    expect(byTestId(fixture, 'support-cancel')).toBeNull();
    expect(byTestId(fixture, 'support-delete')).toBeNull();
  });

  it('a sessão de LEITURA também não vê', async () => {
    const { fixture } = await mount('READ');

    expect(byTestId(fixture, 'support-rental-actions')).toBeNull();
  });

  it('na EDIÇÃO aparecem Cancelar (aluguel ativo) e Excluir', async () => {
    const { fixture } = await mount('EDIT');

    expect(byTestId(fixture, 'support-cancel')).not.toBeNull();
    expect(byTestId(fixture, 'support-delete')).not.toBeNull();
  });

  it('na EDIÇÃO, aluguel já CANCELADO só oferece Excluir', async () => {
    const { fixture } = await mount('EDIT', { status: 'CANCELED' });

    expect(byTestId(fixture, 'support-cancel')).toBeNull();
    expect(byTestId(fixture, 'support-delete')).not.toBeNull();
  });

  it('na EDIÇÃO o "Cancelar aluguel" do dono (RESERVED) não aparece em dobro', async () => {
    const { fixture } = await mount('EDIT', { status: 'RESERVED' });

    const labels = Array.from(el(fixture).querySelectorAll('button'))
      .map((b) => (b.textContent ?? '').trim())
      .filter((t) => t === 'Cancelar aluguel');
    expect(labels.length).toBe(1);
  });

  it('alvos de toque >= 44px e texto de 16px nos botões do administrador', async () => {
    const { fixture } = await mount('EDIT');

    for (const id of ['support-cancel', 'support-delete']) {
      const cls = byTestId(fixture, id)?.className ?? '';
      expect(cls).toContain('min-h-[44px]');
      expect(cls).toContain('text-base');
    }
  });

  it('cancelar: explica o efeito, confirma uma vez e mostra o desfecho por cobrança', async () => {
    const { fixture, http } = await mount('EDIT');

    await click(fixture, 'support-cancel');
    const text = dialogText(fixture);
    expect(text).toContain('removidas do Asaas');
    expect(text).toContain('já pagas ficam');
    http.expectNone(`${BASE}/${RENTAL_ID}/cancel`);

    dialogButton(fixture, 'Cancelar aluguel').click();
    await settle(fixture);
    const req = http.expectOne(`${BASE}/${RENTAL_ID}/cancel`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ removeOverdueCharges: false });
    req.flush({ ...RENTAL, status: 'CANCELED', chargeRemovals: REMOVALS });
    await settle(fixture);
    drain(http);
    await settle(fixture);

    const result = byTestId(fixture, 'support-cancel-result');
    expect(result).not.toBeNull();
    const rows = Array.from(result!.querySelectorAll('li'));
    expect(rows.length).toBe(3);
    // A recusada sobe para o topo, destacada como ação pendente.
    expect(rows[0].getAttribute('data-outcome-pending')).toBe('true');
    expect(rows[0].textContent).toContain('Recusada pelo Asaas');
    expect(rows[0].textContent).toContain('pagamento em processamento');
    expect(result!.textContent).toContain('Mantida: já paga');
    expect(result!.textContent).toContain('Removida do Asaas');
    expect(result!.querySelector('[data-testid="removal-pending-summary"]')).not.toBeNull();
    // O aluguel da tela virou CANCELED: o botão de cancelar some.
    expect(byTestId(fixture, 'support-cancel')).toBeNull();
  });

  it('cancelar com a opção das vencidas marcada envia removeOverdueCharges=true', async () => {
    const { fixture, http } = await mount('EDIT');

    await click(fixture, 'support-cancel');
    const box = el(fixture).querySelector(
      '[role="dialog"] input[type="checkbox"]',
    ) as HTMLInputElement;
    box.click();
    await settle(fixture);
    dialogButton(fixture, 'Cancelar aluguel').click();
    await settle(fixture);

    const req = http.expectOne(`${BASE}/${RENTAL_ID}/cancel`);
    expect(req.request.body).toEqual({ removeOverdueCharges: true });
  });

  it('excluir: o diálogo avisa que só vale depois de cancelar e o DELETE sai sem o reconhecimento', async () => {
    const { fixture, http } = await mount('EDIT', { status: 'CANCELED' });

    await click(fixture, 'support-delete');
    expect(dialogText(fixture)).toContain('depois de cancelá-lo');
    dialogButton(fixture, 'Excluir').click();
    await settle(fixture);

    const req = http.expectOne((r) => r.method === 'DELETE' && r.url === `${BASE}/${RENTAL_ID}`);
    expect(req.request.params.get('acknowledgePaidChargesLoss')).toBeNull();
    req.flush({ rentalId: RENTAL_ID, chargeRemovals: REMOVALS });
    await settle(fixture);

    const result = byTestId(fixture, 'support-delete-result');
    expect(result).not.toBeNull();
    expect(result!.textContent).toContain('Recusada pelo Asaas');
    expect(byTestId(fixture, 'support-rental-actions')).toBeNull();
  });

  it('400 PAID_CHARGES_WOULD_BE_LOST: segundo diálogo forte e reenvio com acknowledgePaidChargesLoss=true', async () => {
    const { fixture, http } = await mount('EDIT', { status: 'CANCELED' });

    await click(fixture, 'support-delete');
    dialogButton(fixture, 'Excluir').click();
    await settle(fixture);
    http
      .expectOne((r) => r.method === 'DELETE')
      .flush(
        { code: 'PAID_CHARGES_WOULD_BE_LOST', message: 'Há cobrança paga.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle(fixture);

    const text = dialogText(fixture);
    expect(text).toContain('histórico');
    expect(text).toContain('continuam existindo no Asaas');
    // Nada reenviado até a confirmação explícita.
    http.expectNone((r) => r.method === 'DELETE');
    expect(byTestId(fixture, 'support-action-error')).toBeNull();

    dialogButton(fixture, 'Excluir mesmo assim').click();
    await settle(fixture);
    const retry = http.expectOne((r) => r.method === 'DELETE');
    expect(retry.request.params.get('acknowledgePaidChargesLoss')).toBe('true');
    retry.flush({ rentalId: RENTAL_ID, chargeRemovals: REMOVALS });
    await settle(fixture);

    expect(byTestId(fixture, 'support-delete-result')).not.toBeNull();
  });

  it('"Não excluir" no diálogo forte não reenvia nada', async () => {
    const { fixture, http } = await mount('EDIT', { status: 'CANCELED' });

    await click(fixture, 'support-delete');
    dialogButton(fixture, 'Excluir').click();
    await settle(fixture);
    http
      .expectOne((r) => r.method === 'DELETE')
      .flush(
        { code: 'PAID_CHARGES_WOULD_BE_LOST', message: 'x' },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle(fixture);
    dialogButton(fixture, 'Não excluir').click();
    await settle(fixture);

    http.expectNone((r) => r.method === 'DELETE');
    expect(el(fixture).querySelector('[role="dialog"]')).toBeNull();
  });

  it('409 OPEN_CHARGES_MUST_BE_CANCELED_FIRST: mostra a mensagem do servidor e oferece Cancelar aluguel', async () => {
    const { fixture, http } = await mount('EDIT');

    await click(fixture, 'support-delete');
    dialogButton(fixture, 'Excluir').click();
    await settle(fixture);
    http
      .expectOne((r) => r.method === 'DELETE')
      .flush(
        {
          code: 'OPEN_CHARGES_MUST_BE_CANCELED_FIRST',
          message: 'Há cobranças abertas no Asaas. Cancele o aluguel primeiro.',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await settle(fixture);

    const banner = byTestId(fixture, 'support-action-error');
    expect(banner?.textContent).toContain('Cancele o aluguel primeiro');
    const offer = byTestId(fixture, 'support-cancel-first');
    expect(offer).not.toBeNull();

    await click(fixture, 'support-cancel-first');
    expect(dialogText(fixture)).toContain('removidas do Asaas');
  });

  it.each([
    ['PENDING_GATEWAY_REMOVAL', true],
    ['OVERDUE_OR_DISPUTED', false],
  ])(
    '409 com reason=%s: mostra o texto do servidor e NÃO oferece cancelar',
    async (reason, hint) => {
      const { fixture, http } = await mount('EDIT');

      await click(fixture, 'support-delete');
      dialogButton(fixture, 'Excluir').click();
      await settle(fixture);
      http
        .expectOne((r) => r.method === 'DELETE')
        .flush(
          { code: 'OPEN_CHARGES_MUST_BE_CANCELED_FIRST', reason, message: 'Texto do servidor.' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle(fixture);

      expect(byTestId(fixture, 'support-action-error')?.textContent).toContain(
        'Texto do servidor.',
      );
      expect(byTestId(fixture, 'support-cancel-first')).toBeNull();
      expect(byTestId(fixture, 'support-action-hint') !== null).toBe(hint);
    },
  );

  it('409 com reason=OPEN_CHARGES oferece cancelar', async () => {
    const { fixture, http } = await mount('EDIT');

    await click(fixture, 'support-delete');
    dialogButton(fixture, 'Excluir').click();
    await settle(fixture);
    http
      .expectOne((r) => r.method === 'DELETE')
      .flush(
        {
          code: 'OPEN_CHARGES_MUST_BE_CANCELED_FIRST',
          reason: 'OPEN_CHARGES',
          message: 'Abertas.',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await settle(fixture);

    expect(byTestId(fixture, 'support-cancel-first')).not.toBeNull();
  });

  it('um 409 de outro motivo não oferece o atalho de cancelar', async () => {
    const { fixture, http } = await mount('EDIT');

    await click(fixture, 'support-delete');
    dialogButton(fixture, 'Excluir').click();
    await settle(fixture);
    http
      .expectOne((r) => r.method === 'DELETE')
      .flush({ message: 'Conflito qualquer.' }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);

    expect(byTestId(fixture, 'support-action-error')?.textContent).toContain('Conflito qualquer');
    expect(byTestId(fixture, 'support-cancel-first')).toBeNull();
  });
});

describe('rental-form na sessão de EDIÇÃO — rotas de escrita sem toast (FEAT-0347)', () => {
  const PREFLIGHT = {
    vehicleId: 'v-1',
    driverId: 'd-1',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
  } as unknown as RentalPreflightRequest;

  function setup(editMode: boolean) {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    localStorage.clear();
    const warning = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([impersonationInterceptor])),
        provideHttpClientTesting(),
        {
          provide: ImpersonationService,
          useValue: { active: () => true, editMode: () => editMode, reconcile: vi.fn() },
        },
        { provide: NotificationService, useValue: { warning } },
      ],
    });
    return {
      warning,
      service: TestBed.inject(RentalService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('preflight, charge-preview e create saem, sem aviso nenhum', () => {
    const { warning, service, http } = setup(true);

    service.preflight(PREFLIGHT).subscribe();
    service.chargePreview({} as never).subscribe();
    service.create({} as never).subscribe();

    http.expectOne(`${BASE}/preflight`).flush({ ok: true, issues: [], warnings: [], limits: {} });
    http.expectOne(`${BASE}/charge-preview`).flush({ charges: [] });
    http.expectOne((r) => r.method === 'POST' && r.url === BASE).flush(RENTAL);
    expect(warning).not.toHaveBeenCalled();
  });

  it('na sessão de LEITURA o mesmo preflight continua barrado, com aviso', () => {
    const { warning, service, http } = setup(false);

    service.preflight(PREFLIGHT).subscribe({ error: () => undefined });

    http.expectNone(`${BASE}/preflight`);
    expect(warning).toHaveBeenCalledTimes(1);
  });
});
