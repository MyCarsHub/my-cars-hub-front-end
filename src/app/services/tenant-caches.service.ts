import { Injectable, inject } from '@angular/core';

import { AlertsService } from './alerts.service';
import { InsurancesService } from './insurances.service';
import { InvitesService } from './invites.service';
import { NotificationFeedService } from './notification-feed.service';
import { SessionResetRegistry } from './session-reset.registry';
import { VehicleIncidentsService } from './vehicle-incidents.service';

/**
 * A lista ÚNICA dos caches `providedIn: 'root'` que guardam dado por empresa e
 * por usuário. Existe porque a lista estava duplicada por omissão: o `logout()`
 * zerava os quatro, mas o encerramento da impersonação não zerava nenhum, e as
 * demais quedas de sessão também não. O resultado era dado de uma empresa
 * cliente sobrevivendo dentro do contexto do administrador — incluindo os
 * e-mails dos convidados, que o próprio `logout()` já classifica como PII que
 * não pode passar para o próximo usuário da aba.
 *
 * Toda troca de contexto passa a chamar UM ponto. Um cache novo que esqueça de
 * entrar aqui é o único jeito de a lista voltar a divergir — e é um lugar só
 * para revisar.
 */
@Injectable({ providedIn: 'root' })
export class TenantCachesService {
  private readonly notificationFeed = inject(NotificationFeedService);
  private readonly insurances = inject(InsurancesService);
  private readonly alerts = inject(AlertsService);
  private readonly invites = inject(InvitesService);
  private readonly incidents = inject(VehicleIncidentsService);

  constructor() {
    // Qualquer `SessionService.clear()` — logout, 401, guard, oauth — passa por aqui.
    inject(SessionResetRegistry).register(() => this.dropForSessionEnd());
  }

  /**
   * Descarta todo dado observado no contexto anterior, MANTENDO o polling do
   * sino ligado. É o que uma troca de contexto dentro da mesma sessão precisa
   * (entrar e sair de impersonação): o cache velho morre, mas o sino continua
   * funcionando para o contexto novo.
   *
   * Chame ANTES de reescrever `selectedCompanyId` — assim `syncTenant()` ainda
   * enxerga a mudança de empresa e dispara um tick imediato em vez de esperar
   * o próximo poll.
   */
  resetAll(): void {
    this.notificationFeed.reset();
    this.insurances.reset();
    this.alerts.reset();
    // Convites pendentes carregam o e-mail de quem foi convidado — PII do tenant.
    this.invites.reset();
    this.incidents.reset();
  }

  /** Reconcilia o sino com a empresa/usuário correntes. Chame DEPOIS da troca de chaves. */
  syncTenant(): void {
    this.notificationFeed.syncTenant();
  }

  /**
   * Fim de sessão (logout, 401, token vencido): além de descartar os caches,
   * PARA o polling. Um tick em voo repopularia o contador depois da limpeza.
   */
  dropForSessionEnd(): void {
    this.notificationFeed.stopPolling();
    this.resetAll();
  }
}
