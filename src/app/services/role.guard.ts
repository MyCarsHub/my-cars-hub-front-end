import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const roleGuard = (
    allowedRoles: string[]
): CanActivateFn => {
    return () => {
        const router = inject(Router);
        const role = sessionStorage.getItem('selectedRole');

        if (!role) {
            return router.createUrlTree(['/dashboard']);
        }

        if (allowedRoles.includes(role)) {
            return true;
        }

        return router.createUrlTree(['/dashboard']);
    };
};