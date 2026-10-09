import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it } from 'vitest';

import { DriverDetail } from './driver-detail';
import { DriversList } from './drivers-list';
import { environment } from '../../../environments/environment';

const DRIVERS = `${environment.apiUrl}/drivers`;

describe('Cadastro pendente chip', () => {
  let harness: RouterTestingHarness;
  let backend: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'motoristas/:id', component: DriverDetail },
          { path: 'motoristas', component: DriversList },
        ]),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    harness = await RouterTestingHarness.create();
  });

  const dom = () => harness.fixture.nativeElement as HTMLElement;
  const chips = () => dom().querySelectorAll('[data-testid="registration-pending-chip"]');

  async function settle(): Promise<void> {
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  const listItem = (id: string, registrationStatus?: string) => ({
    id,
    name: `Motorista ${id}`,
    email: `${id}@example.com`,
    phone: null,
    licenseNumber: registrationStatus === 'PENDING_ONBOARDING' ? null : '12345678900',
    licenseCategory: registrationStatus === 'PENDING_ONBOARDING' ? null : 'B',
    licenseExpiry: registrationStatus === 'PENDING_ONBOARDING' ? null : '2030-01-01',
    status: 'AVAILABLE',
    ...(registrationStatus ? { registrationStatus } : {}),
  });

  it('the list marks only PENDING_ONBOARDING drivers (mobile card and desktop row) and tolerates a null CNH', async () => {
    await router.navigateByUrl('/motoristas');
    harness.detectChanges();
    backend
      .match((r) => r.url === DRIVERS && r.method === 'GET')
      .forEach((r) =>
        r.flush({
          content: [listItem('a', 'PENDING_ONBOARDING'), listItem('b', 'COMPLETE'), listItem('c')],
          page: 0,
          size: 20,
          total: 3,
        }),
      );
    await settle();
    // one pending driver, rendered twice (cards + table); the other two never get the chip
    expect(chips().length).toBe(2);
    expect(dom().textContent).toContain('Cadastro pendente');
  });

  const detail = (registrationStatus?: string) => ({
    id: 'd1',
    name: 'João da Silva',
    contact: { email: 'joao@example.com', phone: '11987654321' },
    document: { type: 'CPF', value: '52998224725' },
    status: 'AVAILABLE',
    thirdPartyContacts: [],
    ...(registrationStatus === 'PENDING_ONBOARDING'
      ? { address: null, licenseNumber: null, licenseCategory: null, licenseExpiry: null }
      : {
          address: {
            street: 'Rua A',
            number: '1',
            complement: null,
            district: 'Centro',
            cep: '01001000',
            city: 'SP',
            uf: 'SP',
          },
          licenseNumber: 'ABC12345678',
          licenseCategory: 'B',
          licenseExpiry: '2099-01-01',
        }),
    ...(registrationStatus ? { registrationStatus } : {}),
  });

  it('the detail shows the chip and "aguardando" placeholders instead of crashing on a null address/CNH', async () => {
    await router.navigateByUrl('/motoristas/d1');
    harness.detectChanges();
    backend.match((r) => r.url === `${DRIVERS}/d1`).forEach((r) => r.flush(detail('PENDING_ONBOARDING')));
    await settle();
    expect(chips().length).toBe(1);
    expect(dom().querySelector('[data-testid="address-pending"]')).not.toBeNull();
    expect(dom().querySelector('[data-testid="license-pending"]')).not.toBeNull();
  });

  it('the detail of a COMPLETE driver has no chip and shows the CNH', async () => {
    await router.navigateByUrl('/motoristas/d1');
    harness.detectChanges();
    backend.match((r) => r.url === `${DRIVERS}/d1`).forEach((r) => r.flush(detail('COMPLETE')));
    await settle();
    expect(chips().length).toBe(0);
    expect(dom().textContent).toContain('ABC12345678');
  });
});
