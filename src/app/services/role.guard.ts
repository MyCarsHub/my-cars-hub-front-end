import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

export const roleGuard = (
    allowedRoles: string[]
): CanActivateFn => {
    return () => {
        const router = inject(Router);
        const sessionService = inject(SessionService);
        // FIX-0363 — o papel vem do TOKEN, nao do espelho `selectedRole` do
        // sessionStorage. O espelho e editavel pelo DevTools e fica stale; o
        // token e reemitido com o papel da empresa nova em
        // `/auth/select-company/{id}`, e e a mesma fonte que o backend usa.
        // `null` (token ausente, expirado, sem claim) NEGA — papel desconhecido
        // nao vira permissao por omissao.
        const role = sessionService.getCompanyRoleFromToken();

        if (!role) {
            return router.createUrlTree(['/dashboard']);
        }

        if (allowedRoles.includes(role)) {
            return true;
        }

        return router.createUrlTree(['/dashboard']);
    };
};