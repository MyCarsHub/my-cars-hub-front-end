import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { EMPTY, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { FineDetail } from './fine-detail';
import { FinesService } from '../../services/fines.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { Fine } from '../../types/fine.types';

const FINE: Fine = {
  id: 'fine-1',
  createdDate: '2026-01-01T00:00:00Z',
  modifyDate: null,
  companyId: 'co-1',
  vehicleId: 'veh-1',
  driverId: null,
  infractionCode: null,
  description: 'Excesso de velocidade',
  infractionDate: '2026-01-01T10:00:00',
  location: null,
  amountCents: 19523,
  points: 4,
  severity: 'MEDIA',
  dueDate: '2026-02-01',
  status: 'PENDING',
  paidDate: null,
  notes: null,
};

/**
 * A page-level banner sits BEHIND the `z-50` pay sheet — the failure of "marcar como
 * paga" must therefore render inside the sheet, with the sheet still open.
 */
describe('FineDetail — erro do pagamento dentro do modal', () => {
  let pay: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<FineDetail>>;

  function sheet(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[role="dialog"]');
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    pay = vi.fn();
    notifyError = vi.fn();

    await TestBed.configureTestingModule({
      imports: [FineDetail],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => FINE.id } } } },
        {
          provide: FinesService,
          useValue: { getOne: vi.fn().mockReturnValue(of(FINE)), pay, remove: vi.fn() },
        },
        { provide: VehiclesService, useValue: { getOne: vi.fn().mockReturnValue(EMPTY) } },
        { provide: DriverService, useValue: { getOne: vi.fn().mockReturnValue(EMPTY) } },
        {
          provide: NotificationService,
          useValue: { error: notifyError, warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FineDetail);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renderiza o erro DENTRO do sheet aberto, e não como toast', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { message: 'Multa cancelada não pode ser paga.' },
    });
    pay.mockReturnValue(throwError(() => error));

    const component = fixture.componentInstance as unknown as {
      openPay: () => void;
      confirmPay: () => void;
    };
    component.openPay();
    fixture.detectChanges();
    expect(sheet()).not.toBeNull();

    component.confirmPay();
    fixture.detectChanges();

    const dialog = sheet();
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('app-alert-banner')).not.toBeNull();
    expect(dialog?.textContent).toContain('Multa cancelada não pode ser paga.');

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
