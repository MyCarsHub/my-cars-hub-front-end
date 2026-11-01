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

/** Lote 2A: os atalhos do admin seguem o papel (o servidor confere de novo). */
describe('AdminHome — atalhos por capacidade', () => {
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

  it('Leitura vê só as áreas de leitura: sem Admins, Blog, Feedback, Ferramentas ou e-mail de teste', () => {
    const el = render(['ver']);
    expect(el.textContent).toContain('Empresas');
    expect(el.textContent).toContain('Auditoria');
    expect(el.textContent).not.toContain('Admins e papéis');
    expect(el.textContent).not.toContain('Moderação de Feedback');
    expect(el.textContent).not.toContain('Testar templates');
    expect(el.textContent).not.toContain('Ferramentas');
    expect(el.querySelector('a[href="/admin/blog"]')).toBeNull();
  });

  it('Cupons entra nas seções para quem lê e fica fora para quem não tem "ver"', () => {
    expect(render(['ver']).querySelector('a[href="/admin/cupons"]')).not.toBeNull();
    expect(render(['blog']).querySelector('a[href="/admin/cupons"]')).toBeNull();
  });

  it('o Dono vê o atalho "Admins e papéis"', () => {
    const el = render(['ver', 'admins.gerir', 'blog', 'suporte.atender', 'plataforma.operar', 'cobranca.agir']);
    expect(el.querySelector('a[href="/admin/admins"]')).not.toBeNull();
    expect(el.textContent).toContain('Testar templates');
  });
});
