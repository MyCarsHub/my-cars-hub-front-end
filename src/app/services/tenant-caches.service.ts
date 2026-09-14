import { Injectable, inject } from '@angular/core';

import { NotificationFeedService } from './notification-feed.service';
import { SessionResetRegistry } from './session-reset.registry';
import { TenantResetRegistry } from './tenant-reset.registry';

/**
 * O ÚNICO ponto que toda troca de contexto chama para descartar dado da empresa
 * anterior. Existe porque a lista estava duplicada por omissão: o `logout()`
 * zerava alguns caches, o encerramento da impersonação não zerava nenhum, e as
 * demais quedas de sessão também não. O resultado era dado de uma empresa
 * cliente sobrevivendo dentro do contexto do administrador — incluindo os
 * e-mails dos convidados, que o próprio `logout()` já classifica como PII que
 * não pode passar para o próximo usuário da aba.
 *
 * ## Quem está na lista
 *
 * Ninguém, estaticamente: cada dono de estado se registra no
 * `TenantResetRegistry` no próprio construtor. Manter a lista aqui custava o
 * BUNDLE INICIAL — sete serviços de feature entravam no caminho crítico só por
 * serem importados por este arquivo, e o orçamento de 1 MB estourava. O
 * registro também dá a semântica certa: um cache que nunca foi instanciado não
 * aparece, e também não tem nada da empresa anterior para vazar.
 *
 * ## Auditoria de 2026-09-14 (FIX-0272)
 *
 * A limpeza era disparada só no fim de sessão e na impersonação: a TROCA DE
 * EMPRESA pelo seletor de tenant (`LayoutStore.commitTenant`) regrava as chaves
 * sem passar por `SessionService.clear()`, então nada era descartado. Varridos
 * todos os `providedIn: 'root'` do app:
 *
 * - **Registrados** — `NotificationFeedService`, `InsurancesService`,
 *   `AlertsService`, `InvitesService`, `VehicleIncidentsService`,
 *   `VehiclesService` (frota e financiamentos), `DriverService`,
 *   `MaintenancesService`, `FinesService`, `ReportsService`, `BillingService` e
 *   `BillingAccessService`. Este último era o mais grave: `isBlocked()`
 *   respondia com a decisão de bloqueio da empresa ANTERIOR.
 * - **Já seguros, por se chavearem sozinhos pela empresa** —
 *   `AlertSettingsService` e `FleetActivationService` comparam a empresa dona
 *   do cache com a selecionada e se descartam; `RentalDraftService` sufixa a
 *   chave de armazenamento com usuário + empresa.
 * - **Fora do escopo por não serem do tenant** — `FipeService` (catálogo
 *   nacional), `TourService` e `NotificationService` (por usuário/efêmeros),
 *   `DashboardService` e `CompanyContactService` (sem estado), e os
 *   `admin-*.service` (contexto do administrador da plataforma).
 * - **Vazam e ainda não se registraram, por estarem fora de `fe:core`** —
 *   `pages/rentals/rental.service.ts` e os dois
 *   `pages/company-settings/integrations/*-integration.service.ts`. O gancho já
 *   existe para eles adotarem.
 */
@Injectable({ providedIn: 'root' })
export class TenantCachesService {
  private readonly notificationFeed = inject(NotificationFeedService);
  private readonly tenantReset = inject(TenantResetRegistry);

  constructor() {
    // Qualquer `SessionService.clear()` — logout, 401, guard, oauth — passa por aqui.
    inject(SessionResetRegistry).register(() => this.dropForSessionEnd());
  }

  /**
   * Descarta todo dado observado no contexto anterior, MANTENDO o polling do
   * sino ligado. É o que uma troca de contexto dentro da mesma sessão precisa
   * (trocar de empresa, entrar e sair de impersonação): o cache velho morre,
   * mas o sino continua funcionando para o contexto novo.
   *
   * Chame ANTES de reescrever `selectedCompanyId` — assim `syncTenant()` ainda
   * enxerga a mudança de empresa e dispara um tick imediato em vez de esperar
   * o próximo poll.
   */
  resetAll(): void {
    this.tenantReset.run();
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
