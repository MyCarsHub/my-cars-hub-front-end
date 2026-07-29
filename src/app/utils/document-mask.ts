import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { isValidCpf } from './validators/cpf.validator';
import { isValidCnpj } from './validators/cnpj.validator';

/**
 * CPF / CNPJ helpers, shared by onboarding and company settings.
 *
 * **A document is ALWAYS a string.** Nothing here ever converts one to a number:
 * `Number('012...')` would drop the leading zero and `NaN` an alphanumeric CNPJ.
 * Values stay strings from the keystroke to the request body.
 *
 * Since July 2026 the Receita Federal issues ALPHANUMERIC CNPJs: 12 alphanumeric
 * positions + 2 numeric check digits. A digits-only mask would block real companies, so
 * the CNPJ side works on `[A-Z0-9]` and upper-cases letters (the backend does the same).
 * CPF stays strictly numeric: 11 digits.
 *
 * Shape only — check digits belong to the backend (and, for CPF, to `cpfValidator`).
 */

/** Raw CPF length. */
const CPF_LENGTH = 11;
/** Raw CNPJ length (12 alphanumeric + 2 numeric check digits). */
const CNPJ_LENGTH = 14;

const CPF_SHAPE = /^\d{11}$/;
const CNPJ_SHAPE = /^[A-Z0-9]{12}\d{2}$/;

/** Validator keys produced by the validators below. */
export const DOCUMENT_SHAPE_ERROR = 'documentShape';
export const CPF_SHAPE_ERROR = 'cpfShape';
export const CNPJ_SHAPE_ERROR = 'cnpjShape';
/** Right shape, wrong mod-11 check digits. */
export const DOCUMENT_INVALID_ERROR = 'documentInvalid';

/**
 * Strips separators, upper-cases letters and caps at the CNPJ length.
 * This is the value that goes on the wire for a CNPJ or a mixed CPF/CNPJ field.
 */
export function normalizeDocument(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CNPJ_LENGTH);
}

/** Digits-only, capped at the CPF length. Leading zeros survive — it stays a string. */
export function normalizeCpf(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '').slice(0, CPF_LENGTH);
}

/** True for an empty value or a well-formed CPF (11 digits). */
export function isCpfShapeValid(value: string | null | undefined): boolean {
  const raw = normalizeCpf(value);
  return raw.length === 0 || CPF_SHAPE.test(raw);
}

/** True for an empty value or a well-formed CNPJ (12 alphanumeric + 2 digits). */
export function isCnpjShapeValid(value: string | null | undefined): boolean {
  const raw = normalizeDocument(value);
  return raw.length === 0 || CNPJ_SHAPE.test(raw);
}

/** True for an empty value, a well-formed CPF, or a well-formed CNPJ. */
export function isDocumentShapeValid(value: string | null | undefined): boolean {
  const raw = normalizeDocument(value);
  if (raw.length === 0) return true;
  return CPF_SHAPE.test(raw) || CNPJ_SHAPE.test(raw);
}

/** Progressive `000.000.000-00` mask. */
export function maskCpf(value: string | null | undefined): string {
  const raw = normalizeCpf(value);
  if (raw.length > 9) {
    return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9)}`;
  }
  if (raw.length > 6) return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6)}`;
  if (raw.length > 3) return `${raw.slice(0, 3)}.${raw.slice(3)}`;
  return raw;
}

/** Progressive `00.000.000/0000-00` mask, letters included. */
export function maskCnpj(value: string | null | undefined): string {
  const raw = normalizeDocument(value);
  if (raw.length > 12) {
    return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
  }
  if (raw.length > 8) {
    return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8)}`;
  }
  if (raw.length > 5) return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5)}`;
  if (raw.length > 2) return `${raw.slice(0, 2)}.${raw.slice(2)}`;
  return raw;
}

/**
 * Mask for a field that accepts either document. Falls back to the CPF layout while the
 * value is short and purely numeric, and switches to the CNPJ layout as soon as a letter
 * appears or the value outgrows a CPF.
 */
