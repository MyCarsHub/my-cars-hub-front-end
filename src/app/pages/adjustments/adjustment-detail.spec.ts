import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdjustmentsService } from '../../services/adjustments.service';
import { NotificationService } from '../../services/notification.service';
import { Adjustment } from '../../types/adjustment.types';
import { addDaysIso } from '../../utils/adjustments-view';
import { todayInBusinessTz } from '../../utils/business-clock';
import { AdjustmentDetail } from './adjustment-detail';

const TODAY = todayInBusinessTz();

function adj(over: Partial<Adjustment> = {}): Adjustment {
  return {
    id: 'a1',
    driverId: 'd1',
    driverName: 'Carlos Mendes',
    description: 'Reabastecimento na devolução',
    amountCents: 18000,
    dueDate: addDaysIso(TODAY, 5),
    status: 'PENDING',
    paymentMethod: 'PIX',
    paidAt: null,
    paidAmountCents: null,
    createdAt: '2026-11-10T14:02:00',
    createdByName: 'Lorran',
    issuedAt: '2026-11-10T14:02:00',
    canceledAt: null,
    failureReason: null,
    pixAvailable: true,
    rentalId: 'r1',
    chargeId: 'c1',
    driver: { id: 'd1', name: 'Carlos Mendes', licenseCategory: 'B', phoneMasked: '(11) •••••-1234', otherAdjustments: 2 },
    history: [
      { type: 'CREATED', at: '2026-11-10T14:02:00', actorName: 'Lorran' },
      { type: 'PIX_ISSUED', at: '2026-11-10T14:02:00', actorName: null },
    ],
    ...over,
  };
}

describe('AdjustmentDetail', () => {
  let pix: ReturnType<typeof vi.fn>;

  function create(a: Adjustment) {
    TestBed.resetTestingModule();
    pix = vi.fn().mockReturnValue(of('000201PIX'));
    TestBed.configureTestingModule({
      imports: [AdjustmentDetail],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => a.id } } } },
        { provide: AdjustmentsService, useValue: { getOne: vi.fn().mockReturnValue(of(a)), pix } },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AdjustmentDetail);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  beforeEach(() => TestBed.resetTestingModule());

  it('motorista no título, chip de status, valor no cartão laranja e o histórico', () => {
    const el = create(adj());
    expect(text(el.querySelector('h1'))).toContain('Carlos Mendes');
    expect(text(el.querySelector('[data-adjustment-status]'))).toBe('Pendente');
    const card = el.querySelector('app-painted-card[data-adjustment-value-card]');
    expect(card?.getAttribute('data-tone')).toBe('orange');
    expect(text(card)).toContain('R$ 180,00');
    expect(text(el.querySelector('[data-driver-card]'))).toContain('(11) •••••-1234');
    expect(text(el.querySelector('[data-adjustment-history]'))).toContain('Criado por Lorran');
    expect(text(el.querySelector('[data-adjustment-history]'))).toContain('Pix gerado para o motorista');
  });

  it('pendente com Pix: oferece copiar o copia-e-cola', () => {
    const el = create(adj());
    expect(el.querySelector('[data-copy-pix]')).not.toBeNull();
  });

  it('paga: cartão verde, sem Pix', () => {
    const el = create(adj({ status: 'PAID', paidAt: '2026-11-18T09:41:00', pixAvailable: false }));
    expect(el.querySelector('app-painted-card[data-adjustment-value-card]')?.getAttribute('data-tone')).toBe('green');
    expect(el.querySelector('[data-copy-pix]')).toBeNull();
    expect(text(el.querySelector('[data-adjustment-status]'))).toBe('Paga');
  });

  it('emitindo: sem Pix, com Atualizar (que só relê, não reemite)', () => {
    const el = create(adj({ status: 'ISSUING', pixAvailable: false, chargeId: null }));
    expect(text(el.querySelector('[data-adjustment-status]'))).toBe('Emitindo');
    expect(el.querySelector('[data-copy-pix]')).toBeNull();
    expect(text(el.querySelector('[data-refresh]'))).toBe('Atualizar');
  });

  it('emissão falhou: diz que nada foi cobrado e NÃO oferece gerar de novo', () => {
    const el = create(adj({ status: 'ISSUE_FAILED', pixAvailable: false, failureReason: 'O Asaas recusou a cobrança deste ajuste.' }));
    expect(text(el.querySelector('[data-adjustment-status]'))).toBe('Não emitida');
    expect(text(el.querySelector('[data-adjustment-value-card]'))).toContain('Nada foi cobrado');
    expect(el.textContent).not.toMatch(/Gerar de novo|Tentar de novo|Reemitir/);
  });

  it('nenhum estado tem Editar, Excluir, Cancelar cobrança, Marcar como paga ou Gerar de novo', () => {
    for (const status of ['ISSUING', 'ISSUE_FAILED', 'PENDING', 'PAST_DUE', 'PAID', 'CANCELED', 'FAILED']) {
      const el = create(adj({ status }));
      expect(el.querySelector('app-detail-actions')).toBeNull();
      expect(el.textContent, status).not.toMatch(/Editar|Excluir|Cancelar cobrança|Marcar como paga|Gerar de novo/);
    }
  });

  it('atrasada: avisa que o mesmo Pix vale e que não é reemitida', () => {
    const el = create(adj({ status: 'PAST_DUE', dueDate: addDaysIso(TODAY, -3) }));
    expect(text(el.querySelector('[data-adjustment-status]'))).toBe('Atrasada');
    expect(text(el.querySelector('[data-adjustment-value-card]'))).toContain('não é reemitida');
  });
});
