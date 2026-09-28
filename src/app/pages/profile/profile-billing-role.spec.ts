import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Profile } from './profile';
import { AuthService } from '../../services/auth.service';
import { BillingService } from '../../services/billing.service';
import { SessionService } from '../../services/session.service';
import { SessionResetRegistry } from '../../services/session-reset.registry';
import { TelemetryService } from '../../services/telemetry.service';
import { IMPERSONATED_ROLE, IMPERSONATION_CLAIM } from '../../services/impersonation.context';
import { SubscriptionResponse } from '../../types/billing.types';

/**
 * FIX-0456 — o bloco de plano do Perfil só aparece para quem pode abrir
 * `/billing`.
 *
 * O bloco tinha trava de DADO (`@if (subscription())`) e NENHUMA de papel, e o
 * ramo `@else` ("Ver Planos") dispara justamente quando não há assinatura — o
 * caso garantido de quem não é dono. Resultado: MANAGER e DRIVER viam um botão
 * primário de largura cheia, tocavam, e o `roleGuard(['OWNER'])` de `/billing`
 * os REDIRECIONAVA para `/dashboard`. Sem erro, sem aviso: a tela trocava.
 *
 * O Perfil é a pior tela possível para isso, porque é fixada no rodapé da
 * barra lateral — é a tela que todo motorista alcança de onde estiver.
 *
 * A trava lê o TOKEN, a MESMA fonte do guard. O espelho `selectedRole` do
 * `sessionStorage` é posto para DISCORDAR em todos os casos abaixo: uma trava
 * de UI que lesse o espelho seria a mesma divergência, só que noutra tela.
 */
