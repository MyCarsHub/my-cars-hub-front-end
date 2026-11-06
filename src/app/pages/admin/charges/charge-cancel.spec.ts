import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import { NotificationService } from '../../../services/notification.service';
import type {
  AdminCancelChargeResult,
  AdminChargeListItem,
  AdminChargesPage,
} from '../../../types/admin-charges.types';
import type { AdminCapabilityCode } from '../../../types/admin-roles.types';
import { AdminContactService } from '../contact/admin-contact.service';
import { AdminCharges } from './admin-charges';
import { AdminChargesService } from './admin-charges.service';
import {
  canCancelCharge,
  cancelConfirmationCode,
  cancelConfirmationMatches,
  isOverdueCharge,
} from './charge-action-rules';
import { ChargeActionMode, ChargeActionsSheet } from './charge-actions-sheet';

const CHARGE_ID = 'ABCD1234-0000-4000-8000-000000000001';

const BASE: AdminChargeListItem = {
  chargeId: CHARGE_ID,
  rentalId: 'rt-1',
  rentalStatus: 'ACTIVE',
  kind: 'RENTAL_PERIOD',
  status: 'PENDING',
  amountCents: 98000,
  dueDate: '2026-11-20',
  daysOverdue: -14,
  failureCode: null,
  failureReason: null,
  companyId: 'co-1',
  companyName: 'Locadora Teste',
  companyInternal: false,
  driverId: 'drv-1',
  driverName: 'Motorista Fictício',
  driverPhoneMasked: null,
};

const OVERDUE: Partial<AdminChargeListItem> = { status: 'PAST_DUE', daysOverdue: 9, dueDate: '2026-10-28' };

function result(outcome: AdminCancelChargeResult['outcome']): AdminCancelChargeResult {
  return {
    chargeId: CHARGE_ID,
    outcome,
    status: outcome === 'GATEWAY_FAILED' || outcome === 'ALREADY_PAID_AT_GATEWAY' ? 'PENDING' : 'CANCELED',
    canceled: outcome.startsWith('CANCELED'),
    retryQueued: outcome === 'GATEWAY_FAILED',
    gatewayFailure: null,
    hint: null,
  };
}

function httpError(status: number, body: Record<string, unknown> = {}): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body });
}

describe('charge-action-rules (cancelar cobrança)', () => {
  it('só cobrança em aberto pode ser cancelada', () => {
    for (const status of ['PENDING', 'PAST_DUE', 'FAILED']) {
      expect(canCancelCharge({ ...BASE, status })).toBe(true);
    }
    for (const status of ['PAID', 'CANCELED', 'REFUNDED', 'DISPUTED']) {
      expect(canCancelCharge({ ...BASE, status })).toBe(false);
    }
  });

  it('vencida: PAST_DUE ou vencimento antes de hoje; vence hoje não é vencida', () => {
    expect(isOverdueCharge({ ...BASE, ...OVERDUE })).toBe(true);
    expect(isOverdueCharge({ ...BASE, status: 'FAILED', daysOverdue: 1 })).toBe(true);
    expect(isOverdueCharge({ ...BASE, daysOverdue: 0 })).toBe(false);
    expect(isOverdueCharge(BASE)).toBe(false);
  });

  it('confirmação: 8 primeiros caracteres do id, sem diferenciar maiúsculas, com espaços nas pontas', () => {
    expect(cancelConfirmationCode(CHARGE_ID)).toBe('abcd1234');
    expect(cancelConfirmationMatches(CHARGE_ID, 'ABCD1234')).toBe(true);
    expect(cancelConfirmationMatches(CHARGE_ID, '  abcd1234 ')).toBe(true);
    expect(cancelConfirmationMatches(CHARGE_ID, 'abcd123')).toBe(false);
    expect(cancelConfirmationMatches(CHARGE_ID, 'abcd12345')).toBe(false);
    expect(cancelConfirmationMatches(CHARGE_ID, '')).toBe(false);
  });
});

