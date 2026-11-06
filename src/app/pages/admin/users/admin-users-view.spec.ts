import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import type { AdminUserCompanyLink, AdminUserListItem } from '../../../types/admin-user.types';
import {
  companiesSummary,
  detailHasPendingInvite,
  enterAsTargets,
  lastAccessLabel,
  matchesTab,
  resendRefusal,
  userRole,
  userSituation,
} from './admin-users-view';

const BASE: AdminUserListItem = {
  id: 'u1',
  name: 'Ana',
  email: 'ana@x.com',
  systemRole: 'USER',
  active: true,
  createdDate: null,
  lastCompanyName: null,
  companyCount: 2,
  companies: [
    { companyId: 'c1', companyName: 'Alfa', role: 'MANAGER' },
    { companyId: 'c2', companyName: 'Beta', role: 'OWNER' },
  ],
};

const link = (id: string, role: string, status: string): AdminUserCompanyLink => ({
  companyId: id,
  companyName: id,
  role,
  status,
  joinedAt: null,
});

describe('admin-users-view', () => {
  it('o papel mostrado é o mais alto; admin da plataforma vence', () => {
    expect(userRole(BASE)).toEqual({ label: 'Dono', tone: 'orange' });
    expect(userRole({ ...BASE, systemRole: 'PLATFORM_ADMIN' })?.label).toBe('Admin');
    expect(userRole({ systemRole: 'USER', companies: [] })).toBeNull();
  });

  it('situação: inativo, convite pendente e ativo', () => {
    expect(userSituation({ active: false, accountStatus: 'ACTIVE' }).label).toBe('Inativo');
    expect(userSituation({ active: true, accountStatus: 'PRE_REGISTERED' }).label).toBe(
      'Convite pendente',
    );
    expect(userSituation({ active: true, accountStatus: 'ACTIVE' }).label).toBe('Ativo');
  });

  it('último acesso: online, minutos, horas, dias e nunca visto', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    expect(lastAccessLabel({ online: true, lastSeenAt: null }, now)).toBe('Online agora');
    expect(lastAccessLabel({ online: false, lastSeenAt: '2026-11-05T11:48:00Z' }, now)).toBe(
      'Visto há 12 min',
    );
    expect(lastAccessLabel({ online: false, lastSeenAt: '2026-11-05T09:00:00Z' }, now)).toBe(
      'Visto há 3 h',
    );
    expect(lastAccessLabel({ online: false, lastSeenAt: '2026-11-03T12:00:00Z' }, now)).toBe(
      'Visto há 2 dias',
    );
    expect(lastAccessLabel({ online: false, lastSeenAt: null }, now)).toBeNull();
  });

  it('aba de papel casa com QUALQUER empresa do usuário', () => {
    expect(matchesTab(BASE, 'MANAGER')).toBe(true);
    expect(matchesTab(BASE, 'DRIVER')).toBe(false);
    expect(matchesTab(BASE, 'ALL')).toBe(true);
  });

  it('resumo de empresas', () => {
    expect(companiesSummary(BASE)).toBe('Alfa +1');
    expect(companiesSummary({ companyCount: 0, companies: [] })).toBe('—');
  });

  it('"Entrar como" exclui motorista e vínculo não ativo', () => {
    const targets = enterAsTargets([
      link('a', 'DRIVER', 'ACTIVE'),
      link('b', 'OWNER', 'INVITED'),
      link('c', 'MANAGER', 'ACTIVE'),
    ]);
    expect(targets.map((t) => t.companyId)).toEqual(['c']);
    expect(enterAsTargets([link('a', 'DRIVER', 'ACTIVE')])).toEqual([]);
  });

  it('convite pendente no detalhe = vínculo INVITED', () => {
    expect(detailHasPendingInvite([link('a', 'OWNER', 'INVITED')])).toBe(true);
    expect(detailHasPendingInvite([link('a', 'OWNER', 'ACTIVE')])).toBe(false);
  });

  it('recusas do reenvio: 404, 409 e 429 (corpo e cabeçalho)', () => {
    expect(resendRefusal(new HttpErrorResponse({ status: 404 }))).toContain('não encontrado');
    expect(resendRefusal(new HttpErrorResponse({ status: 409 }))).toContain(
      'não tem convite pendente',
    );
    expect(
      resendRefusal(new HttpErrorResponse({ status: 429, error: { retryAfterSeconds: 540 } })),
    ).toContain('9 min');
    expect(
      resendRefusal(
        new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '61' }) }),
      ),
    ).toContain('2 min');
    expect(resendRefusal(new HttpErrorResponse({ status: 500 }))).toBeNull();
  });
});
