import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { routes } from './app.routes';
import { SessionService } from './services/session.service';
import { NotificationService } from './services/notification.service';

/**
 * FEAT-0179 (semente) — O REDIRECT DE UM GUARD TEM DE TERMINAR.
 *
 * O invariante: nenhum destino de redirect de guard pode ser uma rota em que o
 * MESMO usuário seria recusado outra vez. Violá-lo não dá tela de erro, não dá
 * aviso e não chega ao login: dá laço, e o operador fica preso.
 *
 * POR QUE ISTO NÃO É TESTE DE UNIDADE. O laço é propriedade da ÁRVORE, não da
 * função. O ramo `!role` de `role.guard.ts` tem teste de unidade e ele passa: o
 * `UrlTree` devolvido é só um valor inspecionado. O defeito só aparece quando se
 * pergunta o que tem GUARD no destino — e isso exige a árvore.
 *
 * POR QUE A VARREDURA DECLARA O TAMANHO DO QUE VIU. Uma varredura que não acha
 * nada é indistinguível de uma que não olhou nada, e foi exatamente assim que
 * este laço passou por duas revisões: a varredura que existia estava escopada a
 * uma subárvore que não continha `/dashboard`. "Zero laços em N rotas e M guards"
 * é afirmação; "zero laços" não é.
 *
 * >>> 11/11 AQUI NÃO SIGNIFICA SUÍTE VERDE. Este instrumento vê a árvore de
 * ROTAS e nada mais: um destino novo pode satisfazer o invariante daqui e ainda
 * quebrar um teste unitário que afirmava o destino antigo — aconteceu, com
 * `onboarding.guard.spec.ts`. Depois de mexer em guard, rota, canActivate ou
 * interceptor, rode a SUÍTE INTEIRA; o verde local deste arquivo é exatamente o
 * momento em que se para de medir. <<<
 *
 * LIMITE DECLARADO: só os guards SÍNCRONOS e puros são executados — `roleGuard`
 * e `adminGuard`. `authGuard`, `onboardingGuard`, `billingAccessGuard` e
 * `firstVehicleGuard` fazem HTTP e não são exercitados aqui; eles são CONTADOS e
 * reportados como não-exercitados, para que o buraco fique visível em vez de
 * silencioso. Fechá-lo é o FEAT-0179.
 */
