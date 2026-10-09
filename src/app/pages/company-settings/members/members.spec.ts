import { HttpErrorResponse } from '@angular/common/http';
import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanyMembers } from './members';
import { DRIVER_CREATE_ROUTE } from './invite-sheet';
import { LayoutStore } from '../../../components/core/layouts/layout.store';
import { ApiErrorService } from '../../../services/api-error.service';
import { CompanyMembersService } from '../../../services/company-members.service';
import { InvitesService } from '../../../services/invites.service';
import { NotificationService } from '../../../services/notification.service';
import { SessionService } from '../../../services/session.service';
import type { CompanyMemberResponse } from '../../../types/company-member.types';
import type { InviteResponse } from '../../../types/invite.types';

/**
 * The Members page, rendered for real with its children (cards, tables, sheets, invite
 * form). Only the HTTP-facing services and the session are doubled; every assertion reads
 * the rendered DOM.
 *
 * Two contract facts the cases rely on: there is NO role-change endpoint (so no promote or
 * demote case exists here), and removal writes `status = 'REMOVED'` — nothing assumes the
 * person is deleted, and the copy speaks of losing access.
 */
@Component({ template: '' })
class DriverCreateStub {}

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number): string => new Date(Date.now() + n * DAY).toISOString();

describe('CompanyMembers — pessoas da empresa', () => {
  const ME = 'user-eu';

  const owner: CompanyMemberResponse = {
    userId: 'user-dono',
    name: 'Dona Ana',
    email: 'ana@empresa.com.br',
    role: 'OWNER',
    memberSince: '2026-01-10T12:00:00Z',
  };
  const manager: CompanyMemberResponse = {
    userId: 'user-gerente',
    name: 'Gerente Bruno',
    email: 'bruno@empresa.com.br',
    role: 'MANAGER',
    memberSince: '2026-03-02T12:00:00Z',
  };
  const driver: CompanyMemberResponse = {
    userId: 'user-motorista',
    name: 'Motorista Caio',
    email: 'caio@empresa.com.br',
    role: 'DRIVER',
    memberSince: '2026-05-20T12:00:00Z',
  };

  const pendingInvite: InviteResponse = {
    id: 'inv-1',
    email: 'convidada@empresa.com.br',
    role: 'MANAGER',
    status: 'PENDING',
    expiresAt: inDays(6),
    createDate: '2026-10-01T12:00:00Z',
  };
  const expiredInvite: InviteResponse = {
    ...pendingInvite,
    id: 'inv-2',
    email: 'expirada@empresa.com.br',
    status: 'EXPIRED',
    expiresAt: inDays(-3),
  };
  /** ACCEPTED: the SAME person the roster already returns. Never a row. */
  const acceptedInvite: InviteResponse = {
    ...pendingInvite,
    id: 'inv-3',
    email: 'bruno@empresa.com.br',
    status: 'ACCEPTED',
  };
  const driverInvite: InviteResponse = {
    ...pendingInvite,
    id: 'inv-4',
    email: 'motorista.novo@empresa.com.br',
    role: 'DRIVER',
  };

  let list: ReturnType<typeof vi.fn>;
  let inviteList: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let resendInvite: ReturnType<typeof vi.fn>;
  let cancelInvite: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let success: ReturnType<typeof vi.fn>;
  let isMobile: WritableSignal<boolean>;

  function error(status: number, message = 'falhou', code?: string): HttpErrorResponse {
    return new HttpErrorResponse({ status, error: { message, code } });
  }

  interface RenderOptions {
    roster?: CompanyMemberResponse[];
    invites?: InviteResponse[];
    listImpl?: () => Observable<CompanyMemberResponse[]>;
    mobile?: boolean;
    invitesNever?: boolean;
  }

  /** @param tokenRole the CALLER's role, read from the token — the `roleGuard` source. */
  function render(
    tokenRole: string | null,
    {
      roster = [owner, manager, driver],
      invites = [],
      listImpl,
      mobile = true,
      invitesNever = false,
    }: RenderOptions = {},
  ): ComponentFixture<CompanyMembers> {
    TestBed.resetTestingModule();
    const members = signal<CompanyMemberResponse[]>([]);
    const mLoading = signal(false);
    const mLoaded = signal(false);
    const inviteSignal = signal<InviteResponse[]>([]);
    const iLoading = signal(false);
    const iLoaded = signal(false);
    isMobile = signal(mobile);

    // The impl goes in HERE: `list()` runs in `ngOnInit`, during `createComponent`.
    list = vi.fn(() => {
      mLoading.set(true);
      const source =
        listImpl?.() ??
        new Observable<CompanyMemberResponse[]>((sub) => {
          sub.next(roster);
          sub.complete();
        });
      return new Observable<CompanyMemberResponse[]>((sub) =>
        source.subscribe({
          next: (value) => {
            members.set(value);
            mLoaded.set(true);
            mLoading.set(false);
            sub.next(value);
          },
          error: (e) => {
            mLoading.set(false);
            sub.error(e);
          },
          complete: () => sub.complete(),
        }),
      );
    });
    remove = vi.fn((id: string) => {
      members.update((l) => l.filter((m) => m.userId !== id));
      return of(undefined);
    });
    success = vi.fn();
    inviteList = vi.fn(() => {
      if (invitesNever) {
        iLoading.set(true);
        return NEVER;
      }
      inviteSignal.set(invites);
      iLoaded.set(true);
      return of(invites);
    });
    create = vi.fn((payload: { email: string; role: 'MANAGER' | 'DRIVER' }) =>
      of({ ...pendingInvite, id: 'inv-new', email: payload.email, role: payload.role }),
    );
    resendInvite = vi.fn(() => of(undefined));
    cancelInvite = vi.fn(() => of(undefined));

    TestBed.configureTestingModule({
      imports: [CompanyMembers],
      providers: [
        provideRouter([{ path: DRIVER_CREATE_ROUTE.slice(1), component: DriverCreateStub }]),
        provideNoopAnimations(),
        ApiErrorService,
        { provide: LayoutStore, useValue: { isMobile } },
        {
          provide: CompanyMembersService,
          useValue: {
            members: members.asReadonly(),
            loading: mLoading.asReadonly(),
            loaded: mLoaded.asReadonly(),
            list,
            remove,
          },
        },
        {
          provide: InvitesService,
          useValue: {
            invites: inviteSignal.asReadonly(),
            loading: iLoading.asReadonly(),
            loaded: iLoaded.asReadonly(),
            list: inviteList,
            create,
            resend: resendInvite,
            cancel: cancelInvite,
          },
        },
        {
          provide: SessionService,
          useValue: {
            getItem: vi.fn((key: string) => (key === 'id' ? ME : null)),
            getUserId: vi.fn(() => ME),
            getCompanyRoleFromToken: vi.fn(() => tokenRole),
          },
        },
        {
          provide: NotificationService,
          useValue: { success, error: vi.fn(), warning: vi.fn(), info: vi.fn(), push: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(CompanyMembers);
    fixture.detectChanges();
    return fixture;
  }

  const host = (f: ComponentFixture<CompanyMembers>): HTMLElement => f.nativeElement as HTMLElement;
  const text = (f: ComponentFixture<CompanyMembers>): string => host(f).textContent ?? '';

  function rowOf(f: ComponentFixture<CompanyMembers>, name: string): HTMLElement {
    const row = Array.from(
      host(f).querySelectorAll<HTMLElement>('[data-member-row], [data-invite-row]'),
    ).find((el) => (el.textContent ?? '').includes(name));
    if (!row) throw new Error(`a linha de ${name} nao esta na tela`);
    return row;
  }

  function buttonByText(scope: ParentNode, label: string): HTMLButtonElement | undefined {
    return Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent ?? '').includes(label),
    );
  }

  /** E-mails in the order the rows are on screen (card or table, members and invites). */
  function order(f: ComponentFixture<CompanyMembers>): string[] {
    return Array.from(
      host(f).querySelectorAll('[data-member-row], [data-invite-row]'),
    ).map((r) => (r.textContent ?? '').match(/[\w.]+@empresa\.com\.br/)?.[0] ?? '?');
  }

  function search(f: ComponentFixture<CompanyMembers>, value: string): void {
    const input = host(f).querySelector<HTMLInputElement>('#members-search');
    if (!input) throw new Error('a busca nao esta na tela');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  /** Desktop: the two inline selects. */
  function choose(f: ComponentFixture<CompanyMembers>, which: 'access' | 'status', value: string): void {
    const select = host(f).querySelector<HTMLSelectElement>(`[data-filter-${which}]`);
    if (!select) throw new Error('o filtro ' + which + ' nao esta na tela');
    select.value = value;
    select.dispatchEvent(new Event('change'));
    f.detectChanges();
  }

  /** Phone: open the Filtrar sheet and pick a radio chip by its group and label. */
  function openFilterSheet(f: ComponentFixture<CompanyMembers>): HTMLElement {
    host(f).querySelector<HTMLButtonElement>('[data-filter-open]')?.click();
    f.detectChanges();
    const s = sheet(f);
    if (!s) throw new Error('a folha de filtros nao abriu');
    return s;
  }

  function pickChip(
    f: ComponentFixture<CompanyMembers>,
    group: 'access' | 'status',
    label: string,
  ): void {
    const radio = Array.from(
      sheet(f)?.querySelectorAll<HTMLButtonElement>(
        `[role="radiogroup"][aria-labelledby="filter-${group}-label"] [role="radio"]`,
      ) ?? [],
    ).find((b) => (b.textContent ?? '').trim() === label);
    if (!radio) throw new Error('chip ' + label + ' nao existe em ' + group);
    radio.click();
    f.detectChanges();
  }

  function sheetButton(f: ComponentFixture<CompanyMembers>, attr: string): void {
    sheet(f)?.querySelector<HTMLButtonElement>(`[${attr}]`)?.click();
    f.detectChanges();
  }

  const count = (f: ComponentFixture<CompanyMembers>): string =>
    host(f).querySelector('[data-results]')?.textContent?.trim() ?? '';

  /** The open sheet (the actions sheet or the invite sheet), if any. */
  function sheet(f: ComponentFixture<CompanyMembers>): HTMLElement | null {
    return host(f).querySelector<HTMLElement>('app-members-sheet [role="dialog"]');
  }

  function confirmDialog(f: ComponentFixture<CompanyMembers>): HTMLElement {
    const dialog = host(f).querySelector<HTMLElement>('app-confirm-dialog [role="dialog"]');
    if (!dialog) throw new Error('a confirmacao nao esta na tela');
    return dialog;
  }

  function confirmButton(f: ComponentFixture<CompanyMembers>, label: string): HTMLButtonElement {
    const b = Array.from(confirmDialog(f).querySelectorAll('button')).find(
      (x) => (x.textContent ?? '').trim() === label,
    );
    if (!b) throw new Error('botao ' + label + ' nao esta na confirmacao');
    return b;
  }

  /** Phone path: kebab on the row -> actions sheet. `undefined` when the row has no kebab. */
  function openRowActions(f: ComponentFixture<CompanyMembers>, name: string): boolean {
    const kebab = rowOf(f, name).querySelector<HTMLButtonElement>(
      '[data-member-actions], [data-invite-actions]',
    );
    if (!kebab) return false;
    kebab.click();
    f.detectChanges();
    return true;
  }

  function startRemoval(f: ComponentFixture<CompanyMembers>, name: string): void {
    expect(openRowActions(f, name), `${name} nao tem acoes`).toBe(true);
    sheet(f)?.querySelector<HTMLButtonElement>('[data-remove-member]')?.click();
    f.detectChanges();
  }

  function openInvite(f: ComponentFixture<CompanyMembers>): HTMLElement {
    host(f).querySelector<HTMLButtonElement>('[data-invite-open]')?.click();
    f.detectChanges();
    const s = sheet(f);
    if (!s) throw new Error('a folha de convite nao abriu');
    return s;
  }

  function fill(f: ComponentFixture<CompanyMembers>, id: string, value: string): void {
    const input = host(f).querySelector<HTMLInputElement>('#' + id);
    if (!input) throw new Error('campo ' + id + ' nao existe');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  function goToManagerForm(f: ComponentFixture<CompanyMembers>): HTMLElement {
    const s = openInvite(f);
    s.querySelector<HTMLButtonElement>('[data-role-option="MANAGER"]')?.click();
    f.detectChanges();
    return sheet(f) as HTMLElement;
  }

  function submitManagerForm(f: ComponentFixture<CompanyMembers>): void {
    host(f).querySelector<HTMLFormElement>('#invite-manager-form')?.dispatchEvent(
      new Event('submit'),
    );
    f.detectChanges();
  }

  beforeEach(() => TestBed.resetTestingModule());

  // ================================================================ LISTING
  it('lista quem tem acesso, com nome, e-mail e papel em portugues', () => {
    const f = render('OWNER');
    expect(list).toHaveBeenCalledTimes(1);
    expect(inviteList).toHaveBeenCalledTimes(1);
    expect(text(f)).toContain('Dona Ana');
    expect(text(f)).toContain('bruno@empresa.com.br');
    // pt-BR labels from `companyRoleLabel`, never the raw enum.
    expect(text(f)).toContain('Dono');
    expect(text(f)).toContain('Gerenciador');
    expect(text(f)).toContain('Motorista');
    expect(text(f)).not.toContain('OWNER');
  });

  it('no celular sao cartoes, sem tabela; no desktop e tabela, sem cartoes', () => {
    const phone = render('OWNER');
    expect(host(phone).querySelectorAll('ul app-person-card')).toHaveLength(3);
    expect(host(phone).querySelector('table')).toBeNull();

    const desk = render('OWNER', { mobile: false });
    expect(host(desk).querySelector('app-person-card')).toBeNull();
    const rows = host(desk).querySelectorAll('table tbody tr[data-member-row]');
    expect(rows).toHaveLength(3);
    // Same data on both: name, e-mail, role, "Desde"/"Membro desde" date.
    expect(rows[0].textContent).toContain('Dona Ana');
    expect(rows[0].textContent).toContain('10/01/2026');
    expect(host(desk).querySelector('thead')?.textContent).toContain('Enviado em / Desde');
  });

  it('nao mostra "ultimo acesso": o payload de membros nao traz esse campo', () => {
    const f = render('OWNER');
    expect(text(f).toLowerCase()).not.toContain('último acesso');
  });

  it('empresa com um unico membro mostra a pessoa e o convite a convidar, nao uma lista vazia', () => {
    const f = render('OWNER', { roster: [{ ...owner, userId: ME }] });
    expect(rowOf(f, 'Dona Ana')).toBeDefined();
    const empty = host(f).querySelector('[data-empty]');
    expect(empty?.textContent).toContain('Só você tem acesso por enquanto.');
    // The empty state carries THE primary action, and the sticky bar steps aside.
    expect(buttonByText(empty as HTMLElement, 'Convidar pessoa')).toBeDefined();
    expect(host(f).querySelectorAll('[data-invite-open]')).toHaveLength(1);
    expect(text(f)).not.toContain('Ninguém mais tem');
  });

  // ================================================================ STATES
  it('carregando: esqueleto na altura real, nunca o texto "Carregando"', () => {
    const f = render('OWNER', { listImpl: () => NEVER, invitesNever: true });
    expect(host(f).querySelectorAll('[data-skeleton]')).toHaveLength(3);
    expect(host(f).querySelector('[aria-label="Resumo da equipe"]')?.getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(host(f).querySelector('app-person-card')).toBeNull();
    expect(text(f)).not.toContain('Carregando');
  });
  it('erro ao carregar: banner com Tentar novamente, que recarrega as duas fontes', () => {
    const f = render('MANAGER', { listImpl: () => throwError(() => error(500)) });
    const banner = host(f).querySelector('app-alert-banner [role="alert"]');
    expect(banner).not.toBeNull();
    expect(host(f).querySelector('app-person-card')).toBeNull();
    const retry = host(f).querySelector<HTMLButtonElement>('[data-retry]');
    expect(retry?.textContent).toContain('Tentar novamente');
    retry?.click();
    f.detectChanges();
    expect(list).toHaveBeenCalledTimes(2);
    expect(inviteList).toHaveBeenCalledTimes(2);
  });

  it('403 na listagem explica de quem e a tela, sem erro cru', () => {
    const f = render('MANAGER', { listImpl: () => throwError(() => error(403)) });
    expect(text(f)).toContain('podem ver quem tem acesso');
  });

  // ================================================================ ONE LIST
  const self: CompanyMemberResponse = { ...owner, userId: ME };
  const allInvites = [pendingInvite, driverInvite, expiredInvite];

  it('UMA lista so, sem abas: voce, membros por nome, convites expirados e depois pendentes', () => {
    const roster = [driver, manager, self];
    const expected = [
      'ana@empresa.com.br',
      'bruno@empresa.com.br',
      'caio@empresa.com.br',
      'expirada@empresa.com.br',
      'convidada@empresa.com.br',
      'motorista.novo@empresa.com.br',
    ];
    const phone = render('OWNER', { roster, invites: allInvites });
    expect(host(phone).querySelector('[role="radiogroup"]')).toBeNull();
    expect(order(phone)).toEqual(expected);
    const desk = render('OWNER', { roster, invites: allInvites, mobile: false });
    expect(order(desk)).toEqual(expected);
    expect(host(desk).querySelector('h2')?.textContent).toContain('Lista');
  });

  it('cada linha traz o seu status: Ativo, Pendente ou Expirado, em cores diferentes', () => {
    const f = render('OWNER', { roster: [owner, manager], invites: [pendingInvite, expiredInvite] });
    const chip = (who: string): HTMLElement =>
      rowOf(f, who).querySelector<HTMLElement>('[data-status-chip]') as HTMLElement;
    expect(chip('Dona Ana').textContent?.trim()).toBe('Ativo');
    expect(chip('convidada@').textContent?.trim()).toBe('Pendente');
    expect(chip('expirada@').textContent?.trim()).toBe('Expirado');
    expect(chip('Dona Ana').className).toContain('success');
    expect(chip('convidada@').className).toContain('amber');
    expect(chip('expirada@').className).toContain('rose');
    expect(host(f).innerHTML).not.toMatch(/\b(bg|text|border)-red-/);
  });

  it('membro e convidado na mesma lista: o convite diz quando expira, o membro diz desde quando', () => {
    const f = render('OWNER', { roster: [owner, manager], invites: [pendingInvite] });
    expect(rowOf(f, 'Dona Ana').textContent).toContain('10/01/2026');
    expect(rowOf(f, 'convidada@empresa.com.br').textContent).toContain('Expira em 6 dias');
    expect(rowOf(f, 'convidada@empresa.com.br').textContent).toContain('01/10/2026');
  });

  it('desktop: colunas pedidas, e-mail sem truncar, aceite do convite e traco no membro', () => {
    const f = render('OWNER', {
      roster: [owner],
      invites: [{ ...pendingInvite, email: 'um.endereco.bem.comprido@empresa.com.br' }, expiredInvite],
      mobile: false,
    });
    const heads = Array.from(host(f).querySelectorAll('thead th')).map((h) =>
      (h.textContent ?? '').trim(),
    );
    expect(heads).toEqual([
      'Nome',
      'E-mail',
      'Nível de acesso',
      'Status',
      'Enviado em / Desde',
      'Aceite',
      'Ações',
    ]);
    const email = rowOf(f, 'um.endereco').querySelector<HTMLElement>('[data-email]') as HTMLElement;
    expect(email.textContent?.trim()).toBe('um.endereco.bem.comprido@empresa.com.br');
    expect(email.className).not.toContain('truncate');
    const cells = (who: string): string[] =>
      Array.from(rowOf(f, who).querySelectorAll('td')).map((c) => (c.textContent ?? '').trim());
    expect(cells('Dona Ana')[5]).toBe('—');
    expect(cells('um.endereco')[5]).toBe('Expira em 6 dias');
    expect(cells('expirada@')[5]).toBe('Expirado');
  });

  it('convite ACEITO nao vira linha: a pessoa aparece UMA vez, como membro', () => {
    const f = render('OWNER', { roster: [owner, manager], invites: [acceptedInvite] });
    expect(host(f).querySelectorAll('[data-invite-row]')).toHaveLength(0);
    const rows = Array.from(host(f).querySelectorAll('[data-member-row]')).filter((r) =>
      (r.textContent ?? '').includes('bruno@empresa.com.br'),
    );
    expect(rows).toHaveLength(1);
  });

  it('quem ja e membro e tem convite pendente aparece UMA vez, como membro (sem caixa nem espaco)', () => {
    const dup = { ...pendingInvite, email: '  BRUNO@Empresa.COM.BR ' };
    const f = render('OWNER', { roster: [owner, manager], invites: [dup] });
    expect(host(f).querySelectorAll('[data-invite-row]')).toHaveLength(0);
  });

  it('convites: expirado vem antes de pendente', () => {
    const f = render('OWNER', { invites: [pendingInvite, expiredInvite] });
    const labels = Array.from(host(f).querySelectorAll('[data-invite-row]')).map((r) =>
      r.querySelector('[data-validity]')?.textContent?.trim(),
    );
    expect(labels).toEqual(['Expirado', 'Expira em 6 dias']);
  });

  it('validade: expirado e pendente nao tem a mesma cor de texto', () => {
    const f = render('OWNER', { invites: [pendingInvite, expiredInvite] });
    const tone = (who: string): string =>
      rowOf(f, who).querySelector('[data-validity]')?.className ?? '';
    expect(tone('expirada@')).not.toBe(tone('convidada@'));
    expect(tone('expirada@')).toContain('rose');
  });

  it('nome do convidado aparece quando a API manda; senao o e-mail e o titulo', () => {
    const f = render('OWNER', { invites: [{ ...pendingInvite, name: 'Patrícia Souza' }] });
    const row = rowOf(f, 'Patrícia Souza');
    expect(row.textContent).toContain('convidada@empresa.com.br');
  });

  // ================================================================ DELIVERY (optional field)
  it('sem `emailDelivery` nao ha chip de entrega nenhum — a tela nao adivinha "Enviado"', () => {
    const phone = render('OWNER', { invites: [pendingInvite] });
    expect(host(phone).querySelector('[data-delivery-chip]')).toBeNull();
    expect(text(phone)).not.toContain('Falha no envio');

    const desk = render('OWNER', { invites: [pendingInvite], mobile: false });
    expect(host(desk).querySelector('[data-delivery-chip]')).toBeNull();
  });

  it('com `emailDelivery`: Enviado / Falha no envio, e falha ganha Reenviar na linha', () => {
    const sent = { ...pendingInvite, emailDelivery: 'SENT' as const };
    const failed = { ...driverInvite, emailDelivery: 'FAILED' as const };
    const f = render('OWNER', { invites: [sent, failed] });
    expect(rowOf(f, 'convidada@').querySelector('[data-delivery-chip]')?.textContent).toContain(
      'Enviado',
    );
    expect(rowOf(f, 'convidada@').querySelector('[data-inline-resend]')).toBeNull();
    const bad = rowOf(f, 'motorista.novo@');
    expect(bad.querySelector('[data-delivery-chip]')?.textContent).toContain('Falha no envio');
    bad.querySelector<HTMLButtonElement>('[data-inline-resend]')?.click();
    f.detectChanges();
    expect(resendInvite).toHaveBeenCalledWith('inv-4');

    const desk = render('OWNER', { invites: [sent], mobile: false });
    expect(rowOf(desk, 'convidada@').querySelector('[data-delivery-chip]')?.textContent).toContain(
      'Enviado',
    );
  });

  // ================================================================ REMOVE
  /** The confirmation exists for the REMOVED person, who loses access and is not clicking. */
  it('remover NAO chama o servidor: abre a confirmacao, que nomeia quem e fala em perder acesso', () => {
    const f = render('OWNER');
    startRemoval(f, 'Motorista Caio');
    expect(remove).not.toHaveBeenCalled();
    const dialog = confirmDialog(f).textContent ?? '';
    expect(dialog).toContain('Motorista Caio');
    expect(dialog).toContain('perde o acesso');
    expect(dialog).not.toContain('apagad');
  });

  it('a folha de acoes diz quem e e traz a nota de troca de nivel', () => {
    const f = render('OWNER');
    openRowActions(f, 'Motorista Caio');
    const s = sheet(f);
    expect(s?.textContent).toContain('caio@empresa.com.br');
    expect(s?.textContent).toContain('Para mudar o nível de acesso, remova e convide de novo.');
    expect(s?.textContent).not.toContain('Alterar papel');
  });

  it('confirmar remove de fato, pelo userId, e avisa', () => {
    const f = render('OWNER');
    startRemoval(f, 'Motorista Caio');
    confirmButton(f, 'Remover acesso').click();
    f.detectChanges();
    expect(remove).toHaveBeenCalledWith('user-motorista');
    expect(success).toHaveBeenCalledWith('Motorista Caio perdeu o acesso a esta empresa.');
  });

  it('cancelar a confirmacao nao remove ninguem', () => {
    const f = render('OWNER');
    startRemoval(f, 'Motorista Caio');
    confirmButton(f, 'Manter acesso').click();
    f.detectChanges();
    expect(remove).not.toHaveBeenCalled();
  });

  it('no desktop o menu da linha leva a mesma confirmacao', () => {
    const f = render('OWNER', { mobile: false });
    const row = rowOf(f, 'Motorista Caio');
    row.querySelector<HTMLButtonElement>('app-actions-menu button[aria-haspopup="menu"]')?.click();
    f.detectChanges();
    const item = row.querySelector<HTMLButtonElement>('[role="menuitem"][data-remove-member]');
    expect(item?.textContent).toContain('Remover acesso');
    item?.click();
    f.detectChanges();
    confirmButton(f, 'Remover acesso').click();
    f.detectChanges();
    expect(remove).toHaveBeenCalledWith('user-motorista');
  });

  // -------------------------------------------------- the three backend locks
  it('o ULTIMO dono nao tem acao de sair, e a linha diz por que (sem mandar promover ninguem)', () => {
    const f = render('OWNER', { roster: [{ ...owner, userId: ME }, manager] });
    const row = rowOf(f, 'Dona Ana');
    expect(openRowActions(f, 'Dona Ana')).toBe(false);
    expect(row.textContent).toContain('único dono desta empresa');
    expect(row.textContent).not.toContain('Promova');

    const desk = render('OWNER', { roster: [{ ...owner, userId: ME }, manager], mobile: false });
    expect(rowOf(desk, 'Dona Ana').querySelector('app-actions-menu')).toBeNull();
  });

  /** Two ACTIVE owners: the backend lets one leave. The lock is the COUNT, not the role. */
  it('com DOIS donos, o dono pode sair — a trava e a contagem, nao o papel', () => {
    const other = { ...owner, userId: 'owner-2', name: 'Dono Carlos' };
    const f = render('OWNER', { roster: [{ ...owner, userId: ME }, other] });
    startRemoval(f, 'Dona Ana');
    expect(confirmDialog(f).textContent).toContain('Sair desta empresa');
  });

  it('o gerente pode remover o PROPRIO acesso, e o verbo e Sair', () => {
    const f = render('MANAGER', { roster: [owner, { ...manager, userId: ME }] });
    expect(openRowActions(f, 'Gerente Bruno')).toBe(true);
    expect(sheet(f)?.querySelector('[data-remove-member]')?.textContent).toContain(
      'Sair desta empresa',
    );
  });

  /** Locks 1 and 2: OWNER cannot be removed by anyone else — the TARGET's role decides. */
  it('a linha do DONO nao e removivel por outra pessoa: sem acao, com o motivo', () => {
    const f = render('MANAGER', { roster: [owner, { ...manager, userId: ME }] });
    expect(openRowActions(f, 'Dona Ana')).toBe(false);
    expect(rowOf(f, 'Dona Ana').textContent).toContain('O dono não pode ser removido.');
  });

  /** Counterweight: without it, a screen that hides EVERY action passes the three above. */
  it('quem PODE ser removido tem a acao — a trava nao apagou a acao de todo mundo', () => {
    const f = render('OWNER');
    expect(rowOf(f, 'Motorista Caio').querySelector('[data-member-actions]')).not.toBeNull();
    expect(rowOf(f, 'Gerente Bruno').querySelector('[data-member-actions]')).not.toBeNull();
  });

  it('a saida propria fala na segunda pessoa e avisa que so quem fica pode reconvidar', () => {
    const f = render('MANAGER', { roster: [owner, { ...manager, userId: ME }] });
    startRemoval(f, 'Gerente Bruno');
    expect(confirmDialog(f).textContent).toContain('Você perde o acesso');
    expect(confirmDialog(f).textContent).toContain('só quem ficou pode te convidar');
  });

  it('remover OUTRA pessoa fala dela, na terceira pessoa', () => {
    const f = render('OWNER', { roster: [{ ...owner, userId: ME }, manager] });
    startRemoval(f, 'Gerente Bruno');
    expect(confirmDialog(f).textContent).toContain('Gerente Bruno perde o acesso');
  });

  // -------------------------------------------------- the driver never gets in
  it('motorista nao ve o roster e NAO chama o servidor', () => {
    const f = render('DRIVER');
    expect(list).not.toHaveBeenCalled();
    expect(inviteList).not.toHaveBeenCalled();
    expect(text(f)).toContain('do dono e dos gerenciadores');
    expect(text(f)).not.toContain('Dona Ana');
    expect(host(f).querySelector('[data-invite-open]')).toBeNull();
  });

  it('papel nulo tambem nao entra — omissao nao vira permissao', () => {
    render(null);
    expect(list).not.toHaveBeenCalled();
  });

  // -------------------------------------------------- removal errors
  it('409 na remocao fala do ultimo dono, nao de permissao', () => {
    const f = render('OWNER');
    remove.mockReturnValue(throwError(() => error(409)));
    startRemoval(f, 'Motorista Caio');
    confirmButton(f, 'Remover acesso').click();
    f.detectChanges();
    expect(text(f)).toContain('ficaria sem dono');
  });

  /** The backend 404 is ambiguous on purpose; the copy does not claim which cause. */
  it('404 na remocao nao afirma a causa, pede para atualizar — e o botao Atualizar esta la', () => {
    const f = render('OWNER');
    remove.mockReturnValue(throwError(() => error(404)));
    startRemoval(f, 'Motorista Caio');
    confirmButton(f, 'Remover acesso').click();
    f.detectChanges();
    expect(text(f)).toContain('já não tem acesso');
    expect(text(f)).toContain('Atualize a lista');
    expect(host(f).querySelector('[data-refresh]')?.textContent).toContain('Atualizar');
  });

  it('o botao Atualizar recarrega as DUAS fontes', () => {
    const f = render('OWNER');
    host(f).querySelector<HTMLButtonElement>('[data-refresh]')?.click();
    f.detectChanges();
    expect(list).toHaveBeenCalledTimes(2);
    expect(inviteList).toHaveBeenCalledTimes(2);
  });

  // ================================================================ INVITE ROW ACTIONS
  it('convite oferece reenviar e cancelar (folha no celular), e nao remover acesso', () => {
    const f = render('OWNER', { roster: [owner], invites: [pendingInvite] });
    openRowActions(f, 'convidada@empresa.com.br');
    const s = sheet(f) as HTMLElement;
    expect(s.querySelector('[data-resend-invite]')?.textContent).toContain('Reenviar convite');
    expect(s.querySelector('[data-cancel-invite]')?.textContent).toContain('Cancelar convite');
    expect(s.querySelector('[data-remove-member]')).toBeNull();
  });

  /** Measured on the backend: resend accepts PENDING and EXPIRED; cancel refuses ACCEPTED only. */
  it('convite EXPIRADO tambem tem as duas acoes, e Reenviar fica a vista na linha', () => {
    const f = render('OWNER', { roster: [owner], invites: [expiredInvite] });
    expect(rowOf(f, 'expirada@').querySelector('[data-inline-resend]')).not.toBeNull();
    openRowActions(f, 'expirada@');
    expect(sheet(f)?.querySelector('[data-resend-invite]')).not.toBeNull();
    expect(sheet(f)?.querySelector('[data-cancel-invite]')).not.toBeNull();
  });

  it('reenviar chama pelo id do CONVITE, avisa que o link anterior morreu e rele so os convites', () => {
    const f = render('OWNER', { roster: [owner], invites: [expiredInvite] });
    openRowActions(f, 'expirada@');
    sheet(f)?.querySelector<HTMLButtonElement>('[data-resend-invite]')?.click();
    f.detectChanges();
    expect(resendInvite).toHaveBeenCalledWith('inv-2');
    expect(success).toHaveBeenCalledWith(expect.stringContaining('link anterior deixou de valer'));
    expect(inviteList).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(1);
    expect(sheet(f)).toBeNull();
  });

  it('cancelar convite so chama o servidor depois da confirmacao', () => {
    const f = render('OWNER', { roster: [owner], invites: [pendingInvite] });
    openRowActions(f, 'convidada@');
    sheet(f)?.querySelector<HTMLButtonElement>('[data-cancel-invite]')?.click();
    f.detectChanges();
    expect(cancelInvite).not.toHaveBeenCalled();
    confirmButton(f, 'Cancelar convite').click();
    f.detectChanges();
    expect(cancelInvite).toHaveBeenCalledWith('inv-1');
  });

  it('no desktop: Reenviar e Cancelar no menu da linha', () => {
    const f = render('OWNER', { roster: [owner], invites: [pendingInvite], mobile: false });
    const row = rowOf(f, 'convidada@');
    row.querySelector<HTMLButtonElement>('app-actions-menu button[aria-haspopup="menu"]')?.click();
    f.detectChanges();
    const items = Array.from(row.querySelectorAll('[role="menuitem"]')).map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(items).toEqual(['Reenviar convite', 'Cancelar convite']);
  });

  it('410 fala em EXPIRADO e aponta o reenvio; 404 fala em inexistente e aponta a recarga', () => {
    const f = render('OWNER', { roster: [owner], invites: [pendingInvite] });
    const resend = (): void => {
      openRowActions(f, 'convidada@');
      sheet(f)?.querySelector<HTMLButtonElement>('[data-resend-invite]')?.click();
      f.detectChanges();
    };
    resendInvite.mockReturnValue(throwError(() => error(410)));
    resend();
    expect(text(f)).toContain('expirou');
    expect(text(f)).toContain('Reenviar convite para enviar um novo');
    expect(text(f)).not.toContain('já não existe');

    resendInvite.mockReturnValue(throwError(() => error(404)));
    resend();
    expect(text(f)).toContain('já não existe');
    expect(text(f)).toContain('convide a pessoa de novo');
    expect(text(f)).not.toContain('expirou');
  });

  it('409 no cancelamento diz que o convite JA FOI USADO, e pede recarga', () => {
    const f = render('OWNER', { roster: [owner], invites: [pendingInvite] });
    cancelInvite.mockReturnValue(throwError(() => error(409)));
    openRowActions(f, 'convidada@');
    sheet(f)?.querySelector<HTMLButtonElement>('[data-cancel-invite]')?.click();
    f.detectChanges();
    confirmButton(f, 'Cancelar convite').click();
    f.detectChanges();
    expect(text(f)).toContain('já foi utilizado');
    expect(text(f)).toContain('Atualize a lista');
  });

  // -------------------------------------------------- manager caller and invites
  it('GERENTE so age sobre convites de MOTORISTA; convite de gerenciador fica sem acao, com motivo', () => {
    const f = render('MANAGER', {
      roster: [owner, { ...manager, userId: ME }],
      invites: [pendingInvite, driverInvite],
    });
    const mgrInvite = rowOf(f, 'convidada@');
    expect(mgrInvite.querySelector('[data-invite-actions]')).toBeNull();
    expect(mgrInvite.textContent).toContain('Só o dono gerencia convites de gerenciador.');
    // Counterweight: the driver invite keeps its actions.
    expect(rowOf(f, 'motorista.novo@').querySelector('[data-invite-actions]')).not.toBeNull();
  });

  it('DONO age sobre qualquer convite', () => {
    const f = render('OWNER', { invites: [pendingInvite, driverInvite] });
    expect(rowOf(f, 'convidada@').querySelector('[data-invite-actions]')).not.toBeNull();
    expect(rowOf(f, 'motorista.novo@').querySelector('[data-invite-actions]')).not.toBeNull();
  });

  // ================================================================ KPIs
  const kpi = (f: ComponentFixture<CompanyMembers>, k: string): string =>
    host(f).querySelector(`[data-kpi="${k}"] p:nth-child(2)`)?.textContent?.trim() ?? '';

  it('o resumo: total com acesso, gestao, motoristas e convites PENDENTES, com o detalhe dos expirados', () => {
    const f = render('OWNER', {
      roster: [owner, manager, driver],
      invites: [pendingInvite, expiredInvite, acceptedInvite],
    });
    expect(kpi(f, 'total')).toBe('3');
    expect(kpi(f, 'management')).toBe('2');
    expect(kpi(f, 'drivers')).toBe('1');
    // Expired was sent too but is not waiting; the list shows it, the number does not count it.
    expect(kpi(f, 'pending')).toBe('1');
    const strip = host(f).querySelector('[aria-label="Resumo da equipe"]')?.textContent ?? '';
    expect(strip).toContain('com acesso à empresa');
    expect(strip).toContain('dono e gerenciadores');
    expect(strip).toContain('com acesso pelo celular');
    expect(strip).toContain('Convites pendentes');
    expect(host(f).querySelector('[data-kpi="pending"] [data-kpi-detail]')?.textContent).toContain(
      '1 expirado para reenviar',
    );
    // The Total is the one filled card, in the brand colour with white text.
    expect(host(f).querySelector('[data-kpi="total"]')?.className).toContain('bg-primary-500');
    expect(host(f).querySelector('[data-kpi="total"]')?.className).toContain('text-white');
    expect(host(f).querySelector('[aria-label="Resumo da equipe"]')?.className).toContain(
      'grid-cols-2',
    );
  });

  it('sem convite expirado o detalhe nao inventa urgencia', () => {
    const f = render('OWNER', { invites: [pendingInvite] });
    expect(host(f).querySelector('[data-kpi-detail]')?.textContent).not.toContain('expirado');
  });

  // ================================================================ SEARCH AND FILTERS
  const jose: CompanyMemberResponse = {
    userId: 'user-jose',
    name: 'José Álvares',
    email: 'jose@empresa.com.br',
    role: 'DRIVER',
    memberSince: '2026-06-01T12:00:00Z',
  };
  const fullRoster = [self, manager, driver, jose];

  it('busca por NOME, sem diferenca de caixa nem de acento', () => {
    const f = render('OWNER', { roster: fullRoster, invites: allInvites, mobile: false });
    search(f, 'JOSE');
    expect(order(f)).toEqual(['jose@empresa.com.br']);
    search(f, 'alvares');
    expect(order(f)).toEqual(['jose@empresa.com.br']);
    search(f, 'José');
    expect(order(f)).toEqual(['jose@empresa.com.br']);
    search(f, '  bruno ');
    expect(order(f)).toEqual(['bruno@empresa.com.br']);
  });

  it('busca por E-MAIL, inclusive de convite sem nome', () => {
    const f = render('OWNER', { roster: fullRoster, invites: allInvites });
    search(f, 'CONVIDADA@');
    expect(order(f)).toEqual(['convidada@empresa.com.br']);
    search(f, 'motorista.novo');
    expect(order(f)).toEqual(['motorista.novo@empresa.com.br']);
  });

  it('filtro de Acesso: cada papel separa membros E convites do papel', () => {
    const f = render('OWNER', { roster: fullRoster, invites: allInvites, mobile: false });
    choose(f, 'access', 'DRIVER');
    expect(order(f)).toEqual([
      'jose@empresa.com.br',
      'caio@empresa.com.br',
      'motorista.novo@empresa.com.br',
    ]);
    choose(f, 'access', 'MANAGER');
    expect(order(f)).toEqual([
      'bruno@empresa.com.br',
      'expirada@empresa.com.br',
      'convidada@empresa.com.br',
    ]);
    choose(f, 'access', 'OWNER');
    expect(order(f)).toEqual(['ana@empresa.com.br']);
    choose(f, 'access', '');
    expect(order(f)).toHaveLength(7);
  });

  it('filtro de Status: Ativo, Pendente e Expirado separam membros de convites', () => {
    const f = render('OWNER', { roster: fullRoster, invites: allInvites, mobile: false });
    choose(f, 'status', 'ACTIVE');
    expect(order(f)).toEqual([
      'ana@empresa.com.br',
      'bruno@empresa.com.br',
      'jose@empresa.com.br',
      'caio@empresa.com.br',
    ]);
    choose(f, 'status', 'PENDING');
    expect(order(f)).toEqual(['convidada@empresa.com.br', 'motorista.novo@empresa.com.br']);
    choose(f, 'status', 'EXPIRED');
    expect(order(f)).toEqual(['expirada@empresa.com.br']);
    choose(f, 'status', '');
    expect(order(f)).toHaveLength(7);
  });

  it('o Status oferece so o que a tela deriva hoje (sem "Cadastro incompleto")', () => {
    const f = render('OWNER', { mobile: false });
    const labels = Array.from(
      host(f).querySelectorAll('[data-filter-status] option'),
    ).map((o) => (o.textContent ?? '').trim());
    expect(labels).toEqual(['Status: Todos', 'Status: Ativo', 'Status: Pendente', 'Status: Expirado']);
    const access = Array.from(host(f).querySelectorAll('[data-filter-access] option')).map((o) =>
      (o.textContent ?? '').trim(),
    );
    expect(access).toEqual([
      'Acesso: Todos',
      'Acesso: Dono',
      'Acesso: Gerenciador',
      'Acesso: Motorista',
    ]);
  });

  it('filtros combinados: busca + Acesso + Status, e o contador de resultados acompanha', () => {
    const f = render('OWNER', { roster: fullRoster, invites: allInvites, mobile: false });
    expect(count(f)).toBe('7 resultados');
    choose(f, 'status', 'PENDING');
    choose(f, 'access', 'MANAGER');
    expect(order(f)).toEqual(['convidada@empresa.com.br']);
    expect(count(f)).toBe('1 resultado');
    search(f, 'convidada');
    expect(order(f)).toEqual(['convidada@empresa.com.br']);
    search(f, 'caio');
    expect(order(f)).toEqual([]);
    expect(count(f)).toBe('0 resultados');
  });

  it('desktop: "Limpar filtros" so aparece com filtro ativo e devolve a lista inteira', () => {
    const f = render('OWNER', { roster: fullRoster, invites: allInvites, mobile: false });
    expect(host(f).querySelector('[data-clear-filters]')).toBeNull();
    choose(f, 'status', 'EXPIRED');
    search(f, 'expirada');
    const clear = host(f).querySelector<HTMLButtonElement>('[data-clear-filters]');
    expect(clear?.textContent).toContain('Limpar filtros');
    clear?.click();
    f.detectChanges();
    expect(order(f)).toHaveLength(7);
    expect(host(f).querySelector<HTMLInputElement>('#members-search')?.value).toBe('');
    expect(host(f).querySelector<HTMLSelectElement>('[data-filter-status]')?.value).toBe('');
    expect(host(f).querySelector('[data-clear-filters]')).toBeNull();
  });

  it('busca sem resultado: estado proprio com "Limpar filtros", nunca a tela de convidar', () => {
    const phone = render('OWNER', { roster: fullRoster, invites: allInvites });
    search(phone, 'zzzz');
    const empty = host(phone).querySelector('[data-empty-search]');
    expect(empty?.textContent).toContain('Nenhum resultado');
    expect(host(phone).querySelector('app-person-card')).toBeNull();
    expect(host(phone).querySelector('[data-empty]')).toBeNull();
    // The sticky invite bar is still there: no match is not "nobody here".
    expect(host(phone).querySelector('[data-invite-open]')).not.toBeNull();
    empty?.querySelector<HTMLButtonElement>('[data-clear-filters]')?.click();
    phone.detectChanges();
    expect(host(phone).querySelector('[data-empty-search]')).toBeNull();
    expect(order(phone)).toHaveLength(7);

    const desk = render('OWNER', { roster: fullRoster, invites: allInvites, mobile: false });
    search(desk, 'zzzz');
    expect(host(desk).querySelector('table')).toBeNull();
    expect(host(desk).querySelector('[data-empty-search]')).not.toBeNull();
  });

  it('o resumo descreve a empresa inteira: busca e filtros nao mexem nos numeros', () => {
    const f = render('OWNER', { roster: fullRoster, invites: allInvites, mobile: false });
    const before = ['total', 'management', 'drivers', 'pending'].map((k) => kpi(f, k));
    expect(before).toEqual(['4', '2', '2', '2']);
    choose(f, 'status', 'EXPIRED');
    search(f, 'expirada');
    expect(order(f)).toHaveLength(1);
    expect(['total', 'management', 'drivers', 'pending'].map((k) => kpi(f, k))).toEqual(before);
  });

  // -------------------------------------------------- phones: the Filtrar sheet
  it('celular: busca no topo, botao Filtrar e contagem de resultados; sem selects inline', () => {
    const f = render('OWNER', { roster: fullRoster, invites: allInvites });
    expect(host(f).querySelector('#members-search')?.getAttribute('placeholder')).toBe(
      'Buscar por nome ou e-mail…',
    );
    expect(host(f).querySelector('[data-filter-open]')?.textContent).toContain('Filtrar');
    expect(host(f).querySelector('[data-filter-count]')).toBeNull();
    expect(host(f).querySelector('[data-filter-status]')).toBeNull();
    expect(count(f)).toBe('7 resultados');
    // 16px field: below that iOS zooms the page on focus.
    expect(host(f).querySelector('#members-search')?.className).toContain('text-base');
  });

  it('a folha de filtros so aplica no Aplicar; o botao mostra quantos filtros, e chips os removem', () => {
    const f = render('OWNER', { roster: fullRoster, invites: allInvites });
    openFilterSheet(f);
    expect(sheet(f)?.querySelector('h2')?.textContent).toContain('Filtrar');
    pickChip(f, 'access', 'Gerenciador');
    pickChip(f, 'status', 'Pendente');
    // Still a draft: the list behind the sheet did not move.
    expect(order(f)).toHaveLength(7);
    expect(host(f).querySelector('[data-filter-count]')).toBeNull();

    sheetButton(f, 'data-filter-apply');
    expect(sheet(f)).toBeNull();
    expect(order(f)).toEqual(['convidada@empresa.com.br']);
    expect(host(f).querySelector('[data-filter-count]')?.textContent?.trim()).toBe('2');
    expect(count(f)).toBe('1 resultado');
    const chips = Array.from(host(f).querySelectorAll('[data-filter-chip]')).map((c) =>
      (c.textContent ?? '').trim(),
    );
    expect(chips).toEqual(['Acesso: Gerenciador', 'Status: Pendente']);

    // Removing one chip drops that filter only.
    host(f).querySelector<HTMLButtonElement>('[data-filter-chip="status"]')?.click();
    f.detectChanges();
    expect(host(f).querySelector('[data-filter-count]')?.textContent?.trim()).toBe('1');
    expect(order(f)).toEqual(['bruno@empresa.com.br', 'expirada@empresa.com.br', 'convidada@empresa.com.br']);
  });

  it('a folha reabre mostrando o que esta aplicado, e fechar sem aplicar descarta o rascunho', () => {
    const f = render('OWNER', { roster: fullRoster, invites: allInvites });
    openFilterSheet(f);
    pickChip(f, 'status', 'Expirado');
    sheetButton(f, 'data-filter-apply');
    expect(order(f)).toEqual(['expirada@empresa.com.br']);

    openFilterSheet(f);
    const checked = (group: string): string =>
      sheet(f)
        ?.querySelector(`[role="radiogroup"][aria-labelledby="filter-${group}-label"] [aria-checked="true"]`)
        ?.textContent?.trim() ?? '';
    expect(checked('status')).toBe('Expirado');
    expect(checked('access')).toBe('Todos');
    pickChip(f, 'status', 'Ativo');
    sheet(f)?.querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')?.click();
    f.detectChanges();
    expect(order(f)).toEqual(['expirada@empresa.com.br']);
    openFilterSheet(f);
    expect(checked('status')).toBe('Expirado');
  });

  it('"Limpar" na folha zera Acesso e Status e fecha, mantendo o texto da busca', () => {
    const f = render('OWNER', { roster: fullRoster, invites: allInvites });
    search(f, 'empresa');
    openFilterSheet(f);
    pickChip(f, 'access', 'Motorista');
    sheetButton(f, 'data-filter-apply');
    expect(order(f)).toEqual([
      'jose@empresa.com.br',
      'caio@empresa.com.br',
      'motorista.novo@empresa.com.br',
    ]);
    openFilterSheet(f);
    sheetButton(f, 'data-filter-clear');
    expect(sheet(f)).toBeNull();
    expect(host(f).querySelector('[data-filter-count]')).toBeNull();
    expect(host(f).querySelector<HTMLInputElement>('#members-search')?.value).toBe('empresa');
    expect(order(f)).toHaveLength(7);
  });

  it('a linha filtrada continua com as mesmas acoes: o menu abre a folha da pessoa certa', () => {
    const f = render('OWNER', { roster: fullRoster, invites: allInvites });
    search(f, 'caio');
    startRemoval(f, 'Motorista Caio');
    confirmButton(f, 'Remover acesso').click();
    f.detectChanges();
    expect(remove).toHaveBeenCalledWith('user-motorista');
  });

  // ================================================================ INVITE ENTRY
  it('o convite tem UM caminho: o botao, e nenhum link para a rota /configuracoes/convites', () => {
    const f = render('OWNER');
    expect(buttonByText(host(f), 'Convidar pessoa')).toBeDefined();
    const link = Array.from(host(f).querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/configuracoes/convites',
    );
    expect(link).toBeUndefined();
  });

  it('no celular o botao principal fica numa barra fixa embaixo; no desktop, no topo do cartao Lista', () => {
    const phone = render('OWNER');
    const bar = host(phone).querySelector('[data-invite-open]')?.parentElement;
    expect(bar?.className).toContain('fixed');
    expect(bar?.className).toContain('bottom-0');
    const desk = render('OWNER', { mobile: false });
    expect(host(desk).querySelector('[data-invite-open]')?.parentElement?.className).not.toContain(
      'fixed',
    );
  });

  it('a folha de convite abre no clique, foca o painel, fecha no Esc e devolve o foco', () => {
    const f = render('OWNER');
    const opener = host(f).querySelector<HTMLButtonElement>('[data-invite-open]') as HTMLButtonElement;
    opener.focus();
    const s = openInvite(f);
    expect(s.getAttribute('aria-modal')).toBe('true');
    expect(s.querySelector('h2')?.textContent).toContain('Quem você quer convidar?');
    expect(s.contains(document.activeElement)).toBe(true);

    s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(sheet(f)).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('DONO ve Gerenciador e Motorista; GERENTE ve so Motorista, ja escolhido', () => {
    const asOwner = render('OWNER');
    const s1 = openInvite(asOwner);
    expect(s1.querySelector('[data-role-option="MANAGER"]')?.textContent).toContain('Gerenciador');
    expect(s1.querySelector('[data-role-option="DRIVER"]')?.textContent).toContain('Motorista');
    expect(s1.querySelector('[data-driver-banner]')).toBeNull();

    const asManager = render('MANAGER', { roster: [owner, { ...manager, userId: ME }] });
    const s2 = openInvite(asManager);
    expect(s2.querySelector('[data-role-option="MANAGER"]')).toBeNull();
    expect(s2.querySelector('[data-role-option="DRIVER"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(s2.querySelector('[data-driver-banner]')).not.toBeNull();
  });

  it('Motorista nao envia convite: explica e leva ao cadastro do motorista', async () => {
    const f = render('OWNER');
    const s = openInvite(f);
    s.querySelector<HTMLButtonElement>('[data-role-option="DRIVER"]')?.click();
    f.detectChanges();
    expect(sheet(f)?.querySelector('[data-driver-banner]')?.textContent).toContain(
      'Motoristas são convidados ao cadastrar o motorista',
    );
    const cta = sheet(f)?.querySelector<HTMLAnchorElement>('[data-driver-create]');
    expect(cta?.getAttribute('href')).toBe('/motoristas/novo');
    expect(sheet(f)?.querySelector('form')).toBeNull();

    cta?.click();
    await f.whenStable();
    expect(TestBed.inject(Router).url).toBe('/motoristas/novo');
    expect(create).not.toHaveBeenCalled();
  });

  it('formulario do gerenciador: obrigatorios bloqueiam o envio, com mensagens nos campos', () => {
    const f = render('OWNER');
    goToManagerForm(f);
    const inputs = Array.from(sheet(f)?.querySelectorAll('input') ?? []);
    expect(inputs.map((i) => i.id)).toEqual([
      'invite-name',
      'invite-email',
      'invite-cpf',
      'invite-phone',
    ]);
    // 16px controls: below that iOS zooms the page on focus.
    inputs.forEach((i) => expect(i.className).toContain('text-base'));
    submitManagerForm(f);
    expect(create).not.toHaveBeenCalled();
    const s = sheet(f)?.textContent ?? '';
    expect(s).toContain('Informe o nome de quem vai gerenciar.');
    expect(s).toContain('Informe o e-mail de quem você quer convidar.');
    expect(s).toContain('Informe o CPF do gerenciador.');
    expect(s).toContain('Informe o telefone do gerenciador.');
    // Neutral helper copy: it must NOT promise an accept without Google.
    expect(s).toContain('Enviaremos um link por e-mail.');
    expect(s).not.toMatch(/Google/);
  });

  it('CPF com digito verificador errado e recusado; a mascara e aplicada', () => {
    const f = render('OWNER');
    goToManagerForm(f);
    fill(f, 'invite-name', 'Patrícia Souza');
    fill(f, 'invite-email', 'patricia@empresa.com.br');
    fill(f, 'invite-cpf', '52998224724');
    fill(f, 'invite-phone', '11987654321');
    expect((host(f).querySelector('#invite-cpf') as HTMLInputElement).value).toBe('529.982.247-24');
    submitManagerForm(f);
    expect(create).not.toHaveBeenCalled();
    expect(sheet(f)?.textContent).toContain('CPF inválido.');
  });

  it('envio do gerenciador manda EXATAMENTE o contrato de hoje e os filtros nao escondem a linha nova', () => {
    const f = render('OWNER');
    goToManagerForm(f);
    fill(f, 'invite-name', '  Patrícia Souza ');
    fill(f, 'invite-email', 'patricia@empresa.com.br ');
    fill(f, 'invite-cpf', '52998224725');
    fill(f, 'invite-phone', '11987654321');
    submitManagerForm(f);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      email: 'patricia@empresa.com.br',
      role: 'MANAGER',
      name: 'Patrícia Souza',
      cpf: '52998224725',
      phone: '11987654321',
    });
    expect(success).toHaveBeenCalledWith('Convite enviado para «patricia@empresa.com.br».');
    expect(sheet(f)).toBeNull();
    // Re-reads the invites only — sending an invite does not touch the roster.
    expect(inviteList).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('depois de enviar um convite os filtros caem: a linha nova nao fica escondida atras deles', () => {
    const f = render('OWNER', { mobile: false });
    choose(f, 'status', 'ACTIVE');
    search(f, 'caio');
    goToManagerForm(f);
    fill(f, 'invite-name', 'Patrícia Souza');
    fill(f, 'invite-email', 'patricia@empresa.com.br');
    fill(f, 'invite-cpf', '52998224725');
    fill(f, 'invite-phone', '11987654321');
    submitManagerForm(f);
    expect(create).toHaveBeenCalledTimes(1);
    expect(host(f).querySelector<HTMLInputElement>('#members-search')?.value).toBe('');
    expect(host(f).querySelector<HTMLSelectElement>('[data-filter-status]')?.value).toBe('');
  });

  it('erro de convite com copy propria fica DENTRO da folha, com o que foi digitado', () => {
    const f = render('OWNER');
    create.mockReturnValue(throwError(() => error(409)));
    goToManagerForm(f);
    fill(f, 'invite-name', 'Patrícia Souza');
    fill(f, 'invite-email', 'patricia@empresa.com.br');
    fill(f, 'invite-cpf', '52998224725');
    fill(f, 'invite-phone', '11987654321');
    submitManagerForm(f);
    const s = sheet(f);
    expect(s).not.toBeNull();
    expect(s?.querySelector('[role="alert"]')?.textContent).toContain('Atualize a lista');
    expect((host(f).querySelector('#invite-email') as HTMLInputElement).value).toBe(
      'patricia@empresa.com.br',
    );
    expect(success).not.toHaveBeenCalled();
  });

  it('codigo desconhecido cai na mensagem do servidor ou na generica, nunca em erro cru', () => {
    const f = render('OWNER');
    create.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: null })));
    goToManagerForm(f);
    fill(f, 'invite-name', 'Patrícia Souza');
    fill(f, 'invite-email', 'patricia@empresa.com.br');
    fill(f, 'invite-cpf', '52998224725');
    fill(f, 'invite-phone', '11987654321');
    submitManagerForm(f);
    const alert = sheet(f)?.querySelector('[role="alert"]')?.textContent ?? '';
    expect(alert.trim().length).toBeGreaterThan(0);
    expect(alert).not.toContain('500');
  });

  it('voltar do formulario retorna a escolha do nivel', () => {
    const f = render('OWNER');
    goToManagerForm(f);
    sheet(f)?.querySelector<HTMLButtonElement>('button[aria-label="Voltar"]')?.click();
    f.detectChanges();
    expect(sheet(f)?.querySelector('[data-role-option="MANAGER"]')).not.toBeNull();
  });
});
