import { HttpErrorResponse } from '@angular/common/http';

/** Código estável do `ApiError {message, code?}` do backend, ou `null`. */
export function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse)) return null;
  const body = err.error as { code?: unknown } | null;
  return body && typeof body.code === 'string' ? body.code : null;
}

/**
 * Texto da recusa para a LOCADORA. Código conhecido usa a nossa frase (sem nome de
 * provedor nem jargão); desconhecido cai no texto do servidor, depois no `fallback`.
 */
export function flexErrorMessage(
  err: unknown,
  byCode: Readonly<Record<string, string>>,
  serverMessage: string,
): string {
  const code = apiErrorCode(err);
  if (code && byCode[code]) return byCode[code];
  return serverMessage;
}
