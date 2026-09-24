import { ChangeDetectionStrategy, Component, Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Route,
  RouterStateSnapshot,
  Routes,
  provideRouter,
} from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Sidebar } from '../../components/sidebar/sidebar';
import { LayoutStore } from '../../components/core/layouts/layout.store';
import { InspectionsService } from '../../services/inspections.service';
import { VehiclesService } from '../../services/vehicles.service';
import { ApiErrorService } from '../../services/api-error.service';
import { routes as APP_ROUTES } from '../../app.routes';
import type { InspectionListItem } from '../../types/inspection.types';

/**
 * FEAT-0142 — o PERCURSO INTEIRO: menu -> rota -> tela com LISTA.
 *
 * Até o endpoint entrar em produção, cada pedaço deste caminho existia sem o
 * vizinho: o item de menu sem rota alcançável, a rota sem contrato que
 * respondesse, a tela sem quem a abrisse. Este é o primeiro momento em que o
 * caminho existe de ponta a ponta, e é o que se afirma aqui.
 *
 * >>> O percurso é SEGUIDO, não redigitado. <<< A rota sai do ITEM DE MENU, o
 * componente sai do `loadComponent` da ROTA, e é esse componente que é
 * renderizado. Nenhuma das três pontas é nomeada por mim no meio do caminho —
 * se alguém trocar a rota do item ou o componente da rota, o teste perde o fio
 * e cai, em vez de continuar verde afirmando três fatos soltos.
 *
 * O que este arquivo NÃO prova, e é honesto dizer: a resposta de verdade do
 * `GET /v1/inspections`. O serviço aqui é dublê. Se o formato do backend
 * divergir do dublê, este teste passa e a tela quebra — essa perna só fecha
 * abrindo `/vistorias` contra um backend real.
 */
