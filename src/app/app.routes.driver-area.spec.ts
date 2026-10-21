import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  CanMatchFn,
  Route,
  Router,
  RouterStateSnapshot,
  UrlSegment,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { routes } from './app.routes';
import { NotificationService } from './services/notification.service';
import { SessionService } from './services/session.service';

/**
 * A area do MOTORISTA na arvore de rotas: o painel dele (`/meu-painel`), a lista de
 * lancamentos, o perfil proprio e o suporte. Os guards sao EXECUTADOS, com um JWT na
 * sessao — nao se confere o array `canActivate` por inspecao.
 */
describe('app.routes — area do motorista', () => {
  const encode = (payload: Record<string, unknown>): string =>
    btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = (role: string | null) =>
    `h.${encode(role ? { role, exp: 4_000_000_000 } : { exp: 4_000_000_000 })}.s`;

  /** O no do pai autenticado e filho `canActivateChild`, onde a area mora. */
  function appChildren(): Route[] {
    const shell = routes.find((r) => r.path === '' && r.children && r.canActivate);
    const inner = shell?.children?.find((c) => c.path === '' && c.children);
    return inner?.children ?? [];
  }

  const find = (path: string): Route[] => appChildren().filter((r) => r.path === path);

  const run = (guard: CanActivateFn, url = '/meu-painel'): boolean | UrlTree =>
    TestBed.runInInjectionContext(
      () =>
        guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot) as boolean | UrlTree,
    );

  const target = (result: boolean | UrlTree): string =>
    TestBed.inject(Router).serializeUrl(result as UrlTree);

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), SessionService, NotificationService],
    });
  });

  afterEach(() => sessionStorage.clear());

  describe('/meu-painel', () => {
    it('existe, e a lista de lancamentos mora debaixo dele', () => {
      const [panel] = find('meu-painel');
      expect(panel, 'a rota meu-painel sumiu da arvore').toBeDefined();
      expect(panel.children?.map((c) => c.path)).toEqual(['', 'lancamentos']);
    });

    it('as duas telas sao carregadas sob demanda', async () => {
      const [panel] = find('meu-painel');
      for (const child of panel.children ?? []) {
        expect(child.component).toBeUndefined();
        expect(typeof child.loadComponent).toBe('function');
      }
      const home = await (panel.children![0].loadComponent as () => Promise<unknown>)();
      const entries = await (panel.children![1].loadComponent as () => Promise<unknown>)();
      expect(home).toBeTruthy();
      expect(entries).toBeTruthy();
    });

    it('so o DRIVER entra', () => {
      const [panel] = find('meu-painel');
      const guard = panel.canActivate![0] as CanActivateFn;

      sessionStorage.setItem('token', token('DRIVER'));
      expect(run(guard)).toBe(true);
    });

    it('dono e gerente que digitam a URL voltam ao painel da frota, com aviso', () => {
      const [panel] = find('meu-painel');
      const guard = panel.canActivate![0] as CanActivateFn;

      for (const role of ['OWNER', 'MANAGER']) {
        TestBed.inject(NotificationService)
          .notifications()
          .forEach((n) => TestBed.inject(NotificationService).dismiss(n.id));
        sessionStorage.setItem('token', token(role));

        const result = run(guard);

        expect(result, `${role} entrou no painel do motorista`).not.toBe(true);
        expect(target(result)).toBe('/dashboard');
      }
      expect(TestBed.inject(NotificationService).notifications()).toHaveLength(1);
    });

    it('sem papel (token sem claim) nao vira permissao', () => {
      const [panel] = find('meu-painel');
      sessionStorage.setItem('token', token(null));

      expect(run(panel.canActivate![0] as CanActivateFn)).not.toBe(true);
    });
  });

  describe('/perfil', () => {
    it('sao duas rotas para a mesma URL, e a do motorista vem PRIMEIRO', () => {
      const profiles = find('perfil');
      expect(profiles).toHaveLength(2);
      expect(profiles[0].canMatch).toHaveLength(1);
      expect(profiles[1].canMatch).toBeUndefined();
    });

    it('a primeira so casa para DRIVER; a segunda e o perfil da empresa', () => {
      const [driver] = find('perfil');
      const match = driver.canMatch![0] as CanMatchFn;
      const decide = () =>
        TestBed.runInInjectionContext(() => match(driver, [] as UrlSegment[]) as boolean);

      sessionStorage.setItem('token', token('DRIVER'));
      expect(decide()).toBe(true);
      sessionStorage.setItem('token', token('OWNER'));
      expect(decide()).toBe(false);
      sessionStorage.setItem('token', token('MANAGER'));
      expect(decide()).toBe(false);
    });

    it('cada uma carrega o seu componente', async () => {
      const [driver, company] = find('perfil');
      const a = (await (driver.loadComponent as () => Promise<unknown>)()) as { name: string };
      const b = (await (company.loadComponent as () => Promise<unknown>)()) as { name: string };

      // O compilador do Angular prefixa o nome da classe com "_" nos componentes standalone.
      expect(a.name).toMatch(/^_?DriverProfile$/);
      expect(b.name).toMatch(/^_?Profile$/);
    });
  });

  describe('/alugueis (FEAT-0361)', () => {
    const rentalChildren = (): Route[] =>
      appChildren().find((r) => r.path === 'alugueis')?.children ?? [];
    const byPath = (path: string) => rentalChildren().filter((r) => r.path === path);
    const decide = (route: Route) =>
      TestBed.runInInjectionContext(
        () => (route.canMatch![0] as CanMatchFn)(route, [] as UrlSegment[]) as boolean,
      );

    it('lista e detalhe tem DUAS rotas cada, e a do motorista vem PRIMEIRO', () => {
      for (const path of ['', ':id']) {
        const [driver, company] = byPath(path);
        expect(driver.canMatch, path).toHaveLength(1);
        expect(company.canMatch, path).toBeUndefined();
      }
    });

    it('"novo" continua antes de ":id" (o motorista nao abre um aluguel chamado "novo")', () => {
      const paths = rentalChildren().map((r) => r.path);
      expect(paths.indexOf('novo')).toBeLessThan(paths.indexOf(':id'));
    });

    it('so o DRIVER casa a do motorista; dono e gerente seguem nas telas da frota', () => {
      for (const path of ['', ':id']) {
        const [driver] = byPath(path);
        sessionStorage.setItem('token', token('DRIVER'));
        expect(decide(driver)).toBe(true);
        for (const role of ['OWNER', 'MANAGER']) {
          sessionStorage.setItem('token', token(role));
          expect(decide(driver), `${role} em ${path}`).toBe(false);
        }
        sessionStorage.setItem('token', token(null));
        expect(decide(driver)).toBe(false);
      }
    });

    it('cada uma carrega o seu componente', async () => {
      const load = async (r: Route) =>
        ((await (r.loadComponent as () => Promise<unknown>)()) as { name: string }).name;
      const [driverList, companyList] = byPath('');
      const [driverDetail, companyDetail] = byPath(':id');

      expect(await load(driverList)).toMatch(/^_?DriverRentalsList$/);
      expect(await load(companyList)).toMatch(/^_?RentalsList$/);
      expect(await load(driverDetail)).toMatch(/^_?DriverRentalDetail$/);
      expect(await load(companyDetail)).toMatch(/^_?RentalDetail$/);
    });
  });

  describe('/suporte', () => {
    it('admite o motorista, o dono e o gerente', () => {
      const [support] = find('suporte');
      const guard = support.canActivate![0] as CanActivateFn;

      for (const role of ['DRIVER', 'OWNER', 'MANAGER']) {
        sessionStorage.setItem('token', token(role));
        expect(run(guard, '/suporte'), `${role} barrado em /suporte`).toBe(true);
      }
    });
  });

  describe('a raiz autenticada', () => {
    const redirect = (): string => {
      const [root] = appChildren().filter((r) => r.path === '' && r.redirectTo !== undefined);
      expect(typeof root.redirectTo).toBe('function');
      return TestBed.runInInjectionContext(
        () => (root.redirectTo as (r: ActivatedRouteSnapshot) => string)({} as ActivatedRouteSnapshot),
      );
    };

    it('manda o motorista para a casa dele, nao para um /dashboard que o desviaria', () => {
      sessionStorage.setItem('token', token('DRIVER'));
      expect(redirect()).toBe('/meu-painel');
    });

    it('dono e gerente seguem para o dashboard', () => {
      sessionStorage.setItem('token', token('OWNER'));
      expect(redirect()).toBe('/dashboard');
      sessionStorage.setItem('token', token('MANAGER'));
      expect(redirect()).toBe('/dashboard');
    });

    it('sem token o destino antigo continua valendo', () => {
      expect(redirect()).toBe('/dashboard');
    });
  });
});
