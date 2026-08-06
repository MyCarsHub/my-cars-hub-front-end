import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl } from '@angular/forms';
import { take } from 'rxjs';
import { SERVER_ERROR_KEY, ServerFieldError } from './validation-messages';

/**
 * Contract shipped by the backend (commit `3983cfc`). Three shapes only:
 * 1. Bean Validation (400): `{ message, errors[], fieldErrors }` — `fieldErrors` always present.
 * 2. Business rule bound to a field (400/409): `{ message, fieldErrors }` with exactly one
 *    entry whose value is IDENTICAL to `message` — show one or the other, never both.
 * 3. Everything else: `{ message }`, with `fieldErrors` absent (not null).
 *
 * The backend never sends `error` or `exception`.
 *
 * `code` is the one exception to shape 3 and vem só das recusas escritas dentro
 * do `JwtAuthFilter` (impersonação: `IMPERSONATION_READ_ONLY`,
 * `IMPERSONATION_INVALID_TOKEN`, …), que não passam pelo
 * `GlobalExceptionHandler`. Ausente em todo o resto — trate sempre como
 * opcional.
 */
export interface ApiErrorBody {
  message?: string;
  code?: string;
  errors?: ReadonlyArray<{ field?: string; message?: string }>;
  fieldErrors?: Record<string, string>;
}

export interface ParsedApiError {
  status: number;
  /** Backend `message`, or `null` when absent / not a JSON body. */
  message: string | null;
  /** Backend `code`, or `null` — presente apenas nas recusas do `JwtAuthFilter`. */
  code: string | null;
  /** Never null — empty object when the backend omitted the key. */
  fieldErrors: Readonly<Record<string, string>>;
  hasFieldErrors: boolean;
}

export interface ApplyFieldErrorsResult {
  /** Control paths that were matched and flagged. */
  applied: string[];
  /** `fieldErrors` entries with no matching control — must be surfaced by the screen. */
  unmatched: Record<string, string>;
}

const DEFAULT_FALLBACK = 'Não foi possível concluir a operação.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFieldErrors(body: Record<string, unknown>): Record<string, string> {
  const raw = body['fieldErrors'];
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value.length > 0) out[key] = value;
  }
  return out;
}

/**
 * Requisições feitas com `responseType: 'text'` — todo DELETE do app, porque o backend
 * responde 204 sem corpo — entregam o corpo de ERRO **sem parse**: o Angular só roda
 * `JSON.parse` quando o responseType é `'json'` (verificado em @angular/common 21.1.5,
 * `FetchBackend.parseBody` e `HttpXhrBackend`). O envelope chega então como a string
 * literal `{"message":"..."}`, e sem reinterpretá-la o usuário lê o JSON cru na tela.
 *
 * Só objetos são reinterpretados: texto puro ("Erro interno"), JSON escalar ou array
 * continuam sendo a própria mensagem, como antes.
 */
function reviveJsonEnvelope(body: string): unknown {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : body;
  } catch {
    return body;
  }
}

/** Normalises the shape of any HTTP error into the backend contract above. */
export function parseApiError(error: unknown): ParsedApiError {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  const raw = error instanceof HttpErrorResponse ? error.error : undefined;
  const body = typeof raw === 'string' && raw.length > 0 ? reviveJsonEnvelope(raw) : raw;

  if (typeof body === 'string' && body.length > 0) {
    return { status, message: body, code: null, fieldErrors: {}, hasFieldErrors: false };
  }
  if (!isRecord(body)) {
    return { status, message: null, code: null, fieldErrors: {}, hasFieldErrors: false };
  }

  const fieldErrors = readFieldErrors(body);
  return {
    status,
    message: typeof body['message'] === 'string' ? body['message'] : null,
    code: typeof body['code'] === 'string' && body['code'].length > 0 ? body['code'] : null,
    fieldErrors,
    hasFieldErrors: Object.keys(fieldErrors).length > 0,
  };
}

/**
 * Converts a backend field key into an Angular control path.
 * `address.zipCode` → `address.zipCode`; `signers[0].name` → `signers.0.name`.
 */
export function toControlPath(fieldKey: string): string {
  return fieldKey.replace(/\[(\d+)\]/g, '.$1').replace(/^\.+|\.+$/g, '');
}

function findControl(root: AbstractControl, fieldKey: string): AbstractControl | null {
  return root.get(toControlPath(fieldKey));
}

/**
 * Distributes backend `fieldErrors` onto the matching controls of `root` under the
 * `serverError` validator key, marking each as touched so the inline message renders.
 * Each flagged control clears itself on the next value change (one-shot, self-completing).
 */
export function applyFieldErrors(
  root: AbstractControl,
  fieldErrors: Readonly<Record<string, string>>,
): ApplyFieldErrorsResult {
  const applied: string[] = [];
  const unmatched: Record<string, string> = {};

  for (const [key, message] of Object.entries(fieldErrors)) {
    const control = findControl(root, key);
    if (!control) {
      unmatched[key] = message;
      continue;
    }

    const serverError: ServerFieldError = { message };
    control.setErrors({ ...(control.errors ?? {}), [SERVER_ERROR_KEY]: serverError });
    control.markAsTouched();
    applied.push(toControlPath(key));

    // Self-completing: dies with the form, no takeUntilDestroyed needed.
    control.valueChanges.pipe(take(1)).subscribe(() => clearServerErrors(control));
  }

  return { applied, unmatched };
}

/**
 * Removes every `serverError` flag under `control` and lets the real validators
 * recompute. Call before re-submitting so stale server messages don't linger.
 */
export function clearServerErrors(control: AbstractControl): void {
  const children = (control as { controls?: unknown }).controls;

  if (Array.isArray(children)) {
    for (const child of children) clearServerErrors(child as AbstractControl);
  } else if (isRecord(children)) {
    for (const child of Object.values(children)) clearServerErrors(child as AbstractControl);
  }

  if (control.errors && SERVER_ERROR_KEY in control.errors) {
    const rest = Object.fromEntries(
      Object.entries(control.errors).filter(([key]) => key !== SERVER_ERROR_KEY),
    );
    control.setErrors(Object.keys(rest).length > 0 ? rest : null);
    control.updateValueAndValidity({ emitEvent: true });
  }
}

/**
 * The message a screen should render in its form-level banner.
 * Returns `null` when everything was already shown inline — shape 2 repeats the
 * field message in `message`, so rendering both makes the user read it twice.
 */
export function formLevelMessage(
  parsed: ParsedApiError,
  result: ApplyFieldErrorsResult,
  fallback: string = DEFAULT_FALLBACK,
): string | null {
  const unmatched = Object.values(result.unmatched);
  if (unmatched.length > 0) return unmatched.join(' ');
  if (parsed.hasFieldErrors) return null;
  return parsed.message ?? fallback;
}

/** Human message for a screen that has no form to distribute errors into. */
export function flatErrorMessage(
  parsed: ParsedApiError,
  fallback: string = DEFAULT_FALLBACK,
): string {
  const values = Object.values(parsed.fieldErrors);
  if (values.length > 0) return values.join(' ');
  return parsed.message ?? fallback;
}

/** Last-resort copy per status, used by the interceptor safety net. */
export function fallbackMessageForStatus(status: number): string {
  switch (status) {
    case 404:
      return 'Registro não encontrado.';
    case 409:
      return 'Este registro já existe ou está em uso.';
    case 429:
      return 'Muitas tentativas. Aguarde alguns instantes e tente novamente.';
    default:
      return DEFAULT_FALLBACK;
  }
}
