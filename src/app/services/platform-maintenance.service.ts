import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../environments/environment';
import { SILENT_HTTP_ERRORS } from './http-errors.context';

/**
 * Sinal de "em manutenção" vindo da API: **503 com `Retry-After`** ou 503 com corpo
 * `{ "maintenance": true }` (a sugestão do handoff; o backend ainda não emite nenhum dos
 * dois, então hoje nada liga a tela sozinho).
 *
 * Um 503 SEM nenhum dos dois NÃO conta: gateway de pagamento fora do ar, proxy ou
 * partida a frio também respondem 503, e derrubar o app inteiro por uma chamada isolada
 * seria pior do que o toast que já existe.
 */
export function isMaintenanceSignal(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== 503) return false;
  if (error.headers?.has('Retry-After')) return true;
  const body: unknown = error.error;
  return typeof body === 'object' && body !== null && (body as { maintenance?: unknown }).maintenance === true;
}

/**
 * Estado global do modo manutenção. `App` mostra a página no lugar do conteúdo enquanto
 * `active()` for verdadeiro; a página se verifica sozinha e chama `leave()` quando a API
 * volta.
 */
@Injectable({ providedIn: 'root' })
export class PlatformMaintenanceService {
  private readonly http = inject(HttpClient);

  readonly active = signal(false);

  enter(): void {
    this.active.set(true);
  }

  leave(): void {
    this.active.set(false);
  }

  /**
   * `true` quando o serviço voltou. Pergunta a um endpoint público e leve
   * (`GET /v1/status`); o que importa é se a API RESPONDE, não o corpo:
   * qualquer resposta 2xx–4xx (inclusive 404 antes de o endpoint existir) significa que o
   * servidor está de pé. 5xx, 503 de manutenção e falha de rede significam que não.
   */
  isBackUp(): Observable<boolean> {
    return this.http
      .get(`${environment.apiUrl}/status`, {
        context: new HttpContext().set(SILENT_HTTP_ERRORS, true),
        responseType: 'text',
      })
      .pipe(
        map(() => true),
        catchError((error: unknown) =>
          of(
            error instanceof HttpErrorResponse &&
              !isMaintenanceSignal(error) &&
              error.status >= 200 &&
              error.status < 500,
          ),
        ),
      );
  }
}
