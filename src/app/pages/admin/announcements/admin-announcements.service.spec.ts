import { HttpContext, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../../environments/environment';
import { OWNED_HTTP_ERRORS } from '../../../services/http-errors.context';
import { AdminAnnouncementsService } from './admin-announcements.service';

const BASE = `${environment.apiUrl}/admin/announcements`;

describe('AdminAnnouncementsService', () => {
  let http: HttpTestingController;
  let service: AdminAnnouncementsService;
  const owned = (context: HttpContext): boolean => context.get(OWNED_HTTP_ERRORS);

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(AdminAnnouncementsService);
  });

  afterEach(() => http.verify());

  it('exclui com DELETE na novidade, id codificado, erro tratado pela tela', () => {
    let done = false;
    service.delete('a 1/x').subscribe(() => (done = true));
    const req = http.expectOne(`${BASE}/a%201%2Fx`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toBeNull();
    expect(owned(req.request.context)).toBe(true);
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBe(true);
  });
});
