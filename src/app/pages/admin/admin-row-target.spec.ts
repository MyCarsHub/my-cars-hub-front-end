import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminUsers } from './users/admin-users';
import { AdminUsersService } from './admin-users.service';
import { AdminCompanies } from './companies/admin-companies';
import { AdminCompaniesService } from './admin-companies.service';
import { AdminCapabilitiesService } from '../../services/admin-capabilities.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { AdminUserListItem } from '../../types/admin-user.types';
import type { AdminCompanyListItem } from '../../types/admin-company.types';

/**
 * FIX-0422 — a LINHA inteira navega, nao so o nome (listas em `app-data-list`).
 *
 * Este arquivo existe por causa de COMO o defeito passou: o FIX-0390 declarou
 * o trade-off, a review confirmou que as linhas eram <a routerLink> — e eram — e
 * o teste da epoca clicava NO NOME. Ninguem clicou fora dele.
 *
 * Por isso todo teste aqui CLICA numa celula que NAO E O NOME e afirma que a
 * URL mudou. Asserir classe, ou so a presenca de <a>, seria repetir a mesma
 * verificacao que deixou o defeito passar.
 *
 * As listas de Usuarios e Empresas sairam de <table> artesanal para o kit
 * `app-data-list` (FEAT-0482/0483). O contrato nao mudou, so o markup: o alvo e
 * a LINHA (tr no desktop, cartao no celular), como na lista de Cupons em
 * producao; a kebab (`app-actions-menu`) tem dono proprio. Continua valendo:
 * - UM tab stop por linha, o link do nome (a linha em si nao e focavel);
 * - nada interativo aninhado dentro de <a>;
 * - alvo de toque de 44px (link do nome e kebab).
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
  internal: false,
};

const NOTIFY = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), push: vi.fn() };

type Fixture = { nativeElement: HTMLElement; detectChanges(): void; whenStable(): Promise<unknown> };

/** A celula da TABELA (desktop) cuja coluna tem esse cabecalho. */
function desktopCell(host: HTMLElement, header: string): HTMLElement | null {
  const ths = Array.from(host.querySelectorAll('[data-table] thead th'));
  const index = ths.findIndex((th) => th.textContent?.trim() === header);
  return index < 0 ? null : host.querySelector<HTMLElement>(`[data-row] td:nth-child(${index + 1})`);
}

/** O valor do CARTAO (celular) cujo rotulo e esse cabecalho. */
function mobileCell(host: HTMLElement, header: string): HTMLElement | null {
  const dt = Array.from(host.querySelectorAll('[data-card] dt')).find(
    (el) => el.textContent?.trim() === header,
  );
  return (dt?.nextElementSibling as HTMLElement | null) ?? null;
}

