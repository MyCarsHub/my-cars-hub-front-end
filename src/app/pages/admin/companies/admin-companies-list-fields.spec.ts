import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminCompanies } from './admin-companies';
import { AdminCompaniesService } from '../admin-companies.service';
import { AdminSegmentsService } from '../segments/admin-segments.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import type { AdminCompanyListItem } from '../../../types/admin-company.types';
import type { CompanyEngagement } from '../../../types/admin-segments.types';

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Empresas, 18/11/2026: cada linha diz segmento, último sinal real, prazo, frota e próxima ação. */
describe('AdminCompanies — campos da linha', () => {
  const ENGAGEMENT: CompanyEngagement = {
    segment: 'PAYING_ACTIVE',
    segmentReasons: [],
    recent: null,
    progress: 'RENTAL',
    lastAction: { kind: 'CHARGE_CANCELED', at: '2026-11-05T18:41:00Z' },
    lastAccessAt: '2026-11-16T13:20:00Z',
    lastSignalAt: '2026-11-16T13:20:00Z',
    deadline: { kind: 'RENEWAL', at: '2026-11-30T12:00:00Z' },
    fleet: { vehicles: 6, drivers: 7, rentals: 5, activeRentals: 5 },
    openSupportTickets: 0,
    retentionEmailOptOut: false,
    nextAction: { key: 'CHECK_IN', reason: 'NONE' },
    lastContact: {
      id: 'k',
      contactedAt: '2026-11-13T14:00:00Z',
      channel: 'WHATSAPP',
      result: 'NO_ANSWER',
      followUpDate: '2026-11-20',
      createdByName: 'Lorran',
    },
    today: { status: 'HIDDEN_UNTIL_DATE', listedReason: null, hiddenUntil: '2026-11-20' },
  };

  const BASE: AdminCompanyListItem = {
    id: 'co-1',
    name: 'Facilita Locadora',
    documentMasked: null,
    planCode: 'STARTER_MONTHLY',
    planName: 'Starter',
    subscriptionStatus: 'ACTIVE',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    active: true,
    memberCount: 8,
    createdAt: null,
    internal: false,
    engagement: ENGAGEMENT,
  };

  let rows: ReturnType<typeof signal<AdminCompanyListItem[]>>;

  function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCompanies],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: AdminCompaniesService,
          useValue: {
            companies: rows,
            loading: signal(false),
            total: signal(rows().length),
            segmentCounts: signal({}),
            load: vi.fn().mockReturnValue(of({})),
            patchEngagement: vi.fn(),
          },
        },
        { provide: AdminSegmentsService, useValue: { today: () => of(null) } },
        { provide: AdminCapabilitiesService, useValue: { ensureLoaded: () => of(null), can: () => true } },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AdminCompanies);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    // Relógio fixo: as datas da linha dependem do ano corrente (o ano só aparece fora dele).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T19:40:00Z'));
    rows = signal([BASE]);
  });

  afterEach(() => vi.useRealTimers());

  it('prazo de outro ano leva o ano: "Renova em 22/10/2027", nunca "22/10" (que lê como passado)', () => {
    rows.set([{ ...BASE, engagement: { ...ENGAGEMENT, deadline: { kind: 'RENEWAL', at: '2027-10-22T12:00:00Z' } } }]);
    expect(text(render().querySelector('[data-testid="cell-deadline"]'))).toBe('Renova em 22/10/2027');
  });

  it('segmento em chip, sinal real, prazo, frota e próxima ação com o último contato', () => {
    const host = render();
    expect(text(host.querySelector('[data-testid="segment-chip"]'))).toBe('Pagante ativo');
    expect(text(host.querySelector('[data-testid="cell-signal"]'))).toContain('Cancelou cobrança');
    expect(text(host.querySelector('[data-testid="cell-signal"]'))).toContain('último acesso 16/11');
    expect(text(host.querySelector('[data-testid="cell-deadline"]'))).toMatch(/^Renova (em 30\/11|hoje|amanhã)$/);
    expect(text(host.querySelector('[data-testid="cell-fleet"]'))).toBe('6 veíc. · 7 mot. · 5 aluguéis');
    expect(text(host.querySelector('[data-testid="cell-next"] b'))).toBe('Nada urgente: perguntar como está indo');
    expect(text(host.querySelector('[data-testid="cell-contact"]'))).toBe(
      'Contato em 13/11, WhatsApp, sem resposta · retorno em 20/11',
    );
  });

  it('backend sem `engagement` não quebra a linha: "—" onde falta', () => {
    rows.set([{ ...BASE, engagement: undefined }]);
    const host = render();
    expect(host.querySelector('[data-testid="segment-chip"]')).toBeNull();
    expect(text(host.querySelector('[data-testid="cell-fleet"]'))).toBe('—');
    expect(text(host.querySelector('[data-testid="cell-next"] b'))).toBe('—');
  });

  it('suspensa ganha chip vermelho ao lado do segmento (cor só no chip)', () => {
    rows.set([{ ...BASE, active: false, status: 'SUSPENDED' }]);
    const host = render();
    const chip = host.querySelector('[data-testid="company-status-chip"]') as HTMLElement;
    expect(text(chip)).toBe('Suspensa');
    expect(chip.className).toContain('rose');
  });

  it('cancelada diz "Cancelada" em chip neutro, como no detalhe (nunca "Suspensa")', () => {
    rows.set([{ ...BASE, active: false, status: 'CANCELLED' }]);
    const host = render();
    const chip = host.querySelector('[data-testid="company-status-chip"]') as HTMLElement;
    expect(text(chip)).toBe('Cancelada');
    expect(chip.className).not.toContain('rose');
  });

  it('ativa não ganha chip de situação', () => {
    rows.set([{ ...BASE, active: true, status: 'ACTIVE' }]);
    expect(render().querySelector('[data-testid="company-status-chip"]')).toBeNull();
  });

  it('explica que o último sinal não conta ações da equipe', () => {
    expect(text(render().querySelector('[data-testid="signal-help"]'))).toContain('não conta as ações da equipe');
  });
});
