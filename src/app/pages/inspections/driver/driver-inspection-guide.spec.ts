import { describe, expect, it } from 'vitest';
import { RENTAL_PHOTO_ANGLES } from '../../../types/rental.types';
import { angleGuide, kmProblem, maskKm, parseKm, pastedKm } from './driver-inspection-guide';

describe('driver-inspection-guide', () => {
  it('every angle of the script has the prototype copy', () => {
    for (const { value, label } of RENTAL_PHOTO_ANGLES) {
      const guide = angleGuide(value, label);
      expect(guide.tip.length, value).toBeGreaterThan(10);
      expect(guide.tip, value).not.toContain(label.toLowerCase() + ' com boa luz');
    }
  });

  it('an angle outside the script still gets a sentence, never an empty hint', () => {
    expect(angleGuide('ESTEPE', 'Estepe').tip).toBe('Fotografe estepe com boa luz e sem reflexo.');
  });

  it('masks the odometer as the prototype: digits only, thousands dot, 7 digits max', () => {
    expect(maskKm('42318')).toBe('42.318');
    expect(maskKm('4a2.3 18')).toBe('42.318');
    expect(maskKm('0042')).toBe('42');
    expect(maskKm('123456789')).toBe('1.234.567');
    expect(maskKm('')).toBe('');
    // A pasted decimal keeps the whole kilometres; the comma's part is dropped, not glued.
    expect(maskKm('42.318,5')).toBe('42.318');
    expect(parseKm(maskKm('42.318,5'))).toBe(42318);
    expect(parseKm('1.234.567')).toBe(1234567);
    expect(parseKm('')).toBeNull();
  });

  it('a pasted reading drops its decimal part, whatever the separator', () => {
    expect(pastedKm('42318.5')).toBe('42.318');
    expect(pastedKm('42318.50')).toBe('42.318');
    expect(pastedKm('42.318,5')).toBe('42.318');
    expect(pastedKm(' 42.318 ')).toBe('42.318');
    // A dot with three digits after it is a thousands dot.
    expect(pastedKm('42.318')).toBe('42.318');
    expect(pastedKm('1.234.567')).toBe('1.234.567');
  });

  it('refuses empty, zero, above the server ceiling and below the last record', () => {
    expect(kmProblem(null, null)).toContain('Informe');
    expect(kmProblem(0, null)).toContain('maior que zero');
    expect(kmProblem(5_000_001, null)).toContain('5.000.000');
    expect(kmProblem(40_000, 41_250)).toContain('41.250 km');
    expect(kmProblem(41_250, 41_250)).toBeNull();
    expect(kmProblem(42_318, null)).toBeNull();
  });
});
