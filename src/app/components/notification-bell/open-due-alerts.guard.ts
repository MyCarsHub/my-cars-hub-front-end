import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../../services/session.service';
import { DUE_ALERTS_ROLES, NotificationBellStore } from './notification-bell.store';

/**
 * `/alertas` deixou de ser página (canvas "Menu novo", prancha 3): os vencimentos moram na
 * aba Vencimentos do sino. A URL continua valendo — e-mails, favoritos e o histórico —, e
 * abrir um link antigo abre o sino nessa aba.
 *
 * Navegação dentro do app: a página atual fica onde está (a navegação é cancelada) e o sino
 * abre por cima. Primeira carga (o link veio de fora): não há página atrás, então a pessoa
 * cai no Dashboard com o sino aberto.
 *
 * O `roleGuard(['OWNER', 'MANAGER'])` da rota continua decidindo quem pode; este guard só
 * abre o painel para esses mesmos papéis, para não abrir o sino de quem o `roleGuard`
 * está mandando embora.
 */
export const openDueAlertsGuard: CanActivateFn = () => {
  const router = inject(Router);
  const role = inject(SessionService).getCompanyRoleFromToken();
  if (role && DUE_ALERTS_ROLES.includes(role)) {
    inject(NotificationBellStore).openOn('vencimentos');
  }
  return router.navigated ? false : router.parseUrl('/dashboard');
};
