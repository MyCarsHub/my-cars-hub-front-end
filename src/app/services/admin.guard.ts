import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';
import { homeRouteForRole } from '../utils/home-route';

export const adminGuard: CanActivateFn = () => {
  const router = inject(Router);
  const session = inject(SessionService);

  if (session.isPlatformAdmin()) {
    return true;
  }

  /*
   * FIX-0579 — o SEGUNDO laço que o mesmo lote criou, e pela mesma causa.
   *
   * Este fallback sempre foi `/dashboard`, e era inofensivo enquanto aquela rota
   * não tinha guard. Ela ganhou `roleGuard(['OWNER','MANAGER'])` neste lote, e a
   * partir daí quem chega aqui com papel NULO é devolvido a uma rota que o recusa
   * de novo — o mesmo laço do ramo `!role` de `role.guard.ts`, por outra porta.
   *
   * A distinção é a mínima que fecha o laço sem punir quem não o causou: papel
   * PRESENTE mas não-admin continua indo para `/dashboard`, que é o que sempre
   * fez e continua correto para operador. Só papel NULO muda de destino, porque
   * é só ele que loopa. Aqui não há ramo de admin: se fosse admin, o `if` acima
   * já teria devolvido `true`.
   *
   * A causa (token vencido atravessa o `authGuard` porque `getToken()` não valida
   * `exp`) é o FIX-0580.
   */
  const role = session.getCompanyRoleFromToken();
  if (!role) {
    return router.createUrlTree(['/login']);
  }

  /*
   * Papel PRESENTE mas não-admin vai para a CASA do papel, não para `/dashboard`
   * fixo. A forma "papel presente continua em /dashboard" fecha o laço mas viola
   * o invariante para o DRIVER: `/dashboard` o recusa, então ele levaria dois
   * saltos (`/admin` -> `/dashboard` -> `/alugueis`) e o primeiro destino é uma
   * rota que o recusa. `homeRouteForRole` já responde isso em um lugar só, e para
   * OWNER/MANAGER devolve exatamente o `/dashboard` de sempre.
   */
  return router.createUrlTree([homeRouteForRole(role)]);
};
