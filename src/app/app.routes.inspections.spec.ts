import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Route,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { routes } from './app.routes';
import { SessionService } from './services/session.service';
import { isRoleGuard } from './services/role.guard';

/**
 * A FRONTEIRA DE PAPEL DAS VISTORIAS.
 *
 * O dono pediu que dono, gerente E MOTORISTA facam vistoria. A listagem estava
 * fechada ao motorista porque a lista voltava vazia ou errada para ele; o
 * backend agora escopa `GET /v1/inspections` as vistorias DELE, e sem a lista
 * ele nao tinha como continuar uma em andamento nem ler o motivo de uma
 * recusa. Entao os tres entram, e o que e da empresa (aprovar, agendar, filtrar
 * frota) a tela esconde por papel:
 *
 * - `vistorias`             → OWNER, MANAGER, DRIVER (listagem)
 * - `vistorias/nova`        → OWNER, MANAGER, DRIVER (captura)
 * - `vistorias/:id/captura` → OWNER, MANAGER, DRIVER (retomada)
 *
 * As duas de captura sao IRMAS da listagem, nao filhas — e isso e load-bearing,
 * nao arrumacao. Como filhas, o `roleGuard(['OWNER','MANAGER'])` da listagem
 * seria um ancestral delas e barraria o motorista ANTES do guard proprio, que
 * diz que ele pode. O teste abaixo mede a CADEIA inteira exatamente para que
 * aninhar as rotas um dia quebre aqui, em vez de calar o motorista em producao.
 *
 * Este spec cobre o GUARD, nao a tela: `pages/inspections/inspection-capture.spec.ts`
 * cobre o componente. Sem este arquivo, a permissao de rota do motorista nao
 * tinha prova nenhuma — e era o unico pedaco da feature que nenhum spec media.
 */

interface GuardAtPath {
  readonly path: string;
  readonly guard: CanActivateFn;
}

/**
 * A cadeia de guards de papel que o Angular REALMENTE roda para cada no.
 *
 * ## O erro que a primeira versao deste helper cometeu
 *
 * Ela deduzia ancestralidade de PREFIXO DE URL: `/vistorias` cobriria
 * `/vistorias/nova` porque uma string comeca com a outra. Isso acusou um
 * defeito que NAO existe — o guard da listagem barrando o motorista na captura.
 *
 * No Angular ancestralidade e de ARVORE, nao de string. `vistorias` tem
 * `loadComponent` e NENHUM `children`: e terminal, consome um segmento e nao
 * casa `/vistorias/nova` (sobra segmento), entao o router volta atras e casa a
 * rota IRMA `vistorias/nova`. O `canActivate` da listagem nunca roda ali.
 *
 * Um no so herda guard de ANCESTRAL DE ARVORE: `canActivate` dos ancestrais
 * efetivamente ativados e `canActivateChild` deles. Rota sem filhos nao e
 * ancestral de ninguem.
 */
function resolveChains(
  list: readonly Route[],
  prefix: string,
  inherited: readonly GuardAtPath[],
): Map<string, GuardAtPath[]> {
  const out = new Map<string, GuardAtPath[]>();

  for (const route of list) {
    const path = [prefix, route.path ?? ''].filter(Boolean).join('/');
    const own = (route.canActivate ?? [])
      .filter(isRoleGuard)
      .map((guard) => ({ path: `/${path}`, guard: guard as CanActivateFn }));
    const forChildren = (route.canActivateChild ?? [])
      .filter(isRoleGuard)
      .map((guard) => ({ path: `/${path} (child)`, guard: guard as CanActivateFn }));

    const chainHere = [...inherited, ...own];
    out.set(`/${path}`, chainHere);

    if (route.children?.length) {
      // So um no COM filhos propaga — e propaga o proprio `canActivate` mais o
      // seu `canActivateChild`.
      for (const [k, v] of resolveChains(route.children, path, [
        ...chainHere,
        ...forChildren,
      ])) {
        out.set(k, v);
      }
    }
  }

  return out;
}

/** Casa o path declarado contra uma URL concreta, `:param` como curinga. */
function matches(declared: string, url: string): boolean {
  const d = declared.split('/').filter(Boolean);
  const u = url.split('/').filter(Boolean);
  if (d.length !== u.length) return false;
  return d.every((seg, i) => seg.startsWith(':') || seg === u[i]);
}

