import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { DriverProfileService } from './driver-profile.service';

const PROFILE = `${environment.apiUrl}/driver/profile`;

describe('DriverProfileService', () => {
  let service: DriverProfileService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DriverProfileService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lê o próprio cadastro, sem id na URL', () => {
    let name = '';
    service.get().subscribe((p) => (name = p.name));

    const req = http.expectOne(PROFILE);
    expect(req.request.method).toBe('GET');
    req.flush({ name: 'Carlos', documentType: 'CPF', documentMasked: '***.456.789-**' });
    expect(name).toBe('Carlos');
  });

  it('grava só telefone e endereço, com PUT', () => {
    service
      .update({
        phone: '11987654321',
        address: {
          street: 'Rua A',
          number: null,
          complement: null,
          district: 'Centro',
          cep: '01001-000',
          city: 'São Paulo',
          uf: 'SP',
        },
      })
      .subscribe();

    const req = http.expectOne(PROFILE);
    expect(req.request.method).toBe('PUT');
    expect(Object.keys(req.request.body as object).sort()).toEqual(['address', 'phone']);
    req.flush({ name: 'Carlos' });
  });
});
