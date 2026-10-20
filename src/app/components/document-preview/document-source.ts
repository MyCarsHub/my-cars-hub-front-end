import { isObservable, firstValueFrom } from 'rxjs';
import type {
  DocumentPreviewResolved,
  DocumentPreviewSource,
} from './document-preview.types';

/** Falha de carregamento com o que o modal precisa para escolher a cópia. */
export class DocumentLoadError extends Error {
  constructor(
    message: string,
    /** O erro original (HttpErrorResponse do carregador, TypeError do fetch…). */
    override readonly cause: unknown,
    /** Status HTTP do storage, quando houve resposta. */
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'DocumentLoadError';
  }
}

/**
 * Resolve qualquer origem aceita até um `Blob`.
 *
 * A URL é buscada SEM credenciais e sem referrer: é a signed URL do storage (o token
 * dela é do próprio storage, de vida curta) ou um asset do app. O token de sessão do app
 * nunca viaja aqui — ele só existe no header que o `authInterceptor` põe nos requests do
 * `HttpClient`, e é por isso que origens autenticadas chegam como `Blob` (via carregador).
 */
export async function resolveToBlob(
  source: DocumentPreviewSource,
  signal?: AbortSignal,
): Promise<Blob> {
  let resolved: DocumentPreviewResolved;
  if (typeof source === 'function') {
    try {
      const out = source();
      resolved = isObservable(out) ? await firstValueFrom(out) : await out;
    } catch (err) {
      throw new DocumentLoadError('loader-failed', err);
    }
  } else {
    resolved = source;
  }

  if (resolved instanceof Blob) return resolved;
  if (resolved instanceof ArrayBuffer) return new Blob([resolved]);
  // `slice()` copia para um ArrayBuffer próprio (o original pode ser uma view de um
  // buffer maior, ou compartilhado).
  if (resolved instanceof Uint8Array) return new Blob([resolved.slice()]);
  const url = typeof resolved === 'string' ? resolved : resolved.url;
  return fetchBlob(url, signal);
}

async function fetchBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  if (!url) throw new DocumentLoadError('empty-url', null);
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal });
  } catch (err) {
    throw new DocumentLoadError('network', err);
  }
  if (!response.ok) throw new DocumentLoadError('http', null, response.status);
  const blob = await response.blob();
  if (blob.size === 0) throw new DocumentLoadError('empty', null, response.status);
  return blob;
}
