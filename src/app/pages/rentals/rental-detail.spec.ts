import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideZonelessChangeDetection } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RentalDetail } from './rental-detail';
import { environment } from '../../../environments/environment';
import { todayInBusinessTz } from '../../utils/business-clock';
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
      // Os dialogs de encerramento animam backdrop/painel — sem isto qualquer
      // teste que os abra estoura NG05105.
      provideNoopAnimations(),
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

/**
 * Pipeline da prévia da multa por atraso.
 *
 * O `distinctUntilChanged` que existia aqui era uma armadilha: `onOverdueReturnAtChanged`
 * liga `overduePreviewLoading` ANTES de empurrar no Subject, e quem desliga é a
 * resposta. Uma emissão repetida — reabrir o popup no mesmo minuto, ou o botão
 * "Tentar de novo" — era engolida pelo operador, o loading nunca voltava a
 * `false` e o botão de concluir ficava permanentemente desabilitado com
 * "Calculando a multa por atraso…" na tela.
 */
describe('RentalDetail — prévia da multa por atraso', () => {
  const ACTIVE_RENTAL: RentalResponseDto = { ...RESERVED_BASE, status: 'ACTIVE' };

  /** `debounceTime(250)` do pipeline. Timers reais para não brigar com o zoneless. */
  async function afterDebounce(fixture: ComponentFixture<RentalDetail>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function previewRequests(http: HttpTestingController) {
    return http.match((req) => req.url.includes('/overdue-preview'));
  }

  async function openCompleteDialog(fixture: ComponentFixture<RentalDetail>): Promise<void> {
    buttonsLabeled(fixture, 'Concluir aluguel')[0].click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const ON_TIME = {
    chargeId: null,
    overdue: false,
    overdueDays: 0,
    dailyRate: 0,
    multiplierBps: 15_000,
    graceHours: 3,
    amount: 0,
    dueAt: '2026-09-01T03:00:00',
    returnedAt: '2026-08-31T18:00:00',
  };

  it('reabrir o popup no mesmo minuto pede a prévia DE NOVO', async () => {
    const { fixture, http } = await mount(ACTIVE_RENTAL);

    await openCompleteDialog(fixture);
    await afterDebounce(fixture);

    const first = previewRequests(http);
    expect(first.length).toBe(1);
    first[0].flush(ON_TIME);
    fixture.detectChanges();
    await fixture.whenStable();

    // Fecha e reabre sem tocar em data/hora: o instante emitido é o MESMO.
    buttonsLabeled(fixture, 'Cancelar')[0].click();
    fixture.detectChanges();
    await fixture.whenStable();
    await openCompleteDialog(fixture);
    await afterDebounce(fixture);

    // Sem esta segunda requisição o loading fica ligado para sempre: quem o
    // desliga é a resposta, e não haveria resposta nenhuma.
    const second = previewRequests(http);
    expect(second.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Calculando a multa por atraso');

    second[0].flush(ON_TIME);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).not.toContain('Calculando a multa por atraso');
    expect(fixture.nativeElement.textContent).toContain('Devolução dentro do prazo');
    expect(buttonsLabeled(fixture, 'Concluir aluguel')[1].disabled).toBe(false);

    http.verify();
  });
});

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

/**
 * FIX-0120 — "Atrasada" derivada de `dueDate` na LEITURA.
 *
 * `rental_charges.status` só vira `PAST_DUE` pelo webhook `PAYMENT_OVERDUE` do
 * Asaas; aluguel manual fica `PENDING` pra sempre mesmo vencido. O dashboard já
 * contava essas cobranças como atrasadas e só a tela de detalhes chamava de
 * "Pendente" — as duas telas se contradiziam.
 *
 * Cada cobrança rende DOIS chips (a lista mobile `lg:hidden` e a tabela desktop
 * coexistem no DOM), então as contagens abaixo são sempre `2 × cobranças`. É
 * justamente isso que prova que os quatro pontos de renderização foram
 * corrigidos, e não só o desktop.
 */
describe('RentalDetail — atraso derivado de dueDate', () => {
  /** Passado/futuro absolutos: o teste não pode depender do dia em que roda. */
  const LONG_PAST = '2020-01-05';
  const FAR_FUTURE = '2099-12-31';

  function charge(overrides: Partial<RentalChargeDto>): RentalChargeDto {
    return {
      id: 'c-1',
      kind: 'RENTAL_PERIOD',
      amount: 10_000,
      status: 'PENDING',
      provider: 'ASAAS',
      externalId: null,
      checkoutUrl: null,
      paidAt: null,
      dueDate: null,
      periodIndex: 0,
      ...overrides,
    };
  }

  /** Chips são spans cujo texto é EXATAMENTE o rótulo — o badge "N atrasada(s)" não entra. */
  function chipsLabeled(fixture: ComponentFixture<RentalDetail>, label: string): HTMLElement[] {
    const all = Array.from(fixture.nativeElement.querySelectorAll('span')) as HTMLElement[];
    return all.filter((s) => (s.textContent ?? '').trim() === label);
  }

  it('só a PENDING vencida ANTES de hoje vira "Atrasada"', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      charges: [
        charge({ id: 'c-past', periodIndex: 0, dueDate: LONG_PAST }),
        charge({ id: 'c-today', periodIndex: 1, dueDate: todayInBusinessTz() }),
        charge({ id: 'c-future', periodIndex: 2, dueDate: FAR_FUTURE }),
        charge({ id: 'c-null', periodIndex: 3, dueDate: null }),
      ],
    });

    expect(chipsLabeled(fixture, 'Atrasada').length, 'mobile + desktop da vencida').toBe(2);
    expect(chipsLabeled(fixture, 'Pendente').length, 'hoje + futura + sem vencimento').toBe(6);
  });

  /**
   * O chip precisa LER como outro estado, não só dizer outra palavra.
   *
   * O par original era `bg-amber-100 text-amber-800` (Pendente) contra
   * `bg-amber-100 text-amber-700` (Atrasada): mesmo fundo, um tom de diferença,
   * a 10px no card mobile. Estado invisível é estado que não existe pro
   * operador — era o motivo do nó, e passava despercebido.
   *
   * Contraste MEDIDO sobre a paleta real do Tailwind 4.2.1 (nenhum override de
   * rose/amber em `styles.css`), OKLCH → sRGB linear → WCAG 2.x:
   *   - `text-rose-700` sobre `bg-rose-100`  → 5.04:1  PASSA AA (≥ 4.5:1)
   *   - `text-rose-600` sobre `bg-rose-100`  → 3.75:1  REPROVA — descartado
   *   - `text-amber-800` sobre `bg-amber-100` → 6.41:1 PASSA AA (Pendente, mantido)
   * `rose-100/rose-700` é o mesmo par do chip "Atrasada" do financiamento
   * (`financing-detail.ts:273`) e a mesma família do badge "N atrasada(s)".
   *
   * Se alguém reaproximar as duas paletas, este teste cai. Ao mexer nas cores,
   * MEÇA de novo — não confie no nome do tom.
   */
  it('o chip "Atrasada" é distinto do "Pendente" e usa o par rose que passa AA', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      charges: [
        charge({ id: 'c-late', periodIndex: 0, dueDate: LONG_PAST }),
        charge({ id: 'c-open', periodIndex: 1, dueDate: FAR_FUTURE }),
      ],
    });

    const late = chipsLabeled(fixture, 'Atrasada')[0];
    const open = chipsLabeled(fixture, 'Pendente')[0];
    expect(late, 'chip Atrasada renderizado').toBeTruthy();
    expect(open, 'chip Pendente renderizado').toBeTruthy();

    // Guarda de convergência: as duas paletas não podem voltar a ser a mesma.
    expect(late.className).not.toBe(open.className);

    // Par medido em 5.04:1. Trocar exige medir de novo.
    expect(late.className).toContain('bg-rose-100');
    expect(late.className).toContain('text-rose-700');
    expect(late.className, 'Atrasada não pode dividir o fundo com Pendente').not.toContain('amber');

    expect(open.className).toContain('bg-amber-100');
    expect(open.className).toContain('text-amber-800');
  });

  it('status terminal manda no chip, por mais vencida que a data esteja', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      charges: [
        charge({
          id: 'c-paid',
          periodIndex: 0,
          status: 'PAID',
          dueDate: LONG_PAST,
          paidAt: '2020-01-02T10:00:00Z',
        }),
        charge({ id: 'c-canceled', periodIndex: 1, status: 'CANCELED', dueDate: LONG_PAST }),
        charge({ id: 'c-failed', periodIndex: 2, status: 'FAILED', dueDate: LONG_PAST }),
      ],
    });

    expect(chipsLabeled(fixture, 'Atrasada').length).toBe(0);
    expect(chipsLabeled(fixture, 'Pago').length).toBe(2);
    expect(chipsLabeled(fixture, 'Cancelada').length).toBe(2);
    expect(chipsLabeled(fixture, 'Falhou').length).toBe(2);
  });

  it('PAST_DUE que veio do backend continua "Atrasada" mesmo sem dueDate', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      charges: [charge({ id: 'c-webhook', status: 'PAST_DUE', dueDate: null })],
    });

    expect(chipsLabeled(fixture, 'Atrasada').length).toBe(2);
  });

  it('o badge "N atrasada(s)" conta exatamente os chips "Atrasada"', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      charges: [
        charge({ id: 'c-a', periodIndex: 0, dueDate: LONG_PAST }),
        charge({ id: 'c-b', periodIndex: 1, dueDate: '2020-02-05' }),
        charge({ id: 'c-c', periodIndex: 2, dueDate: FAR_FUTURE }),
      ],
    });

    const chips = chipsLabeled(fixture, 'Atrasada').length / 2;
    expect(chips).toBe(2);
    expect(fixture.nativeElement.textContent).toContain(`${chips} atrasada(s)`);
  });

  it('a caução vencida também vira "Atrasada" e NÃO entra no contador do cronograma', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      caucaoAmount: 50_000,
      charges: [
        charge({ id: 'c-caucao', kind: 'CAUCAO', periodIndex: null, dueDate: LONG_PAST }),
        charge({ id: 'c-ok', periodIndex: 0, dueDate: FAR_FUTURE }),
      ],
    });

    expect(chipsLabeled(fixture, 'Atrasada').length, 'card de caução mobile + desktop').toBe(2);
    expect(fixture.nativeElement.textContent).not.toContain('atrasada(s)');
  });
});

