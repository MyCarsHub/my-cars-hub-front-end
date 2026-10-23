import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverRentalChargesService } from '../../../services/driver-rental-charges.service';
import { DriverCharge } from '../../../types/driver-charges.types';
import { DriverOverdueNotice } from './driver-overdue-notice';
import { DRIVER_RENTAL_TODAY } from './driver-rental-view';

const TODAY = '2026-10-10';

const charge = (over: Partial<DriverCharge> = {}): DriverCharge => ({
  id: 'c',
  kind: 'RENTAL_PERIOD',
  amount: 65000,
  status: 'PAST_DUE',
  dueDate: '2026-10-06',
  periodIndex: 1,
  paidAt: null,
  checkoutUrl: 'https://pay.example/i/1',
  ...over,
});

describe('DriverOverdueNotice — aviso de cobrança em atraso do motorista', () => {
  const service = { list: vi.fn() };

  function mount(rentalId = 'rental-1') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DriverOverdueNotice],
      providers: [
        provideRouter([]),
        { provide: DriverRentalChargesService, useValue: service },
        { provide: DRIVER_RENTAL_TODAY, useValue: () => TODAY },
      ],
    });
    const fixture = TestBed.createComponent(DriverOverdueNotice);
    fixture.componentRef.setInput('rentalId', rentalId);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    service.list.mockReset();
  });

  it('mostra o valor e os dias de atraso, em rose, com «Pagar agora» para o aluguel dele', () => {
    service.list.mockReturnValue(of([charge()]));
    const host = mount('rental-1');

    const notice = host.querySelector<HTMLElement>('[data-driver-overdue-notice]');
    expect(notice).not.toBeNull();
    expect(notice!.className).toContain('bg-rose-50');
    expect(notice!.className).toContain('dark:bg-rose-500/10');
    expect(notice!.querySelector('[data-notice-title]')!.textContent).toContain(
      '1 cobrança atrasada',
    );
    expect(notice!.querySelector('[data-notice-amount]')!.textContent).toContain('650,00');
    expect(notice!.querySelector('[data-notice-late]')!.textContent).toContain('4 dias de atraso');
    const pay = notice!.querySelector<HTMLAnchorElement>('[data-pay-now]')!;
    expect(pay.textContent).toContain('Pagar agora');
    expect(pay.getAttribute('href')).toBe('/alugueis/rental-1');
    expect(pay.className).toContain('min-h-11');
  });

  it('soma as atrasadas e conta os dias da mais antiga; PENDING vencida também conta', () => {
    service.list.mockReturnValue(
      of([
        charge({ id: 'a', amount: 65000, dueDate: '2026-10-06' }),
        charge({ id: 'b', amount: 65000, dueDate: '2026-09-29', status: 'PENDING' }),
      ]),
    );
    const host = mount();

    expect(host.querySelector('[data-notice-title]')!.textContent).toContain(
      '2 cobranças atrasadas',
    );
    expect(host.querySelector('[data-notice-amount]')!.textContent).toContain('1.300,00');
    expect(host.querySelector('[data-notice-late]')!.textContent).toContain(
      '11 dias de atraso na mais antiga',
    );
  });

  it('só as cobranças DELE: lê apenas o aluguel recebido e ignora o que está em dia', () => {
    service.list.mockReturnValue(
      of([
        charge({ id: 'ok', status: 'PENDING', dueDate: '2026-10-13', amount: 99900 }),
        charge({ id: 'paid', status: 'PAID', dueDate: '2026-10-01', amount: 88800 }),
        charge({ id: 'late', amount: 65000 }),
      ]),
    );
    const host = mount('rental-do-carlos');

    expect(service.list).toHaveBeenCalledTimes(1);
    expect(service.list).toHaveBeenCalledWith('rental-do-carlos');
    const amount = host.querySelector('[data-notice-amount]')!.textContent!;
    expect(amount).toContain('650,00');
    expect(amount).not.toContain('999');
    expect(amount).not.toContain('888');
  });

  it('sem atraso, o aviso não aparece', () => {
    service.list.mockReturnValue(
      of([charge({ status: 'PENDING', dueDate: '2026-10-13' }), charge({ status: 'PAID' })]),
    );
    expect(mount().querySelector('[data-driver-overdue-notice]')).toBeNull();
  });

  it('vence hoje não é atraso', () => {
    service.list.mockReturnValue(of([charge({ status: 'PENDING', dueDate: TODAY })]));
    expect(mount().querySelector('[data-driver-overdue-notice]')).toBeNull();
  });

  it('se a leitura falha, o aviso fica quieto (o card ao lado oferece o retry)', () => {
    service.list.mockReturnValue(throwError(() => new Error('boom')));
    expect(mount().querySelector('[data-driver-overdue-notice]')).toBeNull();
  });
});
