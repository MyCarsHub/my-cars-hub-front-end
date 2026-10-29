import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import { NotificationService } from '../../../services/notification.service';
import type { AdminChargesPage, TrialConversionItem } from '../../../types/admin-charges.types';
import { AdminContactService } from '../contact/admin-contact.service';
import { AdminTrialConversion } from '../companies/admin-trial-conversion';
import { AdminCharges } from './admin-charges';
import { AdminChargesService } from './admin-charges.service';

const PAGE: AdminChargesPage = {
  tab: 'FAILED',
  includeInternal: false,
  content: [
    {
      chargeId: 'ch-1',
      rentalId: 'rt-1',
      rentalStatus: 'ACTIVE',
      kind: 'RENTAL_PERIOD',
      status: 'FAILED',
      amountCents: 98000,
      dueDate: '2026-10-30',
      daysOverdue: -2,
      failureCode: 'invalid_customer',
      failureReason: 'CPF [número] inválido',
      companyId: 'co-1',
      companyName: 'Locadora Teste',
      companyInternal: false,
      driverId: 'drv-1',
      driverName: 'Motorista Fictício',
      driverPhoneMasked: '(11) •••••-4321',
    },
  ],
  page: 0,
  size: 20,
  total: 1,
  failedCount: 9,
  overdueCount: 4,
};

describe('AdminCharges (Cobranças)', () => {
  let list: ReturnType<typeof vi.fn>;
  let compareWithAsaas: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    list = vi.fn().mockReturnValue(of(PAGE));
    compareWithAsaas = vi.fn().mockReturnValue(of({
      chargeId: 'ch-1', rentalId: 'rt-1', companyId: 'co-1', externalId: 'pay_1', result: 'MATCH',
      message: 'MyCarsHub e Asaas concordam nos campos comparados.', comparedOn: '2026-10-29', fields: [],
    }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCharges],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: AdminChargesService, useValue: { list, compareWithAsaas } },
        { provide: AdminContactService, useValue: { reveal: vi.fn() } },
        { provide: ImpersonationService, useValue: { start: vi.fn() } },
        { provide: NotificationService, useValue: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } },
      ],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(AdminCharges);
    fixture.detectChanges();
    return fixture;
  }

  it('abre em "Com falha", sem internas, com as contagens das duas abas', () => {
    const el: HTMLElement = render().nativeElement;

    expect(list).toHaveBeenCalledWith('FAILED', false, 0);
    expect(el.querySelector('[data-testid="tab-failed"]')?.textContent).toContain('9');
    expect(el.querySelector('[data-testid="tab-overdue"]')?.textContent).toContain('4');
  });

  it('o card mostra empresa, motorista, valor, vencimento, status e o telefone SÓ mascarado', () => {
    const el: HTMLElement = render().nativeElement;
    const card = el.querySelector('[data-testid="charge-card"]') as HTMLElement;

    expect(card.textContent).toContain('Locadora Teste');
    expect(card.textContent).toContain('Motorista Fictício');
    expect(card.querySelector('[data-testid="amount"]')?.textContent?.replace(/\s/g, ' ')).toContain('980,00');
    expect(card.textContent).toContain('30/10/2026');
    expect(card.textContent).toContain('vence em 2 dias');
    expect(card.textContent).toContain('Falhou');
    expect(card.textContent).toContain('(11) •••••-4321');
    expect(card.querySelector('[data-testid="contact-whatsapp"]')).not.toBeNull();
    expect(card.querySelector('[data-testid="open-rental"]')).not.toBeNull();
  });

  /** "Atrasado é nossa prova": a LISTA não tem ação de dinheiro solta; tudo passa pela folha de ações. */
  it('a lista não oferece reemitir, re-datar nem tentar de novo direto no card', () => {
    const el: HTMLElement = render().nativeElement;
    const actions = Array.from(el.querySelectorAll('button, a')).map((b) => (b.textContent ?? '').toLowerCase());

    for (const forbidden of ['reemitir', 're-datar', 'redatar', 'tentar de novo', 'marcar', 'cancelar']) {
      expect(actions.some((t) => t.includes(forbidden))).toBe(false);
    }
  });

  it('"Comparar com o Asaas" abre a folha já comparando; "Mais ações" abre o menu', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;

    (el.querySelector('[data-testid="open-compare"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="charge-actions-sheet"]')?.getAttribute('data-mode')).toBe('compare');
    expect(compareWithAsaas).toHaveBeenCalledWith('ch-1');
  });

  it('atrasada (PAST_DUE): o menu nunca oferece "tentar de novo" e mostra a regra', () => {
    list.mockReturnValue(of({
      ...PAGE,
      tab: 'OVERDUE',
      content: [{ ...PAGE.content[0], status: 'PAST_DUE', daysOverdue: 9 }],
    }));
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;

    (el.querySelector('[data-testid="open-actions"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="action-compare"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="action-retry"]')).toBeNull();
    expect(el.querySelector('[data-testid="overdue-rule"]')).not.toBeNull();
  });

  it('desktop: a mesma lista em tabela com cabeçalho de colunas e ações por linha', () => {
    const el: HTMLElement = render().nativeElement;
    const table = el.querySelector('[data-testid="charges-table"] table') as HTMLTableElement;

    expect(Array.from(table.querySelectorAll('th')).map((t) => t.textContent?.trim())).toEqual(
      expect.arrayContaining(['Tipo', 'Valor', 'Vencimento', 'Situação']),
    );
    const row = table.querySelector('[data-testid="charge-row"]') as HTMLElement;
    expect(row.textContent).toContain('Locadora Teste');
    expect(row.querySelector('[data-testid="row-compare"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="row-actions"]')).not.toBeNull();
  });

  it('trocar de aba e incluir internas recarrega com os parâmetros certos', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;

    (el.querySelector('[data-testid="tab-overdue"]') as HTMLButtonElement).click();
    expect(list).toHaveBeenLastCalledWith('OVERDUE', false, 0);

    const toggle = el.querySelector('[data-testid="toggle-internal"]') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(list).toHaveBeenLastCalledWith('OVERDUE', true, 0);
  });
});

