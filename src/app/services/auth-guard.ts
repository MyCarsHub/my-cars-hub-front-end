import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const authToken = sessionStorage.getItem('token');

  if (authToken) {
    return true;
  }

  return router.createUrlTree(['/login']);
};