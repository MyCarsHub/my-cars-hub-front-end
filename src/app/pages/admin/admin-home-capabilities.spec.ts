import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminHome } from './admin-home';
import { AdminMetricsService } from '../../services/admin-metrics.service';
import { AdminCapabilitiesService } from '../../services/admin-capabilities.service';
import { NotificationService } from '../../services/notification.service';
import type { AdminCapabilityCode } from '../../types/admin-roles.types';

/** A grade de atalhos saiu da home (o menu leva a cada área); fica a guarda do FEAT-0452. */
describe('AdminHome — capacidades', () => {
  function render(codes: AdminCapabilityCode[]): HTMLElement {
    const granted = new Set(codes);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminHome],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AdminMetricsService,
          useValue: { overview: signal(null), loading: signal(false), error: signal(null), loadOverview: vi.fn(() => of(null)) },
        },
        { provide: AdminCapabilitiesService, useValue: { can: (c: AdminCapabilityCode) => granted.has(c), ensureLoaded: () => of(null) } },
        { provide: NotificationService, useValue: { error: vi.fn(), success: vi.fn(), info: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AdminHome);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('nem o Dono vê as ferramentas de teste que saíram do admin', () => {
    const el = render(['ver', 'admins.gerir', 'blog', 'suporte.atender', 'plataforma.operar', 'cobranca.agir']);
    // FEAT-0452 — as duas ferramentas de teste saíram do admin, mesmo para o Dono.
    expect(el.textContent).not.toContain('Testar templates');
    expect(el.textContent).not.toContain('Ferramentas');
  });
});
