import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { SessionService } from './session.service';
import { NotificationService } from './notification.service';
import { ApiErrorService } from './api-error.service';
import { ParsedApiError, parseApiError } from './api-error';
import { ImpersonationService } from './impersonation.service';
import {
  IMPERSONATION_ERROR_CODES,
  IMPERSONATION_READ_ONLY_MESSAGE,
  USE_ADMIN_TOKEN,
} from './impersonation.context';

function isTokenExpired(error: HttpErrorResponse, message: string | null): boolean {
  const raw = typeof error.error === 'string' ? error.error : '';
  return `${raw} ${message ?? ''}`.includes('TokenExpiredException');
}

/**
 * Recusa de escrita durante impersonação. Duas origens, contrato diferente:
 * o `JwtAuthFilter` responde com `code` (barreira barata, antes do banco) e a
 * transação READ ONLY responde só com a mensagem, via `GlobalExceptionHandler`.
 * Reconhecer as duas é o que garante que o admin nunca leia "Acesso negado"
 * quando o motivo real foi a sessão somente-leitura.
 */
function isReadOnlyRefusal(parsed: ParsedApiError, sessionActive: boolean): boolean {
  // O `code` é contrato: só a impersonação o emite, então vale sozinho.
  if (parsed.code === IMPERSONATION_ERROR_CODES.readOnly) return true;
  // A frase NÃO é contrato — qualquer 403 com "somente leitura" na mensagem
  // (uma futura regra de plano, um recurso arquivado) casaria e o usuário
  // receberia um aviso sobre uma sessão de impersonação que não existe. Só
  // aceitamos a heurística quando há de fato uma sessão ativa.
  return sessionActive && /somente leitura/i.test(parsed.message ?? '');
}

/**
 * Global HTTP error interceptor. It owns EXACTLY ONE class of feedback: the toast for
 * problems the screen cannot meaningfully explain or recover from.
 *
 * - status 0 (network / CORS / offline) → toast, user stays put.
 * - 401 / token expired → clears session, redirects to /login (except /auth/login itself).
 * - 403 → "Acesso negado" toast.
 * - 5xx → toast with the backend message or a generic one, user stays put.
 *
 * Durante uma sessão de impersonação, 401 e 403 têm tratamento próprio e
 * anterior a esses — ver o bloco no início do `catchError`.
 *
 * 4xx (400 / 404 / 409 / 422 / 429 …) are the SCREEN's responsibility and are shown
 * inline — field errors under the field, business errors in a banner. The interceptor
 * does not toast them, which is what removes the duplicated messages. It only arms a
 * safety net (`ApiErrorService.scheduleSafetyNet`): if no screen claims the error, a
 * toast still fires so nothing is swallowed silently.
 *
 * Always re-throws so component-level handlers still see the error.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const notifications = inject(NotificationService);
  const apiErrors = inject(ApiErrorService);
  const impersonation = inject(ImpersonationService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const status = error.status;
      const parsed = parseApiError(error);
      const backendMessage = parsed.message;

      // --- Impersonação: precede TODA a política genérica abaixo ---------------
      //
      // Sem estes dois desvios o admin cairia no tratamento errado nos dois
      // casos que mais importam: o 401 do token vencido o mandaria para o
      // /login (perdendo o próprio acesso por causa de uma sessão de suporte),
      // e o 403 da escrita bloqueada viraria "Acesso negado" — mensagem que
      // não diz que foi a sessão somente-leitura que barrou.
      //
      // `USE_ADMIN_TOKEN` marca a requisição que ENCERRA a sessão: ela viaja
      // com a credencial administrativa, então um 401 ali é o token do admin
      // que caiu, e aí o /login é o destino certo.
      const isAdminCredentialRequest = req.context.get(USE_ADMIN_TOKEN);

      if (status === 401 && impersonation.active() && !isAdminCredentialRequest) {
        impersonation.expire();
        return throwError(() => error);
      }

      if (status === 403 && isReadOnlyRefusal(parsed, impersonation.active())) {
        notifications.warning(IMPERSONATION_READ_ONLY_MESSAGE);
        return throwError(() => error);
      }

      if (status === 403 && parsed.code === IMPERSONATION_ERROR_CODES.forbiddenPath) {
        notifications.warning(
          backendMessage ?? 'Rota indisponível durante uma sessão de impersonação.',
        );
        return throwError(() => error);
      }

      if (isTokenExpired(error, backendMessage)) {
        session.clear();
        notifications.warning('Sua sessão expirou. Faça login novamente.');
        router.navigate(['/login'], { replaceUrl: true });
      } else if (status === 0) {
        // Rede fora / CORS / servidor inacessível. Não faz logout — provavelmente é
        // temporário e o usuário só precisa tentar de novo.
        notifications.error('Sem conexão com o servidor.');
      } else if (status === 401) {
        if (!req.url.includes('/auth/login')) {
          notifications.warning('Sessão inválida. Faça login novamente.');
          session.clear();
          router.navigate(['/login'], { replaceUrl: true });
        }
      } else if (status === 403) {
        notifications.warning('Acesso negado');
      } else if (status >= 500 && status < 600) {
        // Falha do servidor. Mantém o usuário na tela pra ele poder tentar de novo
        // sem perder o contexto (mark-paid, form em edição, etc).
        notifications.error(backendMessage || 'Erro no servidor. Tente novamente.');
      } else if (status >= 400 && status < 500) {
        apiErrors.scheduleSafetyNet(error);
      }

      return throwError(() => error);
    }),
  );
};
