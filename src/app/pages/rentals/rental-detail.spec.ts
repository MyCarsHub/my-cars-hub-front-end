import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RentalDetail } from './rental-detail';
import { environment } from '../../../environments/environment';
import type { RentalChargeDto, RentalResponseDto } from '../../types/rental.types';

const BASE = `${environment.apiUrl}/rentals`;
const RENTAL_ID = 'r-1';

const RESERVED_BASE: RentalResponseDto = {
  id: RENTAL_ID,
  vehicleId: 'v-1',
  driverId: 'd-1',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  periodRate: 10_000,
  totalAmount: 300_000,
  caucaoAmount: 0,
  caucaoPaid: false,
  status: 'RESERVED',
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

const activatedRouteStub = {
  snapshot: {
    paramMap: { get: (k: string) => (k === 'id' ? RENTAL_ID : null) },
    queryParamMap: { get: () => null },
  },
};

/**
 * Drena veículo/motorista/histórico e o snapshot do checklist (documentos,
 * fotos, assinatura). Todos são tolerantes a erro na tela; só o SHAPE importa —
 * as listas precisam ser arrays porque o service faz `.some()` nelas.
 */
function flushAncillary(http: HttpTestingController): void {
  for (const req of http.match(() => true)) {
    if (req.request.method !== 'GET') continue;
    req.flush(req.request.url.includes('signature') ? null : []);
  }
}

function buttonsLabeled(fixture: ComponentFixture<RentalDetail>, label: string): HTMLButtonElement[] {
  const all = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
  return all.filter((b) => (b.textContent ?? '').includes(label));
}

async function mount(rental: RentalResponseDto): Promise<{
  fixture: ComponentFixture<RentalDetail>;
  http: HttpTestingController;
}> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [RentalDetail],
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: activatedRouteStub },
    ],
  });

  const fixture = TestBed.createComponent(RentalDetail);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  await fixture.whenStable();

  http.expectOne(`${BASE}/${RENTAL_ID}`).flush(rental);
  fixture.detectChanges();
  await fixture.whenStable();
  flushAncillary(http);
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, http };
}

describe('RentalDetail — ativação, cobrança AUTOMÁTICA (RESERVED)', () => {
  let fixture: ComponentFixture<RentalDetail>;
  let http: HttpTestingController;
  let scrollSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    ({ fixture, http } = await mount({ ...RESERVED_BASE, automaticCharge: true }));
  });

  afterEach(() => {
    scrollSpy.mockRestore();
  });

  it('renderiza os dois "Marcar como ativo" (checklist + barra de ações)', () => {
    expect(buttonsLabeled(fixture, 'Marcar como ativo').length).toBe(2);
  });

  /** Sem trava de pagamento no backend, o sucesso é o caminho esperado. */
  it('o CTA marca o aluguel como ativo e sai da barra de ações', async () => {
    buttonsLabeled(fixture, 'Marcar como ativo')[1].click();
    fixture.detectChanges();
    await fixture.whenStable();

    const req = http.expectOne(`${BASE}/${RENTAL_ID}/activate`);
    expect(req.request.method).toBe('POST');
    req.flush({ ...RESERVED_BASE, status: 'ACTIVE' });
    fixture.detectChanges();
    await fixture.whenStable();
    flushAncillary(http);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(buttonsLabeled(fixture, 'Marcar como ativo').length).toBe(0);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('cada "Marcar como ativo" dispara POST /rentals/{id}/activate', async () => {
    const buttons = buttonsLabeled(fixture, 'Marcar como ativo');

    for (const [i, button] of buttons.entries()) {
      button.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const pending = http.match(`${BASE}/${RENTAL_ID}/activate`);
      expect(pending.length, `botão #${i + 1} não disparou o POST`).toBe(1);
      expect(pending[0].request.method).toBe('POST');

      pending[0].flush(
        { message: 'Você não tem permissão para ativar este aluguel.' },
        { status: 403, statusText: 'Forbidden' },
      );
      fixture.detectChanges();
      await fixture.whenStable();
    }
  });

  /**
   * Regressão do "botão morto": `messageFor()` reivindica o erro e desarma o
   * toast do safety net, então sem trazer o banner (que mora no topo) pro campo
   * de visão a tela não mudava nada perto do CTA e o clique parecia não fazer
   * nada. Vale pros erros que sobraram — 400, 402, 403, 404.
   */
  it('após erro do backend, mostra o banner e move o foco pra ele', async () => {
    buttonsLabeled(fixture, 'Marcar como ativo')[1].click();
    fixture.detectChanges();
    await fixture.whenStable();

    http
      .expectOne(`${BASE}/${RENTAL_ID}/activate`)
      .flush(
        { message: 'Você não tem permissão para ativar este aluguel.' },
        { status: 403, statusText: 'Forbidden' },
      );
    fixture.detectChanges();
    await fixture.whenStable();

    const banner: HTMLElement | null = fixture.nativeElement.querySelector('[role="alert"]');
    expect(banner, 'banner de erro não renderizou').toBeTruthy();
    expect(banner?.textContent).toContain('Você não tem permissão para ativar este aluguel.');

    const focusTarget = fixture.nativeElement.querySelector('[tabindex="-1"]');
    expect(document.activeElement).toBe(focusTarget);
    // JSDOM não faz layout: o rect é todo zero, logo o banner conta como fora
    // do viewport e o gate de visibilidade deixa passar.
    expect(scrollSpy).toHaveBeenCalled();
  });

  /**
   * Gate de visibilidade: o botão de ativar do checklist fica a menos de uma
   * tela do banner. Com o banner já visível, rolar mexia a página à toa e
   * tirava o foco do botão que o usuário quer clicar de novo.
   *
   * JSDOM não faz layout, então o rect é forjado: `top: -10 / bottom: 5` é um
   * banner encostado na borda de cima — parcialmente visível para qualquer
   * `clientHeight` >= 0, o que mantém o teste imune ao valor que o JSDOM
   * devolve.
   */
  it('não rola nem foca quando o banner já está no viewport', async () => {
    const rectSpy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, -10, 320, 15));
    try {
      const cta = buttonsLabeled(fixture, 'Marcar como ativo')[1];
      cta.focus();
      scrollSpy.mockClear();

      cta.click();
      fixture.detectChanges();
      await fixture.whenStable();

      http
        .expectOne(`${BASE}/${RENTAL_ID}/activate`)
        .flush(
          { message: 'Você não tem permissão para ativar este aluguel.' },
          { status: 403, statusText: 'Forbidden' },
        );
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
      expect(scrollSpy, 'rolou com o banner já visível').not.toHaveBeenCalled();
      expect(document.activeElement, 'roubou o foco do CTA com o banner já visível').toBe(cta);
    } finally {
      rectSpy.mockRestore();
    }
  });

  /**
   * A trava de ativação por pagamento saiu do backend; com ela sai o aviso
   * âmbar ("Sob sua responsabilidade…") e a variante "Ativar mesmo assim".
   * Nada de alarme falso: cobrança automática só significa que o webhook
   * costuma ativar sozinho, não que ativar à mão seja um contorno.
   */
  it('não mostra aviso de exceção nem descreve os botões, mesmo com cobrança automática', () => {
    expect(fixture.nativeElement.querySelector('#activate-override-hint')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Sob sua responsabilidade');
    expect(buttonsLabeled(fixture, 'Ativar mesmo assim').length).toBe(0);

    for (const button of buttonsLabeled(fixture, 'Marcar como ativo')) {
      expect(button.getAttribute('aria-describedby')).toBeNull();
      expect(button.getAttribute('title'), 'tooltip voltou a ser portador de aviso').toBeNull();
    }
  });

  it('os dois botões usam o token azul preenchido do fluxo de aluguel', () => {
    for (const button of buttonsLabeled(fixture, 'Marcar como ativo')) {
      expect(button.className).toContain('bg-rental-action-600');
      expect(button.className).not.toMatch(/primary|amber/);
    }
  });
});