describe('app.routes — redirect de guard termina (FIX-0579)', () => {
  interface RouteNode {
    path: string;
    guards: readonly unknown[];
  }

  /** Classifica pelo texto do closure: `roleGuard` é factory, cada uso é único. */
  function kindOf(guard: unknown): 'role' | 'admin' | 'other' {
    const src = String(guard);
    if (/allowedRoles/.test(src)) return 'role';
    if (/isPlatformAdmin/.test(src) && /createUrlTree/.test(src)) return 'admin';
    return 'other';
  }

  function collect(): { nodes: Map<string, RouteNode>; otherGuards: number } {
    const nodes = new Map<string, RouteNode>();
    let otherGuards = 0;

    const walk = (rs: readonly unknown[], prefix: string, inherited: readonly unknown[]): void => {
      for (const raw of rs) {
        const r = raw as {
          path?: string;
          canActivate?: unknown[];
          canActivateChild?: unknown[];
          children?: unknown[];
        };
        const full = [prefix, r.path].filter((p) => p !== undefined && p !== '').join('/');
        const abs = `/${full}`;
        const own = [...inherited, ...(r.canActivate ?? [])];
        if (own.length > 0) nodes.set(abs, { path: abs, guards: own });
        for (const g of own) if (kindOf(g) === 'other') otherGuards += 1;
        if (r.children) walk(r.children, full, [...inherited, ...(r.canActivateChild ?? [])]);
      }
    };
    walk(routes as unknown[], '', []);
    return { nodes, otherGuards };
  }

  function buildToken(payload: Record<string, unknown>): string {
    const body = { exp: Math.floor(Date.now() / 1000) + 3600, ...payload };
    const b64 = btoa(JSON.stringify(body))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `header.${b64}.signature`;
  }

  /** Roda só os guards exercitáveis; devolve o primeiro redirect, se houver. */
  function firstRedirect(node: RouteNode): string | null {
    for (const guard of node.guards) {
      if (kindOf(guard) === 'other') continue;
      const result = TestBed.runInInjectionContext(() =>
        (guard as (a: unknown, b: RouterStateSnapshot) => boolean | UrlTree)(null, {
          url: node.path,
        } as RouterStateSnapshot),
      );
      if (result instanceof UrlTree) {
        return TestBed.inject(Router).serializeUrl(result).split('?')[0];
      }
    }
    return null;
  }

  const SESSIONS: Array<{ label: string; token: Record<string, unknown> | null }> = [
    { label: 'token vencido', token: { role: 'OWNER', exp: Math.floor(Date.now() / 1000) - 60 } },
    { label: 'PLATFORM_ADMIN sem papel de empresa', token: { system_role: 'PLATFORM_ADMIN' } },
    { label: 'papel nulo sem claim', token: {} },
    { label: 'DRIVER', token: { role: 'DRIVER' } },
    { label: 'MANAGER', token: { role: 'MANAGER' } },
  ];

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), SessionService, NotificationService],
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('a varredura viu a árvore de verdade — e diz de que tamanho', () => {
    const { nodes, otherGuards } = collect();
    const exercisable = [...nodes.values()].filter((n) =>
      n.guards.some((g) => kindOf(g) !== 'other'),
    );

    // O tamanho vai para a saída, não só para a asserção: quem ler o log da CI
    // tem de poder ver QUE ÁRVORE foi percorrida, não só que passou.
    console.log(
      `[redirect-termination] rotas com guard: ${nodes.size} · ` +
        `exercitáveis (roleGuard/adminGuard): ${exercisable.length} · ` +
        `guards NÃO exercitados (assíncronos, ver FEAT-0179): ${otherGuards}`,
    );

    // Colheita vazia PASSA em silêncio: estes números são a defesa contra isso.
    expect(nodes.size).toBeGreaterThan(20);
    expect(exercisable.length).toBeGreaterThan(20);
    expect(otherGuards).toBeGreaterThan(0);

    // E o alvo do laço tem de estar DENTRO do que foi varrido — a varredura
    // anterior não continha `/dashboard`, e foi por isso que não viu nada.
    expect(nodes.has('/dashboard')).toBe(true);
    expect(nodes.has('/admin')).toBe(true);
  });

  /*
   * O INVARIANTE FORTE, e é ele que o node pediu: nenhum destino de redirect pode
   * ser uma rota em que o MESMO usuário seria recusado outra vez.
   *
   * É mais estrito que "não cicla", e a diferença NÃO É RIGOR DECORATIVO: é a
   * única forma com PODER DE DETECÇÃO aqui. Medido neste repo: plantando de volta
   * o fallback do `adminGuard`, a asserção de CICLO passa VERDE — porque com o
   * ramo `!role` já consertado a cadeia `/admin` -> `/dashboard` -> `/login`
   * TERMINA. O defeito existia e o instrumento não o via. Só a exigência de que o
   * destino seja ADMITIDO o acusa.
   *
   * O ciclo também esconde um acoplamento: o primeiro salto manda a pessoa para
   * uma rota que a recusa, e é o `role.guard` que a salva — mude o destino do
   * ramo `!role` e `/admin` volta a loopar.
   *
   * >>> SE ALGUÉM ACHAR ESTA ASSERÇÃO "exagerada, o teste de ciclo basta e é mais
   * simples": não basta. Foi exatamente essa troca que deixou o laço invisível por
   * duas revisões. Enfraquecer daqui para uma checagem de ciclo devolve o ponto
   * cego. <<<
   */
  /*
   * VIOLAÇÕES CONHECIDAS, declaradas uma a uma. A asserção é de IGUALDADE com
   * esta lista, não de "menor ou igual": uma violação nova falha, e consertar uma
   * conhecida TAMBÉM falha até que a entrada saia daqui. Lista que só cresce em
   * silêncio é allowlist; esta tem de encolher.
   */
  const KNOWN_VIOLATIONS: readonly string[] = [
    // VAZIA, e é para continuar. A entrada que existia aqui era o
    // `onboardingCompleteGuard` mandando PLATFORM_ADMIN para `/dashboard`;
    // consertada em `pages/onboarding/onboarding.guard.ts` no mesmo lote que
    // criou a violação. Acrescentar entrada aqui é declarar dívida, não
    // dispensá-la: a asserção é de IGUALDADE, então consertar sem remover a
    // linha também fica vermelho. Lista que só cresce é allowlist.
  ];

  it.each(SESSIONS)('$label: o destino de todo redirect é ADMITIDO, não recusado de novo', ({ label, token }) => {
    if (token) sessionStorage.setItem('token', buildToken(token));
    const { nodes } = collect();
    const violations: string[] = [];

    for (const start of nodes.values()) {
      if (!start.guards.some((g) => kindOf(g) !== 'other')) continue;

      const target = firstRedirect(start);
      if (target === null) continue;

      const destination = nodes.get(target);
      // Destino sem guard exercitável (ex.: `/login`) é terminal por construção.
      if (!destination) continue;

      if (firstRedirect(destination) !== null) {
        violations.push(`${label}: ${start.path} -> ${target}`);
      }
    }

    expect(violations).toEqual(KNOWN_VIOLATIONS.filter((v) => v.startsWith(`${label}:`)));
  });

  it.each(SESSIONS)('$label: todo redirect termina, nenhum volta para si', ({ token }) => {
    if (token) sessionStorage.setItem('token', buildToken(token));
    const { nodes } = collect();

    for (const start of nodes.values()) {
      if (!start.guards.some((g) => kindOf(g) !== 'other')) continue;

      const seen: string[] = [start.path];
      let current: RouteNode | undefined = start;
      // 8 saltos é folga: qualquer cadeia sã termina em 1 ou 2.
      for (let hop = 0; hop < 8 && current; hop += 1) {
        const next = firstRedirect(current);
        if (next === null) break;
        expect(
          seen,
          `laço a partir de ${start.path}: ${[...seen, next].join(' -> ')}`,
        ).not.toContain(next);
        seen.push(next);
        current = nodes.get(next);
      }
    }
  });
});
