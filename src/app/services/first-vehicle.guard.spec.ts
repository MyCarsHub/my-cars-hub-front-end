import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom, isObservable, Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { firstVehicleGuard } from './first-vehicle.guard';
import { FleetActivationService } from './fleet-activation.service';
import { SessionService } from './session.service';
import { environment } from '../../environments/environment';

/**
 * FEAT-0080 — gate de ativação: sem NENHUM veículo, o usuário OWNER/MANAGER é
 * conduzido a /veiculos/novo. O gate é rede de segurança, não muro: exclui as
 * rotas utilitárias, ignora papéis que o roleGuard de /veiculos rejeitaria,
 * respeita o "Pular por enquanto" e falha ABERTO em erro de rede.
 */
describe('firstVehicleGuard (FEAT-0080)', () => {
  const VEHICLES_URL = `${environment.apiUrl}/vehicles`;

  let httpMock: HttpTestingController;
  let session: SessionService;

  function runGuard(url: string): boolean | UrlTree | Observable<boolean | UrlTree> {
    const state = { url } as RouterStateSnapshot;
    return TestBed.runInInjectionContext(
      () =>
        firstVehicleGuard({} as ActivatedRouteSnapshot, state) as
          | boolean
          | UrlTree
          | Observable<boolean | UrlTree>,
    );
  }

  /**
   * Resolve o guard drenando a consulta em DOIS passos do contrato real:
   * `sold` é ternário (ausente = só operacionais, `true` = só vendidos), então
   * o serviço sonda a operacional sempre e a de vendidos SÓ quando a primeira
   * devolve 0 — este helper só flusheia a segunda nesse caso.
   */
  async function resolveWithTotals(
    url: string,
    operationalTotal: number,
    soldTotal = 0,
  ): Promise<boolean | UrlTree> {
    const result = runGuard(url);
    expect(isObservable(result)).toBe(true);
    const promise = firstValueFrom(result as Observable<boolean | UrlTree>);

    const first = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url === VEHICLES_URL && r.params.get('sold') === null,
    );
    expect(first.request.params.get('size')).toBe('1');
    first.flush({ content: [], page: 0, size: 1, total: operationalTotal });

    if (operationalTotal === 0) {
      const second = httpMock.expectOne(
        (r) => r.method === 'GET' && r.url === VEHICLES_URL && r.params.get('sold') === 'true',
      );
      expect(second.request.params.get('size')).toBe('1');
      second.flush({ content: [], page: 0, size: 1, total: soldTotal });
    }
    return promise;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionService);
    sessionStorage.clear();
    session.setItem('selectedRole', 'OWNER');
    session.setItem('selectedCompanyId', 'empresa-a');
  });

  afterEach(() => {
    httpMock.verify();
    sessionStorage.clear();
  });

  it('sem veículo → redireciona para /veiculos/novo?ativacao=1', async () => {
    const result = await resolveWithTotals('/dashboard', 0);

    expect(result).toBeInstanceOf(UrlTree);
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as UrlTree)).toBe('/veiculos/novo?ativacao=1');
  });

  it('com veículo operacional → passa com UMA chamada só (a de vendidos nem sai)', async () => {
    const result = await resolveWithTotals('/dashboard', 3);
    expect(result).toBe(true);
    httpMock.expectNone((r) => r.url === VEHICLES_URL && r.params.get('sold') === 'true');
  });

  it('cacheia a resposta: segunda navegação não custa outro request', async () => {
    await resolveWithTotals('/dashboard', 3);

    const second = runGuard('/alertas');
    const value = isObservable(second)
      ? await firstValueFrom(second as Observable<boolean | UrlTree>)
      : second;
    expect(value).toBe(true);
    httpMock.expectNone((r) => r.url === VEHICLES_URL);
  });

  it.each(['DRIVER', 'VIEWER'])(
    'papel %s (sem permissão em /veiculos) → passa sem request',
    (role) => {
      session.setItem('selectedRole', role);
      expect(runGuard('/dashboard')).toBe(true);
      httpMock.expectNone((r) => r.url === VEHICLES_URL);
    },
  );

  it.each(['/veiculos/novo', '/billing', '/perfil', '/suporte', '/configuracoes/convites'])(
    'rota excluída %s → passa sem request (sem laço com o próprio redirect)',
    (url) => {
      expect(runGuard(url)).toBe(true);
      httpMock.expectNone((r) => r.url === VEHICLES_URL);
    },
  );

  it('a exclusão respeita fronteira de segmento: /perfil-publico NÃO fica isento', async () => {
    // Prefixo `/perfil` casa `/perfil` e `/perfil/foo`, nunca `/perfil-publico`
    // — startsWith cru isentaria a rota futura em silêncio.
    const result = await resolveWithTotals('/perfil-publico', 0, 0);
    expect(result).toBeInstanceOf(UrlTree);
  });

  it('exclusão vale com query string: /veiculos/novo?ativacao=1 passa sem request', () => {
    expect(runGuard('/veiculos/novo?ativacao=1')).toBe(true);
    httpMock.expectNone((r) => r.url === VEHICLES_URL);
  });

  it('depois de "Pular por enquanto" → passa sem request', () => {
    TestBed.inject(FleetActivationService).skip();
    expect(runGuard('/dashboard')).toBe(true);
    httpMock.expectNone((r) => r.url === VEHICLES_URL);
  });

  it('frota inteiramente vendida → segunda sonda (sold=true) responde e o gate NÃO dispara', async () => {
    // Operacional vazia (0) dispara a sonda de vendidos; vendidos>0 = empresa
    // que já teve carro, nunca vê o gate. Decidível de verdade: os dois flushes
    // vêm de requisições distintas afirmadas pelos params.
    const result = await resolveWithTotals('/dashboard', 0, 1);
    expect(result).toBe(true);
  });

  it('operacional=0 e vendidos=0 → gate dispara', async () => {
    const result = await resolveWithTotals('/dashboard', 0, 0);
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      '/veiculos/novo?ativacao=1',
    );
  });

  it('falha na SEGUNDA sonda (vendidos) → falha ABERTO', async () => {
    const result = runGuard('/dashboard');
    const promise = firstValueFrom(result as Observable<boolean | UrlTree>);

    httpMock
      .expectOne((r) => r.url === VEHICLES_URL && r.params.get('sold') === null)
      .flush({ content: [], page: 0, size: 1, total: 0 });
    httpMock
      .expectOne((r) => r.url === VEHICLES_URL && r.params.get('sold') === 'true')
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect(await promise).toBe(true);
  });

  it('troca de empresa A→B→A derruba o cache nos DOIS sentidos', async () => {
    // Empresa A tem frota: passa e cacheia.
    expect(await resolveWithTotals('/dashboard', 3)).toBe(true);

    // Troca para B (LayoutStore.commitTenant regrava a chave SEM clear()):
    // o cache de A não pode valer — B está vazia e recebe o gate.
    session.setItem('selectedCompanyId', 'empresa-b');
    const gated = await resolveWithTotals('/dashboard', 0);
    expect(gated).toBeInstanceOf(UrlTree);

    // Volta para A: o cache agora era de B — nova consulta, e A passa.
    session.setItem('selectedCompanyId', 'empresa-a');
    expect(await resolveWithTotals('/dashboard', 3)).toBe(true);
  });

  it('o pulo é POR EMPRESA: pular na A não libera a B', async () => {
    TestBed.inject(FleetActivationService).skip();
    expect(runGuard('/dashboard')).toBe(true);
    httpMock.expectNone((r) => r.url === VEHICLES_URL);

    session.setItem('selectedCompanyId', 'empresa-b');
    const result = await resolveWithTotals('/dashboard', 0);
    expect(result).toBeInstanceOf(UrlTree);
  });

  it('erro do backend → falha ABERTO (gate é growth, não segurança)', async () => {
    const result = runGuard('/dashboard');
    const promise = firstValueFrom(result as Observable<boolean | UrlTree>);
    httpMock
      .expectOne((r) => r.url === VEHICLES_URL)
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect(await promise).toBe(true);
  });

  it('`markHasVehicles` (POST de criação) vira o cache: gate para de interceptar', async () => {
    TestBed.inject(FleetActivationService).markHasVehicles();

    const result = runGuard('/dashboard');
    const value = isObservable(result)
      ? await firstValueFrom(result as Observable<boolean | UrlTree>)
      : result;
    expect(value).toBe(true);
    httpMock.expectNone((r) => r.url === VEHICLES_URL);
  });
});
