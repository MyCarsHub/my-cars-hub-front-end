import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import type { AdminUserCompanyLink, AdminUserListItem } from '../../../types/admin-user.types';
import {
  companiesDetail,
  companiesSummary,
  detailHasPendingInvite,
  enterAsTargets,
  exactDate,
  exactDateTime,
  isLocalFilter,
  lastAccessLabel,
  matchesLocalFilters,
  resendRefusal,
  serverQueryFor,
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
  it('o papel mostrado é o mais alto, em chip neutro; admin da plataforma vence', () => {
    expect(userRole(BASE)).toEqual({ label: 'Dono', tone: 'neutral' });
    expect(userRole({ systemRole: 'USER', companies: [BASE.companies![0]] })?.tone).toBe('neutral');
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

  it('filtro de papel casa com QUALQUER empresa do usuário', () => {
    expect(matchesLocalFilters(BASE, 'ALL', 'MANAGER')).toBe(true);
    expect(matchesLocalFilters(BASE, 'ALL', 'DRIVER')).toBe(false);
    expect(matchesLocalFilters(BASE, 'ALL', 'ALL')).toBe(true);
  });

  it('convite pendente é recorte local; os outros chips já vêm do servidor', () => {
    const pending = { ...BASE, accountStatus: 'PRE_REGISTERED' };
    expect(matchesLocalFilters(pending, 'PENDING', 'ALL')).toBe(true);
    expect(matchesLocalFilters({ ...BASE, accountStatus: 'ACTIVE' }, 'PENDING', 'ALL')).toBe(false);
    expect(matchesLocalFilters({ ...BASE, active: false }, 'INACTIVE', 'ALL')).toBe(true);
    expect(isLocalFilter('PENDING', 'ALL')).toBe(true);
    expect(isLocalFilter('ALL', 'OWNER')).toBe(true);
    expect(isLocalFilter('ONLINE', 'ALL')).toBe(false);
  });

  it('cada pílula pede ao servidor só o que ele filtra', () => {
    expect(serverQueryFor('ALL')).toEqual({ status: 'ALL', online: false });
    expect(serverQueryFor('ACTIVE')).toEqual({ status: 'ACTIVE', online: false });
    expect(serverQueryFor('INACTIVE')).toEqual({ status: 'INACTIVE', online: false });
    expect(serverQueryFor('PENDING')).toEqual({ status: 'ACTIVE', online: false });
    expect(serverQueryFor('ONLINE')).toEqual({ status: 'ALL', online: true });
  });

  it('data exata no fuso do negócio: LocalDateTime da API é UTC sem sufixo', () => {
    // 01:30 UTC do dia 19 = 22:30 do dia 18 em Brasília.
    expect(exactDateTime('2026-11-19T01:30:00')).toBe('18/11/2026 às 22:30');
    expect(exactDate('2026-11-19T01:30:00')).toBe('18/11/2026');
    // Com sufixo (OffsetDateTime do lastSeenAt) a zona é respeitada.
    expect(exactDateTime('2026-11-18T14:32:00-03:00')).toBe('18/11/2026 às 14:32');
    expect(exactDateTime(null)).toBeNull();
    expect(exactDate(null)).toBe('—');
  });

  it('resumo de empresas e a lista completa do balão', () => {
    expect(companiesSummary(BASE)).toBe('Alfa +1');
    expect(companiesSummary({ companyCount: 0, companies: [] })).toBe('—');
    expect(companiesDetail(BASE)).toBe('Alfa (Gerenciador), Beta (Dono)');
    expect(companiesDetail({ companies: [] })).toBe('');
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
