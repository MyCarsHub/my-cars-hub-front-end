import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorService } from '../../../services/api-error.service';
import type { AdminChargeListItem, AsaasComparison } from '../../../types/admin-charges.types';
import { AdminChargesService } from './admin-charges.service';
import { ChargeActionMode, ChargeActionsSheet } from './charge-actions-sheet';

const BASE: AdminChargeListItem = {
  chargeId: 'ch-1',
  rentalId: 'rt-1',
  rentalStatus: 'ACTIVE',
  kind: 'CAUCAO',
  status: 'PENDING',
  amountCents: 120000,
  dueDate: '2026-10-29',
  daysOverdue: 0,
  failureCode: null,
  failureReason: null,
  companyId: 'co-1',
  companyName: 'Clube do Teste',
  companyInternal: false,
  driverId: 'drv-1',
  driverName: 'Giovane Lima',
  driverPhoneMasked: '(11) •••••-4321',
};

const COMPARISON: AsaasComparison = {
  chargeId: 'ch-1',
  rentalId: 'rt-1',
  companyId: 'co-1',
  externalId: 'pay_iy22uunv9fvmyk4q',
  result: 'DIVERGENT',
  message: 'Há diferenças entre o MyCarsHub e o Asaas (destacadas).',
  comparedOn: '2026-10-29',
  fields: [
    { key: 'value', kind: 'CENTS', local: '120000', asaas: '98000', divergent: true },
    { key: 'dueDate', kind: 'DATE', local: '2026-10-29', asaas: '2026-10-29', divergent: false },
    { key: 'status', kind: 'TEXT', local: 'PENDING', asaas: 'PENDING', divergent: false },
  ],
};

