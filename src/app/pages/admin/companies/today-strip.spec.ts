import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { TODAY_STRIP_TOP, TodayStrip } from './today-strip';
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
  function renderFixture(data: TodayList | null, canContact = true) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [TodayStrip], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(TodayStrip);
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('now', NOW);
    fixture.componentRef.setInput('canContact', canContact);
    fixture.componentRef.setInput('canExtend', true);
    fixture.detectChanges();
    return fixture;
  }

  function render(data: TodayList | null, canContact = true) {
    return renderFixture(data, canContact).nativeElement as HTMLElement;
  }

  function many(n: number, optOut: number[] = []): TodayList {
    return {
      ...TODAY,
      items: Array.from({ length: n }, (_, i) => ({
        rank: i + 1,
        companyId: `co-${i + 1}`,
        name: `Empresa ${i + 1}`,
        ownerName: null,
        engagement: engagement({ retentionEmailOptOut: optOut.includes(i + 1) }),
      })),
    };
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
  it('curta: só as 5 primeiras na ordem do servidor; "Ver todas (N)" abre o resto na mesma fileira', () => {
    const fixture = renderFixture(many(18));
    const host = fixture.nativeElement as HTMLElement;
    const names = () => Array.from(host.querySelectorAll('[data-testid="today-tile"] a')).map((a) => text(a));
    expect(TODAY_STRIP_TOP).toBe(5);
    expect(names()).toEqual(['Empresa 1', 'Empresa 2', 'Empresa 3', 'Empresa 4', 'Empresa 5']);
    const toggle = host.querySelector('[data-testid="today-toggle"]') as HTMLButtonElement;
    expect(text(toggle)).toBe('Ver todas (18)');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(names().length).toBe(18);
    expect(text(toggle)).toBe('Ver só as 5 primeiras');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    fixture.detectChanges();
    expect(names().length).toBe(5);
  });

  it('até 5 empresas: sem "Ver todas"', () => {
    const host = render(many(5));
    expect(host.querySelectorAll('[data-testid="today-tile"]').length).toBe(5);
    expect(host.querySelector('[data-testid="today-toggle"]')).toBeNull();
  });

  it('uma fileira que rola de lado em toda largura, com cartão de largura fixa (texto e chip cabem)', () => {
    const host = render(many(8));
    const row = host.querySelector('[data-testid="today-row"]') as HTMLElement;
    expect(row.className).toContain('overflow-x-auto');
    expect(row.className).not.toMatch(/(^|\s)lg:grid/);
    const tile = host.querySelector('[data-testid="today-tile"]') as HTMLElement;
    expect(tile.className).toContain('w-[272px]');
    expect(tile.className).toContain('shrink-0');
    expect(tile.className).not.toContain('lg:w-auto');
    expect(host.querySelector('[data-testid="today-tile"] app-status-chip')?.className).toContain('whitespace-nowrap');
  });

  it('quem pediu para não receber mensagem de retenção sai das sugestões e vira só um número', () => {
    const host = render(many(7, [2]));
    const names = Array.from(host.querySelectorAll('[data-testid="today-tile"] a')).map((a) => text(a));
    expect(names).not.toContain('Empresa 2');
    expect(names[1]).toBe('Empresa 3');
    // O número do cartão é a posição na faixa, sem buraco de quem saiu.
    const ranks = Array.from(host.querySelectorAll('[data-testid="today-tile"]')).map((t) => text(t.querySelector('span')));
    expect(ranks).toEqual(['1', '2', '3', '4', '5']);
    expect(text(host.querySelector('[data-testid="today-toggle"]'))).toBe('Ver todas (6)');
    expect(text(host.querySelector('[data-testid="today-summary"]'))).toBe('6 empresas, prazo e dinheiro primeiro.');
    expect(text(host.querySelector('[data-testid="today-opted-out"]'))).toBe(
      '1 empresa pediu para não receber mensagens de retenção e ficou fora das sugestões.',
    );
  });
});
