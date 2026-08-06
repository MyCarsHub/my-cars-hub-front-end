import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap, throwError } from 'rxjs';

import { apiPath, isAdminApiRequest, isApiRequest } from './auth.interceptor';
import {
  IMPERSONATION_ERROR_CODES,
  IMPERSONATION_READ_ONLY_MESSAGE,
  USE_ADMIN_TOKEN,
} from './impersonation.context';
import { ImpersonationService } from './impersonation.service';
import { NotificationService } from './notification.service';

/** Cabeçalhos que o backend expõe no CORS para a sessão impersonada. */
const HEADER_IMPERSONATION = 'X-Impersonation';
const HEADER_IMPERSONATED_COMPANY = 'X-Impersonated-Company-Id';

/** Espelha `ImpersonationAccessPolicy.SAFE_METHODS` no backend. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Trocar de empresa é a única operação de `/auth/**` que o bloqueio precisa
 * barrar: ela reescreveria o token da sessão ativa e faria o banner apontar uma
 * empresa enquanto o resto da interface aponta outra.
 */
const AUTH_PATH_STILL_BLOCKED = '/auth/select-company';

/**
 * Operações de CREDENCIAL, não mutação de dado do cliente.
 *
 * Sem esta isenção, um estado de impersonação órfão (sessão zerada por um
 * caminho que não o desfez) fazia o interceptor recusar o próprio
 * `POST /auth/login`: o admin era mandado para a tela de login, digitava a
 * senha e recebia de volta "Sessão somente leitura" — sem nenhuma saída na aba.
 * A causa raiz está corrigida (`SessionService.clear()` desfaz a sessão), mas o
 * bloqueio nunca deveria alcançar as credenciais em primeiro lugar.
 */
function isCredentialRequest(url: string): boolean {
  const path = apiPath(url);
  if (!path?.startsWith('/auth/')) return false;
  return !path.startsWith(AUTH_PATH_STILL_BLOCKED);
}

/**
 * Primeiro interceptor da cadeia. Faz duas coisas, ambas só quando há sessão de
 * impersonação ativa:
 *
 * 1. **Barra a escrita antes de ela sair do browser.** Vale para o app inteiro
 *    de uma vez — desabilitar botão por botão em dezenas de telas deixaria
 *    buracos, e a tela nova de amanhã nasceria desprotegida. O 403 do servidor
 *    continua sendo a rede de segurança (tratado no `errorInterceptor`); este
 *    bloqueio é o que transforma o erro em explicação imediata.
 * 2. **Reconcilia o banner com a verdade do servidor**, lendo `X-Impersonation`
 *    e `X-Impersonated-Company-Id` das respostas em vez de deduzir do estado
 *    local.
 *
 * A recusa local é modelada como `HttpErrorResponse` 403 com o mesmo `code` do
 * backend, para que qualquer tela que já trate o erro do servidor trate este
 * também sem saber a diferença.
 */
export const impersonationInterceptor: HttpInterceptorFn = (req, next) => {
  const impersonation = inject(ImpersonationService);
  const notifications = inject(NotificationService);

  if (!impersonation.active() || !isApiRequest(req.url)) {
    return next(req);
  }

  // O encerramento da sessão viaja com o token administrativo e é, por
  // definição, a mutação que a sessão precisa poder fazer. A checagem de
  // caminho impede que a marca sirva de escape genérico fora de `/admin/**`.
  if (req.context.get(USE_ADMIN_TOKEN) && isAdminApiRequest(req.url)) {
    return next(req);
  }

  // Login, cadastro, troca de código OAuth: recuperar acesso não pode depender
  // de a sessão somente-leitura ter sido desfeita corretamente.
  if (isCredentialRequest(req.url)) {
    return next(req);
  }

  if (!SAFE_METHODS.has(req.method.toUpperCase())) {
    notifications.warning(IMPERSONATION_READ_ONLY_MESSAGE);
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 403,
          statusText: 'Forbidden',
          url: req.url,
          error: {
            code: IMPERSONATION_ERROR_CODES.readOnly,
            message: IMPERSONATION_READ_ONLY_MESSAGE,
          },
        }),
    );
  }

  return next(req).pipe(
    tap((event) => {
      if (!(event instanceof HttpResponse)) return;
      if (event.headers.get(HEADER_IMPERSONATION) !== 'true') return;
      impersonation.reconcile(event.headers.get(HEADER_IMPERSONATED_COMPANY));
    }),
  );
};
