import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../../../environments/environment';
import { ContractBaseService } from './contract-base.service';
import { ContractBase } from './contract-base.types';

const URL_BASE = `${environment.apiUrl}/settings/contract-template/base`;

const BASE: ContractBase = {
  version: 'base-v1',
  draft: true,
  clauses: [
    { id: 'prazo', title: 'Prazo', description: '', fixed: true, defaultOn: true, text: '## DO PRAZO\nx' },
    { id: 'caucao', title: 'Caução', description: 'd', fixed: false, defaultOn: true, text: '## DA CAUÇÃO\ny' },
  ],
};

describe('ContractBaseService', () => {
  let http: HttpTestingController;
  let svc: ContractBaseService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(ContractBaseService);
  });

  afterEach(() => http.verify());

  it('GET /settings/contract-template/base liga o caminho e guarda o texto-base', () => {
    svc.load();
    const req = http.expectOne(URL_BASE);
    expect(req.request.method).toBe('GET');
    req.flush(BASE);
    expect(svc.availability()).toBe('on');
    expect(svc.base()?.version).toBe('base-v1');
    svc.load(); // idempotente
    http.expectNone(URL_BASE);
  });

  it('404 CONTRACT_BASE_DISABLED = flag desligada («Em breve»), não erro', () => {
    svc.load();
    http
      .expectOne(URL_BASE)
      .flush({ code: 'CONTRACT_BASE_DISABLED', message: 'off' }, { status: 404, statusText: 'Not Found' });
    expect(svc.availability()).toBe('off');
  });

  it('404 sem o código, ou 500, é falha de leitura (não esconde o caminho)', () => {
    svc.load();
    http.expectOne(URL_BASE).flush({ code: 'OTHER' }, { status: 404, statusText: 'Not Found' });
    expect(svc.availability()).toBe('error');
    svc.load(true);
    http.expectOne(URL_BASE).flush(null, { status: 500, statusText: 'Server Error' });
    expect(svc.availability()).toBe('error');
  });

  it('POST /base/save leva a versão lida e só os ids das opcionais escolhidas', () => {
    svc.load();
    http.expectOne(URL_BASE).flush(BASE);
    let filename = '';
    svc.save(['caucao']).subscribe((tpl) => (filename = tpl.filename));
    const req = http.expectOne(`${URL_BASE}/save`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ version: 'base-v1', optionalClauseIds: ['caucao'] });
    req.flush({ filename: 'contrato.docx' });
    expect(filename).toBe('contrato.docx');
  });
});
