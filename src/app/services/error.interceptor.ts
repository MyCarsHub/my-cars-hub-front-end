import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { SessionService } from './session.service';
import { NotificationService } from './notification.service';
import { ApiErrorService } from './api-error.service';
import { parseApiError } from './api-error';

function isTokenExpired(error: HttpErrorResponse, message: string | null): boolean {
  const raw = typeof error.error === 'string' ? error.error : '';
  return `${raw} ${message ?? ''}`.includes('TokenExpiredException');
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

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const status = error.status;
      const backendMessage = parseApiError(error).message;

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