describe('ChargeActionsSheet - Cancelar cobrança', () => {
  let cancelCharge: ReturnType<typeof vi.fn>;
  let notify: Record<'success' | 'info' | 'warning' | 'error', ReturnType<typeof vi.fn>>;
  let caps: Set<AdminCapabilityCode>;

  beforeEach(() => {
    cancelCharge = vi.fn().mockReturnValue(of(result('CANCELED_AT_GATEWAY')));
    notify = { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    caps = new Set<AdminCapabilityCode>(['cobranca.cancelar', 'cobranca.agir', 'asaas.comparar']);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ChargeActionsSheet],
      providers: [
        ApiErrorService,
        { provide: AdminChargesService, useValue: { cancelCharge } },
        { provide: NotificationService, useValue: notify },
        { provide: AdminCapabilitiesService, useValue: { can: (c: AdminCapabilityCode) => caps.has(c), ensureLoaded: () => of(null) } },
      ],
    });
  });

  function render(item: Partial<AdminChargeListItem> = {}, mode: ChargeActionMode = 'cancel') {
    const fixture = TestBed.createComponent(ChargeActionsSheet);
    fixture.componentRef.setInput('item', { ...BASE, ...item });
    fixture.componentRef.setInput('initialMode', mode);
    fixture.detectChanges();
    return fixture;
  }

  const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const confirm = (el: HTMLElement) => q(el, 'action-confirm') as HTMLButtonElement;

  function type(fixture: { detectChanges(): void }, el: HTMLElement, id: string, value: string) {
    const input = q(el, id) as HTMLInputElement | HTMLTextAreaElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function pickReason(fixture: { detectChanges(): void }, el: HTMLElement, reason: string) {
    (q(el, 'reason-' + reason)?.querySelector('input') as HTMLInputElement).click();
    fixture.detectChanges();
  }

  it('menu: o item aparece para o Dono em cobrança aberta, vencida inclusive', () => {
    expect(q(render({}, 'menu').nativeElement, 'action-cancel')).not.toBeNull();
    expect(q(render(OVERDUE, 'menu').nativeElement, 'action-cancel')).not.toBeNull();
    expect(q(render({ status: 'FAILED' }, 'menu').nativeElement, 'action-cancel')).not.toBeNull();
  });

  it('menu: some para paga/estornada e para quem não tem cobranca.cancelar (falha fechada)', () => {
    expect(q(render({ status: 'PAID' }, 'menu').nativeElement, 'action-cancel')).toBeNull();
    expect(q(render({ status: 'REFUNDED' }, 'menu').nativeElement, 'action-cancel')).toBeNull();
    caps.delete('cobranca.cancelar');
    expect(q(render({}, 'menu').nativeElement, 'action-cancel')).toBeNull();
  });

  it('sem capacidade, o botão de confirmar nunca habilita e nada é enviado', () => {
    caps.delete('cobranca.cancelar');
    const el: HTMLElement = render().nativeElement;
    expect(confirm(el).disabled).toBe(true);
    confirm(el).click();
    expect(cancelCharge).not.toHaveBeenCalled();
  });

  it('não vencida: confirmação simples, sem motivo nem código; corpo sem reason/confirmation', () => {
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;

    expect(q(el, 'cancel-confirmation')).toBeNull();
    expect(q(el, 'reason-picker')).toBeNull();
    expect(q(el, 'cancel-explainer')?.textContent).toContain('conta do cliente no Asaas');
    expect(confirm(el).disabled).toBe(false);

    confirm(el).click();
    expect(cancelCharge).toHaveBeenCalledWith(CHARGE_ID, {
      companyId: 'co-1',
      reason: null,
      note: null,
      confirmation: null,
    });
  });

  it('vencida: exige motivo E código exato (sem diferenciar maiúsculas) antes de habilitar', () => {
    const fixture = render(OVERDUE);
    const el: HTMLElement = fixture.nativeElement;

    expect(q(el, 'cancel-code')?.textContent?.trim()).toBe('abcd1234');
    expect(confirm(el).disabled).toBe(true);

    pickReason(fixture, el, 'CUSTOMER_REQUEST');
    expect(confirm(el).disabled).toBe(true); // falta o código

    type(fixture, el, 'cancel-confirmation', 'abcd123');
    expect(confirm(el).disabled).toBe(true); // 7 caracteres

    type(fixture, el, 'cancel-confirmation', 'ABCD1234');
    expect(confirm(el).disabled).toBe(false);
  });

  it('vencida: código certo mas sem motivo continua desabilitado', () => {
    const fixture = render(OVERDUE);
    const el: HTMLElement = fixture.nativeElement;
    type(fixture, el, 'cancel-confirmation', 'abcd1234');
    expect(confirm(el).disabled).toBe(true);
    confirm(el).click();
    expect(cancelCharge).not.toHaveBeenCalled();
  });

  it('vencida: corpo com motivo, observação aparada, empresa e código digitado; contador da observação', () => {
    const fixture = render(OVERDUE);
    const el: HTMLElement = fixture.nativeElement;

    pickReason(fixture, el, 'CUSTOMER_REQUEST');
    type(fixture, el, 'reason-note', '  cliente devolveu o carro  ');
    expect(q(el, 'reason-note-count')?.textContent?.trim()).toBe('28/500');
    type(fixture, el, 'cancel-confirmation', 'AbCd1234');
    confirm(el).click();

    expect(cancelCharge).toHaveBeenCalledWith(CHARGE_ID, {
      companyId: 'co-1',
      reason: 'CUSTOMER_REQUEST',
      note: 'cliente devolveu o carro',
      confirmation: 'AbCd1234',
    });
  });

  it('enquanto envia, o botão fica desabilitado e um segundo clique não envia de novo', () => {
    cancelCharge.mockReturnValue(new (class { subscribe() { return { unsubscribe() {} }; } pipe() { return this; } })());
    const fixture = render();
    const el: HTMLElement = fixture.nativeElement;

    confirm(el).click();
    fixture.detectChanges();
    expect(confirm(el).disabled).toBe(true);
    expect(confirm(el).textContent).toContain('Cancelando');
    confirm(el).click();
    expect(cancelCharge).toHaveBeenCalledTimes(1);
  });

  const OUTCOMES: [AdminCancelChargeResult['outcome'], keyof typeof notify, string][] = [
    ['CANCELED_AT_GATEWAY', 'success', 'Cobrança cancelada no Asaas'],
    ['CANCELED_ALREADY_GONE', 'success', 'Já estava removida no Asaas'],
    ['CANCELED_NO_GATEWAY_LINK', 'success', 'Cobrança cancelada (sem vínculo no Asaas)'],
    ['ALREADY_PAID_AT_GATEWAY', 'info', 'O Asaas mostra esta cobrança como paga; nada foi alterado'],
    ['GATEWAY_FAILED', 'warning', 'a cobrança continua aberta e a remoção foi reagendada'],
  ];

  for (const [outcome, kind, text] of OUTCOMES) {
    it(`desfecho ${outcome}: aviso ${kind} em português e a lista recarrega`, () => {
      cancelCharge.mockReturnValue(of(result(outcome)));
      const fixture = render();
      const changed = vi.fn();
      fixture.componentInstance.changed.subscribe(changed);

      confirm(fixture.nativeElement).click();

      expect(notify[kind]).toHaveBeenCalledTimes(1);
      expect(notify[kind].mock.calls[0][0]).toContain(text);
      expect(changed).toHaveBeenCalledTimes(1);
    });
  }

  const ERRORS: [number, Record<string, unknown>, string][] = [
    [400, { code: 'CANCEL_CHARGE_PAID', message: 'x' }, 'já foi paga'],
    [400, { code: 'CANCEL_CHARGE_DISPUTED', message: 'x' }, 'em disputa'],
    [400, { code: 'CANCEL_REASON_REQUIRED', message: 'x' }, 'escolha o motivo'],
    [400, { code: 'CANCEL_CONFIRMATION_REQUIRED', message: 'x' }, 'digite o código'],
    [409, { code: 'CANCEL_CHARGE_NOT_OPEN', message: 'x' }, 'Só cobrança em aberto'],
    [404, { message: 'Cobrança não encontrada.' }, 'não encontrada nesta empresa'],
    [403, {}, 'Só o Dono'],
  ];

  for (const [status, body, text] of ERRORS) {
    it(`erro ${status} ${String(body['code'] ?? '')}: mensagem clara, nada muda e não recarrega`, () => {
      cancelCharge.mockReturnValue(throwError(() => httpError(status, body)));
      const fixture = render();
      const changed = vi.fn();
      fixture.componentInstance.changed.subscribe(changed);

      confirm(fixture.nativeElement).click();
      fixture.detectChanges();

      expect(q(fixture.nativeElement, 'action-error')?.textContent).toContain(text);
      expect(changed).not.toHaveBeenCalled();
      expect(confirm(fixture.nativeElement).disabled).toBe(false); // pode tentar de novo
    });
  }
});

