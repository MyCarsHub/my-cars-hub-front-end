import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Local CNPJ validation (mod 11 + all-same-character blacklist).
 * Accepts masked (`00.000.000/0000-00`) or unmasked input, letters case-insensitive.
 * Returns `{ cnpjInvalid: true }` when invalid; `null` when valid or empty
 * (use `Validators.required` for presence).
 *
 * Mirrors the backend `CnpjValidator` — keep the two in step.
 *
 * **Alphanumeric CNPJ (Receita Federal, from July 2026).** 14 positions: the first 12
 * became alphanumeric (`0-9A-Z`), the last 2 stay numeric check digits. The mod-11
 * formula and weights are UNCHANGED; only the character-to-value mapping was adjusted —
 * each character contributes its char code minus 48, so digits keep their value
 * (`'0'` = 0) and letters become `A` = 17 … `Z` = 42. That is why every legacy
 * all-numeric CNPJ keeps validating unchanged.
 *
 * The document is handled as a STRING throughout: the number is never parsed as a
 * numeric value, only individual characters are mapped to weights.
 */

/** Total positions: 12 alphanumeric + 2 numeric check digits. */
const LENGTH = 14;
/** Leading positions that may hold letters. */
const BASE_LENGTH = 12;

/** Mod-11 weights for the first check digit (12 base positions). */
const WEIGHTS_FIRST = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
/** Mod-11 weights for the second check digit (13 positions). */
const WEIGHTS_SECOND = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

export function cnpjValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = control.value;
    if (raw === null || raw === undefined || raw === '') {
      return null;
    }
    return isValidCnpj(String(raw)) ? null : { cnpjInvalid: true };
  };
}

export function isValidCnpj(raw: string): boolean {
  const value = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (value.length !== LENGTH) return false;
  if (allSameCharacter(value)) return false;

  for (let i = 0; i < BASE_LENGTH; i++) {
    if (!isAlphanumeric(value.charAt(i))) return false;
  }
  for (let i = BASE_LENGTH; i < LENGTH; i++) {
    if (!isDigit(value.charAt(i))) return false;
  }

  return matchesVerifier(value, WEIGHTS_FIRST) && matchesVerifier(value, WEIGHTS_SECOND);
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isAlphanumeric(c: string): boolean {
  return isDigit(c) || (c >= 'A' && c <= 'Z');
}

/** Char code minus 48 — the RFB mapping. Digits keep their value, `A` = 17. */
function valueOf(c: string): number {
  return c.charCodeAt(0) - 48;
}

function allSameCharacter(value: string): boolean {
  for (let i = 1; i < value.length; i++) {
    if (value.charAt(i) !== value.charAt(0)) return false;
  }
  return true;
}

function matchesVerifier(value: string, weights: readonly number[]): boolean {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += valueOf(value.charAt(i)) * weights[i];
  }
  const remainder = sum % 11;
  const expected = remainder < 2 ? 0 : 11 - remainder;
  // The check digit is compared as a single character, never as a parsed document.
  return value.charAt(weights.length) === String(expected);
}
