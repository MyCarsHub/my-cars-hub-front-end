import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminCompanyDetail } from './admin-company-detail';
import { revealDetail } from './company-detail.testing';
import { AdminCompaniesService } from '../admin-companies.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import type { AdminCompanyDetail as Dto } from '../../../types/admin-company.types';

/** FEAT-0483 — bloco financeiro, assinatura derivada e equipe com lastSeenAt. */
describe('AdminCompanyDetail — financeiro, assinatura e equipe', () => {
  const REG = {
    phone: null, email: null, addressStreet: null, addressNumber: null, addressComplement: null,
    addressDistrict: null, addressCep: null, addressCity: 'Campinas', addressUf: 'SP',
    representativeName: null, representativeRole: null,
  };
  const BASE: Dto = {
    id: 'co-1',
    name: 'Locadora Silva',
    documentMasked: null,
    status: 'ACTIVE',
    active: true,
    createdAt: null,
    modifiedAt: null,
    subscription: {
      id: 's1', planCode: 'PRO', planName: 'Pro', status: 'ACTIVE', billingCycle: 'MONTHLY',
      gateway: 'STRIPE', externalIdMasked: null, trialEndsAt: null, currentPeriodStart: null,
      currentPeriodEnd: null, nextBillingDate: null, cancelAtPeriodEnd: false,
      listPriceCents: 29_900, chargedCents: 29_900, discountCents: 0, paymentMethod: 'CARD',
    },
    members: [
      { userId: 'u1', name: 'Rafael', email: 'r@x.com', role: 'OWNER', status: 'ACTIVE', lastSeenAt: null },
    ],
    chargeIntegration: null,
    registration: REG,
    operations: {
      rentals: { total: 0, activeTotal: 0, closedTotal: 0, closedAmountCents: 0, completedTotal: 0, completedAmountCents: 0, canceledTotal: 0, paidAmountCents: 0 },
      contracts: { total: 0, generatedTotal: 0, signedTotal: 0 },
      vehicles: { total: 50, activeTotal: 48 },
      drivers: { total: 61, workingTotal: 40 },
      fines: { total: 0, pendingTotal: 0, amountCents: 0 },
      maintenances: { total: 0, costCents: 0 },
      sales: { sales: [], undos: [] },
    },
    internal: false,
    finance: {
      month: '2026-11',
      managedMonthCents: 8_640_000,
      receivedMonthCents: 7_120_000,
      overdueMonthCents: 480_000,
      managedSeries: [
        { month: '2026-06', managedCents: 100_000 },
        { month: '2026-11', managedCents: 8_640_000 },
      ],
    },
  };

  function render(dto: Dto): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCompanyDetail],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'co-1' })) } },
        {
          provide: AdminCompaniesService,
          useValue: {
            detail: signal<Dto | null>(dto),
            detailLoading: signal(false),
            statusUpdating: signal(false),
            internalUpdating: signal(false),
            loadDetail: vi.fn().mockReturnValue(of(dto)),
            updateStatus: vi.fn(),
            clearDetail: vi.fn(),
          },
        },
        { provide: NotificationService, useValue: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), push: vi.fn() } },
        { provide: ImpersonationService, useValue: { start: vi.fn(), active: () => false } },
      ],
    });
    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();
    revealDetail(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const tile = (host: HTMLElement, key: string) => text(host.querySelector(`[data-tile="${key}"]`));
  /** Rótulos do eixo x: o último filho de cada coluna (acima dele fica o número da coluna). */
  const axis = (card: Element) => Array.from(card.querySelectorAll('[data-bar-group]')).map((g) => text(g.lastElementChild));

  it('mostra gerenciado, recebido e atraso do mês e a série de 6 meses', () => {
    const host = render(BASE);
    expect(tile(host, 'managed')).toContain('86.400,00');
    expect(tile(host, 'received')).toContain('71.200,00');
    expect(tile(host, 'overdue')).toContain('4.800,00');
    // Pintados como no painel do dono: gerenciado laranja, recebido verde, atraso neutro.
    expect(host.querySelector('[data-tile="managed"]')?.className).toContain('bg-primary-500');
    expect(host.querySelector('[data-tile="received"]')?.className).toContain('bg-emerald');
    expect(host.querySelector('[data-tile="overdue"]')?.className).not.toContain('bg-primary');
    // Degradê só na Assinatura.
    expect(host.querySelector('[data-tile="subscription"]')?.className).toContain('subscription-card');
    expect(host.querySelector('[data-op-tile="vehicles"]')?.textContent).toContain('48');
    const series = text(host.querySelector('[data-testid="managed-series"]'));
    expect(series).toContain('jun/26');
    expect(series).toContain('nov/26');
    expect(series).toContain('vencimento');
  });

  it('valor gerenciado é coluna vertical: um mês por coluna, do mais antigo ao corrente, com centavos', () => {
    const host = render(BASE);
    const card = host.querySelector('[data-testid="managed-series"]')!;
    const plot = card.querySelector('[data-bar-columns]') as HTMLElement | null;
    expect(plot).not.toBeNull();
    expect(plot!.style.height).toBe('200px');
    const groups = axis(card);
    expect(groups).toEqual(['jun/26', 'nov/26']);
    expect(card.querySelectorAll('[data-bar-column]').length).toBe(2);
    // A leitura (tabela acessível = o que o toque mostra) leva o valor inteiro, com centavos.
    const table = text(card.querySelector('table'));
    expect(table).toContain('R$ 1.000,00');
    expect(table).toContain('R$ 86.400,00');
    expect(card.querySelector('[data-bar-legend]')).toBeNull();
    expect(card.querySelector('[data-bar-control]')?.getAttribute('aria-label')).toBe('Valor gerenciado por mês');
  });

  it('12 meses cabem na mesma altura e o eixo perde o ano para não encavalar no celular', () => {
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(2025, 11 + i, 1));
      return { month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, managedCents: (i + 1) * 10_000 };
    });
    const host = render({ ...BASE, finance: { ...BASE.finance!, managedSeries: months } });
    const card = host.querySelector('[data-testid="managed-series"]')!;
    expect((card.querySelector('[data-bar-columns]') as HTMLElement).style.height).toBe('200px');
    const groups = axis(card);
    expect(groups).toEqual(['dez', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov']);
    expect(text(card.querySelector('table'))).toContain('R$ 1.200,00');
  });

  it('sem bloco finance mostra "—", nunca R$ 0', () => {
    const host = render({ ...BASE, finance: null });
    expect(tile(host, 'managed')).toContain('—');
    expect(tile(host, 'managed')).not.toContain('0,00');
    expect(host.querySelector('[data-testid="managed-series-empty"]')).not.toBeNull();
  });

  it('assinatura: valores derivados nulos viram "—"; desconto 0 é "Sem desconto"; Pix/Cartão', () => {
    const sub = BASE.subscription!;
    const ok = render(BASE);
    const rows = Array.from(ok.querySelectorAll('[data-testid="sub-row"]')).map((r) => text(r));
    expect(rows.join('|')).toContain('Preço de tabelaR$ 299,00');
    expect(rows.join('|')).toContain('Sem desconto');
    expect(rows.join('|')).toContain('Cartão');

    const nulls = render({
      ...BASE,
      subscription: { ...sub, chargedCents: null, discountCents: null, paymentMethod: null },
    });
    const text2 = Array.from(nulls.querySelectorAll('[data-testid="sub-row"]')).map((r) => text(r));
    expect(text2).toContain('Desconto—');
    expect(text2).toContain('Cobrado de verdade—');
    expect(text2).toContain('Forma de pagamento—');
  });

  it('equipe: lastSeenAt nulo é "—" e recente é "hoje"', () => {
    const none = render(BASE);
    expect(text(none.querySelector('[data-testid="last-seen"]'))).toBe('—');
    const recent = render({
      ...BASE,
      members: [{ ...BASE.members[0], lastSeenAt: new Date().toISOString() }],
    });
    expect(text(recent.querySelector('[data-testid="last-seen"]'))).toBe('hoje');
  });

  it('mostra cidade e UF do cadastro na linha do cabeçalho', () => {
    expect(text(render(BASE).querySelector('header p'))).toContain('Campinas, SP');
  });
});
