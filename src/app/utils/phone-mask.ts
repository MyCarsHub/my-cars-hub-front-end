import { AbstractControl } from '@angular/forms';
import { applyMaskedDocumentInput } from './document-mask';

/**
 * Brazilian phone helpers, shaped like `document-mask.ts` and sharing its caret-aware
 * input handler.
 *
 * **A phone is ALWAYS a string.** Nothing here converts one to a number: a DDD like
 * `011` would lose its leading zero the moment it became `Number('011...')`. Values stay
 * strings from the keystroke to the request body — the caller strips separators before
 * POST'ing (see `utils/format.ts:stripDigits`).
 *
 * Shape only — there are no check digits to verify on a phone number.
 */

/** Raw phone length (DDD + 9-digit mobile). */
const PHONE_LENGTH = 11;

/** Digits-only, capped at the phone length. Leading zeros survive — it stays a string. */
export function normalizePhone(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '').slice(0, PHONE_LENGTH);
}

/**
 * Progressive `(00) 00000-0000` mask. Shared by the input handler and by hydration
 * `patchValue`, so a value coming back from the backend (raw digits) renders exactly
 * like one the user typed.
 */
export function maskPhone(value: string | null | undefined): string {
  const digits = normalizePhone(value);
  if (digits.length > 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length > 2) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length > 0) return `(${digits}`;
  return digits;
}

/**
 * Index in `masked` right after its `count`-th digit.
 *
 * Counting DIGITS instead of raw characters is what makes the caret survive a re-format:
 * the masked string grows and shrinks as separators appear and disappear, so the raw
 * index the browser reports before the mask runs no longer means the same place after it.
 */
export function caretAfterDigits(masked: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/\d/.test(masked[i])) {
      seen++;
      if (seen === count) return i + 1;
    }
  }
  return masked.length;
}

/**
 * Re-formats a masked phone field on every keystroke and puts the caret back where the
 * user was typing — re-writing the control value would otherwise park it at the end of
 * the string, which makes mid-string edits unusable on a phone (the platform's main use).
 *
 * Delegates to the document handler, which is mask-agnostic: it only ever counts
 * alphanumerics, and in a phone every alphanumeric is a digit. That also inherits the
 * backspace-onto-a-separator handling, so the key never looks dead.
 */
export function applyMaskedPhoneInput(
  event: Event,
  control: AbstractControl | null | undefined,
): void {
  applyMaskedDocumentInput(event, control, maskPhone);
}
