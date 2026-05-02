import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

export const roleGuard = (
    allowedRoles: string[]
): CanActivateFn => {
    return () => {
        const router = inject(Router);
        const sessionService = inject(SessionService);
        const role = sessionService.getItem('selectedRole');

        if (!role) {
            return router.createUrlTree(['/dashboard']);
        }

        if (allowedRoles.includes(role)) {
            return true;
        }

        return router.createUrlTree(['/dashboard']);
    };
};