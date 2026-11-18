import { describe, expect, it } from 'vitest';

import { whenAgo, whenDay, whenExact, whenLong, whenTime } from './admin-when';

describe('admin-when', () => {
  it('lê UTC sem sufixo e escreve no fuso de Brasília', () => {
    expect(whenExact('2026-07-30T14:35:00')).toBe('30/07/2026 às 11:35');
    expect(whenExact('2026-11-19T01:30:00')).toBe('18/11/2026 às 22:30');
    expect(whenDay('2026-11-19T01:30:00')).toBe('18/11/2026');
    expect(whenTime('2026-11-19T01:30:00')).toBe('22:30');
  });

  it('respeita o sufixo quando o servidor manda', () => {
    expect(whenExact('2026-11-18T12:00:00-03:00')).toBe('18/11/2026 às 12:00');
  });

  it('balão longo com segundos e o fuso escrito', () => {
    expect(whenLong('2026-11-18T17:32:05')).toBe(
      'quarta-feira, 18 de novembro de 2026 às 14:32:05 (horário de Brasília)',
    );
  });

  it('sem data: nulo ou travessão, nunca "Invalid Date"', () => {
    expect(whenExact(null)).toBeNull();
    expect(whenExact('lixo')).toBeNull();
    expect(whenDay(undefined)).toBe('—');
    expect(whenLong('')).toBeNull();
  });

  it('há quanto tempo, com o relógio fixado', () => {
    const now = Date.parse('2026-11-18T18:00:00Z');
    expect(whenAgo('2026-11-18T17:59:40', now)).toBe('agora');
    expect(whenAgo('2026-11-18T17:48:00', now)).toBe('há 12 min');
    expect(whenAgo('2026-11-18T15:00:00', now)).toBe('há 3 h');
    expect(whenAgo('2026-11-17T17:00:00', now)).toBe('há 1 dia');
    expect(whenAgo('2026-11-13T18:00:00', now)).toBe('há 5 dias');
    expect(whenAgo('2026-09-01T18:00:00', now)).toBeNull();
    expect(whenAgo('2026-11-19T18:00:00', now)).toBeNull();
  });
});
