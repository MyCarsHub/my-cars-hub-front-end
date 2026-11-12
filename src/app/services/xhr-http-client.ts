import {
  HttpClient,
  HttpEvent,
  HttpHandler,
  HttpRequest,
  HttpXhrBackend,
} from '@angular/common/http';
import { EnvironmentInjector, Injectable, inject, runInInjectionContext } from '@angular/core';
import { Observable } from 'rxjs';
import { API_INTERCEPTORS } from './api-interceptors';

type Next = (req: HttpRequest<unknown>) => Observable<HttpEvent<unknown>>;

/**
 * `HttpClient` sobre XHR, com a MESMA cadeia de interceptors do app (token, suporte,
 * erros). Existe só para envio com barra de progresso real: o app usa `withFetch()` e o
 * `FetchBackend` NUNCA emite `UploadProgress`. Cancelar = desinscrever (o XHR é abortado).
 */
@Injectable({ providedIn: 'root' })
export class XhrHttpClient extends HttpClient {
  constructor() {
    const injector = inject(EnvironmentInjector);
    const backend = inject(HttpXhrBackend);
    const chain = API_INTERCEPTORS.reduceRight<Next>(
      (next, interceptor) => (req) => runInInjectionContext(injector, () => interceptor(req, next)),
      (req) => backend.handle(req),
    );
    const handler: HttpHandler = { handle: chain };
    super(handler);
  }
}
