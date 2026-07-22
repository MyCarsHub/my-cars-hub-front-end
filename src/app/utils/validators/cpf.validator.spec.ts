import { describe, expect, it } from 'vitest';
import { isValidCpf } from './cpf.validator';

describe('isValidCpf', () => {
  it('accepts real CPF digits only', () => {
    expect(isValidCpf('11144477735')).toBe(true);
  });

  it('accepts real CPF masked', () => {
    expect(isValidCpf('111.444.777-35')).toBe(true);
  });

  it('rejects arithmetically invalid CPF', () => {
    expect(isValidCpf('12345678900')).toBe(false);
  });

  it('rejects all-same-digit blacklist', () => {
    expect(isValidCpf('00000000000')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('99999999999')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidCpf('123')).toBe(false);
    expect(isValidCpf('123456789012')).toBe(false);
  });
});
