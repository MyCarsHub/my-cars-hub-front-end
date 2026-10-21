import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideZonelessChangeDetection } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RentalDetail } from './rental-detail';
import { NotificationService } from '../../services/notification.service';
import { RentalService } from './rental.service';
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
/** Os GETs que o último `flushAncillary` respondeu — para afirmar QUAL endpoint a tela chamou. */
let lastAncillaryUrls: string[] = [];

function flushAncillary(http: HttpTestingController): void {
  lastAncillaryUrls = [];
  for (const req of http.match(() => true)) {
    if (req.request.method !== 'GET') continue;
    lastAncillaryUrls.push(req.request.url);
    req.flush(req.request.url.includes('signature') ? null : []);
  }
}

function buttonsLabeled(fixture: ComponentFixture<RentalDetail>, label: string): HTMLButtonElement[] {
  const all = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
  const found = all.filter((b) => (b.textContent ?? '').includes(label));
  // As ações de cobrança vivem em menus de três pontos (itens só existem com o
  // menu aberto): abre um por vez, coleta os itens e fecha.
  const triggers = all.filter((b) => b.getAttribute('aria-haspopup') === 'menu');
  for (const trigger of triggers) {
    trigger.click();
    fixture.detectChanges();
    const items = Array.from(
      fixture.nativeElement.querySelectorAll('[role="menu"] [role="menuitem"]'),
    ) as HTMLButtonElement[];
    found.push(...items.filter((b) => (b.textContent ?? '').includes(label)));
    trigger.click();
    fixture.detectChanges();
  }
  return found;
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

  it('erro ao regerar cobrança mostra o banner sem rolar a página nem levar o foco ao banner', async () => {
    const trigger = fixture.nativeElement.querySelector(
      '[aria-haspopup="menu"]',
    ) as HTMLButtonElement | null;
    expect(trigger, 'menu de ações da cobrança não renderizou').toBeTruthy();
    trigger?.click();
    fixture.detectChanges();
    const regerar = (
      Array.from(fixture.nativeElement.querySelectorAll('[role="menuitem"]')) as HTMLButtonElement[]
    ).find((b) => (b.textContent ?? '').includes('Regerar'));
    expect(regerar, 'item "Regerar" não renderizou').toBeTruthy();
    scrollSpy.mockClear();

    regerar?.click();
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
    expect(document.activeElement, 'o banner roubou o foco').not.toBe(banner);
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
  it('aluguel MANUAL com PAST_DUE persistido (no gateway) oferece "Pagar" e NÃO a baixa manual (FIX-0727)', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      automaticCharge: false,
      charges: [payable({ id: 'c-manual', status: 'PAST_DUE', dueDate: LONG_PAST })],
    });

    expect(buttonsLabeled(fixture, 'Pagar').length, 'mobile + desktop').toBe(2);
    expect(
      buttonsLabeled(fixture, 'Marcar como paga').length,
      'cobrança com id/link no gateway não expõe baixa manual',
    ).toBe(0);
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
    expect(pending.marcar, 'cobrança do gateway não oferece baixa manual').toBe(0);
    expect(pending.restante, 'o card de valor restante existe e tem número').toMatch(/\d/);
    expect(pending.proximo, 'o card de próximo recebimento existe e tem número').toMatch(/\d/);

    expect(pastDue).toEqual(pending);
  });
});

/**
 * `DISPUTED` — a oitava cobrança do enum do backend, ausente da união do
 * frontend até FIX-0190.
 *
 * O modo de falha NÃO era um rótulo feio: `CHARGE_STATUS_META` é indexado por
 * `Record<ChargeStatus, …>`, então um status fora da união devolvia
 * `undefined`, e o template lê `.chip`/`.label` desse retorno. A exceção
 * estoura DENTRO da detecção de mudanças do `RentalDetail`, que aborta a
 * renderização da view inteira — a "tela branca" relatada em FIX-0122, não uma
 * linha com o chip vazio. Por isso o teste é de COMPONENTE: um teste de unidade
 * em `chargeStatusInfo` provaria o `undefined`, mas não que a tela cai.
 *
 * Contraste MEDIDO sobre a paleta real do Tailwind 4.2.1 (nenhum override de
 * `--color-purple-*` em `styles.css`), OKLCH → sRGB → WCAG 2.x:
 *   - `text-purple-700` sobre `bg-purple-100` → 5.99:1  PASSA AA (≥ 4.5:1)
 * O par é o mesmo já usado nos chips do admin (`admin-users.ts:240`), então não
 * introduz família nova. Roxo e não laranja de propósito: `bg-orange-100` é
 * vizinho de `bg-amber-100` (Pendente) e ainda cai na família do Signal Orange
 * da marca — as duas armadilhas que o chip "Atrasada" já pagou uma vez.
 *
 * Ao mexer na cor, MEÇA de novo — não confie no nome do tom.
 */
