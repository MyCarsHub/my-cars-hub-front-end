import { describe, expect, it } from 'vitest';

import { BRL_EMPTY, BrlPipe, formatBrl } from './brl.pipe';

/** `Intl` writes a non-breaking space after "R$"; compare with a plain one. */
const plain = (s: string): string => s.replace(/ /g, ' ');

describe('formatBrl / brl pipe', () => {
  it.each([
    [12345, 'R$ 123,45'],
    [12040000, 'R$ 120.400,00'],
    [0, 'R$ 0,00'],
    [-0, 'R$ 0,00'],
    [-0.4, 'R$ 0,00'],
    [-12345, '-R$ 123,45'],
    [1999.6, 'R$ 20,00'],
    [123456789, 'R$ 1.234.567,89'],
    ['12345', 'R$ 123,45'],
  ] as const)('cents %s -> %s', (value, expected) => {
    expect(plain(formatBrl(value))).toBe(expected);
  });

  it('reais keep their own cents', () => {
    expect(plain(formatBrl(120400, 'reais'))).toBe('R$ 120.400,00');
    expect(plain(formatBrl(1234.5, 'reais'))).toBe('R$ 1.234,50');
  });

  it.each([null, undefined, '', 'abc', Number.NaN, Number.POSITIVE_INFINITY])(
    'absent or not a number (%s) is the dash, never R$ 0,00',
    (value) => {
      expect(formatBrl(value as number | string | null | undefined)).toBe(BRL_EMPTY);
      expect(BRL_EMPTY).toBe('—');
    },
  );

  it('keeps the non-breaking space so "R$" never wraps alone', () => {
    expect(formatBrl(100)).toBe('R$ 1,00');
  });

  it('the pipe is the same function', () => {
    const pipe = new BrlPipe();
    expect(plain(pipe.transform(4590000))).toBe('R$ 45.900,00');
    expect(plain(pipe.transform(45900, 'reais'))).toBe('R$ 45.900,00');
    expect(pipe.transform(null)).toBe('—');
  });
});