export function maskDocument(value: string | null | undefined): string {
  const raw = normalizeDocument(value);
  const looksLikeCnpj = raw.length > CPF_LENGTH || /[A-Z]/.test(raw);
  return looksLikeCnpj ? maskCnpj(raw) : maskCpf(raw);
}

/**
 * Index in `masked` right after its `count`-th alphanumeric character.
 * Used to restore the caret after re-formatting, so editing mid-string does not
 * throw the cursor to the end (painful on mobile).
 */
export function caretAfterAlphanumeric(masked: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/[A-Za-z0-9]/.test(masked[i])) {
      seen++;
      if (seen === count) return i + 1;
    }
  }
  return masked.length;
}

function alphanumericsOf(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '');
}

/**
 * Re-formats a masked document field on every keystroke and puts the caret back where
 * the user was typing — re-writing the control value would otherwise park it at the end
 * of the string, which makes mid-string edits unusable on a phone.
 *
 * Backspacing onto a separator is also handled: the mask would simply put the separator
 * back, so the key would appear dead and the user would have to press it twice. When a
 * backspace removed only punctuation, the character before it is dropped as well.
 *
 * Pass the field's own mask (`maskCpf`, `maskCnpj` or `maskDocument`).
 */
export function applyMaskedDocumentInput(
  event: Event,
  control: AbstractControl | null | undefined,
  mask: (value: string) => string,
): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  const caret = target.selectionStart ?? target.value.length;
  const previous = typeof control?.value === 'string' ? control.value : '';

  let source = target.value;
  let typedBeforeCaret = alphanumericsOf(source.slice(0, caret)).length;

  const deletedBackwards =
    event instanceof InputEvent && event.inputType === 'deleteContentBackward';
  const onlyPunctuationWentAway =
    alphanumericsOf(source).length === alphanumericsOf(previous).length;

  if (deletedBackwards && onlyPunctuationWentAway && typedBeforeCaret > 0) {
    const characters = alphanumericsOf(source);
    source = characters.slice(0, typedBeforeCaret - 1) + characters.slice(typedBeforeCaret);
    typedBeforeCaret--;
  }

  const formatted = mask(source);
  control?.setValue(formatted, { emitEvent: true });

  const nextCaret = caretAfterAlphanumeric(formatted, typedBeforeCaret);
  target.value = formatted;
  target.setSelectionRange(nextCaret, nextCaret);
}

function shapeValidator(key: string, isValid: (value: string) => boolean): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    // Documents are always strings; anything else is a programming error, not user input.
    const value = typeof control.value === 'string' ? control.value : '';
    return isValid(value) ? null : { [key]: true };
  };
}

/** CPF-only shape. Empty is valid — pair with `Validators.required` when mandatory. */
export function cpfShapeValidator(): ValidatorFn {
  return shapeValidator(CPF_SHAPE_ERROR, isCpfShapeValid);
}

/** CNPJ-only shape. Empty is valid — pair with `Validators.required` when mandatory. */
export function cnpjShapeValidator(): ValidatorFn {
  return shapeValidator(CNPJ_SHAPE_ERROR, isCnpjShapeValid);
}

/** CPF or CNPJ shape. Empty is valid — the field is optional. */
export function documentShapeValidator(): ValidatorFn {
  return shapeValidator(DOCUMENT_SHAPE_ERROR, isDocumentShapeValid);
}

/**
 * Mod-11 check digits for a field that accepts either document, dispatched by length:
 * 11 → CPF, 14 → CNPJ. Stays silent on empty or wrong-shape values so
 * `documentShapeValidator` owns that message and the user never sees two at once.
 *
 * This is the same arithmetic the backend runs, so an obvious typo is caught before
 * the request instead of costing a round-trip.
 */
export function documentCheckDigitValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value : '';
    const raw = normalizeDocument(value);
    if (raw.length === CPF_LENGTH) {
      return isValidCpf(raw) ? null : { [DOCUMENT_INVALID_ERROR]: true };
    }
    if (raw.length === CNPJ_LENGTH) {
      return isValidCnpj(raw) ? null : { [DOCUMENT_INVALID_ERROR]: true };
    }
    return null;
  };
}
