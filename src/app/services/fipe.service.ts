import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { OWNED_HTTP_ERRORS } from './http-errors.context';

/** Item das listas do catálogo FIPE (FEAT-0083): `[{code,name}]`. */
export interface FipeOption {
  code: string;
  name: string;
}

const BASE = `${environment.apiUrl}/fipe`;

/**
 * A tabela FIPE vira MENSALMENTE: sem expiração, uma sessão longa (aba aberta
 * na virada da tabela de referência) serviria catálogo velho para sempre.
 * Algumas horas equilibram frescor e economia de rede.
 */
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

interface FipeCacheEntry {
  options: FipeOption[];
  storedAt: number;
}

/**
 * Catálogo FIPE (FEAT-0084) — listas encadeadas marca → modelo → ano.
 *
 * Cache em memória por caminho, com carimbo e TTL (ver `CACHE_TTL_MS`).
 * NUNCA ficam cacheados: erro (o `shareReplay` guarda só o observable em voo,
 * e a falha remove a entrada para a próxima tentativa perguntar de novo) e
 * resposta VAZIA (lista vazia cacheada tornaria o "Selecionar da tabela FIPE"
 * um controle morto até recarregar a página). O formulário cai no modo manual
 * nesses casos — a FIPE nunca pode bloquear um cadastro.
 *
 * `OWNED_HTTP_ERRORS` em todas as chamadas: o catálogo é acessório, e sem a
 * marca o `errorInterceptor` toastaria "Erro no servidor" para todo 5xx antes
 * de o componente decidir o fallback silencioso. Sessão vencida (401) segue
 * com o interceptor — por isso não é o `SILENT_HTTP_ERRORS`.
 */
@Injectable({ providedIn: 'root' })
export class FipeService {
  private readonly http = inject(HttpClient);

  private readonly cache = new Map<string, FipeCacheEntry>();
  private readonly inFlight = new Map<string, Observable<FipeOption[]>>();

  brands(): Observable<FipeOption[]> {
    return this.list('/brands');
  }

  models(brandCode: string): Observable<FipeOption[]> {
    return this.list(`/brands/${encodeURIComponent(brandCode)}/models`);
  }

  years(brandCode: string, modelCode: string): Observable<FipeOption[]> {
    return this.list(
      `/brands/${encodeURIComponent(brandCode)}/models/${encodeURIComponent(modelCode)}/years`,
    );
  }

  private list(path: string): Observable<FipeOption[]> {
    const entry = this.cache.get(path);
    if (entry && Date.now() - entry.storedAt < CACHE_TTL_MS) {
      return of(entry.options);
    }
    this.cache.delete(path);

    const pending = this.inFlight.get(path);
    if (pending) return pending;

    const request$ = this.http
      .get<FipeOption[]>(`${BASE}${path}`, {
        context: new HttpContext().set(OWNED_HTTP_ERRORS, true),
      })
      .pipe(
        tap({
          next: (options) => {
            if ((options ?? []).length > 0) {
              this.cache.set(path, { options, storedAt: Date.now() });
            }
            this.inFlight.delete(path);
          },
          error: () => this.inFlight.delete(path),
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    this.inFlight.set(path, request$);
    return request$;
  }
}
