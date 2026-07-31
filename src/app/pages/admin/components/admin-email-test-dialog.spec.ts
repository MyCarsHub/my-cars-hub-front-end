import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AdminEmailTestDialog } from './admin-email-test-dialog';
import { AdminService } from '../admin.service';
import { SessionService } from '../../../services/session.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';

/**
 * Feedback standard (phase 3): o 4xx do disparo de templates aparece INLINE no
 * diálogo com a mensagem do backend VERBATIM, nunca como toast; e um e-mail
 * inválido deixa de falhar em silêncio — ganha mensagem inline no campo.
 */
describe('AdminEmailTestDialog — feedback inline', () => {
  let testNotifications: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<AdminEmailTestDialog>>;

  function setEmail(value: string): void {
    (
      fixture.componentInstance as unknown as {
        form: { controls: { email: { setValue: (v: string) => void } } };
      }
    ).form.controls.email.setValue(value);
  }

  function submit(): void {
    (fixture.componentInstance as unknown as { onSubmit: () => void }).onSubmit();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    testNotifications = vi.fn();
    notifyError = vi.fn();
    notifySuccess = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AdminEmailTestDialog],
      providers: [
        provideNoopAnimations(),
        ApiErrorService,
        { provide: AdminService, useValue: { testNotifications } },
        { provide: SessionService, useValue: { getItem: () => null } },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            warning: vi.fn(),
            info: vi.fn(),
            success: notifySuccess,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminEmailTestDialog);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra a mensagem do backend verbatim no banner do diálogo, sem toast', () => {
    const error = new HttpErrorResponse({
      status: 422,
      error: { message: 'Provedor SMTP recusou o domínio de destino.' },
    });
    testNotifications.mockReturnValue(throwError(() => error));

    setEmail('admin@mycarshub.app.br');
    submit();

    const banner = fixture.nativeElement.querySelector(
      'app-alert-banner [role="alert"]',
    ) as HTMLElement | null;
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Provedor SMTP recusou o domínio de destino.');
    // o texto genérico é apenas FALLBACK
    expect(fixture.nativeElement.textContent).not.toContain(
      'Verifique se o SMTP está configurado.',
    );

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('coloca fieldErrors.email embaixo do campo e nada no banner', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        message: 'E-mail de destino inválido.',
        fieldErrors: { email: 'E-mail de destino inválido.' },
      },
    });
    testNotifications.mockReturnValue(throwError(() => error));

    setEmail('admin@mycarshub.app.br');
    submit();

    const inline = fixture.nativeElement.querySelector(
      '#admin-email-test-input-error',
    ) as HTMLElement | null;
    expect(inline?.textContent?.trim()).toBe('E-mail de destino inválido.');
    expect(inline?.getAttribute('role')).toBe('alert');
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('não falha em silêncio com e-mail inválido: mostra erro inline e não chama a API', () => {
    setEmail('nao-e-um-email');
    submit();

    const inline = fixture.nativeElement.querySelector(
      '#admin-email-test-input-error',
    ) as HTMLElement | null;
    expect(inline?.textContent?.trim()).toBe('E-mail inválido. Use o formato voce@exemplo.com.');
    expect(
      (
        fixture.nativeElement.querySelector('#admin-email-test-input') as HTMLInputElement
      ).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(testNotifications).not.toHaveBeenCalled();
  });

  it('dispara exatamente um toast de sucesso quando o envio dá certo', () => {
    testNotifications.mockReturnValue(of({ sent: 13 }));

    setEmail('admin@mycarshub.app.br');
    submit();

    expect(notifySuccess).toHaveBeenCalledTimes(1);
    expect(notifyError).not.toHaveBeenCalled();
  });
});