async function render(component: typeof AdminUsers | typeof AdminCompanies): Promise<Fixture> {
  const fixture = TestBed.createComponent(component as typeof AdminUsers) as unknown as Fixture;
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

async function clickAndUrl(fixture: Fixture, target: HTMLElement | null, label: string): Promise<string> {
  expect(target, `alvo nao encontrado: ${label}`).not.toBeNull();
  target!.click();
  await fixture.whenStable();
  fixture.detectChanges();
  return TestBed.inject(Router).url;
}

/** Garantias de teclado e toque, iguais nas duas listas e nos dois layouts. */
function expectKeyboardAndTouchContract(fixture: Fixture, name: string): void {
  const host = fixture.nativeElement;
  for (const scope of ['[data-row]', '[data-card]']) {
    const row = host.querySelector<HTMLElement>(scope)!;

    // UM tab stop por linha: o link do nome. A linha nao e focavel (nao vira segundo stop).
    // A kebab e o botao de contato sao controles proprios, contados a parte.
    const tabbable = Array.from(row.querySelectorAll<HTMLElement>('a, button, [tabindex]')).filter(
      (el) =>
        el.getAttribute('tabindex') !== '-1' &&
        !el.closest('app-actions-menu') &&
        !el.closest('app-contact-actions'),
    );
    expect(tabbable, `${scope}: mais de um tab stop fora da kebab e do contato`).toHaveLength(1);
    expect(tabbable[0].tagName).toBe('A');
    expect(tabbable[0].getAttribute('aria-label')).toBe(`Abrir ${name}`);
    expect(row.hasAttribute('tabindex'), `${scope}: a linha virou tab stop`).toBe(false);

    // Alvo de toque do nome: 44px.
    expect(tabbable[0].className).toContain('min-h-[44px]');

    // Nada interativo dentro de <a> (HTML invalido e armadilha de clique).
    for (const link of Array.from(row.querySelectorAll('a'))) {
      expect(link.querySelector('a, button, input, select'), `${scope}: interativo dentro de <a>`).toBeNull();
    }

    // A kebab existe, nao esta dentro de <a>, e tem alvo de toque de 44px.
    const kebab = row.querySelector<HTMLElement>('app-actions-menu button');
    expect(kebab, `${scope}: kebab sumiu da linha`).not.toBeNull();
    expect(kebab!.closest('a')).toBeNull();
    expect(kebab!.className).toContain('h-11');
    expect(kebab!.className).toContain('w-11');
  }
}

/** A kebab tem dono proprio: abrir o menu NAO navega, nem clicar num item de acao. */
async function expectKebabDoesNotNavigate(fixture: Fixture, actionTestId: string): Promise<void> {
  const host = fixture.nativeElement;
  host.querySelector<HTMLElement>('[data-card] app-actions-menu button')!.click();
  fixture.detectChanges();
  await fixture.whenStable();
  expect(TestBed.inject(Router).url).toBe('/');

  const item = host.querySelector<HTMLElement>(`[data-card] [data-testid="${actionTestId}"]`);
  expect(item, `item de acao ${actionTestId} nao abriu`).not.toBeNull();
  item!.click();
  fixture.detectChanges();
  await fixture.whenStable();
  expect(TestBed.inject(Router).url).toBe('/');
}

describe('FIX-0422 — clicar FORA do nome navega (/admin/users)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminUsers],
      providers: [
        provideRouter([{ path: 'admin/users/:id', component: Stub }]),
        provideNoopAnimations(),
        ApiErrorService,
        { provide: AdminCapabilitiesService, useValue: { can: () => true, ensureLoaded: () => of(null) } },
        {
          provide: AdminUsersService,
          useValue: {
            items: signal<AdminUserListItem[]>([USER]),
            total: signal(1),
            page: signal(0),
            size: signal(20),
            loading: signal(false),
            load: vi.fn().mockReturnValue(of({ content: [USER], page: 0, size: 20, total: 1 })),
            updateStatus: vi.fn(),
          },
        },
        { provide: NotificationService, useValue: NOTIFY },
      ],
    });
  });

  it('desktop: clicar na celula de SITUACAO navega para o detalhe', async () => {
    const f = await render(AdminUsers);
    const cell = desktopCell(f.nativeElement, 'Situação');
    expect(await clickAndUrl(f, cell, 'celula Situacao')).toBe('/admin/users/usr-1');
  });

  it('desktop: clicar na celula de ULTIMO ACESSO navega para o detalhe', async () => {
    const f = await render(AdminUsers);
    const cell = desktopCell(f.nativeElement, 'Último acesso');
    expect(await clickAndUrl(f, cell, 'celula Ultimo acesso')).toBe('/admin/users/usr-1');
  });

  it('desktop: clicar no espaco vazio da linha (a propria tr) navega', async () => {
    const f = await render(AdminUsers);
    const row = f.nativeElement.querySelector<HTMLElement>('[data-row]');
    expect(await clickAndUrl(f, row, 'tr')).toBe('/admin/users/usr-1');
  });

  it('celular: clicar num valor do cartao navega para o detalhe', async () => {
    const f = await render(AdminUsers);
    const cell = mobileCell(f.nativeElement, 'Situação');
    expect(await clickAndUrl(f, cell, 'valor Situacao do cartao')).toBe('/admin/users/usr-1');
  });

  it('celular: clicar no cartao (fora de link e botao) navega para o detalhe', async () => {
    const f = await render(AdminUsers);
    const card = f.nativeElement.querySelector<HTMLElement>('[data-card]');
    expect(await clickAndUrl(f, card, 'cartao')).toBe('/admin/users/usr-1');
  });

  /** A excecao declarada: a coluna de acoes NAO e alvo de navegacao. */
  it('a kebab nao navega — nem abrir o menu, nem um item de acao', async () => {
    const f = await render(AdminUsers);
    await expectKebabDoesNotNavigate(f, 'menu-deactivate');
  });

  it('um tab stop por linha (o nome), alvos de 44px, nada interativo dentro de <a>', async () => {
    const f = await render(AdminUsers);
    expectKeyboardAndTouchContract(f, 'Fulano');
  });
});

describe('FIX-0422 — clicar FORA do nome navega (/admin/companies)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCompanies],
      providers: [
        provideRouter([{ path: 'admin/companies/:id', component: Stub }]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: AdminCompaniesService,
          useValue: {
            companies: signal<AdminCompanyListItem[]>([COMPANY]),
            loading: signal(false),
            total: signal(1),
            load: vi.fn().mockReturnValue(of({ content: [COMPANY], total: 1 })),
            updateStatus: vi.fn(),
            updateInternal: vi.fn().mockReturnValue(of(COMPANY)),
          },
        },
        { provide: NotificationService, useValue: NOTIFY },
      ],
    });
  });

  it('desktop: clicar na celula de SITUACAO navega para o detalhe', async () => {
    const f = await render(AdminCompanies);
    const cell = desktopCell(f.nativeElement, 'Situação');
    expect(await clickAndUrl(f, cell, 'celula Situacao')).toBe('/admin/companies/co-1');
  });

  it('desktop: clicar na celula de PLANO navega para o detalhe', async () => {
    const f = await render(AdminCompanies);
    const cell = desktopCell(f.nativeElement, 'Plano');
    expect(await clickAndUrl(f, cell, 'celula Plano')).toBe('/admin/companies/co-1');
  });

  it('desktop: clicar na celula de VALOR (MRR) navega para o detalhe', async () => {
    const f = await render(AdminCompanies);
    const cell = desktopCell(f.nativeElement, 'MRR');
    expect(await clickAndUrl(f, cell, 'celula MRR')).toBe('/admin/companies/co-1');
  });

  it('celular: clicar num valor do cartao navega para o detalhe', async () => {
    const f = await render(AdminCompanies);
    const cell = mobileCell(f.nativeElement, 'Situação');
    expect(await clickAndUrl(f, cell, 'valor Situacao do cartao')).toBe('/admin/companies/co-1');
  });

  it('celular: clicar no cartao (fora de link e botao) navega para o detalhe', async () => {
    const f = await render(AdminCompanies);
    const card = f.nativeElement.querySelector<HTMLElement>('[data-card]');
    expect(await clickAndUrl(f, card, 'cartao')).toBe('/admin/companies/co-1');
  });

  it('a kebab nao navega — nem abrir o menu, nem um item de acao', async () => {
    const f = await render(AdminCompanies);
    await expectKebabDoesNotNavigate(f, 'internal-menu-item');
  });

  it('um tab stop por linha (o nome), alvos de 44px, nada interativo dentro de <a>', async () => {
    const f = await render(AdminCompanies);
    expectKeyboardAndTouchContract(f, 'Locadora Alpha');
  });
});