describe('AdminTrialConversion (Converter testes)', () => {
  const ITEM: TrialConversionItem = {
    companyId: 'co-9',
    companyName: 'Frota Exemplo',
    companyStatus: 'ACTIVE',
    internal: false,
    signupAt: '2026-09-01T10:00:00',
    trialEndsAt: '2026-10-20T10:00:00',
    daysSinceTrialEnd: 8,
    subscriptionStatus: 'TRIALING',
    planName: 'Pro',
    vehicles: 2,
    drivers: 1,
    rentals: 1,
    lastSeenAt: null,
    lastLoginAt: '2026-10-25T09:00:00',
    activationStage: 3,
    ownerUserId: 'usr-9',
    ownerName: 'Maria Dona Exemplo',
    ownerPhoneMasked: '(21) •••••-1234',
  };

  let trialConversion: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    trialConversion = vi.fn().mockReturnValue(of([ITEM]));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminTrialConversion],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: AdminChargesService, useValue: { trialConversion } },
        { provide: AdminContactService, useValue: { reveal: vi.fn() } },
        { provide: NotificationService, useValue: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } },
      ],
    });
  });

  it('mostra sinais de ativação, explica a ordem e liga o WhatsApp do dono', () => {
    const fixture = TestBed.createComponent(AdminTrialConversion);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(trialConversion).toHaveBeenCalledWith(false);
    const card = el.querySelector('[data-testid="conversion-card"]') as HTMLElement;
    expect(card.textContent).toContain('Frota Exemplo');
    expect(card.textContent).toContain('Fez aluguel');
    expect(card.textContent).toContain('Teste acabou há 8 dias');
    expect(card.textContent).toContain('2 veículo(s)');
    expect(card.textContent).toContain('(21) •••••-1234');
    expect(el.querySelector('[data-testid="order-explainer"]')?.textContent).toContain('Até onde chegou');
    expect(el.querySelector('[data-testid="tab-convert"]')?.getAttribute('aria-current')).toBe('page');
  });

  it('a mensagem pré-preenchida é curta, em pt-BR, com o primeiro nome e a empresa', () => {
    const fixture = TestBed.createComponent(AdminTrialConversion);
    const text = (fixture.componentInstance as unknown as { whatsAppText(i: TrialConversionItem): string })
      .whatsAppText(ITEM);

    expect(text.startsWith('Olá, Maria!')).toBe(true);
    expect(text).toContain('Frota Exemplo');
    expect(text).toContain('terminou');
    expect(text).toContain('Posso te ajudar');
    expect(text.length).toBeLessThan(200);
  });
});
