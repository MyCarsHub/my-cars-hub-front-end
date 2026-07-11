import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { SessionService } from './session.service';
import { NotificationService } from './notification.service';

interface BackendErrorBody {
  message?: string;
  error?: string;
  exception?: string;
  code?: string;
}

function isTokenExpired(error: HttpErrorResponse, body: BackendErrorBody): boolean {
  const details = [
    typeof error.error === 'string' ? error.error : '',
    body.message ?? '',
    body.error ?? '',
    body.exception ?? '',
  ].join(' ');
  return body.code === 'TOKEN_EXPIRED' || details.includes('TokenExpiredException');
}

/**
 * Global HTTP error interceptor.
 * - 401: clears session and redirects to /login
 * - 403: shows "Acesso negado"
 * - 400/422: forwards backend message when present
 * - 5xx: shows generic server error
 * Always re-throws so component-level handlers still see the error.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const notifications = inject(NotificationService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const status = error.status;
      const body = (error.error ?? {}) as BackendErrorBody;
      const backendMessage =
        typeof body === 'object' && body !== null ? body.message ?? body.error : undefined;

      if (isTokenExpired(error, body)) {
        session.clear();
        notifications.warning('Sua sessão expirou. Faça login novamente.');
        router.navigate(['/login'], { replaceUrl: true });
      } else if (status === 0) {
        notifications.error('Sem conexão com o servidor. Verifique sua internet.');
      } else if (status === 401) {
        if (!req.url.includes('/auth/login')) {
          session.clear();
          router.navigate(['/login']);
        }
      } else if (status === 403) {
        notifications.warning('Acesso negado');
      } else if (status === 400 || status === 422) {
        if (backendMessage) {
          notifications.error(backendMessage);
        }
      } else if (status >= 500 && status < 600) {
        notifications.error('Erro no servidor, tente novamente');
      }

      return throwError(() => error);
    }),
  );
};
