import { describe, expect, it } from 'vitest';
import { isValidCnpj } from './cnpj.validator';

/** Same vectors as the backend `CnpjValidatorTest` — the two must never drift apart. */
describe('isValidCnpj', () => {
  it('accepts a legacy all-numeric CNPJ, digits only and masked', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
  });

  it('accepts an alphanumeric CNPJ, case-insensitively', () => {
    expect(isValidCnpj('12ABC34501DE35')).toBe(true);
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12abc34501de35')).toBe(true);
  });

  it('rejects arithmetically invalid check digits', () => {
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('12ABC34501DE36')).toBe(false);
  });

  it('rejects non-numeric check digits', () => {
    expect(isValidCnpj('12ABC34501DEAB')).toBe(false);
  });

  it('rejects the all-same-character blacklist', () => {
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
    expect(isValidCnpj('AAAAAAAAAAAAAA')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidCnpj('123')).toBe(false);
    expect(isValidCnpj('112223330001811')).toBe(false);
  });

  it('preserves leading zeros — the document is never parsed as a number', () => {
    expect(isValidCnpj('00000000000191')).toBe(true);
  });
});
