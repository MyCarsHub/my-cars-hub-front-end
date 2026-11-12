import { HttpInterceptorFn } from '@angular/common/http';
import { authInterceptor } from './auth.interceptor';
import { errorInterceptor } from './error.interceptor';
import { impersonationInterceptor } from './impersonation.interceptor';
import { platformMaintenanceInterceptor } from './platform-maintenance.interceptor';
import { prerenderApiBaseInterceptor } from './prerender-api-base.interceptor';

/**
 * A cadeia de interceptors da API, numa lista só: o `provideHttpClient` do app e o
 * `XhrHttpClient` (envio com progresso) usam a MESMA, então não derivam.
 *
 * `impersonationInterceptor` vem PRIMEIRO de propósito: sendo o mais externo, a recusa de
 * escrita durante uma sessão somente-leitura nem chega a montar a requisição — e o erro
 * sintético que ele devolve não passa pelo `errorInterceptor`, que senão duplicaria o aviso.
 * `prerenderApiBaseInterceptor` vem depois dos três de cima: ele reescreve a URL relativa da
 * API para uma base absoluta durante o prerender, e eles precisam ver a URL original —
 * `isApiRequest` ancora em `environment.apiUrl`. No browser o token não está provido e ele é
 * um pass-through. `platformMaintenanceInterceptor` é o mais interno: vê o 503 antes do
 * `errorInterceptor` decidir o que fazer com ele.
 */
export const API_INTERCEPTORS: HttpInterceptorFn[] = [
  impersonationInterceptor,
  authInterceptor,
  errorInterceptor,
  prerenderApiBaseInterceptor,
  platformMaintenanceInterceptor,
];