describe('ChargeActionsSheet', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    service = {
      compareWithAsaas: vi.fn().mockReturnValue(of(COMPARISON)),
      markReceivedOutside: vi.fn().mockReturnValue(
        of({ chargeId: 'ch-1', action: 'RECEIVED_OUTSIDE', outcome: 'MARKED_RECEIVED_OUTSIDE', status: 'PAID', done: true, hint: null }),
      ),
      retry: vi.fn().mockReturnValue(
        of({ chargeId: 'ch-1', action: 'RETRY', outcome: 'RETRIED', status: null, done: true, hint: null }),
      ),
      correctDriverName: vi.fn().mockReturnValue(
        of({ driverId: 'drv-1', companyId: 'co-1', name: 'Giovane Lima de Sousa', userUpdated: true, asaasCustomerLinked: true }),
      ),
      syncDriverAsaasCustomer: vi.fn().mockReturnValue(
        of({
          driverId: 'drv-1', companyId: 'co-1', customerId: 'cus_000206163598', result: 'UPDATED',
          message: 'Cliente atualizado no Asaas com os dados atuais do motorista.',
          sentFields: ['name', 'cpfCnpj'], asaasName: 'Giovane Lima de Sousa',
        }),
      ),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ChargeActionsSheet],
      providers: [
        ApiErrorService,
        { provide: AdminChargesService, useValue: service },
        // Lote 2A: estas specs exercem o menu completo (Dono).
        { provide: AdminCapabilitiesService, useValue: { can: () => true, ensureLoaded: () => of(null) } },
      ],
    });
  });

  function render(item: Partial<AdminChargeListItem> = {}, mode: ChargeActionMode = 'menu') {
    const fixture = TestBed.createComponent(ChargeActionsSheet);
    fixture.componentRef.setInput('item', { ...BASE, ...item });
    fixture.componentRef.setInput('initialMode', mode);
    fixture.detectChanges();
    return fixture;
  }

  const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  it('menu: caução no prazo oferece comparar, recebida por fora, nome e Asaas — mas não "tentar de novo" (não é FAILED)', () => {
    const el: HTMLElement = render().nativeElement;

    expect(q(el, 'action-compare')).not.toBeNull();
    expect(q(el, 'action-received')).not.toBeNull();
    expect(q(el, 'action-name')).not.toBeNull();
    expect(q(el, 'action-sync')).not.toBeNull();
    expect(q(el, 'action-retry')).toBeNull();
  });

  it('"Tentar de novo" só para FAILED com hoje ≤ vencimento', () => {
    expect(q(render({ status: 'FAILED', daysOverdue: 0 }).nativeElement, 'action-retry')).not.toBeNull();
    expect(q(render({ status: 'FAILED', daysOverdue: -3 }).nativeElement, 'action-retry')).not.toBeNull();
  });

  it('atrasada NUNCA oferece "tentar de novo" (FAILED vencida ou PAST_DUE) e explica a regra', () => {
    const failedLate: HTMLElement = render({ status: 'FAILED', daysOverdue: 1 }).nativeElement;
    expect(q(failedLate, 'action-retry')).toBeNull();
    expect(q(failedLate, 'overdue-rule')).not.toBeNull();

    const pastDue: HTMLElement = render({ status: 'PAST_DUE', daysOverdue: 9 }).nativeElement;
    expect(q(pastDue, 'action-retry')).toBeNull();
  });

  it('"recebida por fora": caução e parcela PENDENTE/ATRASADA sim; FAILED, paga e multa não', () => {
    expect(q(render({ kind: 'RENTAL_PERIOD', status: 'PENDING' }).nativeElement, 'action-received')).not.toBeNull();
    expect(q(render({ kind: 'RENTAL_TOTAL', status: 'PAST_DUE', daysOverdue: 9 }).nativeElement, 'action-received'))
      .not.toBeNull();
    expect(q(render({ kind: 'CAUCAO', status: 'PAST_DUE', daysOverdue: 2 }).nativeElement, 'action-received'))
      .not.toBeNull();
    expect(q(render({ kind: 'CAUCAO', status: 'FAILED' }).nativeElement, 'action-received')).toBeNull();
    expect(q(render({ kind: 'RENTAL_PERIOD', status: 'PAID' }).nativeElement, 'action-received')).toBeNull();
    expect(q(render({ kind: 'OVERDUE_FEE', status: 'PENDING' }).nativeElement, 'action-received')).toBeNull();
  });

  it('"Ver aluguel" mora no menu e avisa a página', () => {
    const fixture = render();
    const open = vi.fn();
    fixture.componentInstance.openRental.subscribe(open);

    (q(fixture.nativeElement, 'action-view-rental') as HTMLButtonElement).click();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('comparar: lado a lado formatado em R$ e com a divergência destacada', () => {
    const el: HTMLElement = render({}, 'compare').nativeElement;

    expect(service['compareWithAsaas']).toHaveBeenCalledWith('ch-1');
    const value = q(el, 'compare-row-value')!;
    expect(value.getAttribute('data-divergent')).toBe('true');
    expect(value.textContent).toContain('1.200,00');
    expect(value.textContent).toContain('980,00');
    expect(q(el, 'compare-row-dueDate')!.textContent).toContain('29/10/2026');
    expect(q(el, 'compare-row-status')!.textContent).toContain('Pendente');
    expect(el.textContent).toContain('pay_iy22uunv9fvmyk4q');
  });

  it('recebida por fora: motivo pré-escolhido + data (hoje, 16px) e manda motivo, nota e data; avisa a lista', () => {
    const fixture = render({ kind: 'RENTAL_PERIOD', status: 'PAST_DUE', daysOverdue: 9 }, 'received');
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    const el: HTMLElement = fixture.nativeElement;
    const date = q(el, 'date-field-input') as HTMLInputElement;

    expect(q(el, 'received-explainer')!.textContent).toContain('A parcela');
    expect(date.className).toContain('text-base');
    expect(date.getAttribute('max')).toBe(date.value);
    date.value = '2026-10-20';
    date.dispatchEvent(new Event('input'));
    const note = q(el, 'reason-note') as HTMLTextAreaElement;
    note.value = '  pagou em dinheiro ';
    note.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (q(el, 'action-confirm') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(service['markReceivedOutside']).toHaveBeenCalledWith('ch-1', {
      reason: 'PAID_OUTSIDE_GATEWAY',
      note: 'pagou em dinheiro',
      receivedOn: '2026-10-20',
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(q(el, 'action-result')!.textContent).toContain('recebida por fora em 20/10/2026');
    expect(q(el, 'action-result')!.textContent).toContain('O vencimento não mudou');
    // Atrasada: "recebida por fora" sim, "tentar de novo" continua fora do menu.
    expect(q(render({ kind: 'RENTAL_PERIOD', status: 'PAST_DUE', daysOverdue: 9 }).nativeElement, 'action-retry'))
      .toBeNull();
  });

  it('recebida por fora: data futura bloqueia o botão', () => {
    const fixture = render({}, 'received');
    const el: HTMLElement = fixture.nativeElement;
    const date = q(el, 'date-field-input') as HTMLInputElement;

    date.value = '2999-01-01';
    date.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect((q(el, 'action-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(service['markReceivedOutside']).not.toHaveBeenCalled();
  });

  it('tentar de novo: sem motivo o botão fica desabilitado', () => {
    const fixture = render({ status: 'FAILED', daysOverdue: 0 }, 'retry');
    const el: HTMLElement = fixture.nativeElement;

    expect((q(el, 'action-confirm') as HTMLButtonElement).disabled).toBe(true);
    (el.querySelector('[data-testid="reason-CUSTOMER_REQUEST"] input') as HTMLInputElement).click();
    fixture.detectChanges();
    expect((q(el, 'action-confirm') as HTMLButtonElement).disabled).toBe(false);
  });

  it('o 409 do backend (atrasada) aparece como erro e nada é dado como feito', () => {
    service['retry'].mockReturnValue(
      throwError(() => new HttpErrorResponse({
        status: 409,
        error: { message: 'Cobrança vencida não pode ser gerada de novo; ela permanece em atraso.' },
      })),
    );
    const fixture = render({ status: 'FAILED', daysOverdue: 0 }, 'retry');
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('[data-testid="reason-OTHER"] input') as HTMLInputElement).click();
    fixture.detectChanges();
    (q(el, 'action-confirm') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(q(el, 'action-error')).not.toBeNull();
    expect(q(el, 'action-result')).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });

  it('corrigir nome → oferece "Atualizar no Asaas" → PUT do cliente com o mesmo motivo', () => {
    const fixture = render({}, 'name');
    const el: HTMLElement = fixture.nativeElement;
    const input = q(el, 'driver-name-input') as HTMLInputElement;

    expect(input.value).toBe('Giovane Lima');
    expect(input.className).toContain('text-base');
    // Mesmo nome não salva.
    expect((q(el, 'action-confirm') as HTMLButtonElement).disabled).toBe(true);

    input.value = 'Giovane Lima de Sousa';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (q(el, 'action-confirm') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(service['correctDriverName']).toHaveBeenCalledWith('drv-1', {
      reason: 'DATA_CORRECTION',
      note: null,
      name: 'Giovane Lima de Sousa',
    });
    (q(el, 'continue-sync') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-mode]')?.getAttribute('data-mode')).toBe('sync');

    (q(el, 'action-confirm') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(service['syncDriverAsaasCustomer']).toHaveBeenCalledWith('drv-1', { reason: 'DATA_CORRECTION', note: null });
    expect(q(el, 'action-result')!.textContent).toContain('Giovane Lima de Sousa');
  });
});
