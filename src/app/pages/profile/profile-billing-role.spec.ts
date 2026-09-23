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
  function render(tokenRole: string | null, subscription: SubscriptionResponse | null) {
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
            // O ESPELHO mente: diz OWNER em todos os casos. Se a trava o
            // lesse, o motorista continuaria vendo o botão.
            getItem: vi.fn((key: string) => (key === 'selectedRole' ? 'OWNER' : null)),
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
});
