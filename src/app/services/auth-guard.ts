import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const authService = inject(AuthService);

  const token = sessionStorage.getItem('token');

  if (!token) {
    return router.createUrlTree(['/login']);
  }

  const alreadyLoaded =
    sessionStorage.getItem('onboardingCompleted') !== null;

  if (alreadyLoaded) {
    return true;
  }

  return authService.getMe().pipe(
    map(() => true),
    catchError(() => {
      sessionStorage.clear();
      return of(router.createUrlTree(['/login']));
    })
  );
};