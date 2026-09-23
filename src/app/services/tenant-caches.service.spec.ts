import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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
import { SessionService } from './session.service';
import { TenantCachesService } from './tenant-caches.service';
import { VehicleIncidentsService } from './vehicle-incidents.service';
import { VehiclesService } from './vehicles.service';

/**
 * A cobertura da limpeza por empresa regride em silêncio: um cache que esqueça
 * de chamar `TenantResetRegistry.register()` no construtor não quebra teste
 * nenhum, só vaza dado da empresa anterior em produção. Por isso o teste é
 * sobre a LISTA — cada serviço auditado no FIX-0272 aparece aqui pelo nome, é
 * instanciado (o que é o que o registra) e tem de ser zerado pelo `resetAll()`.
 * Tirar o registro de qualquer um deles derruba a suíte.
 */
describe('TenantCachesService — cobertura da lista de caches por empresa', () => {
  /** Os donos de estado por empresa. Crescer esta lista é a manutenção esperada. */
  const TENANT_CACHES: ReadonlyArray<readonly [string, Type<{ reset(): void }>]> = [
    ['NotificationFeedService', NotificationFeedService],
    ['InsurancesService', InsurancesService],
    ['AlertsService', AlertsService],
    ['InvitesService', InvitesService],
    ['VehicleIncidentsService', VehicleIncidentsService],
    ['VehiclesService', VehiclesService],
    ['DriverService', DriverService],
    ['MaintenancesService', MaintenancesService],
    ['FinesService', FinesService],
    ['ReportsService', ReportsService],
    ['BillingService', BillingService],
    ['BillingAccessService', BillingAccessService],
  ];

  let resets: Map<string, Mock<() => void>>;
  let stopPolling: Mock<() => void>;
  let tenantCaches: TenantCachesService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: HttpClient, useValue: { get: vi.fn(() => of({})), post: vi.fn(() => of({})) } },
        {
          provide: SessionService,
          useValue: {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            isPlatformAdmin: vi.fn(() => false),
          },
        },
      ],
    });

    // Espiar substituindo a implementação: o que está sob teste é QUEM é
    // chamado, não o que cada `reset()` zera — isso é do spec de cada serviço.
    resets = new Map();
    for (const [name, type] of TENANT_CACHES) {
      const spy = vi.fn(() => {});
      TestBed.inject(type).reset = spy;
      resets.set(name, spy);
    }
    stopPolling = vi.fn(() => {});
    TestBed.inject(NotificationFeedService).stopPolling = stopPolling;

    tenantCaches = TestBed.inject(TenantCachesService);
  });

  it('resetAll() descarta TODOS os caches auditados', () => {
    tenantCaches.resetAll();

    for (const [name] of TENANT_CACHES) {
      expect(resets.get(name), `${name} nao se registrou no TenantResetRegistry`).toHaveBeenCalledTimes(1);
    }
  });

  it('resetAll() NÃO para o polling — a troca de empresa continua na mesma sessão', () => {
    tenantCaches.resetAll();

    expect(stopPolling).not.toHaveBeenCalled();
  });

  it('dropForSessionEnd() descarta tudo E para o polling', () => {
    tenantCaches.dropForSessionEnd();

    for (const [name] of TENANT_CACHES) {
      expect(resets.get(name), `${name} ficou de fora do fim de sessão`).toHaveBeenCalledTimes(1);
    }
    // Um tick em voo repopularia o contador depois da limpeza.
    expect(stopPolling).toHaveBeenCalledTimes(1);
  });
});
