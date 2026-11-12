import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../../environments/environment';
import type { FailedChargeNoticeDto } from '../../../types/rental.types';
import { FailedChargeNotices, FAILED_NOTICES_COLLAPSED } from './failed-charge-notices';

/**
 * V118 — o painel "Cobranças que precisam de você" do dashboard: a frase do backend, o
 * "Gerar de novo" ali mesmo, e nada de alarme para a falha transitória que o sistema ainda
 * tenta sozinho.
 */
describe('FailedChargeNotices', () => {
  const URL = `${environment.apiUrl}/charges/attention`;
  let http: HttpTestingController;

  function notice(over: Partial<FailedChargeNoticeDto> = {}): FailedChargeNoticeDto {
    return {
      chargeId: 'c-1',
      rentalId: 'r-1',
      driverName: 'Rennan',
      amount: 70000,
      dueDate: '2026-10-30',
      periodIndex: 1,
      category: 'DATA',
      failureCode: 'DRIVER_DATA_INVALID',
      reason: 'faltou o CPF do motorista',
      message:
        'A cobrança de R$ 700,00 do motorista Rennan (vence sexta, 30/10) não foi criada no Asaas. ' +
        'Motivo: faltou o CPF do motorista. Corrija o cadastro do motorista ou toque em Gerar de novo.',
      autoRetrying: false,
      needsAttention: true,
      ...over,
    };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  function mount(list: FailedChargeNoticeDto[]) {
    const fixture = TestBed.createComponent(FailedChargeNotices);
    fixture.detectChanges();
    http.expectOne(URL).flush(list);
    fixture.detectChanges();
    return fixture;
  }

  it('mostra a frase do backend e o "Gerar de novo"', () => {
    const fixture = mount([notice()]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Motivo: faltou o CPF do motorista.');
    const btn = el.querySelector('[data-regenerate]') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe('Gerar de novo');
    expect(el.querySelector('a[href="/alugueis/r-1"]')).toBeTruthy();
  });

  it('a falha transitória que o sistema ainda tenta sozinho não vira alarme', () => {
    const fixture = mount([
      notice({ category: 'TRANSIENT', autoRetrying: true, needsAttention: false }),
    ]);
    expect(fixture.nativeElement.querySelector('[data-failed-charge-notices]')).toBeNull();
  });

  it('"Gerar de novo" chama o retry da cobrança certa e recarrega a lista', () => {
    const fixture = mount([notice()]);
    (fixture.nativeElement.querySelector('[data-regenerate]') as HTMLButtonElement).click();
    const retry = http.expectOne(`${environment.apiUrl}/rentals/r-1/charges/c-1/retry`);
    expect(retry.request.method).toBe('POST');
    retry.flush({ outcome: 'RETRIED', externalId: 'pay_new', checkoutUrl: null, retryCount: 1 });
    http.expectOne(URL).flush([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-failed-charge-notices]')).toBeNull();
  });

  it('V141 — Ajuste aparece com o rótulo "Ajuste" e SEM "Gerar de novo"; aluguel ao lado mantém o botão', () => {
    const fixture = mount([
      notice({ chargeId: 'c-adj', kind: 'ADJUSTMENT' }),
      notice({ chargeId: 'c-rent', kind: 'RENTAL_PERIOD' }),
    ]);
    const items = fixture.nativeElement.querySelectorAll('[data-failed-charge-notice]') as NodeListOf<HTMLElement>;
    expect(items.length).toBe(2);
    expect(items[0].querySelector('[data-notice-kind]')?.textContent?.trim()).toBe('Ajuste');
    expect(items[0].querySelector('[data-regenerate]')).toBeNull();
    expect(items[0].querySelector('a[href="/alugueis/r-1"]')).toBeTruthy();
    expect(items[1].querySelector('[data-notice-kind]')).toBeNull();
    expect(items[1].querySelector('[data-regenerate]')).not.toBeNull();
  });

  it('back-end sem `kind` (anterior ao V141): comportamento de antes, com o botão', () => {
    const fixture = mount([notice()]);
    expect(fixture.nativeElement.querySelector('[data-regenerate]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-notice-kind]')).toBeNull();
  });

  it('encurta a lista e oferece ver todas', () => {
    const many = Array.from({ length: FAILED_NOTICES_COLLAPSED + 2 }, (_, i) =>
      notice({ chargeId: `c-${i}` }),
    );
    const fixture = mount(many);
    expect(fixture.nativeElement.querySelectorAll('[data-failed-charge-notice]').length).toBe(
      FAILED_NOTICES_COLLAPSED,
    );
    expect(fixture.nativeElement.textContent).toContain(`Ver todas (${many.length})`);
  });
});
