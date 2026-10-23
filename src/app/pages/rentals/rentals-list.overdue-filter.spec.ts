import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RentalsList } from './rentals-list';
import { RentalService } from './rental.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { NotificationService } from '../../services/notification.service';

/**
 * O destino do alerta «Cobranças em atraso» do dashboard: `/alugueis?emAtraso=true`
 * pede ao backend só os aluguéis com cobrança vencida, mostra o chip que diz isso e
 * o chip remove o filtro.
 */
describe('RentalsList — filtro «com cobrança em atraso»', () => {
  let list: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    list = vi.fn().mockReturnValue(of({ content: [], totalElements: 0 }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'alugueis', component: RentalsList }]),
        provideNoopAnimations(),
        {
          provide: RentalService,
          useValue: {
            items: signal([]),
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(0),
            list,
          },
        },
        {
          provide: VehiclesService,
          useValue: { list: vi.fn().mockReturnValue(of({ content: [] })) },
        },
        { provide: DriverService, useValue: { list: vi.fn().mockReturnValue(of({ content: [] })) } },
        { provide: NotificationService, useValue: { push: vi.fn(), success: vi.fn() } },
      ],
    });
  });

  it('com ?emAtraso=true pede só os aluguéis em atraso e mostra o chip', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/alugueis?emAtraso=true', RentalsList);
    harness.detectChanges();

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ overdueCharges: true }));
    const chip = (harness.routeNativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-overdue-filter]',
    );
    expect(chip).not.toBeNull();
    expect(chip!.className).toContain('min-h-11');
  });

  it('sem o parâmetro, não filtra e não mostra o chip', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/alugueis', RentalsList);
    harness.detectChanges();

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ overdueCharges: undefined }));
    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('[data-overdue-filter]'),
    ).toBeNull();
  });

  it('o chip remove o filtro e recarrega a lista inteira', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/alugueis?emAtraso=true', RentalsList);
    harness.detectChanges();
    list.mockClear();

    (harness.routeNativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-overdue-filter]')!
      .click();
    harness.detectChanges();

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ overdueCharges: undefined }));
    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('[data-overdue-filter]'),
    ).toBeNull();
  });
});
