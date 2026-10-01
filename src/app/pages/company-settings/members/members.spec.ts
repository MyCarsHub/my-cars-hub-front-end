import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanyMembers } from './members';
import { ApiErrorService } from '../../../services/api-error.service';
import { CompanyMembersService } from '../../../services/company-members.service';
import { NotificationService } from '../../../services/notification.service';
import { SessionService } from '../../../services/session.service';
import type { CompanyMemberResponse } from '../../../types/company-member.types';

/**
 * FEAT-0266 — a tela do roster, e as quatro regras que ela nao pode perder.
 *
 * As duas rotas do backend sao `GET` e `DELETE`; NAO existe endpoint de troca de papel, e e
 * por isso que nao ha caso de promover nem rebaixar aqui. Se alguem acrescentar um seletor
 * de cargo nesta tela, ele nao tem para onde postar.
 *
 * A remocao grava `status = 'REMOVED'` e MANTEM a linha — apagar deixaria um token assinado
 * continuar valendo. Nenhum caso aqui assume delecao, e a copy fala em perder acesso.
 */
describe('CompanyMembers — roster da empresa', () => {
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

  let list: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let success: ReturnType<typeof vi.fn>;
  let members: ReturnType<typeof signal<CompanyMemberResponse[]>>;

  function error(status: number, message = 'falhou'): HttpErrorResponse {
    return new HttpErrorResponse({ status, error: { message } });
  }

  /**
   * @param tokenRole papel do CHAMADOR, lido do token — a mesma fonte do `roleGuard`
   * @param roster    o que `GET /members` devolve
   */
  function render(
    tokenRole: string | null,
    roster: CompanyMemberResponse[] = [owner, manager, driver],
    listImpl?: () => ReturnType<typeof of>,
  ): ComponentFixture<CompanyMembers> {
    TestBed.resetTestingModule();
    members = signal<CompanyMemberResponse[]>([]);
    // O impl entra AQUI e nao por `mockReturnValue` depois: `list()` roda no `ngOnInit`,
    // durante o `createComponent` — um mock ajustado depois chegaria tarde, e um ajustado
    // antes seria descartado por esta reatribuicao.
    list = vi.fn(
      listImpl ??
        (() => {
          members.set(roster);
          return of(roster);
        }),
    );
    remove = vi.fn(() => of(undefined));
    success = vi.fn();

    TestBed.configureTestingModule({
      imports: [CompanyMembers],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: CompanyMembersService,
          useValue: {
            members: members.asReadonly(),
            loading: signal(false).asReadonly(),
            loaded: signal(true).asReadonly(),
            memberCount: signal(roster.length).asReadonly(),
            list,
            remove,
          },
        },
        {
          provide: SessionService,
          useValue: {
            // `id` e quem EU sou: e o que decide "a sua propria linha".
            getItem: vi.fn((key: string) => (key === 'id' ? ME : null)),
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

  function rowOf(fixture: ComponentFixture<CompanyMembers>, name: string): HTMLElement {
    const row = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('li'),
    ).find((li) => (li.textContent ?? '').includes(name));
    if (!row) throw new Error(`a linha de ${name} nao esta na tela`);
    return row as HTMLElement;
  }

  function removeButtonOf(
    fixture: ComponentFixture<CompanyMembers>,
    name: string,
  ): HTMLButtonElement | undefined {
    return Array.from(rowOf(fixture, name).querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Remover acesso'),
    );
  }

  /**
   * Escopado ao `role="dialog"` DE PROPOSITO: a linha da pessoa tem um botao com o MESMO
   * rotulo ("Remover acesso") e vem ANTES no DOM, entao uma busca global acharia o da linha
   * e o teste reabriria a confirmacao em vez de confirmar — passando pelo motivo errado.
   */
  function confirmDialogButton(
    fixture: ComponentFixture<CompanyMembers>,
    label: string,
  ): HTMLButtonElement | undefined {
    const dialog = (fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]');
    if (!dialog) throw new Error('a confirmacao nao esta na tela');
    return Array.from(dialog.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === label,
    );
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  // ------------------------------------------------------------------ LISTAR
  it('lista quem tem acesso, com nome, e-mail e papel em portugues', () => {
    const fixture = render('OWNER');
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(list).toHaveBeenCalledTimes(1);
    expect(text).toContain('Dona Ana');
    expect(text).toContain('bruno@empresa.com.br');
    // Rotulos pt-BR vindos de `companyRoleLabel`, nao os enums crus.
    expect(text).toContain('Dono');
    expect(text).toContain('Gerenciador');
    expect(text).toContain('Motorista');
    expect(text).not.toContain('OWNER');
  });

  it('empresa com um unico membro nao mostra lista vazia enganosa', () => {
    const fixture = render('OWNER', [owner]);

    expect(rowOf(fixture, 'Dona Ana')).toBeDefined();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Ninguém mais tem');
  });

  // --------------------------------------------------- REMOVER COM CONFIRMACAO
  /**
   * A confirmacao nao e enfeite: remover e destrutivo PARA A PESSOA REMOVIDA, que perde o
   * acesso no instante seguinte e nao e quem esta clicando.
   */
  it('clicar em remover NAO chama o servidor: abre a confirmacao primeiro', () => {
    const fixture = render('OWNER');

    removeButtonOf(fixture, 'Motorista Caio')?.click();
    fixture.detectChanges();

    expect(remove).not.toHaveBeenCalled();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Remover acesso');
    // A frase da confirmacao nomeia QUEM, e nao fala em apagar: o backend marca REMOVED.
    expect(text).toContain('Motorista Caio');
    expect(text).toContain('perde o acesso');
    expect(text).not.toContain('apagad');
  });

  it('confirmar remove de fato, pelo userId, e avisa quem ficou', () => {
    const fixture = render('OWNER');

    removeButtonOf(fixture, 'Motorista Caio')?.click();
    fixture.detectChanges();
    confirmDialogButton(fixture, 'Remover acesso')?.click();
    fixture.detectChanges();

    expect(remove).toHaveBeenCalledWith('user-motorista');
    expect(success).toHaveBeenCalledWith('Motorista Caio perdeu o acesso a esta empresa.');
  });

  it('cancelar a confirmacao nao remove ninguem', () => {
    const fixture = render('OWNER');

    removeButtonOf(fixture, 'Motorista Caio')?.click();
    fixture.detectChanges();
    confirmDialogButton(fixture, 'Manter acesso')?.click();
    fixture.detectChanges();

    expect(remove).not.toHaveBeenCalled();
  });

  // ------------------------------------------- O DONO NAO REMOVE A SI MESMO
  /**
   * Nao existe transferencia de propriedade nesta base — o unico escritor de OWNER e o
   * onboarding, e convite nao concede propriedade. Uma empresa que perde o dono nao
   * recupera, entao a tela nunca oferece.
   *
   * O botao ausente vem com RAZAO escrita: botao que simplesmente nao esta ali faz a pessoa
   * procurar o que nao existe.
   */
  it('o dono nao recebe botao para remover a si mesmo, e le o porque', () => {
    const fixture = render('OWNER', [{ ...owner, userId: ME }, manager]);

    expect(removeButtonOf(fixture, 'Dona Ana')).toBeUndefined();
    expect(rowOf(fixture, 'Dona Ana').textContent).toContain('não pode remover o seu próprio');
  });

  it('ninguem remove a propria linha, nem gerente', () => {
    const fixture = render('MANAGER', [owner, { ...manager, userId: ME }]);

    expect(removeButtonOf(fixture, 'Gerente Bruno')).toBeUndefined();
  });

  /** O backend recusa remover OWNER por outro membro — nem por outro OWNER. A tela espelha. */
  it('a linha do DONO nao e removivel por outra pessoa', () => {
    const fixture = render('OWNER', [owner, { ...manager, userId: ME }]);

    expect(removeButtonOf(fixture, 'Dona Ana')).toBeUndefined();
    expect(rowOf(fixture, 'Dona Ana').textContent).toContain('dono da empresa não pode ser');
  });

  /** CONTRAPESO: sem ele, uma tela que esconde TODO botao passaria nos tres casos acima. */
  it('quem PODE ser removido tem o botao — a trava nao apagou a acao de todo mundo', () => {
    const fixture = render('OWNER');

    expect(removeButtonOf(fixture, 'Motorista Caio')).toBeDefined();
    expect(removeButtonOf(fixture, 'Gerente Bruno')).toBeDefined();
  });

  // ----------------------------------------------- O MOTORISTA NAO ENTRA
  /**
   * A rota e `roleGuard(['OWNER', 'MANAGER'])` e o backend responde 403 ao motorista
   * (`FORBIDDEN_MEMBER_MANAGEMENT`). Esta e a terceira barreira, e ela existe para o
   * motorista que chegue ao componente ler uma frase em vez de ver uma chamada falhar.
   */
  it('motorista nao ve o roster e NAO chama o servidor', () => {
    const fixture = render('DRIVER');

    expect(list).not.toHaveBeenCalled();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('do dono e dos gerenciadores');
    expect(text).not.toContain('Dona Ana');
  });

  it('papel nulo tambem nao entra — omissao nao vira permissao', () => {
    const fixture = render(null);

    expect(list).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------- OS ERROS
  it('409 na remocao fala do ultimo dono, nao de permissao', () => {
    const fixture = render('OWNER');
    remove.mockReturnValue(throwError(() => error(409)));

    removeButtonOf(fixture, 'Motorista Caio')?.click();
    fixture.detectChanges();
    confirmDialogButton(fixture, 'Remover acesso')?.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('ficaria sem dono');
  });

  /**
   * O 404 do backend e AMBIGUO de proposito: cobre usuario inexistente, membro de outra
   * empresa e vinculo JA removido, indistinguiveis. Entao a copy nao pode afirmar qual foi —
   * ela diz que o acesso nao esta mais la e pede para atualizar, verdade nos tres casos.
   */
  it('404 na remocao nao afirma qual das tres causas foi', () => {
    const fixture = render('OWNER');
    remove.mockReturnValue(throwError(() => error(404)));

    removeButtonOf(fixture, 'Motorista Caio')?.click();
    fixture.detectChanges();
    confirmDialogButton(fixture, 'Remover acesso')?.click();
    fixture.detectChanges();

    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('já não tem acesso');
    expect(text).toContain('Atualize a lista');
  });

  it('403 na listagem explica de quem e a tela, sem erro cru', () => {
    const fixture = render('MANAGER', [], () => throwError(() => error(403)));

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'podem ver quem tem acesso',
    );
  });
});
