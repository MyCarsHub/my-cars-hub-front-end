import { describe, expect, it } from 'vitest';
import type { CompanyEngagement } from '../../../types/admin-segments.types';
import {
  activityLine,
  addDays,
  businessDay,
  dayMonth,
  deadlineText,
  fleetText,
  lastContactText,
  lastSignalText,
  nextActionTitle,
  segmentChip,
  trialActionLabel,
  weekdayName,
  whatsAppMessage,
  whyLines,
} from './segment-copy';

/** 18/11/2026, 16:40 em Brasília (19:40 UTC). */
const NOW = new Date('2026-11-18T19:40:00Z');

function engagement(over: Partial<CompanyEngagement> = {}): CompanyEngagement {
  return {
    segment: 'TRIAL_STALLED',
    segmentReasons: ['NO_RECENT_SIGNAL'],
    recent: null,
    progress: 'SIGNUP_ONLY',
    lastAction: null,
    lastAccessAt: '2026-11-13T22:10:00Z',
    lastSignalAt: '2026-11-13T22:10:00Z',
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

describe('segment-copy', () => {
  it('segmento vira chip: cor só no chip, neutro para o que não pede ação', () => {
    expect(segmentChip('PAYING_COOLING')).toEqual({ label: 'Pagante esfriando', tone: 'red' });
    expect(segmentChip('TRIAL_STALLED')).toEqual({ label: 'Teste parado', tone: 'amber' });
    expect(segmentChip('NO_ACTIVATION')?.tone).toBe('neutral');
    expect(segmentChip(null)).toBeNull();
  });

  it('teste vigente estende; vencido reabre', () => {
    expect(trialActionLabel('TRIAL_STALLED')).toBe('Estender teste');
    expect(trialActionLabel('NO_ACTIVATION')).toBe('Reabrir teste');
  });

  it('datas de calendário nunca passam pelo fuso do navegador', () => {
    expect(dayMonth('2026-11-20')).toBe('20/11');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(weekdayName('2026-11-19')).toBe('quinta-feira');
    // 02:30 UTC de 19/11 ainda é 18/11 em Brasília.
    expect(businessDay('2026-11-19T02:30:00Z')).toBe('2026-11-18');
    // LocalDateTime sem fuso é UTC (parseServerTime).
    expect(businessDay('2026-11-19T02:30:00')).toBe('2026-11-18');
  });

  it('prazo: acaba amanhã, acabou em, renova em', () => {
    expect(deadlineText(engagement(), NOW)).toBe('Teste acaba amanhã');
    expect(deadlineText(engagement({ deadline: { kind: 'TRIAL_ENDS', at: '2026-11-18T23:00:00Z' } }), NOW)).toBe('Teste acaba hoje');
    expect(deadlineText(engagement({ deadline: { kind: 'TRIAL_ENDED', at: '2026-10-25T12:00:00Z' } }), NOW)).toBe('Teste acabou em 25/10');
    expect(deadlineText(engagement({ deadline: { kind: 'RENEWAL', at: '2026-12-03T12:00:00Z' } }), NOW)).toBe('Renova em 03/12');
    expect(deadlineText(engagement({ deadline: null }), NOW)).toBe('—');
  });

  it('último sinal real: ação com quando e o último acesso; sem ação diz isso', () => {
    expect(lastSignalText(engagement(), NOW)).toBe('Nenhuma ação real · último acesso 13/11');
    expect(
      lastSignalText(engagement({ lastAction: { kind: 'VEHICLE_CREATED', at: '2026-11-14T15:02:11Z' }, lastAccessAt: null }), NOW),
    ).toBe('Cadastrou veículo há 4 dias');
    expect(lastSignalText(engagement({ lastAccessAt: null }), NOW)).toBe('Nenhuma ação real · nunca acessou');
  });

  it('frota: só cadastro ou a contagem curta', () => {
    expect(fleetText(engagement())).toBe('Só cadastro');
    expect(fleetText(engagement({ fleet: { vehicles: 6, drivers: 7, rentals: 1, activeRentals: 1 } }))).toBe(
      '6 veíc. · 7 mot. · 1 aluguel',
    );
  });

  it('próxima ação: chamados contados e esfriando pelo motivo', () => {
    expect(nextActionTitle(engagement())).toBe('Oferecer mais dias de teste');
    expect(
      nextActionTitle(engagement({ openSupportTickets: 3, nextAction: { key: 'ANSWER_SUPPORT', reason: 'OPEN_SUPPORT_TICKETS' } })),
    ).toBe('Responder os 3 chamados abertos antes de vender');
    expect(nextActionTitle(engagement({ nextAction: { key: 'REENGAGE_PAYING', reason: 'PAST_DUE' } }))).toBe(
      'Regularizar a mensalidade em atraso',
    );
    expect(nextActionTitle(engagement({ nextAction: null }))).toBeNull();
  });

  it('"por quê" junta os motivos do segmento e da ação, sem repetir', () => {
    expect(whyLines(engagement())).toEqual(['Nenhuma ação real nem acesso recente', 'O teste está acabando']);
  });

  it('último contato: volta na data ou só quando o segmento mudar', () => {
    const contact = {
      id: 'c1',
      contactedAt: '2026-11-13T14:00:00Z',
      channel: 'WHATSAPP' as const,
      result: 'NO_ANSWER' as const,
      followUpDate: '2026-11-20',
      createdByName: 'Lorran',
    };
    expect(
      lastContactText(engagement({ lastContact: contact, today: { status: 'HIDDEN_UNTIL_DATE', listedReason: null, hiddenUntil: '2026-11-20' } })),
    ).toBe('Contato em 13/11, WhatsApp, sem resposta · retorno em 20/11');
    expect(
      lastContactText(
        engagement({
          lastContact: { ...contact, followUpDate: null },
          today: { status: 'HIDDEN_UNTIL_SEGMENT_CHANGES', listedReason: null, hiddenUntil: null },
        }),
      ),
    ).toBe('Contato em 13/11, WhatsApp, sem resposta · sem retorno marcado');
    expect(lastContactText(engagement())).toBeNull();
  });

  it('mensagem pronta: equipe, primeiro nome, a empresa; "Não tem interesse" fica sem mensagem', () => {
    const text = whatsAppMessage(engagement(), 'Cayque Transportes', 'Cayque Souza', NOW);
    expect(text).toBe(
      'Olá, Cayque! Aqui é da equipe MyCarsHub. O teste da Cayque Transportes acaba amanhã. Se precisar de mais tempo para testar, eu estendo para você.',
    );
    expect(whatsAppMessage(engagement({ nextAction: { key: 'NONE', reason: 'NOT_INTERESTED' } }), 'X', null, NOW)).toBeNull();
    expect(whatsAppMessage(engagement({ nextAction: { key: 'CHECK_IN', reason: 'NONE' } }), 'Facilita', null, NOW)).toContain(
      'Olá! Aqui é da equipe MyCarsHub.',
    );
  });

  it('atividade: contato com nota e retorno; ação agrupada com a contagem', () => {
    const contact = activityLine({
      at: '2026-11-13T14:00:00Z',
      category: 'CONTACT',
      kind: 'CONTACT_LOGGED',
      count: 1,
      contact: {
        id: 'c1',
        contactedAt: '2026-11-13T14:00:00Z',
        channel: 'WHATSAPP',
        result: 'NO_ANSWER',
        note: 'Tentar na sexta',
        followUpDate: '2026-11-20',
        createdByName: 'Lorran',
      },
      subscription: null,
    });
    expect(contact).toEqual({
      day: '13/11',
      text: 'Lorran registrou contato por WhatsApp: sem resposta. Retorno marcado para 20/11.',
      note: 'Tentar na sexta',
      chip: { label: 'Contato', tone: 'blue' },
    });
    const action = activityLine({ at: '2026-11-05T18:41:00Z', category: 'ACTION', kind: 'CHARGE_CANCELED', count: 4, contact: null, subscription: null });
    expect(action.text).toBe('Cancelou cobrança (4 vezes)');
    expect(action.chip.label).toBe('Ação real');
    const sub = activityLine({
      at: '2026-10-29T12:00:00Z',
      category: 'SUBSCRIPTION',
      kind: 'SUBSCRIPTION_CHANGED',
      count: 1,
      contact: null,
      subscription: { fromStatus: 'PAST_DUE', toStatus: 'ACTIVE', fromPlanCode: 'A', toPlanCode: 'A', source: 'webhook' },
    });
    expect(sub.text).toBe('A assinatura passou de em atraso para ativa');
  });
});