describe('RentalDetail — cobrança contestada (DISPUTED)', () => {
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

  function chipsLabeled(fixture: ComponentFixture<RentalDetail>, label: string): HTMLElement[] {
    const all = Array.from(fixture.nativeElement.querySelectorAll('span')) as HTMLElement[];
    return all.filter((s) => (s.textContent ?? '').trim() === label);
  }

  it('renderiza a tela e o chip "Contestada" em vez de quebrar a detecção', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      charges: [charge({ id: 'c-disputed', periodIndex: 0, status: 'DISPUTED' })],
    });

    // Guarda anti-"tela branca": antes do fix o `undefined` estourava aqui e a
    // view não chegava a existir. Um seletor qualquer do corpo já prova isso.
    const rendered = fixture.nativeElement.querySelectorAll('span').length;
    expect(rendered, 'a view renderizou').toBeGreaterThan(0);

    // Mobile + desktop renderizam o mesmo chip — o template tem os dois ramos.
    expect(chipsLabeled(fixture, 'Contestada').length, 'chip em mobile e desktop').toBe(2);
  });

  it('não deixa vazar rótulo vazio nem "undefined" para a tela', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      charges: [charge({ id: 'c-disputed', periodIndex: 0, status: 'DISPUTED' })],
    });

    // Escopo no CHIP, não na página: o harness responde `[]` ao GET de veículo
    // (`flushAncillary`), então o cabeçalho imprime "Veículo — undefined
    // undefined" por conta do stub. Asserir sobre a página inteira testaria o
    // mock, não a cobrança.
    const chips = chipsLabeled(fixture, 'Contestada');
    expect(chips.length, 'chip em mobile e desktop').toBe(2);

    for (const chip of chips) {
      expect(chip.textContent?.trim()).toBe('Contestada');
      expect(chip.className, 'classe do chip sem undefined').not.toContain('undefined');
      expect(chip.className.trim(), 'chip não pode vir vazio').not.toBe('');
    }
  });

  it('usa o par roxo medido em 5.99:1 e não divide a paleta com "Pendente"', async () => {
    const { fixture } = await mount({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      charges: [
        charge({ id: 'c-disputed', periodIndex: 0, status: 'DISPUTED' }),
        charge({ id: 'c-open', periodIndex: 1, status: 'PENDING' }),
      ],
    });

    const disputed = chipsLabeled(fixture, 'Contestada')[0];
    const pending = chipsLabeled(fixture, 'Pendente')[0];
    expect(disputed, 'chip Contestada renderizado').toBeTruthy();
    expect(pending, 'chip Pendente renderizado').toBeTruthy();

    // Par medido em 5.99:1. Trocar exige medir de novo.
    expect(disputed.className).toContain('bg-purple-100');
    expect(disputed.className).toContain('text-purple-700');
    expect(
      disputed.className,
      'Contestada não pode dividir o fundo com Pendente',
    ).not.toContain('amber');
    expect(disputed.className).not.toBe(pending.className);
  });
});

/**
 * Caução "recebida por fora" (`caucaoPaid`) com cobrança perdida no Asaas.
 *
 * Uma cobrança de caução criada antes da correção no backend pode continuar
 * aberta mesmo com o aluguel marcado como recebido. O card não pode oferecer
 * ação de pagamento sobre ela e precisa dizer a verdade ao dono. Cada linha é
 * renderizada DUAS vezes (mobile + desktop), daí as contagens pares.
 */
describe('RentalDetail — caução recebida por fora', () => {
  const NOTE = 'Caução marcada como recebida — nenhuma cobrança será feita no Asaas.';
  const BANNER =
    'Há uma cobrança de caução aberta no Asaas. Salve o aluguel em Editar para cancelá-la.';

  function caucaoCharge(overrides: Partial<RentalChargeDto> = {}): RentalChargeDto {
    return {
      id: 'c-caucao',
      kind: 'CAUCAO',
      amount: 50_000,
      status: 'PENDING',
      provider: 'ASAAS',
      externalId: 'pay_caucao',
      checkoutUrl: 'https://asaas.example/checkout/caucao',
      paidAt: null,
      dueDate: '2099-12-31',
      periodIndex: null,
      ...overrides,
    };
  }

  const MANUAL = { ...RESERVED_BASE, status: 'ACTIVE' as const, automaticCharge: false, caucaoAmount: 50_000 };

  function chips(fixture: ComponentFixture<RentalDetail>, label: string): HTMLElement[] {
    const all = Array.from(fixture.nativeElement.querySelectorAll('span')) as HTMLElement[];
    return all.filter((s) => (s.textContent ?? '').trim() === label);
  }

  function banner(fixture: ComponentFixture<RentalDetail>): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="caucao-open-charge-banner"]');
  }

  function note(fixture: ComponentFixture<RentalDetail>): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="caucao-received-note"]');
  }

  function links(fixture: ComponentFixture<RentalDetail>): HTMLAnchorElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('a[href*="asaas"]'));
  }

  it('caucaoPaid sem cobrança: chip verde "Recebida por fora", nota, sem ação nem banner', async () => {
    const { fixture } = await mount({ ...MANUAL, caucaoPaid: true, charges: [] });

    const received = chips(fixture, 'Recebida por fora');
    expect(received.length, 'mobile + desktop').toBe(2);
    expect(received[0].className).toContain('bg-emerald-100');
    expect(received[0].className).toContain('text-emerald-800');
    expect(chips(fixture, 'Não gerada').length).toBe(0);
    expect(note(fixture)?.textContent).toContain(NOTE);
    expect(banner(fixture)).toBeNull();
    expect(buttonsLabeled(fixture, 'Marcar como paga').length).toBe(0);
    expect(links(fixture).length).toBe(0);
  });

  it.each(['PENDING', 'PAST_DUE', 'FAILED'] as const)(
    'caucaoPaid com cobrança %s aberta: chip, sem ação de pagar, banner azul',
    async (status) => {
      const { fixture } = await mount({
        ...MANUAL,
        caucaoPaid: true,
        charges: [caucaoCharge({ status })],
      });

      expect(chips(fixture, 'Recebida por fora').length, 'mobile + desktop').toBe(2);
      expect(chips(fixture, 'Pendente').length + chips(fixture, 'Atrasada').length).toBe(0);
      expect(buttonsLabeled(fixture, 'Marcar como paga').length, 'nenhuma ação de pagamento').toBe(0);
      expect(links(fixture).length, 'nenhum link de pagamento').toBe(0);
      expect(fixture.nativeElement.innerHTML).not.toContain('asaas.example');
      expect(note(fixture)?.textContent).toContain(NOTE);
      const b = banner(fixture);
      expect(b, 'banner de cobrança aberta').toBeTruthy();
      expect(b!.textContent).toContain(BANNER);
      expect(b!.className).toContain('bg-blue-50');
    },
  );

  it('caucaoPaid com cobrança PAID: exibida como hoje, sem banner nem "Recebida por fora"', async () => {
    const { fixture } = await mount({
      ...MANUAL,
      caucaoPaid: true,
      charges: [caucaoCharge({ status: 'PAID', paidAt: '2026-08-02T10:00:00Z' })],
    });

    expect(chips(fixture, 'Pago').length, 'mobile + desktop').toBe(2);
    expect(chips(fixture, 'Recebida por fora').length).toBe(0);
    expect(banner(fixture)).toBeNull();
    expect(note(fixture)).toBeNull();
  });

  it('caucaoPaid=false (caracterização): cobrança aberta segue com seu chip (sem baixa: tem id no gateway)', async () => {
    const { fixture } = await mount({
      ...MANUAL,
      caucaoPaid: false,
      charges: [caucaoCharge({ status: 'PENDING' })],
    });

    expect(chips(fixture, 'Pendente').length, 'mobile + desktop').toBe(2);
    expect(chips(fixture, 'Recebida por fora').length).toBe(0);
    expect(buttonsLabeled(fixture, 'Marcar como paga').length).toBe(0);
    expect(banner(fixture)).toBeNull();
    expect(note(fixture)).toBeNull();
  });

  it('caucaoPaid=false sem cobrança (caracterização): "Não gerada" e a dica de marcar como paga', async () => {
    const { fixture } = await mount({ ...MANUAL, caucaoPaid: false, charges: [] });

    expect(chips(fixture, 'Não gerada').length).toBe(2);
    expect(chips(fixture, 'Recebida por fora').length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Marque como paga quando receber');
    expect(banner(fixture)).toBeNull();
  });
});