describe('Vistorias — menu -> rota -> lista', () => {
  @Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
  class StubPage {}

  /*
   * Este fixture tem EXATAMENTE os campos que `InspectionListItem` declara, e
   * isso e deliberado: `rentalCode`, `documentId` e `documentSignedUrl` saíram
   * do tipo porque nao ha fonte para eles no banco — nao ha coluna de codigo de
   * aluguel e nao ha tabela de documento de vistoria. A justificativa completa
   * mora em `types/inspection.types.ts`.
   *
   * Eles estavam aqui porque esta branch bifurcou ANTES da remocao. O merge com
   * develop e LIMPO e mesmo assim nao compilava: merge sem conflito e compilacao
   * sao perguntas diferentes.
   */
  const ITEM: InspectionListItem = {
    id: 'insp-1',
    rentalId: 'rent-1',
    vehicleId: 'veh-1',
    vehiclePlate: 'ABC1D23',
    vehicleBrand: 'Fiat',
    vehicleModel: 'Argo',
    driverName: 'Fulano de Tal',
    kind: 'CHECKIN',
    performedAt: '2026-09-10T12:00:00Z',
    photoCount: 14,
  };

  function signInAs(role: string): void {
    const payload = { role, exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    sessionStorage.setItem('token', `header.${b64}.signature`);
  }

  function flatten(list: Routes, prefix: string, into: Map<string, Route>): Map<string, Route> {
    for (const route of list as Route[]) {
      const segment = route.path ?? '';
      const full = segment ? `${prefix}/${segment}` : prefix;
      if (segment) into.set(full, route);
      if (route.children) flatten(route.children, full, into);
    }
    return into;
  }
  const ROUTE_BY_PATH = flatten(APP_ROUTES, '', new Map());

  /** PERNA 1 — a rota que o ITEM DE MENU aponta, para o papel dado. */
  function routeFromMenu(role: string): string | undefined {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    signInAs(role);
    TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [provideRouter([{ path: '**', component: StubPage }]), provideNoopAnimations()],
    });
    TestBed.inject(LayoutStore).selectedTenant.set({ id: 't', name: 'X', role, initial: 'X' });
    const fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();
    const nav = (
      fixture.componentInstance as unknown as {
        navItems: () => { label: string; children?: { route?: string; label?: string }[] }[];
      }
    ).navItems();
    const frota = nav.find((i) => i.label === 'Frota');
    return (frota?.children ?? []).find((c) => c.label === 'Vistorias')?.route;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });

  afterEach(() => sessionStorage.clear());

  it('o caminho inteiro chega numa LISTA, e não numa mensagem de erro', async () => {
    // ---- PERNA 1: o menu aponta uma rota -----------------------------------
    const path = routeFromMenu('OWNER');
    expect(path).toBe('/vistorias');

    // ---- PERNA 2: a rota existe, admite o papel, e carrega um componente ----
    const route = ROUTE_BY_PATH.get(path!);
    expect(route).toBeDefined();

    signInAs('OWNER');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: StubPage }])],
    });
    const admitted = TestBed.runInInjectionContext(() =>
      ((route!.canActivate ?? []) as CanActivateFn[]).every(
        (guard) =>
          guard(
            {} as unknown as ActivatedRouteSnapshot,
            {} as unknown as RouterStateSnapshot,
          ) === true,
      ),
    );
    expect(admitted).toBe(true);

    // O componente vem do `loadComponent` DA ROTA — não é nomeado aqui.
    expect(route!.loadComponent).toBeDefined();
    const loaded = (await route!.loadComponent!()) as Type<unknown>;

    // ---- PERNA 3: esse componente, SEM FILTRO, renderiza a lista -----------
    const listSpy = vi
      .fn()
      .mockReturnValue(of({ content: [ITEM], page: 0, size: 20, total: 1 }));

    TestBed.resetTestingModule();
    signInAs('OWNER');
    TestBed.configureTestingModule({
      imports: [loaded],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: InspectionsService,
          useValue: {
            items: signal<InspectionListItem[]>([ITEM]),
            total: signal(1),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            loading: signal(false),
            list: listSpy,
          },
        },
        {
          provide: VehiclesService,
          useValue: {
            list: vi
              .fn()
              .mockReturnValue(of({ content: [], page: 0, size: 500, total: 0 })),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(loaded);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    // A tela abriu LISTANDO: a linha da vistoria está no DOM...
    expect(host.textContent).toContain(ITEM.vehiclePlate);
    // ...e nenhum banner de erro apareceu no lugar dela.
    expect(host.querySelector('app-alert-banner')).toBeNull();
    expect(host.textContent).not.toContain('Não foi possível carregar as vistorias.');

    // E o pedido saiu SEM FILTRO — é esse o estado que o item de menu abre, e
    // é o que o backend passou a aceitar em vez de recusar com 400.
    expect(listSpy).toHaveBeenCalledTimes(1);
    const enviado = listSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado['vehicleId']).toBeNull();
    expect(enviado['rentalId']).toBeNull();
    expect(enviado['kind']).toBeNull();
    expect(enviado['from']).toBeNull();
    expect(enviado['to']).toBeNull();
  });

  it('o MANAGER percorre o mesmo caminho', () => {
    expect(routeFromMenu('MANAGER')).toBe('/vistorias');
  });

  it('o DRIVER não recebe o item, e o guard da rota também o recusa', () => {
    expect(routeFromMenu('DRIVER')).toBeUndefined();

    signInAs('DRIVER');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: StubPage }])],
    });
    const route = ROUTE_BY_PATH.get('/vistorias')!;
    const admitted = TestBed.runInInjectionContext(() =>
      ((route.canActivate ?? []) as CanActivateFn[]).every(
        (guard) =>
          guard(
            {} as unknown as ActivatedRouteSnapshot,
            {} as unknown as RouterStateSnapshot,
          ) === true,
      ),
    );
    // As duas pontas concordam: nem menu, nem rota.
    expect(admitted).toBe(false);
  });
});
