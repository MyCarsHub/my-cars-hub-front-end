import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import { NotificationService } from '../../../services/notification.service';
import type { AdminChargeListItem, AdminChargesPage } from '../../../types/admin-charges.types';
import { AdminContactService } from '../contact/admin-contact.service';
import { AdminCharges } from './admin-charges';
import { AdminChargesService } from './admin-charges.service';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import type { AdminCapabilityCode } from '../../../types/admin-roles.types';

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

const OWNER_CAPS = { can: () => true, ensureLoaded: () => of(null) };

/** Abre o kebab (ActionsMenu) dentro de `scope` e devolve o elemento raiz. */
function openKebab(scope: HTMLElement, fixture: { detectChanges(): void }): void {
  (scope.querySelector('app-actions-menu button[aria-haspopup="menu"]') as HTMLButtonElement).click();
  fixture.detectChanges();
}

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
        { provide: AdminCapabilitiesService, useValue: OWNER_CAPS },
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
    const card = el.querySelector('[data-card]') as HTMLElement;

    expect(card.textContent).toContain('Locadora Teste');
    expect(card.textContent).toContain('Motorista Fictício');
    expect(card.querySelector('[data-testid="amount"]')?.textContent?.replace(/\s/g, ' ')).toContain('980,00');
    expect(card.textContent).toContain('30/10/2026');
    expect(card.textContent).toContain('vence em 2 dias');
    expect(card.textContent).toContain('Falhou');
    expect(card.textContent).toContain('(11) •••••-4321');
    expect(card.querySelector('[data-testid="contact-whatsapp"]')).not.toBeNull();
    // Ações da linha: só o kebab padrão das listas do admin (como em Empresas), sem botões soltos.
    expect(card.querySelector('[data-testid="open-rental"]')).toBeNull();
    expect(card.querySelector('[data-testid="open-compare"]')).toBeNull();
    expect(card.querySelector('app-actions-menu')).not.toBeNull();
  });

  /** "Atrasado é nossa prova": a LISTA não tem ação de dinheiro solta; tudo passa pela folha de ações. */
  it('a lista não oferece reemitir, re-datar nem tentar de novo direto no card', () => {
    const el: HTMLElement = render().nativeElement;
    const actions = Array.from(el.querySelectorAll('button, a')).map((b) => (b.textContent ?? '').toLowerCase());

    for (const forbidden of ['reemitir', 're-datar', 'redatar', 'tentar de novo', 'marcar', 'cancelar']) {
      expect(actions.some((t) => t.includes(forbidden))).toBe(false);
    }
  });

  it('kebab: "Comparar com o Asaas" abre a folha já comparando', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    const card = el.querySelector('[data-card]') as HTMLElement;

    openKebab(card, fixture);
    const items = Array.from(card.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent?.trim());
    // G13 (FEAT-0573): a FAILED também oferece "Recebida por fora".
    expect(items).toEqual(['Comparar com o Asaas', 'Recebida por fora', 'Tentar de novo', 'Corrigir nome do motorista',
      'Atualizar cliente no Asaas', 'Ver aluguel', 'Cancelar cobrança']);

    (card.querySelector('[data-testid="menu-compare"]') as HTMLButtonElement).click();
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

    const card = el.querySelector('[data-card]') as HTMLElement;
    openKebab(card, fixture);

    expect(card.querySelector('[data-testid="menu-compare"]')).not.toBeNull();
    expect(card.querySelector('[data-testid="menu-received"]')).not.toBeNull();
    expect(card.querySelector('[data-testid="menu-retry"]')).toBeNull();
  });

  it('desktop: a mesma lista em tabela com cabeçalho de colunas e ações por linha', () => {
    const el: HTMLElement = render().nativeElement;
    const table = el.querySelector('[data-testid="charges-list"] [data-table]') as HTMLTableElement;

    expect(Array.from(table.querySelectorAll('th')).map((t) => t.textContent?.trim())).toEqual(
      expect.arrayContaining(['Tipo', 'Valor', 'Vencimento', 'Situação']),
    );
    const row = table.querySelector('[data-row]') as HTMLElement;
    expect(row.textContent).toContain('Locadora Teste');
    expect(row.querySelector('app-actions-menu')).not.toBeNull();
    expect(row.querySelector('[data-testid="row-compare"]')).toBeNull();
  });

  it('Leitura: sem kebab e sem contato na linha (o servidor recusaria de qualquer forma)', () => {
    const readonly = new Set<AdminCapabilityCode>(['ver']);
    TestBed.overrideProvider(AdminCapabilitiesService, {
      useValue: { can: (c: AdminCapabilityCode) => readonly.has(c), ensureLoaded: () => of(null) },
    });
    const el: HTMLElement = render().nativeElement;
    expect(el.querySelector('app-actions-menu')).toBeNull();
    expect(el.querySelector('app-contact-actions')).toBeNull();
  });

  it('lista mista: a linha sem ação não tem kebab (nada de item desabilitado); cada kebab tem o nome da linha', () => {
    const agir = new Set<AdminCapabilityCode>(['ver', 'cobranca.agir']);
    TestBed.overrideProvider(AdminCapabilitiesService, {
      useValue: { can: (c: AdminCapabilityCode) => agir.has(c), ensureLoaded: () => of(null) },
    });
    const adjustment: AdminChargeListItem = {
      ...PAGE.content[0],
      chargeId: 'ch-2',
      kind: 'ADJUSTMENT',
      daysOverdue: 3,
      driverId: null,
      driverName: null,
      companyName: 'Locadora Beta',
    };
    list.mockReturnValue(of({ ...PAGE, content: [PAGE.content[0], adjustment], total: 2 }));
    const el: HTMLElement = render().nativeElement;

    const cards = el.querySelectorAll<HTMLElement>('[data-card]');
    expect(cards[0].querySelector('app-actions-menu button[aria-haspopup="menu"]')?.getAttribute('aria-label'))
      .toBe('Ações da cobrança de Motorista Fictício');
    expect(cards[1].querySelector('app-actions-menu')).toBeNull();
    expect(el.querySelector('[data-testid="menu-none"]')).toBeNull();
  });

  it('"Ver aluguel" no kebab abre a sessão somente leitura da empresa', () => {
    const start = TestBed.inject(ImpersonationService).start as ReturnType<typeof vi.fn>;
    start.mockReturnValue(of({ companyName: 'Locadora Teste' }));
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;

    const card = el.querySelector('[data-card]') as HTMLElement;
    openKebab(card, fixture);
    (card.querySelector('[data-testid="menu-view-rental"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(start).toHaveBeenCalledWith('co-1');
    expect(el.querySelector('[data-testid="charge-actions-sheet"]')).toBeNull();
  });

  it('padrão de lista: cartão "Lista", cabeçalho em caixa normal, chip sem bolinha e sem linhas', () => {
    list.mockReturnValue(of({ ...PAGE, content: [{ ...PAGE.content[0], companyInternal: true }] }));
    const el: HTMLElement = render().nativeElement;

    expect(el.querySelector('app-page-card h2')?.textContent?.trim()).toBe('Lista');
    const headers = Array.from(el.querySelectorAll('[data-table] th')).map((t) => t.className);
    expect(headers.some((c) => c.includes('uppercase'))).toBe(false);
    // "Interna" é quem a empresa é, não situação: chip neutro, nunca anil.
    const internal = el.querySelector('[data-card] [data-testid="internal-chip"]') as HTMLElement;
    expect(internal.className).toContain('bg-surface-sunken');
    expect(el.innerHTML).not.toMatch(/indigo-/);
    // Situação: o chip padrão (texto sobre fundo tingido).
    const status = Array.from(el.querySelectorAll('[data-card] app-status-chip')).find(
      (c) => c.textContent?.trim() === 'Falhou',
    ) as HTMLElement;
    expect(status.className).toContain('bg-rose-100');
    // Sem linha entre registros nem entre itens do kebab.
    expect(el.querySelector('[data-testid="charges-list"]')?.innerHTML).not.toMatch(/border-t|divide-/);
  });

  it('a regra do dono não usa contorno: fundo cinza só', () => {
    const el: HTMLElement = render().nativeElement;
    const rule = el.querySelector('[data-testid="tab-rule"]') as HTMLElement;
    expect(rule.className).not.toMatch(/border/);
  });

  it('kebab sem linha entre os itens', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    const card = el.querySelector('[data-card]') as HTMLElement;
    openKebab(card, fixture);
    for (const item of Array.from(card.querySelectorAll('[role="menuitem"]'))) {
      expect(item.className).not.toMatch(/border-t/);
    }
  });

  it('paginação do servidor: "Próxima" pede a página seguinte', () => {
    list.mockReturnValue(of({ ...PAGE, total: 45 }));
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-pager-text]')?.textContent).toContain('45 cobranças');
    (el.querySelector('[data-page-next]') as HTMLButtonElement).click();
    expect(list).toHaveBeenLastCalledWith('FAILED', false, 1);
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
