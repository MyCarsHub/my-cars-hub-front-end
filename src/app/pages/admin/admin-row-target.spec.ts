import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminUsers } from './users/admin-users';
import { AdminUsersService } from './admin-users.service';
import { AdminCompanies } from './companies/admin-companies';
import { AdminCompaniesService } from './admin-companies.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { AdminUserListItem } from '../../types/admin-user.types';
import type { AdminCompanyListItem } from '../../types/admin-company.types';

/**
 * FIX-0422 — a LINHA inteira navega, nao so o nome.
 *
 * Este arquivo existe por causa de COMO o defeito passou: o FIX-0390 declarou
 * o trade-off (nao esticou o link porque <a> com <button> dentro e HTML
 * invalido, e um link esticado engoliria o menu de acoes), a review confirmou
 * que as linhas eram <a routerLink> — e eram — e o teste da epoca clicava NO
 * NOME. Ninguem clicou fora dele. A decisao era defensavel no papel e
 * insustentavel no uso.
 *
 * Por isso todo teste aqui CLICA numa celula que NAO E O NOME e afirma que a
 * URL mudou. Asserir classe, ou so a presenca de <a>, seria repetir a mesma
 * verificacao que deixou o defeito passar.
 */
@Component({ template: 'detalhe' })
class Stub {}

const USER: AdminUserListItem = {
  id: 'usr-1',
  name: 'Fulano',
  email: 'fulano@empresa.com',
  systemRole: 'USER',
  active: true,
  createdDate: '2025-01-01T00:00:00Z',
  lastCompanyName: 'Locadora Alpha',
};

const COMPANY: AdminCompanyListItem = {
  id: 'co-1',
  name: 'Locadora Alpha',
  documentMasked: '12.***.***/0001-**',
  planCode: 'PRO_MONTHLY',
  planName: 'Pro (mensal)',
  subscriptionStatus: 'ACTIVE',
  billingCycle: 'MONTHLY',
  status: 'ACTIVE',
  active: true,
  memberCount: 3,
  createdAt: '2025-01-01T00:00:00Z',
};

const NOTIFY = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

describe('FIX-0422 — clicar FORA do nome navega (/admin/users)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminUsers],
      providers: [
        provideRouter([{ path: 'admin/users/:id', component: Stub }]),
        ApiErrorService,
        {
          provide: AdminUsersService,
          useValue: {
            items: signal<AdminUserListItem[]>([USER]),
            total: signal(1),
            page: signal(0),
            size: signal(20),
            loading: signal(false),
            load: vi.fn().mockReturnValue(of({ content: [USER], total: 1 })),
            updateStatus: vi.fn(),
            updateSystemRole: vi.fn(),
          },
        },
        { provide: NotificationService, useValue: NOTIFY },
      ],
    });
  });

  async function clickAndUrl(selector: string): Promise<string> {
    const fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const target = host.querySelector<HTMLElement>(selector);
    expect(target, `alvo nao encontrado: ${selector}`).not.toBeNull();

    target!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    return TestBed.inject(Router).url;
  }

  it('desktop: clicar na celula de STATUS navega para o detalhe', async () => {
    expect(await clickAndUrl('[data-testid="cell-status"] a')).toBe('/admin/users/usr-1');
  });

  it('desktop: clicar na celula de DATA navega para o detalhe', async () => {
    expect(await clickAndUrl('[data-testid="cell-date"] a')).toBe('/admin/users/usr-1');
  });

  it('celular: clicar na faixa de chips do cartao navega para o detalhe', async () => {
    expect(await clickAndUrl('[data-testid="card-meta"]')).toBe('/admin/users/usr-1');
  });

  /** A excecao declarada: a coluna de acoes NAO e alvo de navegacao. */
  it('a coluna de ACOES nao navega — o menu continua sendo do menu', async () => {
    const fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const menuButton = host.querySelector<HTMLElement>('app-actions-menu button');
    expect(menuButton, 'menu de acoes sumiu da linha').not.toBeNull();

    menuButton!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/');
    expect(menuButton!.closest('a'), 'o botao do menu esta DENTRO de um <a>').toBeNull();
  });

  /** Um ponto de foco por linha: o nome. O resto e alvo de mouse, nao de Tab. */
  it('a linha tem UM tab stop, e ele e o nome', async () => {
    const fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();
    await fixture.whenStable();

    const row = (fixture.nativeElement as HTMLElement).querySelector('tbody tr');
    const tabbable = Array.from(row!.querySelectorAll('a')).filter(
      (a) => a.getAttribute('tabindex') !== '-1',
    );

    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].textContent?.trim()).toBe('Fulano');
  });
});

describe('FIX-0422 — clicar FORA do nome navega (/admin/companies)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCompanies],
      providers: [
        provideRouter([{ path: 'admin/companies/:id', component: Stub }]),
        ApiErrorService,
        {
          provide: AdminCompaniesService,
          useValue: {
            companies: signal<AdminCompanyListItem[]>([COMPANY]),
            loading: signal(false),
            total: signal(1),
            load: vi.fn().mockReturnValue(of({ content: [COMPANY], total: 1 })),
            updateStatus: vi.fn(),
          },
        },
        { provide: NotificationService, useValue: NOTIFY },
      ],
    });
  });

  async function clickAndUrl(selector: string): Promise<string> {
    const fixture = TestBed.createComponent(AdminCompanies);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const target = host.querySelector<HTMLElement>(selector);
    expect(target, `alvo nao encontrado: ${selector}`).not.toBeNull();

    target!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    return TestBed.inject(Router).url;
  }

  it('desktop: clicar na celula de STATUS navega para o detalhe', async () => {
    expect(await clickAndUrl('[data-testid="cell-status"] a')).toBe('/admin/companies/co-1');
  });

  it('desktop: clicar na celula de DATA navega para o detalhe', async () => {
    expect(await clickAndUrl('[data-testid="cell-date"] a')).toBe('/admin/companies/co-1');
  });

  it('desktop: clicar na celula de ASSINATURA navega para o detalhe', async () => {
    expect(await clickAndUrl('[data-testid="cell-sub"] a')).toBe('/admin/companies/co-1');
  });

  it('celular: clicar na faixa de chips do cartao navega para o detalhe', async () => {
    expect(await clickAndUrl('[data-testid="card-meta"]')).toBe('/admin/companies/co-1');
  });

  it('a coluna de ACOES nao navega — o menu continua sendo do menu', async () => {
    const fixture = TestBed.createComponent(AdminCompanies);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const menuButton = host.querySelector<HTMLElement>('app-actions-menu button');
    expect(menuButton, 'menu de acoes sumiu da linha').not.toBeNull();

    menuButton!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/');
    expect(menuButton!.closest('a'), 'o botao do menu esta DENTRO de um <a>').toBeNull();
  });

  it('a linha tem UM tab stop, e ele e o nome', async () => {
    const fixture = TestBed.createComponent(AdminCompanies);
    fixture.detectChanges();
    await fixture.whenStable();

    const row = (fixture.nativeElement as HTMLElement).querySelector('tbody tr');
    const tabbable = Array.from(row!.querySelectorAll('a')).filter(
      (a) => a.getAttribute('tabindex') !== '-1',
    );

    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].textContent?.trim()).toBe('Locadora Alpha');
  });
});
