import { ValidationErrors } from '@angular/forms';

/**
 * Validator key reserved for messages that came from the backend `fieldErrors` map.
 * Always wins over client-side validator messages: the server saw the whole picture.
 */
export const SERVER_ERROR_KEY = 'serverError';

export interface ServerFieldError {
  message: string;
}

/** Order matters: the first key present in the control's errors is the one shown. */
const MESSAGE_ORDER = [
  SERVER_ERROR_KEY,
  'required',
  'email',
  'pattern',
  'minlength',
  'maxlength',
  'min',
  'max',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOf(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '';
}

/**
 * PT-BR message for a single Angular validator key.
 * Messages are intentionally subject-less ("Campo obrigatório.") to avoid
 * gender agreement bugs when composing with the field label.
 */
export function messageForValidator(key: string, detail: unknown): string {
  switch (key) {
    case SERVER_ERROR_KEY:
      return isRecord(detail) && typeof detail['message'] === 'string'
        ? detail['message']
        : 'Valor inválido.';
    case 'required':
      return 'Campo obrigatório.';
    case 'email':
      return 'Informe um e-mail válido.';
    case 'pattern':
      return 'Formato inválido.';
    case 'minlength':
      return isRecord(detail)
        ? `Mínimo de ${numberOf(detail['requiredLength'])} caracteres.`
        : 'Texto muito curto.';
    case 'maxlength':
      return isRecord(detail)
        ? `Máximo de ${numberOf(detail['requiredLength'])} caracteres.`
        : 'Texto muito longo.';
    case 'min':
      return isRecord(detail) ? `Valor mínimo: ${numberOf(detail['min'])}.` : 'Valor muito baixo.';
    case 'max':
      return isRecord(detail) ? `Valor máximo: ${numberOf(detail['max'])}.` : 'Valor muito alto.';
    default:
      return 'Valor inválido.';
  }
}

/**
 * Resolves the single message to display for a control.
 * `overrides` lets a screen replace the copy for a given validator key
 * (e.g. `{ pattern: 'Placa inválida. Use ABC1234 ou ABC1D23.' }`).
 */
export function resolveValidationMessage(
  errors: ValidationErrors | null | undefined,
  overrides: Readonly<Record<string, string>> = {},
): string | null {
  if (!errors) return null;

  for (const key of MESSAGE_ORDER) {
    if (key in errors) {
      return overrides[key] ?? messageForValidator(key, errors[key]);
    }
  }

  const firstKey = Object.keys(errors)[0];
  if (!firstKey) return null;
  return overrides[firstKey] ?? messageForValidator(firstKey, errors[firstKey]);
}