describe('Profile — bloco de plano travado por PAPEL, não só por dado', () => {
  const PAID: SubscriptionResponse = {
    id: 'sub-1',
    planCode: 'PRO_MONTHLY_STRIPE',
    planName: 'PRO',
    status: 'ACTIVE',
    billingCycle: 'MONTHLY',
    trialEndsAt: null,
    currentPeriodStart: '2026-07-01T00:00:00Z',
    currentPeriodEnd: '2026-08-01T00:00:00Z',
    cancelAtPeriodEnd: false,
    externalId: null,
    pendingPlanCode: null,
    scheduledDowngradePlanCode: null,
    scheduledDowngradeAt: null,
  };

  let navigate: ReturnType<typeof vi.fn>;

  /**
   * @param tokenRole  o papel de verdade, o que o guard usaria
   * @param subscription  `null` exercita o ramo "Sem plano ativo / Ver Planos"
   */
  function render(
    tokenRole: string | null,
    subscription: SubscriptionResponse | null,
    session: { selectedRole?: string | null; userCompanies?: string | null } = {},
  ) {
    TestBed.resetTestingModule();
    navigate = vi.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: HttpClient, useValue: { get: vi.fn(() => of({ document: null })) } },
        {
          provide: BillingService,
          useValue: {
            plans: signal([]).asReadonly(),
            subscription: signal<SubscriptionResponse | null>(subscription).asReadonly(),
            loadPlans: vi.fn(() => of([])),
            loadSubscription: vi.fn(() => of(subscription)),
          },
        },
        {
          provide: SessionService,
          useValue: {
            // O ESPELHO mente: diz OWNER por padrão em todos os casos. Se a
            // trava o lesse, o motorista continuaria vendo o botão.
            getItem: vi.fn((key: string) => {
              if (key === 'selectedRole') {
                return session.selectedRole === undefined ? 'OWNER' : session.selectedRole;
              }
              if (key === 'userCompanies') {
                return session.userCompanies ?? null;
              }
              return null;
            }),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            getCompanyRoleFromToken: vi.fn(() => tokenRole),
            isPlatformAdmin: vi.fn(() => false),
          },
        },
        { provide: AuthService, useValue: { logout: vi.fn() } },
        { provide: Router, useValue: { navigate, navigateByUrl: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();
    return fixture;
  }

  /**
   * Os controles que levam a `/billing`.
   *
   * Por marca, e não clicando em tudo para ver o que navega: uma varredura de
   * cliques dispararia `logout()` e o replay do tour no meio do teste. A marca
   * só vale porque um dos casos abaixo CLICA nela e confere o destino real —
   * sem isso, `data-testid` seria uma afirmação sobre si mesma.
   */
  function billingButtons(host: HTMLElement): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="billing-cta"]'));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  // ------------------------------------------------------------------ TRAVA
  it.each([
    ['DRIVER', null],
    ['DRIVER', PAID],
    ['MANAGER', null],
    ['MANAGER', PAID],
  ] as const)(
    'papel %s não recebe NENHUM caminho para /billing (assinatura: %s)',
    (tokenRole, subscription) => {
      const host = render(tokenRole, subscription).nativeElement as HTMLElement;

      expect(billingButtons(host).length).toBe(0);
      // e nada de prosa de plano sobrando sem o botão
      expect(host.textContent).not.toContain('Ver Planos');
      expect(host.textContent).not.toContain('Gerenciar Assinatura');
    },
  );

  it('papel desconhecido (sem token) também não vê — omissão não vira permissão', () => {
    // Mesma regra do `role.guard.ts`: `null` NEGA.
    const host = render(null, null).nativeElement as HTMLElement;

    expect(billingButtons(host).length).toBe(0);
  });

  // -------------------------------------------------------------- O DONO VÊ
  it('OWNER continua vendo o bloco e o botão — a trava não apagou a tela de ninguém', () => {
    const host = render('OWNER', PAID).nativeElement as HTMLElement;

    expect(billingButtons(host).length).toBe(1);
    expect(host.textContent).toContain('Gerenciar Assinatura');
  });

  it('OWNER sem assinatura ainda recebe o convite de escolher plano', () => {
    const host = render('OWNER', null).nativeElement as HTMLElement;

    expect(billingButtons(host).length).toBe(1);
    expect(host.textContent).toContain('Ver Planos');
  });

  // ----------------------------------------------- a marca aponta para /billing
  it('a marca não é auto-referente: clicar nela navega mesmo para /billing', () => {
    const host = render('OWNER', PAID).nativeElement as HTMLElement;

    const cta = billingButtons(host)[0];
    expect(cta).toBeDefined();
    cta.click();

    expect(navigate).toHaveBeenCalledWith(['/billing']);
  });

  // ------------------------------------------------- a trava e o guard batem
  it('IGUALDADE: só existe botão para /billing quando o papel do TOKEN é o que o guard aceita', () => {
    // `/billing` é `roleGuard(['OWNER'])` em `app.routes.ts`. A trava da tela
    // tem de concordar com ele em todos os papéis, não só no feliz.
    const allowedByGuard = ['OWNER'];
    for (const role of ['OWNER', 'MANAGER', 'DRIVER']) {
      const host = render(role, PAID).nativeElement as HTMLElement;
      const offered = billingButtons(host).length > 0;

      expect(offered).toBe(allowedByGuard.includes(role));
    }
  });
  // --------------------------------------------------------- O PAPEL EXIBIDO
  /**
   * Quantas vezes `needle` aparece no texto renderizado. Contar importa aqui: o
   * Perfil mostra o papel da empresa ativa em TRÊS lugares (o badge de "Seu
   * Papel", a linha da empresa ativa e o badge ao lado do nome). Uma asserção de
   * "contém" ficaria verde com dois dos três ainda lendo o espelho.
   */
  function occurrences(text: string, needle: string): number {
    return text.split(needle).length - 1;
  }

  /**
   * FEAT-0230 — o mesmo espelho, agora no papel EXIBIDO. `selectedRole` do
   * `sessionStorage` alimentava `roleLabel(selectedRole())` nos três lugares
   * acima, enquanto o `roleGuard`, a trava de plano deste arquivo e todas as
   * outras telas já liam o TOKEN. Não abria porta nenhuma — é texto —, mas
   * mostrava à pessoa um papel diferente do que o servidor aplica, e é assim
   * que um 403 legítimo vira mistério.
   *
   * Estes casos só provam algo porque as duas fontes DISCORDAM: o espelho diz
   * OWNER e o token diz outra coisa. Um caso em que as duas concordam fica
   * verde com a leitura revertida, e foi por isso que este espelho atravessou
   * as rodadas anteriores de remoção.
   */
  it.each([
    ['DRIVER', 'Motorista'],
    ['MANAGER', 'Gerenciador'],
  ] as const)(
    'papel %s do TOKEN é o exibido nos três lugares (%s), com o espelho dizendo OWNER',
    (tokenRole, label) => {
      const host = render(tokenRole, PAID).nativeElement as HTMLElement;
      const text = host.textContent ?? '';

      expect(occurrences(text, label)).toBe(3);
      // "Dono" é o rótulo de OWNER: se aparecer, a leitura voltou ao espelho.
      expect(text).not.toContain('Dono');
    },
  );

  it('sem token o papel exibido é o travessão, não o do espelho — omissão não vira papel', () => {
    // Mesma regra fail-closed do `role.guard.ts` e da trava acima: `null` NEGA.
    const host = render(null, PAID).nativeElement as HTMLElement;
    const text = host.textContent ?? '';

    // NENHUM rotulo de papel na tela. Contar travessoes nao serviria: a tela
    // tem placeholders '—' de nome, e-mail e empresa, e a contagem ficaria
    // verde mesmo com o badge mostrando um papel.
    expect(text).not.toContain('Dono');
    expect(text).not.toContain('Gerenciador');
    expect(text).not.toContain('Motorista');
  });

  /**
   * CONTRAPESO, e ele existe para impedir a correção EXCESSIVA: a lista
   * "Empresas com acesso" mostra `roleLabel(company.role)`, o papel de CADA
   * linha. Aquele não é espelho de nada — é o papel naquela empresa, e a linha
   * da empresa que não é a ativa não tem token para consultar. Trocar aquela
   * leitura pelo token pintaria todas as linhas com o papel da empresa ativa.
   */
  it('a lista de empresas mantém o papel DE CADA LINHA; só o papel ativo vem do token', () => {
    const host = render('DRIVER', PAID, {
      userCompanies: JSON.stringify([
        { companyId: 'co-1', companyName: 'Locadora Alfa', role: 'OWNER' },
      ]),
    }).nativeElement as HTMLElement;
    const text = host.textContent ?? '';

    // O papel ativo segue o token, nos três lugares …
    expect(occurrences(text, 'Motorista')).toBe(3);
    // … e a linha daquela empresa continua dizendo o papel DELA.
    expect(text).toContain('Dono');
  });
  // ------------------------------------------------------ SESSAO DE SUPORTE
  /**
   * FEAT-0230 — por que este caso usa o `SessionService` DE VERDADE, e nao o
   * dobro que todos os outros usam.
   *
   * Trocar o papel exibido para o token coloca esta tela em cima de uma
   * armadilha que ja mordeu o projeto: o token de "ver como empresa" NÃO tem
   * claim `role` (o backend o omite e ainda rebaixa `system_role`). O que
   * mantem a sessao de suporte funcionando e UM ramo em
   * `session.service.ts:getCompanyRoleFromToken`, que testa
   * `IMPERSONATION_CLAIM` ANTES de ler `role` e devolve `IMPERSONATED_ROLE`.
   *
   * Esse ramo esta FORA desta branch e nao e tocado por ela. Com o
   * `SessionService` dobrado, mexer nele nao derruba teste nenhum daqui — o
   * defeito reapareceria só em produção, na sessão de suporte, que e
   * exatamente como ele apareceu da primeira vez. Entao este caso monta o
   * servico real com um token real e passa a segurar o ramo: quem o remover ve
   * ESTA tela ficar vermelha, e nao o cliente.
   */
  function impersonationToken(): string {
    const segment = (value: unknown): string =>
      btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // A FORMA REAL do token de impersonacao: claim de impersonacao presente e
    // NENHUM `role`. Escrever `role` aqui faria o teste passar pelo motivo
    // errado, porque a leitura cairia no ramo comum.
    return [
      segment({ alg: 'HS256', typ: 'JWT' }),
      segment({ [IMPERSONATION_CLAIM]: true, exp: Math.floor(Date.now() / 1000) + 3600 }),
      'assinatura-nunca-verificada-no-cliente',
    ].join('.');
  }

  function renderWithRealSession(token: string) {
    TestBed.resetTestingModule();
    navigate = vi.fn(() => Promise.resolve(true));
    sessionStorage.clear();
    sessionStorage.setItem('token', token);
    // O ESPELHO mente ao contrario aqui: diz DRIVER. Assim "Dono" na tela so
    // pode ter vindo do TOKEN, nunca do espelho.
    sessionStorage.setItem('selectedRole', 'DRIVER');

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: HttpClient, useValue: { get: vi.fn(() => of({ document: null })) } },
        {
          provide: BillingService,
          useValue: {
            plans: signal([]).asReadonly(),
            subscription: signal<SubscriptionResponse | null>(PAID).asReadonly(),
            loadPlans: vi.fn(() => of([])),
            loadSubscription: vi.fn(() => of(PAID)),
          },
        },
        SessionService,
        { provide: TelemetryService, useValue: { setUser: vi.fn() } },
        { provide: SessionResetRegistry, useValue: { register: vi.fn(), run: vi.fn() } },
        { provide: AuthService, useValue: { logout: vi.fn() } },
        { provide: Router, useValue: { navigate, navigateByUrl: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();
    return fixture;
  }

  it('sessao de suporte: o papel vem do ramo de impersonacao, nao do espelho nem de um role ausente', () => {
    const host = renderWithRealSession(impersonationToken()).nativeElement as HTMLElement;
    const text = host.textContent ?? '';

    // `IMPERSONATED_ROLE` e OWNER, cujo rotulo e "Dono", nos tres lugares.
    expect(IMPERSONATED_ROLE).toBe('OWNER');
    expect(occurrences(text, 'Dono')).toBe(3);
    // Nao e o espelho: ele diz DRIVER.
    expect(text).not.toContain('Motorista');
    expect(text).not.toContain('Gerenciador');
  });

  it('token comum SEM role cai no travessao — o ramo de impersonacao nao vale para todo token', () => {
    // CONTRAPESO: prova que o caso acima passa pelo CLAIM e nao por "token
    // qualquer vira OWNER". Sem ele, apagar a checagem do claim deixaria o
    // teste de cima verde.
    const segment = (value: unknown): string =>
      btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const semRole = [
      segment({ alg: 'HS256', typ: 'JWT' }),
      segment({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      'assinatura-nunca-verificada-no-cliente',
    ].join('.');

    const host = renderWithRealSession(semRole).nativeElement as HTMLElement;
    const text = host.textContent ?? '';

    // NENHUM rotulo de papel na tela. Contar travessoes nao serviria: a tela
    // tem placeholders '—' de nome, e-mail e empresa, e a contagem ficaria
    // verde mesmo com o badge mostrando um papel.
    expect(text).not.toContain('Dono');
    expect(text).not.toContain('Gerenciador');
    expect(text).not.toContain('Motorista');
  });
});