describe('AdminCharges - kebab "Cancelar cobrança"', () => {
  let caps: Set<AdminCapabilityCode>;
  let content: AdminChargeListItem[];

  beforeEach(() => {
    caps = new Set<AdminCapabilityCode>(['ver', 'cobranca.cancelar']);
    content = [{ ...BASE }];
    const page = (): AdminChargesPage => ({
      tab: 'FAILED', includeInternal: false, content, page: 0, size: 20, total: content.length,
      failedCount: 1, overdueCount: 0,
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCharges],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: AdminChargesService, useValue: { list: () => of(page()), cancelCharge: vi.fn() } },
        { provide: AdminCapabilitiesService, useValue: { can: (c: AdminCapabilityCode) => caps.has(c), ensureLoaded: () => of(null) } },
        { provide: AdminContactService, useValue: { reveal: vi.fn() } },
        { provide: ImpersonationService, useValue: { start: vi.fn() } },
        { provide: NotificationService, useValue: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } },
      ],
    });
  });

  function render(): { el: HTMLElement; fixture: ReturnType<typeof TestBed.createComponent<AdminCharges>> } {
    const fixture = TestBed.createComponent(AdminCharges);
    fixture.detectChanges();
    return { el: fixture.nativeElement, fixture };
  }

  function open(el: HTMLElement, fixture: { detectChanges(): void }): void {
    (el.querySelector('[data-testid="row-menu"] button[aria-haspopup="menu"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  it('o Dono vê "Cancelar cobrança" no kebab e ele abre o diálogo no modo cancelar', () => {
    const { el, fixture } = render();
    open(el, fixture);
    const item = el.querySelector('[data-testid="row-menu"] [data-testid="menu-cancel"]') as HTMLButtonElement;
    expect(item.textContent).toContain('Cancelar cobrança');

    item.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="charge-actions-sheet"]')?.getAttribute('data-mode')).toBe('cancel');
  });

  it('vencida também mostra o item (a regra "vencida é prova" só proíbe os outros caminhos)', () => {
    content = [{ ...BASE, ...OVERDUE }];
    const { el, fixture } = render();
    open(el, fixture);
    expect(el.querySelector('[data-testid="menu-cancel"]')).not.toBeNull();
  });

  it('Suporte/Leitura (sem cobranca.cancelar) não vê o item; sem nenhuma ação, nem o kebab', () => {
    caps.delete('cobranca.cancelar');
    const { el } = render();
    expect(el.querySelector('[data-testid="menu-cancel"]')).toBeNull();
    expect(el.querySelector('[data-testid="row-menu"]')).toBeNull();
  });

  it('cobrança paga não oferece o item', () => {
    content = [{ ...BASE, status: 'PAID' }];
    const { el, fixture } = render();
    expect(el.querySelector('[data-testid="menu-cancel"]')).toBeNull();
    void fixture;
  });
});
