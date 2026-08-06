import { describe, expect, it } from 'vitest';
import { isCepShapeValid, maskCep, normalizeCep } from './cep-mask';

describe('cep-mask', () => {
  it('mantém o zero à esquerda — CEP é string, nunca número', () => {
    expect(normalizeCep('01001-000')).toBe('01001000');
    expect(maskCep('01001000')).toBe('01001-000');
  });

  it('mascara progressivamente, sem hífen solto enquanto o valor é curto', () => {
    expect(maskCep('')).toBe('');
    expect(maskCep('010')).toBe('010');
    expect(maskCep('01001')).toBe('01001');
    expect(maskCep('010010')).toBe('01001-0');
  });

  it('descarta o que passa de oito dígitos e ignora letras', () => {
    expect(maskCep('01001000999')).toBe('01001-000');
    expect(normalizeCep('01a0b01000')).toBe('01001000');
  });

  it('re-mascarar um valor já mascarado é idempotente (hidratação do backend)', () => {
    expect(maskCep(maskCep('01001000'))).toBe('01001-000');
  });

  it('aceita vazio (omissão é válida) e recusa CEP incompleto', () => {
    expect(isCepShapeValid('')).toBe(true);
    expect(isCepShapeValid(null)).toBe(true);
    expect(isCepShapeValid('01001-000')).toBe(true);
    expect(isCepShapeValid('01001-00')).toBe(false);
  });
});
