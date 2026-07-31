import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';

import { RentalDraftService } from './rental-draft.service';
import { SessionService } from '../../services/session.service';

/** Stub in-memory do SessionService — evita depender do sessionStorage do jsdom. */
class FakeSession {
  readonly store = new Map<string, string>();
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  getItem(k: string): string | null {
    return this.store.get(k) ?? null;
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
}

describe('RentalDraftService', () => {
  let session: FakeSession;
  let service: RentalDraftService;

  function signIn(userId: string, companyId: string): void {
    session.setItem('id', userId);
    session.setItem('selectedCompanyId', companyId);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    session = new FakeSession();
    TestBed.configureTestingModule({
      providers: [{ provide: SessionService, useValue: session }],
    });
    service = TestBed.inject(RentalDraftService);
  });

  it('salva e restaura o rascunho do mesmo usuário/empresa', () => {
    signIn('user-1', 'company-1');
    service.save({ vehicleId: 'v1', notes: 'teste', periodRateReais: 120 });

    expect(service.load()).toEqual({ vehicleId: 'v1', notes: 'teste', periodRateReais: 120 });
  });

  it('clear() remove o rascunho', () => {
    signIn('user-1', 'company-1');
    service.save({ vehicleId: 'v1' });
    service.clear();

    expect(service.load()).toBeNull();
  });

  it('não vaza rascunho entre usuários diferentes', () => {
    signIn('user-1', 'company-1');
    service.save({ vehicleId: 'do-user-1' });

    signIn('user-2', 'company-1');
    expect(service.load()).toBeNull();
  });

  it('não vaza rascunho entre empresas diferentes do mesmo usuário', () => {
    signIn('user-1', 'company-1');
    service.save({ vehicleId: 'da-empresa-1' });

    signIn('user-1', 'company-2');
    expect(service.load()).toBeNull();
  });

  it('devolve o rascunho certo ao voltar pro escopo original', () => {
    signIn('user-1', 'company-1');
    service.save({ vehicleId: 'a' });
    signIn('user-1', 'company-2');
    service.save({ vehicleId: 'b' });

    signIn('user-1', 'company-1');
    expect(service.load()).toEqual({ vehicleId: 'a' });
  });

  it('não grava nada sem usuário/empresa na sessão', () => {
    service.save({ vehicleId: 'orfao' });

    expect(session.store.size).toBe(0);
    expect(service.load()).toBeNull();
  });

  it('ignora payload corrompido ou de versão desconhecida', () => {
    signIn('user-1', 'company-1');
    session.setItem('rentalDraft:user-1:company-1', '{ nao é json');
    expect(service.load()).toBeNull();

    session.setItem(
      'rentalDraft:user-1:company-1',
      JSON.stringify({ v: 99, userId: 'user-1', companyId: 'company-1', value: { a: 1 } }),
    );
    expect(service.load()).toBeNull();
  });

  it('ignora payload cujo dono não bate com a sessão (chave adulterada)', () => {
    signIn('user-1', 'company-1');
    session.setItem(
      'rentalDraft:user-1:company-1',
      JSON.stringify({ v: 1, userId: 'outro', companyId: 'company-1', value: { a: 1 } }),
    );

    expect(service.load()).toBeNull();
  });
});
