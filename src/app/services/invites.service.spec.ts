import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvitesService } from './invites.service';
import { environment } from '../../environments/environment';
import type { InviteResponse } from '../types/invite.types';

/**
 * Guards the two parts of the contract that are easy to break silently: the URLs
 * (`resend` / `cancel` are keyed by the invite UUID, not by the raw token) and the
 * tenant-scoped cache that `reset()` has to clear on logout.
 */
describe('InvitesService', () => {
  const BASE = `${environment.apiUrl}/invites`;

  const pending: InviteResponse = {
    id: 'inv-1',
    email: 'novo@empresa.com.br',
    role: 'DRIVER',
    status: 'PENDING',
    expiresAt: '2026-08-06T12:00:00Z',
    createDate: '2026-08-05T12:00:00Z',
  };

  const accepted: InviteResponse = { ...pending, id: 'inv-2', status: 'ACCEPTED' };

  let httpGet: ReturnType<typeof vi.fn>;
  let httpPost: ReturnType<typeof vi.fn>;
  let httpDelete: ReturnType<typeof vi.fn>;
  let service: InvitesService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    httpGet = vi.fn(() => of([pending, accepted]));
    httpPost = vi.fn(() => of(pending));
    httpDelete = vi.fn(() => of(''));

    TestBed.configureTestingModule({
      providers: [
        InvitesService,
        { provide: HttpClient, useValue: { get: httpGet, post: httpPost, delete: httpDelete } },
      ],
    });
    service = TestBed.inject(InvitesService);
  });

  it('publica a listagem no cache e conta apenas os pendentes', () => {
    service.list().subscribe();

    expect(httpGet).toHaveBeenCalledWith(BASE);
    expect(service.invites()).toEqual([pending, accepted]);
    expect(service.pendingCount()).toBe(1);
    expect(service.loaded()).toBe(true);
    expect(service.loading()).toBe(false);
  });

  it('coloca o convite recém-criado no topo da lista', () => {
    service.list().subscribe();
    httpPost.mockReturnValue(of({ ...pending, id: 'inv-3', email: 'outro@empresa.com.br' }));

    service.create({ email: 'outro@empresa.com.br', role: 'MANAGER' }).subscribe();

    expect(httpPost).toHaveBeenCalledWith(BASE, {
      email: 'outro@empresa.com.br',
      role: 'MANAGER',
    });
    expect(service.invites()[0].id).toBe('inv-3');
    expect(service.pendingCount()).toBe(2);
  });

  it('reenvia pelo UUID do convite — nunca pelo token', () => {
    httpPost.mockReturnValue(of(''));

    service.resend('inv-1').subscribe();

    expect(httpPost).toHaveBeenCalledWith(`${BASE}/resend/inv-1`, {}, { responseType: 'text' });
  });

  it('cancela pelo UUID e remove a linha do cache', () => {
    service.list().subscribe();

    service.cancel('inv-1').subscribe();

    expect(httpDelete).toHaveBeenCalledWith(`${BASE}/inv-1`, { responseType: 'text' });
    expect(service.invites().map((i) => i.id)).toEqual(['inv-2']);
    expect(service.pendingCount()).toBe(0);
  });

  it('escapa o token bruto nas rotas públicas de validar e aceitar', () => {
    httpGet.mockReturnValue(of({ email: 'a@b.com', role: 'DRIVER', companyName: 'X', userExists: false }));

    service.validate('tok/en+1').subscribe();
    service.accept('tok/en+1').subscribe();

    expect(httpGet).toHaveBeenLastCalledWith(`${BASE}/validate/tok%2Fen%2B1`);
    expect(httpPost).toHaveBeenLastCalledWith(`${BASE}/accept/tok%2Fen%2B1`, {});
  });

  it('reset zera o cache — os e-mails são PII do tenant anterior', () => {
    service.list().subscribe();
    expect(service.invites()).toHaveLength(2);

    service.reset();

    expect(service.invites()).toEqual([]);
    expect(service.pendingCount()).toBe(0);
    expect(service.loaded()).toBe(false);
  });
});
