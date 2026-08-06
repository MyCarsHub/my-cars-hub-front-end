import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AdminOpsToolsDialog } from './admin-ops-tools-dialog';
import { AdminService } from '../admin.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';

const RENTAL_ID = '3f1d2c4a-5b6e-4f70-8a91-0b2c3d4e5f60';

/**
 * Ferramentas operacionais do admin: regenerate-schedule é uma ação que mexe em
 * dados de cobrança. Nunca dispara sem confirmação, nunca dispara duas vezes, e
 * sucesso/erro sempre viram feedback visível.
 */
describe('AdminOpsToolsDialog — regenerate-schedule', () => {
  let regenerateRentalSchedule: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<AdminOpsToolsDialog>>;

  function setRentalId(value: string): void {
    (
      fixture.componentInstance as unknown as {
        form: { controls: { rentalId: { setValue: (v: string) => void } } };
      }
    ).form.controls.rentalId.setValue(value);
  }

  function submit(): void {
    (fixture.componentInstance as unknown as { onSubmit: () => void }).onSubmit();
    fixture.detectChanges();
  }

  function confirmDialogEl(): HTMLElement | null {
    return fixture.nativeElement.querySelector('app-confirm-dialog [role="dialog"]');
  }

  function rentalIdInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('#admin-ops-rental-id') as HTMLInputElement;
  }

  /** Painel hospedeiro — o `[role="dialog"]` que NÃO pertence ao confirm aninhado. */
  function hostPanelEl(): HTMLElement {
    const panels = Array.from(
      fixture.nativeElement.querySelectorAll('[role="dialog"]'),
    ) as HTMLElement[];
    const host = panels.find((el) => !el.closest('app-confirm-dialog'));
    expect(host, 'painel hospedeiro').toBeTruthy();
    return host as HTMLElement;
  }

  async function reopen(): Promise<void> {
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    await settle();
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  }

  /** A remoção do nó é concluída depois do `:leave`, mesmo com animações noop. */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function clickConfirmButton(label: string): void {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('app-confirm-dialog button'),
    ) as HTMLButtonElement[];
    const target = buttons.find((b) => b.textContent?.trim() === label);
    expect(target, `botão "${label}" do confirm dialog`).toBeTruthy();
    target?.click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    regenerateRentalSchedule = vi.fn();
    notifySuccess = vi.fn();
    notifyError = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AdminOpsToolsDialog],
      providers: [
        provideNoopAnimations(),
        ApiErrorService,
        { provide: AdminService, useValue: { regenerateRentalSchedule } },
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

    fixture = TestBed.createComponent(AdminOpsToolsDialog);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('não dispara a ação sem confirmação: abre o confirm dialog e só chama a API no confirmar', async () => {
    regenerateRentalSchedule.mockReturnValue(of({ rentalId: RENTAL_ID, inserted: 4 }));

    setRentalId(RENTAL_ID);
    submit();

    expect(confirmDialogEl()).not.toBeNull();
    expect(regenerateRentalSchedule).not.toHaveBeenCalled();

    clickConfirmButton('Regenerar');

    expect(regenerateRentalSchedule).toHaveBeenCalledTimes(1);
    expect(regenerateRentalSchedule).toHaveBeenCalledWith(RENTAL_ID);
    await settle();
    expect(confirmDialogEl()).toBeNull();
  });

  it('cancelar a confirmação não chama a API e fecha o confirm dialog', async () => {
    setRentalId(RENTAL_ID);
    submit();

    clickConfirmButton('Cancelar');

    expect(regenerateRentalSchedule).not.toHaveBeenCalled();
    await settle();
    expect(confirmDialogEl()).toBeNull();
  });

  it('sucesso mostra a quantidade gerada no banner inline, sem duplicar em toast', () => {
    regenerateRentalSchedule.mockReturnValue(of({ rentalId: RENTAL_ID, inserted: 4 }));

    setRentalId(RENTAL_ID);
    submit();
    clickConfirmButton('Regenerar');

    const banner = fixture.nativeElement.querySelector(
      'app-alert-banner [role="status"]',
    ) as HTMLElement | null;
    expect(banner?.textContent).toContain('4 cobrança(s) geradas');
    // o diálogo continua aberto: o banner é o feedback, toast seria a mesma frase 2x
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('inserted = 0 informa que não havia nada a gerar, sem fingir sucesso genérico', () => {
    regenerateRentalSchedule.mockReturnValue(of({ rentalId: RENTAL_ID, inserted: 0 }));

    setRentalId(RENTAL_ID);
    submit();
    clickConfirmButton('Regenerar');

    expect(fixture.nativeElement.textContent).toContain('Nada a gerar');
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('erro do backend aparece verbatim no banner do diálogo, sem toast', () => {
    const error = new HttpErrorResponse({
      status: 404,
      error: { message: 'Aluguel não encontrado.' },
    });
    regenerateRentalSchedule.mockReturnValue(throwError(() => error));

    setRentalId(RENTAL_ID);
    submit();
    clickConfirmButton('Regenerar');

    const banner = fixture.nativeElement.querySelector(
      'app-alert-banner [role="alert"]',
    ) as HTMLElement | null;
    expect(banner?.textContent).toContain('Aluguel não encontrado.');
    // o texto genérico é apenas FALLBACK
    expect(fixture.nativeElement.textContent).not.toContain('Confira o ID do aluguel.');

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('ID inválido não chega na API e ganha erro inline no campo', () => {
    setRentalId('nao-e-um-uuid');
    submit();

    const inline = fixture.nativeElement.querySelector(
      '#admin-ops-rental-id-error',
    ) as HTMLElement | null;
    expect(inline?.textContent?.trim()).toBe('ID inválido. Cole o UUID completo do aluguel.');
    expect(confirmDialogEl()).toBeNull();
    expect(regenerateRentalSchedule).not.toHaveBeenCalled();
  });

  it('loading impede duplo disparo: botão desabilitado e segundo submit ignorado', async () => {
    const pending = new Subject<{ rentalId: string; inserted: number }>();
    regenerateRentalSchedule.mockReturnValue(pending.asObservable());

    setRentalId(RENTAL_ID);
    submit();
    clickConfirmButton('Regenerar');

    const submitButton = fixture.nativeElement.querySelector(
      'form button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    submit();
    await settle();
    expect(confirmDialogEl()).toBeNull();
    expect(regenerateRentalSchedule).toHaveBeenCalledTimes(1);

    pending.next({ rentalId: RENTAL_ID, inserted: 2 });
    pending.complete();
    fixture.detectChanges();
    expect(regenerateRentalSchedule).toHaveBeenCalledTimes(1);
  });

  it('reabrir depois de executar não herda o alvo nem o banner da execução anterior', async () => {
    regenerateRentalSchedule.mockReturnValue(of({ rentalId: RENTAL_ID, inserted: 4 }));

    setRentalId(RENTAL_ID);
    submit();
    clickConfirmButton('Regenerar');
    expect(fixture.nativeElement.textContent).toContain('4 cobrança(s) geradas');

    await reopen();

    expect(rentalIdInput().value).toBe('');
    expect(fixture.nativeElement.textContent).not.toContain('4 cobrança(s) geradas');
    expect(fixture.nativeElement.textContent).not.toContain(RENTAL_ID);
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
  });

  it('reabrir descarta erro, campo tocado e confirmação pendente', async () => {
    regenerateRentalSchedule.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'Sumiu.' } })),
    );

    setRentalId('nao-e-um-uuid');
    submit();
    expect(fixture.nativeElement.querySelector('#admin-ops-rental-id-error')).not.toBeNull();

    setRentalId(RENTAL_ID);
    submit();
    clickConfirmButton('Regenerar');
    expect(fixture.nativeElement.textContent).toContain('Sumiu.');

    // fecha com a confirmação de novo pendente — o pior estado para vazar
    submit();
    expect(confirmDialogEl()).not.toBeNull();

    await reopen();

    expect(rentalIdInput().value).toBe('');
    expect(fixture.nativeElement.querySelector('#admin-ops-rental-id-error')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Sumiu.');
    expect(confirmDialogEl()).toBeNull();
  });

  it('com a confirmação aberta o painel hospedeiro fica inerte, sem dois modais ativos', () => {
    setRentalId(RENTAL_ID);
    submit();

    expect(confirmDialogEl()).not.toBeNull();
    expect(hostPanelEl().hasAttribute('inert')).toBe(true);

    clickConfirmButton('Cancelar');
    expect(hostPanelEl().hasAttribute('inert')).toBe(false);
  });
});
