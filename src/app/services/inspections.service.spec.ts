import { HttpClient, HttpParams } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectionsService } from './inspections.service';
import { environment } from '../../environments/environment';
import type { PagedResponse } from '../types/paged.types';
import type { InspectionListItem } from '../types/inspection.types';

const EMPTY: PagedResponse<InspectionListItem> = { content: [], page: 0, size: 20, total: 0 };

/**
 * `toParams` é a tradução filtro → query string, e era o único ponto do fluxo
 * sem teste nenhum: a spec da página troca o `InspectionsService` inteiro por um
 * `vi.fn`, então nada exercitava o que de fato viaja na URL. Dublar justamente o
 * tradutor que se quer verificar é o arranjo que já escondeu defeito nesta
 * semana — aqui o serviço é o REAL e só o `HttpClient` é dublado.
 *
 * Os parâmetros são lidos do `HttpParams` entregue ao `http.get`, que é o objeto
 * que o Angular serializa. Afirmar o objeto de filtros de entrada não provaria
 * nada sobre a requisição.
 */
describe('InspectionsService.toParams', () => {
  let get: ReturnType<typeof vi.fn>;
  let service: InspectionsService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    get = vi.fn(() => of(EMPTY));

    TestBed.configureTestingModule({
      providers: [InspectionsService, { provide: HttpClient, useValue: { get } }],
    });
    service = TestBed.inject(InspectionsService);
  });

  const url = (): string => get.mock.calls.at(-1)?.[0] as string;
  const params = (): HttpParams =>
    (get.mock.calls.at(-1)?.[1] as { params: HttpParams }).params;

  it('chama GET /v1/inspections', () => {
    service.list().subscribe();
    expect(url()).toBe(`${environment.apiUrl}/inspections`);
  });

  it('sempre manda page e size, com o padrão 0 e 20', () => {
    service.list().subscribe();
    expect(params().get('page')).toBe('0');
    expect(params().get('size')).toBe('20');
  });

  it('respeita page e size quando a tela escolhe', () => {
    service.list({ page: 3, size: 50 }).subscribe();
    expect(params().get('page')).toBe('3');
    expect(params().get('size')).toBe('50');
  });

  /**
   * O contrato que a tela precisa: os cinco filtros são opcionais e valem AO
   * MESMO TEMPO. Um filtro que anulasse os outros seria pior que não existir.
   */
  it('leva os cinco filtros juntos na mesma query', () => {
    service
      .list({
        vehicleId: 'veh-1',
        rentalId: 'rent-1',
        kind: 'CHECKOUT',
        from: '2026-09-01',
        to: '2026-09-30',
      })
      .subscribe();

    expect(params().get('vehicleId')).toBe('veh-1');
    expect(params().get('rentalId')).toBe('rent-1');
    expect(params().get('kind')).toBe('CHECKOUT');
    expect(params().get('from')).toBe('2026-09-01');
    expect(params().get('to')).toBe('2026-09-30');
  });

  it('manda um filtro sozinho sem arrastar os outros', () => {
    service.list({ kind: 'CHECKIN' }).subscribe();

    expect(params().get('kind')).toBe('CHECKIN');
    expect(params().has('vehicleId')).toBe(false);
    expect(params().has('rentalId')).toBe(false);
    expect(params().has('from')).toBe(false);
    expect(params().has('to')).toBe(false);
  });

  /**
   * Filtro vazio tem de ficar AUSENTE, não virar `?vehicleId=`: string vazia na
   * query é ambígua no servidor (dá para ler como "vazio" em vez de "não
   * informado") e suja a URL que o usuário compartilha. `null`, `undefined` e
   * `''` são as três formas que chegam da tela — o `select` devolve `''` quando
   * volta para "Todos", e é por isso que as três estão aqui.
   */
  it('omite a chave para null, undefined e string vazia', () => {
    service
      .list({ vehicleId: '', rentalId: null, kind: undefined, from: '', to: null })
      .subscribe();

    for (const key of ['vehicleId', 'rentalId', 'kind', 'from', 'to']) {
      expect(params().has(key)).toBe(false);
    }
    // CONTROLE POSITIVO: se a montagem não produzisse parâmetro nenhum, as cinco
    // afirmações acima passariam a vazio e não diriam nada.
    expect(params().get('page')).toBe('0');
    expect(params().get('size')).toBe('20');
  });

  it('a página seguinte preserva os filtros ativos', () => {
    service.list({ vehicleId: 'veh-1', kind: 'FLEET', page: 2 }).subscribe();

    expect(params().get('page')).toBe('2');
    expect(params().get('vehicleId')).toBe('veh-1');
    expect(params().get('kind')).toBe('FLEET');
  });
});
