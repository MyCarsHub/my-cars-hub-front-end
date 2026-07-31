import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiErrorService } from './api-error.service';
import { NotificationService } from './notification.service';
import { SERVER_ERROR_KEY } from './validation-messages';

function httpError(status: number, body?: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body, url: 'http://localhost/v1/x' });
}

describe('ApiErrorService', () => {
  let service: ApiErrorService;
  let notifyError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    notifyError = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: NotificationService,
          useValue: { error: notifyError, warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    });
    service = TestBed.inject(ApiErrorService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('safety net', () => {
    it('toasts when no screen claims the error', () => {
      service.scheduleSafetyNet(httpError(409, { message: 'Placa já cadastrada.' }));
      vi.runAllTimers();
      expect(notifyError).toHaveBeenCalledWith('Placa já cadastrada.');
    });

    it('stays silent when the screen claimed the error', () => {
      const error = httpError(409, { message: 'Placa já cadastrada.' });
      service.scheduleSafetyNet(error);
      service.claim(error);
      vi.runAllTimers();
      expect(notifyError).not.toHaveBeenCalled();
    });

    it('stays silent when the screen handled it through handleForm', () => {
      const error = httpError(400, {
        message: 'x',
        fieldErrors: { plate: 'Placa já cadastrada.' },
      });
      const form = new FormBuilder().nonNullable.group({ plate: [''] });
      service.scheduleSafetyNet(error);
      service.handleForm(error, form);
      vi.runAllTimers();
      expect(notifyError).not.toHaveBeenCalled();
    });

    it('uses a status-specific message when the body has none', () => {
      service.scheduleSafetyNet(httpError(404));
      vi.runAllTimers();
      expect(notifyError).toHaveBeenCalledWith('Registro não encontrado.');
    });

    it('uses a status-specific message for 429', () => {
      service.scheduleSafetyNet(httpError(429));
      vi.runAllTimers();
      expect(notifyError).toHaveBeenCalledWith(
        'Muitas tentativas. Aguarde alguns instantes e tente novamente.',
      );
    });
  });

  describe('handleForm', () => {
    it('puts the server message on the control and leaves the banner empty', () => {
      const form = new FormBuilder().nonNullable.group({ plate: [''] });
      const result = service.handleForm(
        httpError(409, {
          message: 'Placa já cadastrada.',
          fieldErrors: { plate: 'Placa já cadastrada.' },
        }),
        form,
      );

      expect(form.controls.plate.errors?.[SERVER_ERROR_KEY]).toEqual({
        message: 'Placa já cadastrada.',
      });
      expect(result.formMessage).toBeNull();
      expect(result.applied).toEqual(['plate']);
    });

    it('returns a banner message when there are no field errors', () => {
      const form = new FormBuilder().nonNullable.group({ plate: [''] });
      const result = service.handleForm(httpError(409, { message: 'Veículo em uso.' }), form);
      expect(result.formMessage).toBe('Veículo em uso.');
    });
  });

  describe('messageFor', () => {
    it('returns the backend message and claims the error', () => {
      const error = httpError(404, { message: 'Veículo não encontrado.' });
      expect(service.messageFor(error, 'fallback')).toBe('Veículo não encontrado.');
      service.scheduleSafetyNet(error);
      vi.runAllTimers();
      expect(notifyError).not.toHaveBeenCalled();
    });

    it('returns the caller fallback when the body is empty', () => {
      expect(service.messageFor(httpError(400), 'Não deu.')).toBe('Não deu.');
    });
  });
});
