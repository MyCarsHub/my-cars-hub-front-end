import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { OnboardingService } from './onboarding.service';

export const onboardingGuard: CanActivateFn = () => {
  const onboardingService = inject(OnboardingService);
  const router = inject(Router);

  if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('onboardingCompleted') === 'true') {
    return true;
  }

  if (onboardingService.isCompleted()) {
    return true;
  }

  return onboardingService.loadState().pipe(
    map((state) => {
      if (!state.isCompleted) {
        return router.createUrlTree(['/onboarding']);
      }
      return true;
    }),
    catchError(() => of(true)),
  );
};


export const onboardingCompleteGuard: CanActivateFn = () => {
  const onboardingService = inject(OnboardingService);
  const router = inject(Router);

  if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('onboardingCompleted') === 'true') {
    return router.createUrlTree(['/dashboard']);
  }

  if (onboardingService.isCompleted()) {
    return router.createUrlTree(['/dashboard']);
  }

  return onboardingService.loadState().pipe(
    map((state) => {
      if (state.isCompleted) {
        return router.createUrlTree(['/dashboard']);
      }
      return true;
    }),
    catchError(() => of(true)),
  );
};
