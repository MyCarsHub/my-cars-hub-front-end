import { Injectable, inject } from '@angular/core';

import { AlertsService } from './alerts.service';
import { BillingAccessService } from './billing-access.service';
import { BillingService } from './billing.service';
import { DriverService } from './driver.service';
import { FinesService } from './fines.service';
import { InsurancesService } from './insurances.service';
import { InvitesService } from './invites.service';
import { MaintenancesService } from './maintenances.service';
import { NotificationFeedService } from './notification-feed.service';
import { ReportsService } from './reports.service';
import { SessionResetRegistry } from './session-reset.registry';
import { VehicleIncidentsService } from './vehicle-incidents.service';
import { VehiclesService } from './vehicles.service';

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
 *
 * ## Auditoria de 2026-09-14 (FIX-0272)
 *
 * A lista cobria cinco serviços e o gancho só era chamado no fim de sessão e
 * na impersonação: a TROCA DE EMPRESA pelo seletor de tenant
 * (`LayoutStore.commitTenant`) regrava as chaves sem passar por
 * `SessionService.clear()`, então nada era descartado. Varridos todos os
 * `providedIn: 'root'` do app, o resultado foi:
 *
 * - **Entraram agora** — guardam dado da empresa em memória e não tinham como
 *   ser zerados: `VehiclesService` (frota e financiamentos), `DriverService`,
 *   `MaintenancesService`, `FinesService`, `ReportsService`, `BillingService` e
 *   `BillingAccessService`. Este último é o mais grave da lista: `isBlocked()`
 *   respondia com a decisão de bloqueio da empresa ANTERIOR.
 * - **Já seguros, por se chavearem sozinhos pela empresa** —
 *   `AlertSettingsService` e `FleetActivationService` comparam a empresa dona
 *   do cache com a selecionada e se descartam; `RentalDraftService` sufixa a
 *   chave de armazenamento com usuário + empresa.
 * - **Fora do escopo por não serem do tenant** — `FipeService` (catálogo
 *   nacional), `TourService` e `NotificationService` (por usuário/efêmeros),
 *   `DashboardService` e `CompanyContactService` (sem estado), e os
 *   `admin-*.service` (contexto do administrador da plataforma, não da
 *   empresa).
 * - **Vazam e NÃO entraram aqui por estarem fora de `fe:core`** —
 *   `pages/rentals/rental.service.ts` e os dois
 *   `pages/company-settings/integrations/*-integration.service.ts`. Ficam
 *   registrados como trabalho próprio; o gancho já existe para eles adotarem.
 */
@Injectable({ providedIn: 'root' })
export class TenantCachesService {
  private readonly notificationFeed = inject(NotificationFeedService);
  private readonly insurances = inject(InsurancesService);
  private readonly alerts = inject(AlertsService);
  private readonly invites = inject(InvitesService);
  private readonly incidents = inject(VehicleIncidentsService);
  private readonly vehicles = inject(VehiclesService);
  private readonly drivers = inject(DriverService);
  private readonly maintenances = inject(MaintenancesService);
  private readonly fines = inject(FinesService);
  private readonly reports = inject(ReportsService);
  private readonly billing = inject(BillingService);
  private readonly billingAccess = inject(BillingAccessService);

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
    this.vehicles.reset();
    this.drivers.reset();
    this.maintenances.reset();
    this.fines.reset();
    this.reports.reset();
    this.billing.reset();
    // Decisão de acesso é POR EMPRESA: mantida, a empresa nova herdaria o
    // bloqueio (ou a liberação) da anterior até a próxima resposta.
    this.billingAccess.reset();
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
