import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SupportPage } from './support';
import { SupportTicketService } from '../../services/support-ticket.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';

describe('SupportPage — feedback standard', () => {
  let create: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<SupportPage>>;

  function form(): { patchValue: (v: unknown) => void } {
    return (fixture.componentInstance as unknown as { form: { patchValue: (v: unknown) => void } })
      .form;
  }

  function sendViaEmail(): void {
    (fixture.componentInstance as unknown as { sendViaEmail: () => void }).sendViaEmail();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    create = vi.fn();
    notifyError = vi.fn();
    notifySuccess = vi.fn();

    await TestBed.configureTestingModule({
      imports: [SupportPage],
      providers: [
        ApiErrorService,
        { provide: SupportTicketService, useValue: { create } },
        { provide: ExternalNavigationService, useValue: { openExternal: vi.fn() } },
        { provide: Location, useValue: { back: vi.fn() } },
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

    fixture = TestBed.createComponent(SupportPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the "mínimo 10 caracteres" rule inline on the field, not in the screen banner', () => {
    form().patchValue({ message: 'curto' });
    sendViaEmail();

    const inline = fixture.nativeElement.querySelector('#support-message-error') as HTMLElement;
    expect(inline?.textContent?.trim()).toBe('Descreva seu problema em pelo menos 10 caracteres.');
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('reports success with a toast, not with an inline green banner', () => {
    create.mockReturnValue(of({}));
    form().patchValue({ message: 'Não consigo emitir o contrato de aluguel.' });
    sendViaEmail();

    expect(notifySuccess).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).not.toContain('Ticket enviado');
  });

  it('claims a 4xx failure in the banner so the interceptor safety net stays quiet', () => {
    const error = new HttpErrorResponse({
      status: 429,
      error: { message: 'Muitos tickets abertos. Aguarde alguns minutos.' },
    });
    create.mockReturnValue(throwError(() => error));
    form().patchValue({ message: 'Não consigo emitir o contrato de aluguel.' });
    sendViaEmail();

    expect(fixture.nativeElement.textContent).toContain('Muitos tickets abertos');

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
