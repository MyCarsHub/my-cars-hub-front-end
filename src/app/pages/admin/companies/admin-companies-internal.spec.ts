import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminCompanies } from './admin-companies';
import { AdminCompaniesService } from '../admin-companies.service';
import { AdminSegmentsService } from '../segments/admin-segments.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import type { AdminCompanyListItem } from '../../../types/admin-company.types';

/**
 * Contas internas (FEAT-0141 + segmentos de 18/11): ficam fora das pílulas e da contagem; o ⋮
 * do topo troca a lista para elas, sem segmento e sem "Hoje, para agir".
 */
describe('AdminCompanies — contas internas', () => {
  const INTERNAL: AdminCompanyListItem = {
    id: 'co-int',
    name: 'Conta de teste do Lorran',
    documentMasked: null,
    planCode: null,
    planName: null,
    subscriptionStatus: null,
    billingCycle: null,
    status: 'ACTIVE',
    active: true,
    memberCount: 1,
    createdAt: null,
    internal: true,
    engagement: null,
  };

  let load: ReturnType<typeof vi.fn>;
  let today: ReturnType<typeof vi.fn>;

  function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCompanies],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: AdminCompaniesService,
          useValue: {
            companies: signal([INTERNAL]),
            loading: signal(false),
            total: signal(1),
            segmentCounts: signal({ ALL: 42 }),
            load,
            patchEngagement: vi.fn(),
          },
        },
        { provide: AdminSegmentsService, useValue: { today } },
        { provide: AdminCapabilitiesService, useValue: { ensureLoaded: () => of(null), can: () => true } },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AdminCompanies);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    load = vi.fn().mockReturnValue(of({}));
    today = vi.fn().mockReturnValue(of({ today: '2026-11-18', generatedAt: '', items: [], snoozed: [], notInterestedCount: 0 }));
  });

  it('por padrão a lista pede só clientes (as pílulas não contam internas)', () => {
    render();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ internal: false, segment: null }));
    expect(today).toHaveBeenCalledTimes(1);
  });

  it('"Ver contas internas" no ⋮ do topo troca a lista, tira as pílulas e "Hoje, para agir"', () => {
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-today-strip')).not.toBeNull();
    (host.querySelector('button[aria-label="Ações da página"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (host.querySelector('[data-testid="menu-internal-view"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ internal: true, segment: null, page: 0 }));
    expect(host.querySelector('app-today-strip')).toBeNull();
    expect(host.querySelector('app-list-toolbar [role="radio"]')).toBeNull();
    expect(host.querySelector('[data-testid="internal-note"]')).not.toBeNull();
  });

  it('linha interna: chip neutro "Interna", sem segmento e sem ações de conversa', () => {
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="internal-badge"]')?.textContent?.trim()).toBe('Interna');
    expect(host.querySelector('[data-testid="segment-chip"]')).toBeNull();
    (host.querySelector('button[aria-label="Ações da empresa Conta de teste do Lorran"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="menu-whatsapp"]')).toBeNull();
    expect(host.querySelector('[data-testid="menu-open"]')).not.toBeNull();
  });
});