/**
 * O MOTORISTA no detalhe do aluguel. `GET /v1/vehicles/{id}` e `GET /v1/drivers/{id}` sao
 * 403 para ele: a tela os chamava mesmo assim, ganhava dois erros e mostrava "—" nos dois
 * campos. Agora nao os chama, e placa/modelo/nome vem da linha da LISTA, que o servico
 * ainda guarda quando ele chegou por ela.
 */
describe('RentalDetail — motorista', () => {
  const ROW = {
    id: RENTAL_ID,
    vehicleId: 'v-1',
    driverId: 'd-1',
    vehiclePlate: 'ABC1D23',
    vehicleBrand: 'Fiat',
    vehicleModel: 'Argo',
    driverName: 'Fulano de Tal',
  };

  function signInAs(role: string): void {
    const payload = { role, exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    sessionStorage.setItem('token', `header.${b64}.signature`);
  }

  async function mountAs(
    role: string,
    seed: typeof ROW | null,
  ): Promise<{ fixture: ComponentFixture<RentalDetail>; cadastroCalls: string[] }> {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    signInAs(role);
    TestBed.configureTestingModule({
      imports: [RentalDetail],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: activatedRouteStub },
      ],
    });
    if (seed) {
      const service = TestBed.inject(RentalService) as unknown as {
        _items: { set(value: unknown[]): void };
      };
      service._items.set([seed]);
    }

    const fixture = TestBed.createComponent(RentalDetail);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await fixture.whenStable();

    http.expectOne(`${BASE}/${RENTAL_ID}`).flush({ ...RESERVED_BASE, status: 'ACTIVE' });
    fixture.detectChanges();
    await fixture.whenStable();

    const cadastroCalls = http
      .match((req) => /\/(vehicles|drivers)\//.test(req.url))
      .map((req) => req.request.url);
    flushAncillary(http);
    fixture.detectChanges();
    await fixture.whenStable();

    return { fixture, cadastroCalls };
  }

  afterEach(() => sessionStorage.clear());

  it('NAO consulta o cadastro de veiculo nem o de motorista', async () => {
    const { cadastroCalls } = await mountAs('DRIVER', ROW);

    expect(cadastroCalls).toEqual([]);
  });

  it('mostra placa, modelo e motorista da linha da lista', async () => {
    const { fixture } = await mountAs('DRIVER', ROW);
    const text = ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');

    expect(text).toContain('ABC-1D23');
    expect(text).toContain('Fiat Argo');
    expect(text).toContain('Fulano de Tal');
  });

  it('aberto por link direto, sem a lista carregada, degrada para "—" sem chamar o cadastro', async () => {
    const { fixture, cadastroCalls } = await mountAs('DRIVER', null);

    expect(cadastroCalls).toEqual([]);
    expect(((fixture.nativeElement as HTMLElement).textContent ?? '')).toContain('—');
  });

  it('o dono continua consultando os dois cadastros', async () => {
    const { cadastroCalls } = await mountAs('OWNER', null);

    expect(cadastroCalls.some((url) => url.includes('/vehicles/'))).toBe(true);
    expect(cadastroCalls.some((url) => url.includes('/drivers/'))).toBe(true);
  });
});

/**
 * Emissão no gateway, reconciliação e baixa manual — as três coisas que o dono
 * precisa para confiar no cronograma de um aluguel de cobrança automática.
 */
