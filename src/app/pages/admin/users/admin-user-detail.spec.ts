import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminUserDetail } from './admin-user-detail';
import { AdminUsersService } from '../admin-users.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type { AdminUserDetail as AdminUserDetailDto } from '../../../types/admin-user.types';

/**
 * "Último login" tem dois estados legítimos: data real (o backend passou a
 * gravar `last_login_date` também no login Google) e ausência de registro.
 * Como não houve backfill dos usuários antigos, o estado vazio fala de
 * AUSÊNCIA DO DADO — nunca afirma que a pessoa jamais acessou.
 */
describe('AdminUserDetail — campo "Último login"', () => {
  const BASE_USER: AdminUserDetailDto = {
    id: 'u-1',
    name: 'Ana Souza',
    email: 'ana@example.com',
    systemRole: 'USER',
    active: true,
    createdDate: '2025-01-01T00:00:00Z',
    lastLoginAt: null,
    companies: [],
  };

  let detail: ReturnType<typeof signal<AdminUserDetailDto | null>>;

  function configure(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminUserDetail],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'u-1' })) },
        },
        {
          provide: AdminUsersService,
          useValue: {
            detail,
            detailLoading: signal(false),
            getDetail: vi.fn().mockReturnValue(of(detail())),
            clearDetail: vi.fn(),
            updateStatus: vi.fn(),
            updateSystemRole: vi.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            error: vi.fn(),
            success: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });
  }

  /** Valor renderizado logo abaixo do rótulo "Último login" no card "Dados". */
  function lastLoginValue(host: HTMLElement): string {
    const labels = Array.from(host.querySelectorAll('p'));
    const label = labels.find((p) => p.textContent?.trim() === 'Último login');
    expect(label, 'rótulo "Último login" não encontrado').toBeTruthy();
    return label?.nextElementSibling?.textContent?.trim() ?? '';
  }

  beforeEach(() => {
    detail = signal<AdminUserDetailDto | null>(null);
  });

  it('mostra a data/hora formatada em pt-BR quando há último acesso', () => {
    detail.set({ ...BASE_USER, lastLoginAt: '2026-07-30T14:35:00Z' });
    configure();

    const fixture = TestBed.createComponent(AdminUserDetail);
    fixture.detectChanges();

    // Fuso do runner varia; valida o FORMATO pt-BR (dd/mm/aaaa hh:mm), não o instante.
    const value = lastLoginValue(fixture.nativeElement);
    expect(value).toMatch(/^\d{2}\/\d{2}\/\d{4},?\s\d{2}:\d{2}$/);
    expect(value).not.toContain('N/A');
  });

  it('mostra "Sem registro de acesso" atenuado quando não há último acesso', () => {
    detail.set({ ...BASE_USER, lastLoginAt: null });
    configure();

    const fixture = TestBed.createComponent(AdminUserDetail);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(lastLoginValue(host)).toBe('Sem registro de acesso');
    expect(host.textContent).not.toContain('N/A');

    const labels = Array.from(host.querySelectorAll('p'));
    const empty = labels.find((p) => p.textContent?.trim() === 'Sem registro de acesso');
    // Atenuado, mas ainda com contraste AA sobre branco (neutral-500 ≥ 4,5:1).
    expect(empty?.className).toContain('text-fg-subtle');
  });
});

/** AUDIT 2026-10-25 D2 — a situação do vínculo aparece em português, nunca o enum cru. */
describe('AdminUserDetail — situação do vínculo com a empresa', () => {
  it('mostra Ativo / Convidado / Em cadastro em vez de ACTIVE / INVITED / ONBOARDING', () => {
    const detail = signal<AdminUserDetailDto | null>({
      id: 'u-1',
      name: 'Ana Souza',
      email: 'ana@example.com',
      systemRole: 'USER',
      active: true,
      createdDate: '2025-01-01T00:00:00Z',
      lastLoginAt: null,
      companies: [
        { companyId: 'c-1', companyName: 'Alfa', role: 'OWNER', status: 'ACTIVE', joinedAt: null },
        {
          companyId: 'c-2',
          companyName: 'Beta',
          role: 'MANAGER',
          status: 'INVITED',
          joinedAt: null,
        },
        {
          companyId: 'c-3',
          companyName: 'Gama',
          role: 'DRIVER',
          status: 'ONBOARDING',
          joinedAt: null,
        },
      ],
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminUserDetail],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'u-1' })) } },
        {
          provide: AdminUsersService,
          useValue: {
            detail,
            detailLoading: signal(false),
            getDetail: vi.fn().mockReturnValue(of(detail())),
            clearDetail: vi.fn(),
            updateStatus: vi.fn(),
            updateSystemRole: vi.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            error: vi.fn(),
            success: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(AdminUserDetail);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Ativo');
    expect(text).toContain('Convidado');
    expect(text).toContain('Em cadastro');
    expect(text).not.toMatch(/\bACTIVE\b|\bINVITED\b|\bONBOARDING\b/);
  });
});
