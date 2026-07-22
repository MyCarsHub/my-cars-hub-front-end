import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { RentalService } from './rental.service';
import { environment } from '../../../environments/environment';

/**
 * Focused unit tests for the shared per-rental snapshot cache introduced with
 * the checklist/contract-card/inspection-card unification. HTTP is mocked at
 * the {@link HttpClient} boundary to keep the test single-purpose.
 */
describe('RentalService shared rentalState', () => {
  const RID = 'rental-1';
  let httpGet: ReturnType<typeof vi.fn>;
  let service: RentalService;

  beforeEach(() => {
    httpGet = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        RentalService,
        { provide: HttpClient, useValue: { get: httpGet, post: vi.fn(), delete: vi.fn(), put: vi.fn() } },
      ],
    });
    service = TestBed.inject(RentalService);
  });

  function mockRoutes(routes: Record<string, unknown>): void {
    httpGet.mockImplementation((url: string) => of(routes[url] ?? []));
  }

  it('starts null and populates after loadRentalState — documents + both photo kinds + signature', () => {
    mockRoutes({
      [`http://localhost:8085/v1/rentals/${RID}/documents`]: [
        { kind: 'CONTRACT', id: 'd1' },
      ],
      [`http://localhost:8085/v1/rentals/${RID}/photos`]: [], // both kinds share this URL — see next test
      [`http://localhost:8085/v1/rentals/${RID}/contract/signature`]: {
        documentId: 'd1',
        status: 'SIGNED',
        provider: 'AUTENTIQUE',
        externalDocumentId: 'x',
        signedAt: null,
      },
    });

    const view = service.rentalState(RID);
    expect(view()).toBeNull();

    service.loadRentalState(RID);
    const snap = view();
    expect(snap).not.toBeNull();
    expect(snap!.documents).toHaveLength(1);
    expect(snap!.contractSignature?.status).toBe('SIGNED');
  });

  it('skips signature fetch when there is no CONTRACT doc', () => {
    mockRoutes({
      [`http://localhost:8085/v1/rentals/${RID}/documents`]: [],
    });

    service.loadRentalState(RID);
    const snap = service.rentalState(RID)();
    expect(snap).not.toBeNull();
    expect(snap!.contractSignature).toBeNull();
    // no call to /contract/signature
    const signatureCalls = httpGet.mock.calls.filter((c) => String(c[0]).endsWith('/contract/signature'));
    expect(signatureCalls).toHaveLength(0);
  });

  it('refreshRentalState triggers a fresh fetch (bypasses in-flight guard)', () => {
    mockRoutes({
      [`http://localhost:8085/v1/rentals/${RID}/documents`]: [],
    });
    service.loadRentalState(RID);
    const firstCallCount = httpGet.mock.calls.length;
    service.refreshRentalState(RID);
    expect(httpGet.mock.calls.length).toBeGreaterThan(firstCallCount);
  });

  it('refreshContractSignature updates only the signature slice', () => {
    let signaturePayload = {
      documentId: 'd1',
      status: 'PENDING',
      provider: 'AUTENTIQUE',
      externalDocumentId: 'x',
      signedAt: null,
    };
    httpGet.mockImplementation((url: string) => {
      if (url.endsWith('/documents')) return of([{ kind: 'CONTRACT', id: 'd1' }]);
      if (url.endsWith('/contract/signature')) return of(signaturePayload);
      return of([]);
    });

    service.loadRentalState(RID);
    expect(service.rentalState(RID)()!.contractSignature?.status).toBe('PENDING');

    signaturePayload = { ...signaturePayload, status: 'SIGNED' };
    service.refreshContractSignature(RID);
    expect(service.rentalState(RID)()!.contractSignature?.status).toBe('SIGNED');
    // Documents/photos endpoints should NOT be re-hit by refreshContractSignature.
    const docsCalls = httpGet.mock.calls.filter((c) => String(c[0]).endsWith('/documents')).length;
    expect(docsCalls).toBe(1);
  });

  it('preserves previous contractSignature when signature fetch errors on refresh', () => {
    // Primeiro load: PENDING resolvido normalmente.
    httpGet.mockImplementation((url: string) => {
      if (url.endsWith('/documents')) return of([{ kind: 'CONTRACT', id: 'd1' }]);
      if (url.endsWith('/contract/signature'))
        return of({
          documentId: 'd1',
          status: 'PENDING',
          provider: 'AUTENTIQUE',
          externalDocumentId: 'x',
          signedAt: null,
        });
      return of([]);
    });
    service.loadRentalState(RID);
    expect(service.rentalState(RID)()!.contractSignature?.status).toBe('PENDING');

    // Segundo load (via refreshRentalState): signature endpoint falha — deve manter PENDING.
    httpGet.mockImplementation((url: string) => {
      if (url.endsWith('/documents')) return of([{ kind: 'CONTRACT', id: 'd1' }]);
      if (url.endsWith('/contract/signature')) return throwError(() => new Error('network'));
      return of([]);
    });
    service.refreshRentalState(RID);
    expect(service.rentalState(RID)()!.contractSignature?.status).toBe('PENDING');
  });

  it('same rentalId returns the same signal instance across calls', () => {
    const a = service.rentalState(RID);
    const b = service.rentalState(RID);
    expect(a).toBe(b);
  });
});

describe('RentalService.createCaucaoCharge', () => {
  it('POSTs to /v1/rentals/{id}/caucao-charge with empty body', () => {
    const httpPost = vi.fn().mockReturnValue(of({ id: 'ch-1', kind: 'CAUCAO' }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        RentalService,
        {
          provide: HttpClient,
          useValue: { get: vi.fn(), post: httpPost, delete: vi.fn(), put: vi.fn() },
        },
      ],
    });
    const service = TestBed.inject(RentalService);
    service.createCaucaoCharge('rid-42').subscribe();
    expect(httpPost).toHaveBeenCalledWith(
      `${environment.apiUrl}/rentals/rid-42/caucao-charge`,
      {},
    );
  });
});
