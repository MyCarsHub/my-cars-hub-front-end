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

  /*
   * PLATFORM_ADMIN must never render the onboarding page.
   *
   * FIX-0579 — the destination is /admin, not /dashboard. Sending them to
   * /dashboard worked until that route acquired roleGuard(['OWNER','MANAGER']):
   * a platform admin with no company role has a null company role, so the
   * dashboard refuses him and forwards to /admin anyway. It terminated, so it
   * was never a loop - but the first hop landed on a route that refuses the same
   * user, which is the invariant asserted in
   * app.routes.redirect-termination.spec.ts. One hop, no bounce.
   */
  if (sessionService.isPlatformAdmin()) {
    return router.createUrlTree(['/admin']);
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