describe('RentalDetail — emissão, reconciliação e baixa manual', () => {
  const FUTURE = '2099-12-31';

  function charge(overrides: Partial<RentalChargeDto>): RentalChargeDto {
    return {
      id: 'c-1',
      kind: 'RENTAL_PERIOD',
      amount: 10_000,
      status: 'PENDING',
      provider: 'ASAAS',
      externalId: 'pay_1',
      checkoutUrl: null,
      paidAt: null,
      dueDate: FUTURE,
      periodIndex: 0,
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

  async function mountDetail(
    rental: RentalResponseDto,
    options: { role?: string; navState?: Record<string, unknown> } = {},
  ): Promise<{ fixture: ComponentFixture<RentalDetail>; http: HttpTestingController }> {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    signInAs(options.role ?? 'OWNER');
    TestBed.configureTestingModule({
      imports: [RentalDetail],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: activatedRouteStub },
      ],
    });
    if (options.navState) {
      // O formulário entrega o resultado da emissão no `state` da navegação em curso.
      vi.spyOn(TestBed.inject(Router), 'currentNavigation').mockReturnValue({
        extras: { state: options.navState },
      } as never);
    }
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

  async function settle(fixture: ComponentFixture<RentalDetail>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(fixture: ComponentFixture<RentalDetail>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  describe('FIX-0755: motivo da falha na linha FAILED do cronograma', () => {
    const REASON = 'A multa fixa precisa ser menor que o valor da cobrança.';
    const RENTAL_WITH_FAILURE: RentalResponseDto = {
      ...RESERVED_BASE,
      status: 'ACTIVE',
      automaticCharge: true,
      charges: [
        charge({ id: 'c-failed', status: 'FAILED', periodIndex: 0, failureCode: 'FINE', failureReason: REASON }),
        charge({ id: 'c-pending', status: 'PENDING', periodIndex: 1, failureReason: 'não deve aparecer' }),
      ],
    };

    function reasons(fixture: ComponentFixture<RentalDetail>): HTMLElement[] {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          '[data-testid="charge-failure-reason"]',
        ),
      );
    }

    it('mostra o failureReason legível junto da cobrança FAILED (cartão e tabela)', async () => {
      const { fixture } = await mountDetail(RENTAL_WITH_FAILURE);
      const found = reasons(fixture);
      // Um no cartão do celular e um na tabela do desktop (um dos dois fica oculto por CSS).
      expect(found.length).toBe(2);
      for (const node of found) expect(node.textContent?.trim()).toBe(REASON);
      expect(text(fixture)).toContain('Falhou');
    });

    it('no celular o texto é limitado a poucas linhas, com o texto inteiro no title', async () => {
      const { fixture } = await mountDetail(RENTAL_WITH_FAILURE);
      const mobile = reasons(fixture).find((n) => n.className.includes('line-clamp-3'));
      expect(mobile).toBeDefined();
      expect(mobile?.getAttribute('title')).toBe(REASON);
      expect(mobile?.className).toContain('text-base');
    });

    it('cobrança que não está FAILED não mostra motivo, mesmo que o campo venha preenchido', async () => {
      const { fixture } = await mountDetail({
        ...RENTAL_WITH_FAILURE,
        charges: [charge({ id: 'c-pending', status: 'PENDING', failureReason: 'não deve aparecer' })],
      });
      expect(reasons(fixture).length).toBe(0);
      expect(text(fixture)).not.toContain('não deve aparecer');
    });

    it('FAILED antiga, sem failureReason, não ganha linha vazia', async () => {
      const { fixture } = await mountDetail({
        ...RENTAL_WITH_FAILURE,
        charges: [charge({ id: 'c-old', status: 'FAILED' })],
      });
      expect(reasons(fixture).length).toBe(0);
    });
  });

  describe('aviso de cobranças que não foram criadas (chargeSync)', () => {
    const ACTIVE_AUTO: RentalResponseDto = {
      ...RESERVED_BASE,
      status: 'ACTIVE',
      automaticCharge: true,
      charges: [charge({ id: 'c-failed', status: 'FAILED', externalId: null })],
    };

    function warning(fixture: ComponentFixture<RentalDetail>): HTMLElement | null {
      return (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="charge-sync-warning"]',
      );
    }

    it('com failed > 0: diz quantas, que o sistema tenta de novo e aponta o Regerar', async () => {
      const { fixture } = await mountDetail(ACTIVE_AUTO, {
        navState: { chargeSync: { requested: 4, created: 2, failed: 2, local: 0 } },
      });

      const banner = warning(fixture);
      expect(banner).not.toBeNull();
      const copy = (banner?.textContent ?? '').replace(/\s+/g, ' ');
      expect(copy).toContain('2 cobranças não puderam ser criadas no Asaas.');
      expect(copy).toContain('o sistema tenta criá-las de novo automaticamente');
      expect(copy).toContain('Regerar');
      expect(banner?.querySelector('[role="alert"]')).not.toBeNull();
      // O caminho existente continua lá: a linha FAILED tem o botão.
      expect(buttonsLabeled(fixture, 'Regerar').length).toBeGreaterThan(0);
    });

    it('no singular quando falhou uma só', async () => {
      const { fixture } = await mountDetail(ACTIVE_AUTO, {
        navState: { chargeSync: { requested: 3, created: 2, failed: 1, local: 0 } },
      });
      expect(text(fixture)).toContain('1 cobrança não pôde ser criada no Asaas.');
    });

    it('FIX-0755: o banner cita o motivo quando todas as cobranças falharam pelo mesmo motivo', async () => {
      const reason = 'O CPF/CNPJ do motorista é inválido para o Asaas.';
      const rental: RentalResponseDto = {
        ...ACTIVE_AUTO,
        charges: [
          charge({ id: 'c-a', status: 'FAILED', periodIndex: 0, failureCode: 'INVALID_CUSTOMER', failureReason: reason }),
          charge({ id: 'c-b', status: 'FAILED', periodIndex: 1, failureCode: 'INVALID_CUSTOMER', failureReason: reason }),
        ],
      };
      const { fixture } = await mountDetail(rental, {
        navState: { chargeSync: { requested: 2, created: 0, failed: 2, local: 0 } },
      });

      const copy = (warning(fixture)?.textContent ?? '').replace(/\s+/g, ' ');
      expect(copy).toContain('2 cobranças não puderam ser criadas no Asaas.');
      expect(copy).toContain(`Motivo: ${reason}`);
      // Motivo repetido aparece UMA vez no banner.
      expect(copy.split(reason).length - 1).toBe(1);
    });

    it('FIX-0755: motivos diferentes aparecem todos, sem repetir', async () => {
      const rental: RentalResponseDto = {
        ...ACTIVE_AUTO,
        charges: [
          charge({ id: 'c-a', status: 'FAILED', periodIndex: 0, failureReason: 'Juros acima do máximo.' }),
          charge({ id: 'c-b', status: 'FAILED', periodIndex: 1, failureReason: 'Multa acima do máximo.' }),
          charge({ id: 'c-c', status: 'FAILED', periodIndex: 2, failureReason: 'Juros acima do máximo.' }),
        ],
      };
      const { fixture } = await mountDetail(rental, {
        navState: { chargeSync: { requested: 3, created: 0, failed: 3, local: 0 } },
      });

      const copy = (warning(fixture)?.textContent ?? '').replace(/\s+/g, ' ');
      expect(copy).toContain('Motivos: Juros acima do máximo. | Multa acima do máximo.');
    });

    it('FIX-0755: sem failureReason (cobrança antiga) o banner segue como antes, sem "Motivo"', async () => {
      const { fixture } = await mountDetail(ACTIVE_AUTO, {
        navState: { chargeSync: { requested: 2, created: 1, failed: 1, local: 0 } },
      });
      expect(text(fixture)).not.toContain('Motivo');
    });

    it('sem falha (failed = 0) o fluxo é o de sempre: nenhum aviso', async () => {
      const { fixture } = await mountDetail(ACTIVE_AUTO, {
        navState: { chargeSync: { requested: 3, created: 3, failed: 0, local: 0 } },
      });
      expect(warning(fixture)).toBeNull();
    });

    it('sem state de navegação (abrir direto, recarregar) não há aviso', async () => {
      const { fixture } = await mountDetail(ACTIVE_AUTO);
      expect(warning(fixture)).toBeNull();
    });

    it('state malformado é ignorado em vez de quebrar a tela', async () => {
      const { fixture } = await mountDetail(ACTIVE_AUTO, { navState: { chargeSync: 'x' } });
      expect(warning(fixture)).toBeNull();
    });

    it('"Entendi" dispensa o aviso', async () => {
      const { fixture } = await mountDetail(ACTIVE_AUTO, {
        navState: { chargeSync: { requested: 2, created: 1, failed: 1, local: 0 } },
      });
      buttonsLabeled(fixture, 'Entendi')[0].click();
      await settle(fixture);
      expect(warning(fixture)).toBeNull();
    });
  });

  describe('Sincronizar com o Asaas (reconciliação por cobrança)', () => {
    const ACTIVE_AUTO = (charges: RentalChargeDto[]): RentalResponseDto => ({
      ...RESERVED_BASE,
      status: 'ACTIVE',
      automaticCharge: true,
      charges,
    });

    it('aparece só na cobrança EM ABERTO que existe no gateway (mobile + desktop)', async () => {
      const { fixture } = await mountDetail(
        ACTIVE_AUTO([
          charge({ id: 'open', periodIndex: 0 }),
          charge({ id: 'local', periodIndex: 1, externalId: null }),
          charge({ id: 'paid', periodIndex: 2, status: 'PAID', paidAt: '2026-08-02T10:00:00Z' }),
          charge({ id: 'canceled', periodIndex: 3, status: 'CANCELED' }),
        ]),
      );

      expect(buttonsLabeled(fixture, 'Sincronizar com o Asaas').length).toBe(2);
    });

    it('PAST_DUE e FAILED com id no gateway também são conferíveis', async () => {
      const { fixture } = await mountDetail(
        ACTIVE_AUTO([
          charge({ id: 'late', periodIndex: 0, status: 'PAST_DUE' }),
          charge({ id: 'failed', periodIndex: 1, status: 'FAILED' }),
        ]),
      );

      expect(buttonsLabeled(fixture, 'Sincronizar com o Asaas').length).toBe(4);
    });

    it('o motorista não vê o botão (o backend responderia 403)', async () => {
      const { fixture } = await mountDetail(ACTIVE_AUTO([charge({ id: 'open' })]), {
        role: 'DRIVER',
      });
      expect(buttonsLabeled(fixture, 'Sincronizar com o Asaas').length).toBe(0);
    });

    it('clicar POSTa a reconciliação da cobrança e recarrega o aluguel', async () => {
      const { fixture, http } = await mountDetail(ACTIVE_AUTO([charge({ id: 'open' })]));

      buttonsLabeled(fixture, 'Sincronizar com o Asaas')[0].click();
      fixture.detectChanges();
      await fixture.whenStable();

      const req = http.expectOne(`${BASE}/${RENTAL_ID}/charges/open/reconcile`);
      expect(req.request.method).toBe('POST');
      req.flush({ outcome: 'SYNCED', remoteStatus: 'PAID', status: 'PAID' });
      await settle(fixture);

      const reload = http.expectOne(`${BASE}/${RENTAL_ID}`);
      reload.flush(
        ACTIVE_AUTO([charge({ id: 'open', status: 'PAID', paidAt: '2026-08-02T10:00:00Z' })]),
      );
      await settle(fixture);

      expect(text(fixture)).toContain('Atualizada a partir do Asaas: a cobrança agora consta como pago.');
      // Paga: já não é conferível.
      expect(buttonsLabeled(fixture, 'Sincronizar com o Asaas').length).toBe(0);
    });

    it('Asaas ainda mostra pendente: diz que nada mudou, na linha da cobrança', async () => {
      const { fixture, http } = await mountDetail(ACTIVE_AUTO([charge({ id: 'open' })]));

      buttonsLabeled(fixture, 'Sincronizar com o Asaas')[0].click();
      fixture.detectChanges();
      await fixture.whenStable();
      http
        .expectOne(`${BASE}/${RENTAL_ID}/charges/open/reconcile`)
        .flush({ outcome: 'NO_CHANGE', remoteStatus: 'PENDING', status: 'PENDING' });
      await settle(fixture);

      expect(text(fixture)).toContain(
        'Conferido: o Asaas ainda mostra esta cobrança como pendente. Nada mudou.',
      );
    });

    it('a janela entre consultas (409) mostra a mensagem do servidor na linha, sem banner no topo', async () => {
      const { fixture, http } = await mountDetail(ACTIVE_AUTO([charge({ id: 'open' })]));

      buttonsLabeled(fixture, 'Sincronizar com o Asaas')[0].click();
      fixture.detectChanges();
      await fixture.whenStable();
      http
        .expectOne(`${BASE}/${RENTAL_ID}/charges/open/reconcile`)
        .flush(
          { message: 'Esta cobrança acabou de ser consultada no gateway. Aguarde alguns segundos.' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle(fixture);

      const note = (fixture.nativeElement as HTMLElement).querySelector('p[role="alert"]');
      expect(note?.textContent).toContain('Aguarde alguns segundos.');
      // Erro de operação não vai pro banner do topo: ele ficaria fora de vista.
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('app-alert-banner[variant="error"]'),
      ).toBeNull();
    });

    it('429 sem corpo cai no texto de espera local', async () => {
      const { fixture, http } = await mountDetail(ACTIVE_AUTO([charge({ id: 'open' })]));

      buttonsLabeled(fixture, 'Sincronizar com o Asaas')[0].click();
      fixture.detectChanges();
      await fixture.whenStable();
      http
        .expectOne(`${BASE}/${RENTAL_ID}/charges/open/reconcile`)
        .flush(null, { status: 429, statusText: 'Too Many Requests' });
      await settle(fixture);

      expect(text(fixture)).toContain(
        'Esta cobrança acabou de ser conferida. Aguarde alguns segundos e tente de novo.',
      );
    });

    it('durante a consulta o botão fica desabilitado e mostra "Sincronizando…"', async () => {
      const { fixture } = await mountDetail(ACTIVE_AUTO([charge({ id: 'open' })]));

      const [first] = buttonsLabeled(fixture, 'Sincronizar com o Asaas');
      first.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const conferindo = buttonsLabeled(fixture, 'Sincronizando…');
      expect(conferindo.length).toBeGreaterThan(0);
      expect(conferindo.every((b) => b.disabled)).toBe(true);
    });
  });

  describe('Marcar como paga', () => {
    it('multa por atraso (OVERDUE_FEE) é quitável também em aluguel de cobrança automática', async () => {
      const { fixture } = await mountDetail({
        ...RESERVED_BASE,
        status: 'COMPLETED',
        automaticCharge: true,
        charges: [
          charge({
            id: 'fee',
            kind: 'OVERDUE_FEE',
            provider: 'ASAAS',
            externalId: null,
            periodIndex: null,
          }),
        ],
      });

      expect(buttonsLabeled(fixture, 'Marcar como paga').length).toBe(2);
    });

    it('parcela registrada só no app (sem id no gateway) é quitável em aluguel automático', async () => {
      const { fixture } = await mountDetail({
        ...RESERVED_BASE,
        status: 'ACTIVE',
        automaticCharge: true,
        charges: [charge({ id: 'local', externalId: null, dueDate: '2020-01-05' })],
      });

      expect(buttonsLabeled(fixture, 'Marcar como paga').length).toBe(2);
    });

    it('cobrança que o gateway gerencia NÃO é quitável à mão em aluguel automático (o webhook quita)', async () => {
      const { fixture } = await mountDetail({
        ...RESERVED_BASE,
        status: 'ACTIVE',
        automaticCharge: true,
        charges: [charge({ id: 'gateway', externalId: 'pay_9' })],
      });

      expect(buttonsLabeled(fixture, 'Marcar como paga').length).toBe(0);
    });

    it('multa paga à mão pode ser desmarcada em aluguel automático; paga pelo webhook não', async () => {
      const { fixture } = await mountDetail({
        ...RESERVED_BASE,
        status: 'COMPLETED',
        automaticCharge: true,
        charges: [
          charge({
            id: 'fee',
            kind: 'OVERDUE_FEE',
            externalId: null,
            status: 'PAID',
            paidAt: '2026-08-02T12:00:00Z',
            periodIndex: null,
          }),
          charge({
            id: 'hook',
            externalId: 'pay_7',
            status: 'PAID',
            paidAt: '2026-08-03T12:00:00Z',
            periodIndex: 0,
          }),
        ],
      });

      expect(buttonsLabeled(fixture, 'Desmarcar').length).toBe(2);
    });
  });

  describe('Regerar — cada desfecho diz o que de fato aconteceu', () => {
    async function regerarWith(outcome: string): Promise<string[]> {
      const { fixture, http } = await mountDetail({
        ...RESERVED_BASE,
        status: 'ACTIVE',
        automaticCharge: true,
        charges: [charge({ id: 'failed', status: 'FAILED', externalId: null })],
      });
      buttonsLabeled(fixture, 'Regerar')[0].click();
      fixture.detectChanges();
      await fixture.whenStable();
      http
        .expectOne(`${BASE}/${RENTAL_ID}/charges/failed/retry`)
        .flush({ outcome, externalId: null, checkoutUrl: null, retryCount: 1 });
      await settle(fixture);
      http.match(`${BASE}/${RENTAL_ID}`).forEach((r) => r.flush({ ...RESERVED_BASE, status: 'ACTIVE' }));
      return TestBed.inject(NotificationService)
        .notifications()
        .map((n) => n.message);
    }

    it('CANCELED não finge que gerou uma cobrança nova', async () => {
      const messages = await regerarWith('CANCELED');
      expect(messages.some((m) => m.startsWith('Nada foi gerado:'))).toBe(true);
      expect(messages).not.toContain('Nova cobrança gerada com sucesso.');
    });

    it('SKIPPED diz que a cobrança mudou e nada foi alterado', async () => {
      const messages = await regerarWith('SKIPPED');
      expect(messages.some((m) => m.includes('mudou de situação') && m.includes('nada foi alterado'))).toBe(
        true,
      );
    });

    it('RETRIED segue com a frase de sempre', async () => {
      const messages = await regerarWith('RETRIED');
      expect(messages).toContain('Nova cobrança gerada com sucesso.');
    });
  });

  describe('Menu de ações das cobranças (FIX-0735)', () => {
    const ACTIVE_AUTO = (charges: RentalChargeDto[], over: Partial<RentalResponseDto> = {}) =>
      ({ ...RESERVED_BASE, status: 'ACTIVE', automaticCharge: true, charges, ...over }) as RentalResponseDto;

    const OPEN = (over: Partial<RentalChargeDto> = {}): RentalChargeDto =>
      charge({ id: 'p-1', checkoutUrl: 'https://www.asaas.com/i/abc', ...over });

    function triggers(fixture: ComponentFixture<RentalDetail>): HTMLButtonElement[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll('[aria-haspopup="menu"]'),
      ) as HTMLButtonElement[];
    }

    function menuItems(fixture: ComponentFixture<RentalDetail>): HTMLButtonElement[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll('[role="menu"] [role="menuitem"]'),
      ) as HTMLButtonElement[];
    }

    /** Abre o PRIMEIRO menu da tela e devolve os rótulos dos itens. */
    function openFirstMenu(fixture: ComponentFixture<RentalDetail>): string[] {
      const [first] = triggers(fixture);
      if (!first) return [];
      first.click();
      fixture.detectChanges();
      return menuItems(fixture).map((i) => (i.textContent ?? '').trim());
    }

    function item(fixture: ComponentFixture<RentalDetail>, label: string): HTMLButtonElement {
      const found = menuItems(fixture).find((b) => (b.textContent ?? '').trim() === label);
      if (!found) throw new Error(`item "${label}" não encontrado`);
      return found;
    }

    it('cobrança aberta no gateway: Pagar, Conferir, Compartilhar e Sincronizar; sem baixa manual', async () => {
      const { fixture } = await mountDetail(ACTIVE_AUTO([OPEN()]));

      const labels = openFirstMenu(fixture);

      expect(labels).toEqual([
        'Pagar (abrir cobrança)',
        'Conferir no Asaas',
        'Compartilhar',
        'Sincronizar com o Asaas',
      ]);
      expect(labels).not.toContain('Marcar como paga');
    });

    it('cada linha tem UM gatilho por layout (mobile + desktop) e nenhum botão solto de ação', async () => {
      const { fixture } = await mountDetail(ACTIVE_AUTO([OPEN()]));

      expect(triggers(fixture).length).toBe(2);
      const loose = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLElement[])
        .filter((b) => b.getAttribute('role') !== 'menuitem')
        .map((b) => (b.textContent ?? '').trim());
      for (const label of ['Pagar', 'Conferir no Asaas', 'Cancelar cobrança', 'Marcar como paga']) {
        expect(loose, label).not.toContain(label);
      }
    });

    it('cobrança local (sem link nem id no gateway): só a baixa manual', async () => {
      const { fixture } = await mountDetail(
        ACTIVE_AUTO([OPEN({ externalId: null, checkoutUrl: null })]),
      );

      expect(openFirstMenu(fixture)).toEqual(['Marcar como paga']);
    });

    it('PAID: só Conferir no Asaas; CANCELED: sem menu', async () => {
      const paid = await mountDetail(
        ACTIVE_AUTO([OPEN({ status: 'PAID', paidAt: '2026-08-02T10:00:00Z' })]),
      );
      expect(openFirstMenu(paid.fixture)).toEqual(['Conferir no Asaas']);

      const canceled = await mountDetail(ACTIVE_AUTO([OPEN({ status: 'CANCELED' })]));
      expect(triggers(canceled.fixture).length).toBe(0);
    });

    it('motorista não vê o menu do operador: vê a seção "Pagamentos", do endpoint dele', async () => {
      const { fixture } = await mountDetail(ACTIVE_AUTO([OPEN()]), { role: 'DRIVER' });

      expect(triggers(fixture).length).toBe(0);
      expect(fixture.nativeElement.querySelector('[data-driver-charges]')).not.toBeNull();
      expect(text(fixture)).not.toContain('Cronograma de cobrança');
      expect(text(fixture)).not.toContain('Conferir');
      expect(text(fixture)).not.toContain('Sincronizar');
      // O endpoint novo, e não o `charges` que o detalhe do operador carrega.
      expect(lastAncillaryUrls).toContain(`${BASE}/${RENTAL_ID}/charges`);
    });

    it('o dono segue com o cronograma e sem a seção do motorista', async () => {
      const { fixture } = await mountDetail(ACTIVE_AUTO([OPEN()]));

      expect(fixture.nativeElement.querySelector('[data-driver-charges]')).toBeNull();
      expect(text(fixture)).toContain('Cronograma de cobrança');
      expect(lastAncillaryUrls).not.toContain(`${BASE}/${RENTAL_ID}/charges`);
    });

    it('Cancelar cobrança só existe na caução aberta, nunca na parcela do cronograma', async () => {
      const { fixture } = await mountDetail(
        ACTIVE_AUTO(
          [
            OPEN({ id: 'cau', kind: 'CAUCAO', periodIndex: null }),
            OPEN({ id: 'per', periodIndex: 0 }),
          ],
          { caucaoAmount: 50_000 },
        ),
      );
      const all = triggers(fixture);
      const withCancel = all.filter((t) => {
        t.click();
        fixture.detectChanges();
        const has = menuItems(fixture).some((i) => (i.textContent ?? '').includes('Cancelar cobrança'));
        t.click();
        fixture.detectChanges();
        return has;
      });

      // 2 cobranças x (mobile + desktop); só a caução oferece
      expect(all.length).toBe(4);
      expect(withCancel.length).toBe(2);
    });

    it('Pagar e Conferir abrem, cada um, o link do Asaas em nova aba', async () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
      try {
        const { fixture } = await mountDetail(ACTIVE_AUTO([OPEN()]));
        for (const label of ['Pagar (abrir cobrança)', 'Conferir no Asaas']) {
          openSpy.mockClear();
          const [t] = triggers(fixture);
          t.click();
          fixture.detectChanges();
          item(fixture, label).click();
          fixture.detectChanges();

          expect(openSpy, label).toHaveBeenCalledTimes(1);
          expect(openSpy.mock.calls[0][0]).toBe('https://www.asaas.com/i/abc');
          expect(openSpy.mock.calls[0][1]).toBe('_blank');
        }
      } finally {
        openSpy.mockRestore();
      }
    });

    it.each([
      ['PENDING', ['Pagar (abrir cobrança)', 'Conferir no Asaas', 'Compartilhar']],
      ['PAST_DUE', ['Pagar (abrir cobrança)', 'Conferir no Asaas', 'Compartilhar']],
      ['PAID', ['Conferir no Asaas']],
      ['FAILED', ['Regerar']],
      ['REFUNDED', []],
      ['DISPUTED', []],
      ['CANCELED', []],
    ] as const)('itens de link por status: %s', async (status, expected) => {
      const { fixture } = await mountDetail(
        ACTIVE_AUTO([
          OPEN({ status, paidAt: status === 'PAID' ? '2026-08-02T10:00:00Z' : null }),
        ]),
      );
      const labels = openFirstMenu(fixture).filter(
        (l) => l !== 'Sincronizar com o Asaas' && l !== 'Desmarcar como paga',
      );

      expect(labels).toEqual([...expected]);
    });

    it('aluguel MANUAL: cobrança com externalId OU link vivo não oferece "Marcar como paga" (FIX-0727)', async () => {
      const withId = await mountDetail(
        ACTIVE_AUTO([OPEN({ checkoutUrl: null })], { automaticCharge: false }),
      );
      expect(openFirstMenu(withId.fixture)).not.toContain('Marcar como paga');

      const withLink = await mountDetail(
        ACTIVE_AUTO([OPEN({ externalId: null })], { automaticCharge: false }),
      );
      expect(openFirstMenu(withLink.fixture)).not.toContain('Marcar como paga');
    });

    it('Compartilhar sem Clipboard API usa o fallback (textarea + execCommand) e avisa', async () => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      const exec = vi.fn().mockReturnValue(true);
      (document as unknown as { execCommand: unknown }).execCommand = exec;
      const { fixture } = await mountDetail(ACTIVE_AUTO([OPEN()]));
      openFirstMenu(fixture);

      item(fixture, 'Compartilhar').click();
      await fixture.whenStable();

      expect(exec).toHaveBeenCalledWith('copy');
      const messages = TestBed.inject(NotificationService)
        .notifications()
        .map((n) => n.message);
      expect(messages).toContain('Link da cobrança copiado.');
    });

    it('Compartilhar com falha no clipboard e no fallback mostra o erro', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('denied'));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      (document as unknown as { execCommand: unknown }).execCommand = vi.fn().mockReturnValue(false);
      const { fixture } = await mountDetail(ACTIVE_AUTO([OPEN()]));
      openFirstMenu(fixture);

      item(fixture, 'Compartilhar').click();
      await fixture.whenStable();

      const notes = TestBed.inject(NotificationService).notifications();
      expect(
        notes.some((n) => n.kind === 'error' && n.message.includes('Não foi possível copiar')),
      ).toBe(true);
      expect(notes.some((n) => n.message === 'Link da cobrança copiado.')).toBe(false);
    });

    it('Compartilhar copia o link e avisa na tela', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const { fixture } = await mountDetail(ACTIVE_AUTO([OPEN()]));
      openFirstMenu(fixture);

      item(fixture, 'Compartilhar').click();
      await fixture.whenStable();

      expect(writeText).toHaveBeenCalledWith('https://www.asaas.com/i/abc');
      const messages = TestBed.inject(NotificationService)
        .notifications()
        .map((n) => n.message);
      expect(messages).toContain('Link da cobrança copiado.');
    });

    it('Cancelar cobrança: pede confirmação e só então chama o endpoint', async () => {
      const { fixture, http } = await mountDetail(
        ACTIVE_AUTO([OPEN({ id: 'cau', kind: 'CAUCAO', periodIndex: null })], {
          caucaoAmount: 50_000,
        }),
      );
      openFirstMenu(fixture);
      item(fixture, 'Cancelar cobrança').click();
      fixture.detectChanges();
      await fixture.whenStable();

      http.expectNone(`${BASE}/${RENTAL_ID}/charges/cau/cancel`);
      const confirm = (
        Array.from(fixture.nativeElement.querySelectorAll('[role="dialog"] button')) as HTMLButtonElement[]
      ).find((b) => (b.textContent ?? '').includes('Confirmar cancelamento'));
      expect(confirm, 'sem diálogo de confirmação').toBeTruthy();
      confirm?.click();

      const req = http.expectOne(`${BASE}/${RENTAL_ID}/charges/cau/cancel`);
      expect(req.request.method).toBe('POST');
    });

    it.each([
      ['cobrança local, sem vínculo com o Asaas', null, 'NO_GATEWAY_LINK', 'não tinha vínculo com o Asaas'],
      ['cobrança do Asaas', 'pay_9', 'REMOVED_AT_GATEWAY', 'removida do Asaas'],
    ] as const)('cancelar: %s mostra o desfecho certo', async (_n, externalId, outcome, fragment) => {
      const { fixture, http } = await mountDetail(
        ACTIVE_AUTO([OPEN({ id: 'cau', kind: 'CAUCAO', periodIndex: null, externalId })], {
          caucaoAmount: 50_000,
        }),
      );
      openFirstMenu(fixture);
      item(fixture, 'Cancelar cobrança').click();
      fixture.detectChanges();
      await fixture.whenStable();
      (
        Array.from(fixture.nativeElement.querySelectorAll('[role="dialog"] button')) as HTMLButtonElement[]
      )
        .find((b) => (b.textContent ?? '').includes('Confirmar cancelamento'))
        ?.click();

      http
        .expectOne(`${BASE}/${RENTAL_ID}/charges/cau/cancel`)
        .flush({ outcome, status: 'CANCELED', hint: null });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.nativeElement.textContent).toContain(fragment);
    });
  });
});