/**
 * Contraparte do teste acima: `actionError` é o banner COMPARTILHADO por 9
 * operações da tela, mas o scroll + foco só valem pra ativação (o CTA fica
 * telas abaixo do banner). Nas outras operações — aqui, regerar uma cobrança
 * FAILED no cronograma — sequestrar o scroll tirava o usuário do lugar da
 * lista e obrigava o teclado a retabular a página inteira.
 */
describe('RentalDetail — erro de operação que NÃO é ativação', () => {
  const FAILED_CHARGE: RentalChargeDto = {
    id: 'c-1',
    kind: 'RENTAL_PERIOD',
    amount: 10_000,
    status: 'FAILED',
    provider: 'ASAAS',
    externalId: 'pay_1',
    checkoutUrl: null,
    paidAt: null,
    dueDate: '2026-08-10',
    periodIndex: 0,
  };

  let fixture: ComponentFixture<RentalDetail>;
  let http: HttpTestingController;
  let scrollSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    ({ fixture, http } = await mount({
      ...RESERVED_BASE,
      automaticCharge: true,
      charges: [FAILED_CHARGE],
    }));
  });

  afterEach(() => {
    scrollSpy.mockRestore();
  });

  it('erro ao regerar cobrança mostra o banner sem rolar a página nem mover o foco', async () => {
    const [regerar] = buttonsLabeled(fixture, 'Regerar');
    expect(regerar, 'botão "Regerar" não renderizou').toBeTruthy();

    regerar.focus();
    expect(document.activeElement, 'pré-condição: foco no botão').toBe(regerar);
    scrollSpy.mockClear();

    regerar.click();
    fixture.detectChanges();
    await fixture.whenStable();

    http
      .expectOne(`${BASE}/${RENTAL_ID}/charges/${FAILED_CHARGE.id}/retry`)
      .flush({ message: 'Provedor indisponível.' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    await fixture.whenStable();

    const banner: HTMLElement | null = fixture.nativeElement.querySelector('[role="alert"]');
    expect(banner, 'banner de erro não renderizou').toBeTruthy();
    expect(banner?.textContent).toContain('Provedor indisponível.');

    expect(scrollSpy, 'a página rolou numa operação que não é ativação').not.toHaveBeenCalled();
    expect(document.activeElement, 'o foco saiu do botão que o usuário quer reusar').toBe(regerar);
  });
});

describe('RentalDetail — ativação, cobrança MANUAL (RESERVED)', () => {
  let fixture: ComponentFixture<RentalDetail>;

  beforeEach(async () => {
    ({ fixture } = await mount({ ...RESERVED_BASE, automaticCharge: false }));
  });

  /** Mesmo rótulo do fluxo automático: sem trava, não há dois cenários. */
  it('checklist e CTA usam "Marcar como ativo", azul preenchido', () => {
    const buttons = buttonsLabeled(fixture, 'Marcar como ativo');
    expect(buttons.length, 'esperado checklist + barra de ações').toBe(2);

    for (const button of buttons) {
      expect(button.className).toContain('bg-rental-action-600');
      expect(button.className).not.toMatch(/primary|amber/);
    }
  });

  it('não mostra o aviso de exceção nem descreve os botões', () => {
    expect(fixture.nativeElement.querySelector('#activate-override-hint')).toBeNull();

    for (const button of buttonsLabeled(fixture, 'Marcar como ativo')) {
      expect(button.getAttribute('aria-describedby')).toBeNull();
    }
  });
});
