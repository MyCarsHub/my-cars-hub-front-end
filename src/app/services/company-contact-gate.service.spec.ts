import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoticesService } from '../components/notices/notices.service';
import { environment } from '../../environments/environment';
import {
  COMPANY_CONTACT_INCOMPLETE_CODE,
  CompanyContactGate,
  isCompanyContactIncomplete,
} from './company-contact-gate.service';
import { SessionService } from './session.service';

describe('CompanyContactGate', () => {
  let gate: CompanyContactGate;
  let http: HttpTestingController;
  let notices: NoticesService;
  let role: string | null;
  const url = `${environment.apiUrl}/companies/me/contact-readiness`;

  beforeEach(() => {
    role = 'OWNER';
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SessionService, useValue: { getCompanyRoleFromToken: () => role } },
      ],
    });
    gate = TestBed.inject(CompanyContactGate);
    http = TestBed.inject(HttpTestingController);
    notices = TestBed.inject(NoticesService);
  });

  it('lets the rental proceed when the contact is complete (no notice)', () => {
    const results: boolean[] = [];
    gate.ensureComplete().subscribe((ok) => results.push(ok));
    http.expectOne(url).flush({ complete: true, missing: [], fillPath: '/configuracoes/contato' });
    expect(results).toEqual([true]);
    expect(notices.current()).toBeNull();
  });

  it('queues the contact notice with what is missing, and proceeds once resolved', () => {
    const results: boolean[] = [];
    gate.ensureComplete().subscribe((ok) => results.push(ok));
    http.expectOne(url).flush({
      complete: false,
      missing: [{ field: 'phone', label: 'telefone' }, { field: 'addressCep', label: 'CEP' }],
      fillPath: '/configuracoes/contato',
    });
    const n = notices.current();
    expect(n?.items).toEqual(['telefone', 'CEP']);
    expect(n?.form).toBe('company-contact');
    expect(n?.link?.route).toBe('/configuracoes/contato');
    notices.resolve(n!.id);
    expect(results).toEqual([true]);
  });

  it('after a server refusal the notice opens even when the pre-check fails (network error)', () => {
    const results: boolean[] = [];
    gate.promptAfterServerRefusal().subscribe((ok) => results.push(ok));
    http.expectOne(url).flush(null, { status: 503, statusText: 'down' });
    const n = notices.current();
    expect(n?.form).toBe('company-contact');
    expect(n?.items).toEqual([]);
    notices.resolve(n!.id);
    expect(results).toEqual([true]);
  });

  it('after a server refusal the notice opens even when the pre-check says complete', () => {
    gate.promptAfterServerRefusal().subscribe();
    http.expectOne(url).flush({ complete: true, missing: [], fillPath: '' });
    expect(notices.current()?.form).toBe('company-contact');
  });

  it('a failed pre-check alone fails open (the backend stays the authoritative gate)', () => {
    const results: boolean[] = [];
    gate.ensureComplete().subscribe((ok) => results.push(ok));
    http.expectOne(url).flush(null, { status: 503, statusText: 'down' });
    expect(results).toEqual([true]);
    expect(notices.current()).toBeNull();
  });

  it('does not proceed when the user leaves the notice', () => {
    const results: boolean[] = [];
    gate.ensureComplete().subscribe((ok) => results.push(ok));
    http.expectOne(url).flush({ complete: false, missing: [{ field: 'phone', label: 'telefone' }], fillPath: '' });
    notices.dismiss(notices.current()!.id);
    expect(results).toEqual([false]);
  });

  it('gives a role that cannot save the contact (driver) the ask-the-owner copy and NO form', () => {
    role = 'DRIVER';
    expect(gate.canFillContact()).toBe(false);
    const n = gate.noticeFor({ complete: false, missing: [{ field: 'phone', label: 'telefone' }], fillPath: '' });
    expect(n.form).toBeUndefined();
    expect(n.link).toBeUndefined();
    expect(n.message).toContain('proprietário');
  });

  it('the manager can fill the contact: form offered with the signer read-only', () => {
    role = 'MANAGER';
    expect(gate.canFillContact()).toBe(true);
    expect(gate.canEditSigner()).toBe(false);
    const n = gate.noticeFor({ complete: false, missing: [{ field: 'phone', label: 'telefone' }], fillPath: '' });
    expect(n.form).toBe('company-contact');
    expect(n.signerReadOnly).toBe(true);
  });

  it('the manager with the signer missing gets the ask-the-owner-to-fill-the-signer message, no form', () => {
    role = 'MANAGER';
    const n = gate.noticeFor({
      complete: false,
      missing: [{ field: 'phone', label: 'telefone' }, { field: 'representativeName', label: 'nome do representante' }],
      fillPath: '',
    });
    expect(n.form).toBeUndefined();
    expect(n.link).toBeUndefined();
    expect(n.title).toContain('quem assina');
    expect(n.message).toContain('Peça ao proprietário');
  });

  it('the owner gets the form with the signer editable', () => {
    role = 'OWNER';
    expect(gate.canFillContact()).toBe(true);
    expect(gate.canEditSigner()).toBe(true);
    const n = gate.noticeFor({
      complete: false,
      missing: [{ field: 'representativeName', label: 'nome do representante' }],
      fillPath: '',
    });
    expect(n.form).toBe('company-contact');
    expect(n.signerReadOnly).toBe(false);
  });

  it('a failed pre-check does not block (the server refuses with the code and the fallback takes over)', () => {
    const results: boolean[] = [];
    gate.ensureComplete().subscribe((ok) => results.push(ok));
    http.expectOne(url).flush('boom', { status: 500, statusText: 'err' });
    expect(results).toEqual([true]);
  });

  it('recognises the stable server refusal code', () => {
    const err = (status: number, code: string) =>
      new HttpErrorResponse({ status, error: { code, message: 'x' } });
    expect(isCompanyContactIncomplete(err(400, COMPANY_CONTACT_INCOMPLETE_CODE))).toBe(true);
    expect(isCompanyContactIncomplete(err(400, 'OTHER'))).toBe(false);
    expect(isCompanyContactIncomplete(err(409, COMPANY_CONTACT_INCOMPLETE_CODE))).toBe(false);
    expect(isCompanyContactIncomplete(new Error('x'))).toBe(false);
    void vi;
  });
});
