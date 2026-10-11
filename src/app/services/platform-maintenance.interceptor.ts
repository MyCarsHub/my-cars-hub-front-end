import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { PlatformMaintenanceService, isMaintenanceSignal } from './platform-maintenance.service';

/**
 * Liga a tela de manutenção quando a API sinaliza manutenção (ver `isMaintenanceSignal`).
 * Só observa: o erro segue adiante intacto para quem chamou.
 */
export const platformMaintenanceInterceptor: HttpInterceptorFn = (req, next) => {
  const maintenance = inject(PlatformMaintenanceService);
  return next(req).pipe(
    catchError((error: unknown) => {
      if (isMaintenanceSignal(error)) maintenance.enter();
      return throwError(() => error);
    }),
  );
};
