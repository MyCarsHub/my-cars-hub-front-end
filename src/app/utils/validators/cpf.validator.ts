import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Local CPF validation (mod 11 + all-same-digit blacklist).
 * Accepts masked (`000.000.000-00`) or unmasked input.
 * Returns `{ cpfInvalid: true }` when invalid; `null` when valid or empty
 * (use `Validators.required` for presence).
 */
export function cpfValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = control.value;
    if (raw === null || raw === undefined || raw === '') {
      return null;
    }
    return isValidCpf(String(raw)) ? null : { cpfInvalid: true };
  };
}

export function isValidCpf(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  return matchesVerifier(digits, 9) && matchesVerifier(digits, 10);
}

function matchesVerifier(digits: string, prefixLength: number): boolean {
  let sum = 0;
  let weight = prefixLength + 1;
  for (let i = 0; i < prefixLength; i++) {
    sum += Number(digits.charAt(i)) * weight;
    weight--;
  }
  const remainder = sum % 11;
  const expected = remainder < 2 ? 0 : 11 - remainder;
  return Number(digits.charAt(prefixLength)) === expected;
}
