import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdjustmentsService } from '../../services/adjustments.service';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverService } from '../../services/driver.service';
import { NotificationService } from '../../services/notification.service';
import { ADJUSTMENT_MAX_DUE_DAYS_AHEAD } from '../../types/adjustment.types';
import { IdempotencyKeyKeeper, addDaysIso } from '../../utils/adjustments-view';
import { todayInBusinessTz } from '../../utils/business-clock';
import { AdjustmentForm } from './adjustment-form';

const TODAY = todayInBusinessTz();

type FormApi = {
  form: {
    patchValue: (v: unknown) => void;
    controls: Record<string, { value: unknown; valid: boolean; errors: Record<string, unknown> | null; setValue: (v: unknown) => void }>;
    valid: boolean;
  };
  submit: () => void;
  keys: IdempotencyKeyKeeper;
};

const VALID = {
  driverId: 'd1',
  amountReais: '1.234,56',
  dueDate: addDaysIso(TODAY, 10),
  description: '  Reabastecimento na devolução  ',
};

describe('AdjustmentForm', () => {
  let create: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let success: ReturnType<typeof vi.fn>;

  function setup() {
    TestBed.resetTestingModule();
    create = vi.fn();
    success = vi.fn();
    TestBed.configureTestingModule({
      imports: [AdjustmentForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: AdjustmentsService, useValue: { create } },
        {
          provide: DriverService,
          useValue: {
            list: vi.fn().mockReturnValue(
              of({ content: [{ id: 'd1', name: 'Carlos Mendes' }, { id: 'd2', name: 'Bruno Almeida' }] }),
            ),
          },
        },
        { provide: NotificationService, useValue: { success, error: vi.fn() } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    const fixture = TestBed.createComponent(AdjustmentForm);
    fixture.detectChanges();
    const api = fixture.componentInstance as unknown as FormApi;
    let n = 0;
    // Gerador determinístico: cada chave NOVA é k1, k2...
    (api as unknown as { keys: IdempotencyKeyKeeper }).keys = new IdempotencyKeyKeeper(() => `k${++n}`);
    return { fixture, api, el: fixture.nativeElement as HTMLElement };
  }

  const saved = (status = 'PENDING') => ({
    adjustment: { id: 'new-1', status } as never,
    httpStatus: status === 'ISSUING' ? 202 : 201,
  });

  beforeEach(() => TestBed.resetTestingModule());

  it('lista os motoristas e não oferece aluguel nem forma de pagamento', () => {
    const { el } = setup();
    const options = Array.from(el.querySelectorAll('#adjustment-driver option')).map((o) => o.textContent?.trim());
    expect(options).toContain('Carlos Mendes');
    expect(el.textContent).not.toMatch(/Aluguel|Forma de pagamento|Boleto|Cartão/);
  });

  it('campos com fonte ≥ 16px (text-base): o iOS não dá zoom no foco', () => {
    const { el } = setup();
    for (const c of Array.from(el.querySelectorAll('input, select'))) {
      expect(c.className).toMatch(/\btext-base\b/);
    }
  });

  it('envia centavos lidos do TEXTO pt-BR, motivo aparado, com uma Idempotency-Key', () => {
    const { api } = setup();
    create.mockReturnValue(of(saved()));
    api.form.patchValue(VALID);
    api.submit();
    expect(create).toHaveBeenCalledWith(
      { driverId: 'd1', amountCents: 123456, dueDate: VALID.dueDate, description: 'Reabastecimento na devolução' },
      'k1',
    );
    expect(navigate).toHaveBeenCalledWith(['/ajustes', 'new-1']);
    expect(success).toHaveBeenCalledWith('Ajuste criado e Pix emitido.');
  });

  it('202 (emitindo): avisa que a emissão termina sozinha', () => {
    const { api } = setup();
    create.mockReturnValue(of(saved('ISSUING')));
    api.form.patchValue(VALID);
    api.submit();
    expect(success.mock.calls[0][0]).toContain('em andamento');
  });

  it('tentar de novo o MESMO envio reaproveita a chave; mudar o corpo é envio novo', () => {
    const { api } = setup();
    create.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));
    create.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    create.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    create.mockReturnValueOnce(of(saved()));
    api.form.patchValue(VALID);
    api.submit();
    api.submit();
    expect(create.mock.calls[0][1]).toBe('k1');
    expect(create.mock.calls[1][1]).toBe('k1');

    api.form.patchValue({ amountReais: '200,00' });
    api.submit();
    expect(create.mock.calls[2][1]).toBe('k2');

    api.submit();
    expect(create.mock.calls[3][1]).toBe('k2');
    expect(navigate).toHaveBeenCalledWith(['/ajustes', 'new-1']);
  });

  it('duplo clique enquanto envia não dispara segundo POST', () => {
    const { api } = setup();
    // Resposta que nunca chega: o envio fica em andamento.
    create.mockReturnValue({ subscribe: () => undefined });
    api.form.patchValue(VALID);
    api.submit();
    api.submit();
    expect(create).toHaveBeenCalledTimes(1);
  });

  describe('valor (texto mascarado)', () => {
    const amount = (api: FormApi, v: string) => {
      api.form.controls['amountReais'].setValue(v);
      return api.form.controls['amountReais'].errors;
    };

    it('aceita milhar e vírgula', () => {
      const { api } = setup();
      expect(amount(api, '1.234,56')).toBeNull();
      expect(amount(api, '0,01')).toBeNull();
      expect(amount(api, '100.000,00')).toBeNull();
    });

    it('recusa vazio, zero, acima do teto e texto que não é dinheiro', () => {
      const { api } = setup();
      expect(amount(api, '')).toEqual({ required: true });
      expect(amount(api, '0,00')).toHaveProperty('min');
      expect(amount(api, '100.000,01')).toEqual({ max: true });
      expect(amount(api, 'abc')).toEqual({ moneyFormat: true });
    });

    it('formulário inválido não chama a API', () => {
      const { api } = setup();
      api.form.patchValue({ ...VALID, amountReais: '0,00' });
      api.submit();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('vencimento: de hoje até o teto do back-end', () => {
    const due = (api: FormApi, v: string) => {
      api.form.controls['dueDate'].setValue(v);
      return api.form.controls['dueDate'].errors;
    };

    it('hoje e o último dia aceito passam', () => {
      const { api } = setup();
      expect(due(api, TODAY)).toBeNull();
      expect(due(api, addDaysIso(TODAY, ADJUSTMENT_MAX_DUE_DAYS_AHEAD))).toBeNull();
    });

    it('ontem, um dia depois do teto e vazio são recusados', () => {
      const { api } = setup();
      expect(due(api, addDaysIso(TODAY, -1))).toEqual({ minDate: true });
      expect(due(api, addDaysIso(TODAY, ADJUSTMENT_MAX_DUE_DAYS_AHEAD + 1))).toEqual({ maxDate: true });
      expect(due(api, '')).toEqual({ required: true });
    });

    it('o campo de data leva min e max', () => {
      const { el } = setup();
      const input = el.querySelector('#adjustment-due') as HTMLInputElement;
      expect(input.getAttribute('min')).toBe(TODAY);
      expect(input.getAttribute('max')).toBe(addDaysIso(TODAY, ADJUSTMENT_MAX_DUE_DAYS_AHEAD));
    });
  });

  it('motivo só com espaços é recusado', () => {
    const { api } = setup();
    api.form.controls['description'].setValue('   ');
    expect(api.form.controls['description'].errors).toEqual({ required: true });
  });

  it('erro do back-end (422 sem aluguel) aparece e o botão volta', () => {
    const { api, fixture, el } = setup();
    create.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 422, error: { message: 'Este motorista não tem aluguel.' } }),
      ),
    );
    api.form.patchValue(VALID);
    api.submit();
    fixture.detectChanges();
    expect(el.querySelector('app-alert-banner')).not.toBeNull();
    expect((el.querySelector('[data-submit]') as HTMLButtonElement).disabled).toBe(false);
  });
});