/**
 * O botão "Pagar" numa cobrança ATRASADA.
 *
 * `canPayCharge` gateava em `charge.status === 'PENDING'`, então o botão sumia
 * exatamente da cobrança que mais precisa dele. Dois caminhos levam a `PAST_DUE`
 * e nenhum deles pode esconder o link: o PERSISTIDO, gravado pelo webhook
 * `PAYMENT_OVERDUE` do Asaas, e o DERIVADO na leitura pelo backend. A string é
 * a MESMA nos dois — o leitor não distingue, e não precisa.
 *
 * `checkoutUrl` continua sendo gate — sem link não há o que abrir. É por ele
 * que a multa por atraso (`provider='INTERNAL'`, `checkout_url` nulo na origem)
 * fica de fora: ela nunca teve este botão e continua sem, o que NÃO é regressão.
 * O que esta mudança resgata é a cobrança que chegou ao gateway e venceu.
 *
 * Cada cobrança do cronograma renderiza DUAS vezes (card mobile + linha da
 * tabela desktop), daí as contagens sempre pares.
 */
describe('RentalDetail — "Pagar" continua visível na cobrança atrasada', () => {
  const LONG_PAST = '2020-01-05';
  const FAR_FUTURE = '2099-12-31';
  const CHECKOUT = 'https://asaas.example/checkout/abc';

  function payable(overrides: Partial<RentalChargeDto>): RentalChargeDto {
    return {
      id: 'c-1',
      kind: 'RENTAL_PERIOD',
      amount: 10_000,
      status: 'PENDING',
      provider: 'ASAAS',
      externalId: 'pay_1',
      checkoutUrl: CHECKOUT,
      paidAt: null,
      dueDate: null,
      periodIndex: 0,
      ...overrides,
    };
  }

  it('PAST_DUE persistido pelo webhook mantém o botão', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      charges: [payable({ id: 'c-webhook', status: 'PAST_DUE', dueDate: LONG_PAST })],
    });

    expect(buttonsLabeled(fixture, 'Pagar').length, 'mobile + desktop').toBe(2);
  });

  /**
   * Aluguel MANUAL cuja parcela chegou ao gateway: é o caso que o backend cita
   * por nome como o que ficava `PENDING` para sempre (sem webhook, ninguém
   * promovia o status), e o único em que as DUAS saídas coexistem — pagar pelo
   * link do provedor OU dar baixa à mão.
   *
   * Esta é a versão com dentes do teste que estava aqui antes. O anterior
   * montava uma `PENDING` vencida e dizia cobrir "o caso que chega ao usuário":
   * não cobria nada, porque status CRU `PENDING` já passava no gate ANTIGO —
   * era verde contra o bug. A carga que realmente distingue o gate novo do
   * velho é `PAST_DUE` no status cru, que é o que o backend passou a mandar.
   */
  it('aluguel MANUAL com PAST_DUE persistido oferece "Pagar" E "Marcar como paga"', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      automaticCharge: false,
      charges: [payable({ id: 'c-manual', status: 'PAST_DUE', dueDate: LONG_PAST })],
    });

    expect(buttonsLabeled(fixture, 'Pagar').length, 'mobile + desktop').toBe(2);
    expect(
      buttonsLabeled(fixture, 'Marcar como paga').length,
      'a baixa manual não pode desaparecer porque a cobrança atrasou',
    ).toBe(2);
  });

  it('PENDING a vencer continua com o botão — nada regrediu no caso feliz', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      charges: [payable({ id: 'c-open', dueDate: FAR_FUTURE })],
    });

    expect(buttonsLabeled(fixture, 'Pagar').length).toBe(2);
  });

  it('sem checkoutUrl não há botão, nem atrasada', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      charges: [
        payable({ id: 'c-no-link', status: 'PAST_DUE', dueDate: LONG_PAST, checkoutUrl: null }),
      ],
    });

    expect(buttonsLabeled(fixture, 'Pagar').length).toBe(0);
  });

  it('status terminal não ganha botão só por ter link', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      charges: [
        payable({ id: 'c-paid', periodIndex: 0, status: 'PAID', paidAt: '2020-01-02T10:00:00Z' }),
        payable({ id: 'c-canceled', periodIndex: 1, status: 'CANCELED' }),
        payable({ id: 'c-refunded', periodIndex: 2, status: 'REFUNDED' }),
        payable({ id: 'c-released', periodIndex: 3, status: 'RELEASED' }),
        // FAILED tem fluxo próprio ("Tentar novamente"), não "Pagar".
        payable({ id: 'c-failed', periodIndex: 4, status: 'FAILED' }),
      ],
    });

    expect(buttonsLabeled(fixture, 'Pagar').length).toBe(0);
  });

  /**
   * A PROPRIEDADE DE FECHAMENTO, que é o que torna o teste no status CRU seguro.
   *
   * `canPayCharge` lê `charge.status` sem passar por `effectiveChargeStatus`.
   * Isso só é correto porque TODO conjunto de status desta tela que contém
   * `PENDING` também contém `PAST_DUE` — `PAYABLE_STATUSES`,
   * `MARK_PAID_STATUSES`, `OPEN_CAUCAO_STATUSES`, o filtro de `remainingCents`
   * e o de `nextCharge`. Enquanto isso valer, promover `PENDING → PAST_DUE`
   * (por webhook ou por derivação) não pode mudar NADA além do rótulo do chip.
   *
   * É uma coincidência load-bearing: ninguém a declara em lugar nenhum, e a
   * primeira lista futura que aceite `PENDING` e esqueça `PAST_DUE` a quebra em
   * silêncio. Este teste é o alarme. Ele compara as duas montagens pelo que a
   * tela OFERECE, sem espiar campo privado nenhum — se cair, procure a lista
   * nova, não este arquivo.
   *
   * O chip é a exceção esperada e por isso NÃO entra na comparação: mudar o
   * rótulo é justamente o trabalho da derivação.
   */
  it('trocar PENDING por PAST_DUE não muda nenhuma ação nem o valor restante', async () => {
    const shape = { ...RESERVED_BASE, status: 'ACTIVE' as const, automaticCharge: false };
    const charges = (status: RentalChargeDto['status']) => [
      payable({ id: 'c-a', periodIndex: 0, status, dueDate: LONG_PAST }),
      payable({ id: 'c-b', periodIndex: 1, status: 'PAID', paidAt: '2020-01-02T10:00:00Z' }),
    ];

    /** Texto do card de resumo cujo rótulo é `label` (ex.: "Valor restante"). */
    const tile = (fixture: ComponentFixture<RentalDetail>, label: string): string => {
      const ps = Array.from(fixture.nativeElement.querySelectorAll('p')) as HTMLElement[];
      const heading = ps.find((el) => (el.textContent ?? '').trim() === label);
      // NBSP: `Intl` pt-BR separa "R$" do número com U+00A0, não com espaço.
      return (heading?.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim();
    };

    const snapshot = (fixture: ComponentFixture<RentalDetail>) => ({
      pagar: buttonsLabeled(fixture, 'Pagar').length,
      marcar: buttonsLabeled(fixture, 'Marcar como paga').length,
      restante: tile(fixture, 'Valor restante'),
      proximo: tile(fixture, 'Próximo recebimento'),
    });

    const pending = snapshot((await mount({ ...shape, charges: charges('PENDING') })).fixture);
    const pastDue = snapshot((await mount({ ...shape, charges: charges('PAST_DUE') })).fixture);

    // Guarda de vacuidade: sem isto, uma tela que parasse de oferecer as ações
    // compararia dois zeros e dois vazios, e o teste viraria enfeite.
    expect(pending.pagar, 'PENDING oferece Pagar').toBeGreaterThan(0);
    expect(pending.marcar, 'PENDING oferece Marcar como paga').toBeGreaterThan(0);
    expect(pending.restante, 'o card de valor restante existe e tem número').toMatch(/\d/);
    expect(pending.proximo, 'o card de próximo recebimento existe e tem número').toMatch(/\d/);

    expect(pastDue).toEqual(pending);
  });
});
