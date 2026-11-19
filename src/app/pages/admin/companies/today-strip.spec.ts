import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { TodayStrip } from './today-strip';
import type { CompanyEngagement, TodayList } from '../../../types/admin-segments.types';

const NOW = new Date('2026-11-18T19:40:00Z');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function engagement(over: Partial<CompanyEngagement> = {}): CompanyEngagement {
  return {
    segment: 'TRIAL_STALLED',
    segmentReasons: ['NO_RECENT_SIGNAL'],
    recent: null,
    progress: 'SIGNUP_ONLY',
    lastAction: null,
    lastAccessAt: null,
    lastSignalAt: null,
    deadline: { kind: 'TRIAL_ENDS', at: '2026-11-19T18:00:00Z' },
    fleet: { vehicles: 0, drivers: 0, rentals: 0, activeRentals: 0 },
    openSupportTickets: 0,
    retentionEmailOptOut: false,
    nextAction: { key: 'OFFER_TRIAL_EXTENSION', reason: 'TRIAL_ENDING_SOON' },
    lastContact: null,
    today: { status: 'LISTED', listedReason: 'SEGMENT', hiddenUntil: null },
    ...over,
  };
}

const TODAY: TodayList = {
  today: '2026-11-18',
  generatedAt: '2026-11-18T19:40:00Z',
  items: [
    { rank: 1, companyId: 'a', name: 'Cayque Transportes', ownerName: 'Cayque', engagement: engagement() },
    {
      rank: 2,
      companyId: 'b',
      name: 'Grao Carros',
      ownerName: null,
      engagement: engagement({
        segment: 'PAYING_COOLING',
        nextAction: { key: 'REENGAGE_PAYING', reason: 'NO_RECENT_SIGNAL' },
        deadline: { kind: 'RENEWAL', at: '2026-12-03T12:00:00Z' },
      }),
    },
  ],
  snoozed: [
    {
      companyId: 'c',
      name: 'Facilita Locadora',
      ownerName: null,
      engagement: engagement({
        segment: 'PAYING_ACTIVE',
        lastContact: {
          id: 'k',
          contactedAt: '2026-11-13T14:00:00Z',
          channel: 'WHATSAPP',
          result: 'NO_ANSWER',
          followUpDate: '2026-11-20',
          createdByName: 'Lorran',
        },
        today: { status: 'HIDDEN_UNTIL_DATE', listedReason: null, hiddenUntil: '2026-11-20' },
      }),
    },
  ],
  notInterestedCount: 1,
};

describe('TodayStrip — "Hoje, para agir"', () => {
  function render(data: TodayList | null, canContact = true) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [TodayStrip], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(TodayStrip);
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('now', NOW);
    fixture.componentRef.setInput('canContact', canContact);
    fixture.componentRef.setInput('canExtend', true);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('mostra a fila na ordem do servidor, com a próxima ação, o prazo e o chip do segmento', () => {
    const host = render(TODAY);
    const tiles = host.querySelectorAll('[data-testid="today-tile"]');
    expect(tiles.length).toBe(2);
    for (const part of ['Cayque Transportes', 'Oferecer mais dias de teste', 'Teste acaba amanhã', 'Teste parado']) {
      expect(text(tiles[0])).toContain(part);
    }
    expect(text(tiles[0]).startsWith('1')).toBe(true);
    expect(text(tiles[1])).toContain('Perguntar o que travou: parou de usar');
    expect(text(tiles[1])).toContain('Pagante esfriando');
    expect(text(host.querySelector('[data-testid="today-summary"]'))).toBe('2 empresas, prazo e dinheiro primeiro.');
  });

  it('cada cartão tem o ⋮ (nenhum botão solto) e nada de bolinha', () => {
    const host = render(TODAY);
    const tile = host.querySelector('[data-testid="today-tile"]') as HTMLElement;
    const buttons = tile.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].getAttribute('aria-haspopup')).toBe('menu');
  });

  it('"Com contato registrado" diz o contato e quando volta; "não tem interesse" só como número', () => {
    const host = render(TODAY);
    const row = host.querySelector('[data-testid="snoozed-row"]');
    expect(text(row?.querySelector('a'))).toBe('Facilita Locadora');
    expect(text(row)).toContain('Contato em 13/11, WhatsApp, sem resposta');
    expect(text(row?.querySelector('app-status-chip'))).toBe('volta em 20/11');
    expect(text(host.querySelector('[data-testid="today-not-interested"]'))).toBe(
      '1 empresa disse que não tem interesse e saiu das sugestões.',
    );
  });

  it('fila vazia diz isso em vez de sumir', () => {
    const host = render({ ...TODAY, items: [], snoozed: [], notInterestedCount: 0 });
    expect(host.querySelector('[data-testid="today-empty"]')).not.toBeNull();
  });
});