describe('fronteira de papel das vistorias', () => {
  let chains: Map<string, GuardAtPath[]>;

  beforeEach(() => {
    chains = resolveChains(routes, '', []);
    // Vizinho sujo nao decide este teste: specs vazam `sessionStorage` entre
    // si, e um token herdado mudaria o papel sob medicao.
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), SessionService],
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  const encodePayload = (payload: Record<string, unknown>): string =>
    btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  /** JWT com o claim `role`, na forma que o backend emite. */
  const tokenWithRole = (role: string): string =>
    `${encodePayload({ alg: 'HS256', typ: 'JWT' })}.${encodePayload({ role })}.sig`;

  /** A cadeia que o Angular roda para esta URL — do no que de fato casa. */
  function chainFor(url: string): GuardAtPath[] {
    const hit = [...chains.entries()].find(([declared]) => matches(declared, url));
    expect(hit, `nenhuma rota declarada casa ${url}`).toBeDefined();
    const chain = (hit as [string, GuardAtPath[]])[1];
    expect(chain.length, `nenhum guard de papel cobre ${url}`).toBeGreaterThan(0);
    return chain;
  }

  /** A CADEIA inteira de guards de papel deixa este papel entrar nesta URL? */
  function chainAllows(url: string, role: string): boolean {
    sessionStorage.setItem('token', tokenWithRole(role));
    const chain = chainFor(url);

    return chain.every(({ guard }) => {
      const result = TestBed.runInInjectionContext(() =>
        guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
      ) as boolean | UrlTree;
      return result === true;
    });
  }

  const CAPTURE = ['/vistorias/nova', '/vistorias/abc-123/captura'];

  it('as tres rotas de vistoria existem na arvore, com guard de papel', () => {
    for (const p of ['/vistorias', '/vistorias/nova', '/vistorias/:id/captura']) {
      expect(chains.has(p), `rota ${p} sumiu da arvore`).toBe(true);
      expect((chains.get(p) ?? []).length, `${p} ficou sem guard de papel`).toBeGreaterThan(0);
    }
  });

  /**
   * A razao estrutural de a captura ser IRMA e nao filha, prendida como teste:
   * `vistorias` e terminal. Se alguem lhe der `children` e aninhar a captura,
   * o guard da listagem passa a ser ancestral e o motorista perde a tela sem
   * que nenhum guard proprio mude. Isto aqui quebra antes disso chegar em prod.
   */
  it('a listagem e TERMINAL — nao e ancestral da captura', () => {
    const listagem = chains.get('/vistorias') ?? [];
    const captura = chains.get('/vistorias/nova') ?? [];

    expect(listagem.map((g) => g.path)).not.toContain('/vistorias (child)');
    expect(captura.map((g) => g.path)).not.toContain('/vistorias');
  });

  /** O pedido do dono: o motorista FAZ vistoria. */
  it('o MOTORISTA entra nas duas rotas de captura', () => {
    for (const url of CAPTURE) {
      expect(chainAllows(url, 'DRIVER'), `motorista barrado em ${url}`).toBe(true);
    }
  });

  it('OWNER e MANAGER tambem entram na captura', () => {
    for (const role of ['OWNER', 'MANAGER']) {
      for (const url of CAPTURE) {
        expect(chainAllows(url, role), `${role} barrado em ${url}`).toBe(true);
      }
    }
  });

  /**
   * A LISTAGEM abriu para o motorista: e por ela que ele continua uma vistoria
   * em andamento e le o motivo de uma recusa. O NEGATIVO que vale aqui e o que
   * continua fechado a ele — a area da empresa vizinha.
   */
  it('a LISTAGEM /vistorias admite dono, gerente E motorista', () => {
    for (const role of ['OWNER', 'MANAGER', 'DRIVER']) {
      expect(chainAllows('/vistorias', role), `${role} barrado em /vistorias`).toBe(true);
    }
  });

  it('o negativo continua: sem token a listagem nega', () => {
    const chain = chainFor('/vistorias');
    sessionStorage.clear();
    const allowed = chain.every(({ guard }) => {
      const result = TestBed.runInInjectionContext(() =>
        guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
      ) as boolean | UrlTree;
      return result === true;
    });

    expect(allowed).toBe(false);
  });

  /**
   * Suporte teve as duas metades: a rota recusava o motorista porque `/v1/support/**`
   * era 403 para ele; o backend liberou abrir e ler os PROPRIOS tickets, e a rota o
   * admite de novo. O nome deste caso era "... nao do motorista" e dizia o contrario.
   */
  it('/suporte e do dono, do gerente e do motorista', () => {
    expect(chainAllows('/suporte', 'OWNER')).toBe(true);
    expect(chainAllows('/suporte', 'MANAGER')).toBe(true);
    // O motorista voltou: abrir e ler os PROPRIOS tickets e dele.
    expect(chainAllows('/suporte', 'DRIVER')).toBe(true);
  });

  /**
   * A armadilha estrutural: se alguem aninhar a captura DENTRO de `vistorias`,
   * o guard da listagem passa a ser ancestral e o motorista perde a tela sem
   * que nenhum guard proprio tenha mudado. Esta asercao e o que transforma esse
   * refactor silencioso em teste vermelho.
   */
  it('nenhum guard da cadeia da captura nega o motorista', () => {
    sessionStorage.setItem('token', tokenWithRole('DRIVER'));

    const blocking = CAPTURE.flatMap((url) => chainFor(url))
      .filter(({ guard }) => {
        const result = TestBed.runInInjectionContext(() =>
          guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
        ) as boolean | UrlTree;
        return result !== true;
      })
      .map(({ path }) => path);

    expect(blocking, `guards barrando o motorista: ${blocking.join(', ')}`).toEqual([]);
  });

  /** Papel desconhecido nao vira permissao por omissao, nem aqui. */
  it('sem token a captura tambem nega', () => {
    for (const url of CAPTURE) {
      const chain = chainFor(url);
      sessionStorage.clear();
      const allowed = chain.every(({ guard }) => {
        const result = TestBed.runInInjectionContext(() =>
          guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
        ) as boolean | UrlTree;
        return result === true;
      });

      expect(allowed, `sem token entrou em ${url}`).toBe(false);
    }
  });
});
