import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { VehicleForm } from './vehicle-form';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';

/**
 * Pilot for the feedback standard (phase 1):
 * - backend `fieldErrors.plate` renders INLINE under the plate field;
 * - the same message is NOT repeated in the form banner;
 * - no toast fires — the screen claimed the error, so the interceptor safety net stays quiet.
 */
describe('VehicleForm — server field errors', () => {
  let create: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<VehicleForm>>;

  function html(): string {
    return fixture.nativeElement.innerHTML as string;
  }

  function plateError(): HTMLElement | null {
    return fixture.nativeElement.querySelector('#veiculo-plate-error');
  }

  function fillValidForm(): void {
    const form = (
      fixture.componentInstance as unknown as { form: { patchValue: (v: unknown) => void } }
    ).form;
    form.patchValue({
      plate: 'ABC1D23',
      brand: 'Fiat',
      model: 'Mobi',
      yearManufacture: 2022,
      yearModel: 2022,
      hodometer: 1000,
    });
  }

  function submit(): void {
    (fixture.componentInstance as unknown as { submit: () => void }).submit();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    create = vi.fn();
    notifyError = vi.fn();

    await TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: VehiclesService, useValue: { create, getOne: vi.fn(), update: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
        },
        {
          provide: NotificationService,
          useValue: { error: notifyError, warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VehicleForm);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a duplicate-plate 409 under the plate field, not as a banner or toast', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: {
        message: 'Placa já cadastrada para esta empresa.',
        fieldErrors: { plate: 'Placa já cadastrada para esta empresa.' },
      },
    });
    create.mockReturnValue(throwError(() => error));

    fillValidForm();
    submit();

    // (a) inline, under the field, with role=alert and wired to the input
    const inline = plateError();
    expect(inline).not.toBeNull();
    expect(inline?.textContent?.trim()).toBe('Placa já cadastrada para esta empresa.');
    expect(inline?.getAttribute('role')).toBe('alert');

    const input = fixture.nativeElement.querySelector('#veiculo-plate') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('veiculo-plate-error');

    // not duplicated in the form-level banner
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();

    // (c) and never a toast — the safety net must stay quiet
    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('renders a business error with no field in the form banner', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { message: 'Limite de veículos do plano atingido.' },
    });
    create.mockReturnValue(throwError(() => error));

    fillValidForm();
    submit();

    expect(html()).toContain('Limite de veículos do plano atingido.');
    expect(plateError()).toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('clears the stale server error when the user edits the plate', () => {
    create.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'dup', fieldErrors: { plate: 'Placa já cadastrada.' } },
          }),
      ),
    );

    fillValidForm();
    submit();
    expect(plateError()).not.toBeNull();

    const form = (
      fixture.componentInstance as unknown as {
        form: { controls: { plate: { setValue: (v: string) => void } } };
      }
    ).form;
    form.controls.plate.setValue('XYZ9K88');
    fixture.detectChanges();

    expect(plateError()).toBeNull();
  });
});
