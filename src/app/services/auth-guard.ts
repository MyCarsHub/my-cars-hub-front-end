import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const authService = inject(AuthService);
  const sessionService = inject(SessionService);

  const token = sessionService.getToken();

  if (!token) {
    return router.createUrlTree(['/login']);
  }

  const alreadyLoaded =
    sessionService.getItem('onboardingCompleted') !== null;

  if (alreadyLoaded) {
    return true;
  }

  return authService.getMe().pipe(
    map(() => true),
    catchError(() => {
      sessionService.clear();
      return of(router.createUrlTree(['/login']));
    })
  );
};