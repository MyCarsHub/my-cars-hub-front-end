import { describe, expect, it } from 'vitest';

import { nowHhMmInBusinessTz, todayInBusinessTz } from './business-clock';

/**
 * O relógio de negócio é de Brasília, não do navegador. Os instantes abaixo são
 * UTC explícitos (sufixo `Z`), então o resultado não depende do fuso da máquina
 * que roda o teste — que é justamente o defeito sendo corrigido.
 */
describe('business-clock', () => {
  it('converte o instante UTC para a data de Brasília (UTC−3)', () => {
    // 02:00Z do dia 7 ainda é dia 6 às 23:00 em Brasília.
    expect(todayInBusinessTz(new Date('2026-08-07T02:00:00Z'))).toBe('2026-08-06');
    expect(nowHhMmInBusinessTz(new Date('2026-08-07T02:00:00Z'))).toBe('23:00');
  });

  it('vira o dia em Brasília, não em UTC', () => {
    // 03:00Z = 00:00 em Brasília — já é o dia seguinte lá.
    expect(todayInBusinessTz(new Date('2026-08-07T03:00:00Z'))).toBe('2026-08-07');
    expect(nowHhMmInBusinessTz(new Date('2026-08-07T03:00:00Z'))).toBe('00:00');
  });

  it('a meia-noite sai como 00:00, nunca 24:00', () => {
    expect(nowHhMmInBusinessTz(new Date('2026-01-01T03:00:00Z'))).toBe('00:00');
  });

  it('formata com dois dígitos em data e hora', () => {
    expect(todayInBusinessTz(new Date('2026-03-05T15:04:00Z'))).toBe('2026-03-05');
    expect(nowHhMmInBusinessTz(new Date('2026-03-05T12:04:00Z'))).toBe('09:04');
  });
});
