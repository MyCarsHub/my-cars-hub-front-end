import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { OnboardingService } from './onboarding.service';
import { SessionService } from '../../services/session.service';

export const onboardingGuard: CanActivateFn = () => {
  const onboardingService = inject(OnboardingService);
  const router = inject(Router);
  const sessionService = inject(SessionService);

  // PLATFORM_ADMIN operates above the tenant model — never gated by
  // onboarding, even if companies=[]. Short-circuit before touching
  // onboardingService.loadState() to avoid a needless HTTP round-trip.
  if (sessionService.isPlatformAdmin()) {
    return true;
  }

  if (sessionService.isOnboardingCompleted()) {
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
    // Fail-closed: se não conseguimos confirmar que onboarding foi concluído
    // (ex: /v1/onboarding retorna 404 pra user sem row em `onboardings`, ou
    // rede falha), redireciona pra /onboarding. Deixar passar aqui manda o
    // user pra dashboard mudo com 400/403 em cada endpoint.
    catchError(() => of(router.createUrlTree(['/onboarding']))),
  );
};


export const onboardingCompleteGuard: CanActivateFn = () => {
  const onboardingService = inject(OnboardingService);
  const router = inject(Router);
  const sessionService = inject(SessionService);

  // PLATFORM_ADMIN must never render the onboarding page — kick them to
  // /dashboard immediately.
  if (sessionService.isPlatformAdmin()) {
    return router.createUrlTree(['/dashboard']);
  }

  if (sessionService.isOnboardingCompleted()) {
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
    // Aqui manter fail-open é OK: rota é /onboarding, deixar passar quando
    // /v1/onboarding falhar significa "vamos deixar o user tentar o
    // onboarding". O oposto (redirecionar pra /dashboard mudo) é pior.
    catchError(() => of(true)),
  );
};
