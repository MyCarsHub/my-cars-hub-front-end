import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AdminCapabilityCode } from '../types/admin-roles.types';
import { AdminCapabilitiesService } from './admin-capabilities.service';

/**
 * Rota de admin que exige uma capacidade. Conveniência: quem não tem volta
 * para o início do admin em vez de ver uma tela que só daria 403.
 */
export function capabilityGuard(code: AdminCapabilityCode): CanActivateFn {
  return () => {
    const caps = inject(AdminCapabilitiesService);
    const router = inject(Router);
    return caps.ensureLoaded().pipe(map(() => (caps.can(code) ? true : router.createUrlTree(['/admin']))));
  };
}
