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
  let listMine: ReturnType<typeof vi.fn>;
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
    // A lista dos PROPRIOS tickets: vazia por padrao, para os casos do formulario.
    listMine = vi.fn(() => of({ content: [], page: 0, size: 5, total: 0 }));
    notifyError = vi.fn();
    notifySuccess = vi.fn();

    await TestBed.configureTestingModule({
      imports: [SupportPage],
      providers: [
        ApiErrorService,
        { provide: SupportTicketService, useValue: { create, listMine } },
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

  describe('seus chamados', () => {
    const ticket = (over: Record<string, unknown> = {}) => ({
      id: 't-1',
      createdDate: '2026-10-08T14:30:00',
      message: 'Não consigo ver o meu aluguel ativo.',
      channel: 'EMAIL',
      status: 'OPEN',
      resolvedAt: null,
      ...over,
    });

    function render(): void {
      // O beforeEach ja montou uma tela e pediu a lista uma vez: o que se mede aqui comeca zerado.
      listMine.mockClear();
      fixture = TestBed.createComponent(SupportPage);
      fixture.detectChanges();
    }

    it('pede os PROPRIOS tickets ao abrir e lista com data e situação', () => {
      listMine.mockReturnValue(
        of({
          content: [ticket(), ticket({ id: 't-2', status: 'RESOLVED', message: 'Obrigado!' })],
          page: 0,
          size: 5,
          total: 2,
        }),
      );
      render();

      expect(listMine).toHaveBeenCalled();
      const section = fixture.nativeElement.querySelector('[data-my-tickets]') as HTMLElement;
      expect(section.textContent).toContain('Seus chamados');
      expect(section.textContent).toContain('08/10/2026');
      expect(section.textContent).toContain('Aberto');
      expect(section.textContent).toContain('Resolvido');
      expect(section.textContent).toContain('Não consigo ver o meu aluguel ativo.');
    });

    it('sem tickets a seção não aparece', () => {
      render();
      expect(fixture.nativeElement.querySelector('[data-my-tickets]')).toBeNull();
    });

    it('se a lista falhar, só a seção some: o formulário continua inteiro', () => {
      listMine.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
      render();

      expect(fixture.nativeElement.querySelector('[data-my-tickets]')).toBeNull();
      expect(fixture.nativeElement.querySelector('#support-message')).not.toBeNull();
      expect(notifyError).not.toHaveBeenCalled();
    });

    it('depois de enviar, a lista é pedida de novo e o ticket novo aparece', () => {
      render();
      expect(listMine).toHaveBeenCalledTimes(1);

      create.mockReturnValue(of({}));
      listMine.mockReturnValue(
        of({ content: [ticket({ id: 't-9', message: 'Recém enviado.' })], page: 0, size: 5, total: 1 }),
      );
      form().patchValue({ message: 'Não consigo emitir o contrato de aluguel.' });
      sendViaEmail();

      expect(listMine).toHaveBeenCalledTimes(2);
      expect(fixture.nativeElement.textContent).toContain('Recém enviado.');
    });
  });
});
