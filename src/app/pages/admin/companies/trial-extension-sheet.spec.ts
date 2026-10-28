import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { TrialExtensionSheet, parseUtc } from './trial-extension-sheet';
import { AdminTrialService } from '../../../services/admin-trial.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';

describe('TrialExtensionSheet', () => {
  // 28/10/2026 15:00 UTC = 12:00 em São Paulo.
  const NOW = Date.UTC(2026, 9, 28, 15, 0);
  let extend: ReturnType<typeof vi.fn>;

  function mount(trialEndsAt: string | null): ComponentFixture<TrialExtensionSheet> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TrialExtensionSheet],
      providers: [
        ApiErrorService,
        { provide: AdminTrialService, useValue: { extend } },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), push: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(TrialExtensionSheet);
    fixture.componentRef.setInput('companyId', 'co-1');
    fixture.componentRef.setInput('companyName', 'Locadora Alfa');
    fixture.componentRef.setInput('trialEndsAt', trialEndsAt);
    fixture.componentRef.setInput('now', NOW);
    fixture.detectChanges();
    return fixture;
  }

  function q<T extends Element>(f: ComponentFixture<TrialExtensionSheet>, id: string): T {
    return (f.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`) as T;
  }

  function chooseReason(f: ComponentFixture<TrialExtensionSheet>, index = 1): void {
    const select = q<HTMLSelectElement>(f, 'trial-reason-select');
    select.value = select.options[index].value;
    select.dispatchEvent(new Event('change'));
    f.detectChanges();
  }

  beforeEach(() => {
    extend = vi.fn().mockReturnValue(
      of({
        companyId: 'co-1',
        days: 14,
        previousStatus: 'EXPIRED',
        status: 'TRIALING',
        trialEndsAt: '2026-11-11T15:00:00',
        emailRecipients: 1,
      }),
    );
  });

  it('teste vencido: a prévia conta a partir de hoje, não do fim antigo', () => {
    const f = mount('2026-10-01T12:00:00');
    q<HTMLButtonElement>(f, 'trial-pick-14').click();
    f.detectChanges();

    const text = q<HTMLElement>(f, 'trial-extension-preview').textContent ?? '';
    expect(text).toContain('11/11/2026');
    expect((f.nativeElement as HTMLElement).textContent).toContain('teste vencido em 01/10/2026');
  });

  it('teste em andamento: a prévia soma ao fim atual', () => {
    const f = mount('2026-11-02T15:00:00');
    q<HTMLButtonElement>(f, 'trial-pick-30').click();
    f.detectChanges();

    expect(q<HTMLElement>(f, 'trial-extension-preview').textContent).toContain('02/12/2026');
  });

  it('não envia sem motivo nem fora de 1–60 dias', () => {
    const f = mount(null);
    expect(q<HTMLButtonElement>(f, 'trial-extension-submit').disabled).toBe(true);

    chooseReason(f);
    expect(q<HTMLButtonElement>(f, 'trial-extension-submit').disabled).toBe(false);

    const input = q<HTMLInputElement>(f, 'trial-days-input');
    input.value = '61';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(q<HTMLButtonElement>(f, 'trial-extension-submit').disabled).toBe(true);
    expect(extend).not.toHaveBeenCalled();
  });

  it('envia dias, motivo e nota aparada, e emite o resultado', () => {
    const f = mount('2026-10-01T12:00:00');
    const emitted = vi.fn();
    f.componentInstance.extended.subscribe(emitted);
    q<HTMLButtonElement>(f, 'trial-pick-14').click();
    chooseReason(f, 2);
    const note = q<HTMLTextAreaElement>(f, 'trial-note-input');
    note.value = '  combinado por telefone  ';
    note.dispatchEvent(new Event('input'));
    f.detectChanges();

    q<HTMLButtonElement>(f, 'trial-extension-submit').click();

    expect(extend).toHaveBeenCalledWith('co-1', {
      days: 14,
      reason: 'ONBOARDING',
      note: 'combinado por telefone',
    });
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ status: 'TRIALING' }));
  });

  it('mostra a recusa do backend (assinatura paga) dentro da folha', () => {
    extend.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Esta empresa tem assinatura paga ativa — não há teste a estender.' },
          }),
      ),
    );
    const f = mount('2026-10-01T12:00:00');
    chooseReason(f);
    q<HTMLButtonElement>(f, 'trial-extension-submit').click();
    f.detectChanges();

    expect((f.nativeElement as HTMLElement).textContent).toContain('assinatura paga ativa');
  });

  /** iOS dá zoom no foco de campo com fonte < 16px — todo controle usa text-base (16px). */
  it('todo controle de formulário tem fonte de 16px e alvo de 48px', () => {
    const f = mount(null);
    const host = f.nativeElement as HTMLElement;
    for (const el of Array.from(host.querySelectorAll('input, select, textarea'))) {
      expect(el.className).toContain('text-base');
    }
    for (const el of Array.from(host.querySelectorAll('input, select, button'))) {
      expect(el.className).toContain('min-h-12');
    }
  });

  it('parseUtc lê LocalDateTime sem fuso como UTC', () => {
    expect(parseUtc('2026-11-05T02:30:00')).toBe(Date.UTC(2026, 10, 5, 2, 30));
    expect(parseUtc('2026-11-05T02:30:00Z')).toBe(Date.UTC(2026, 10, 5, 2, 30));
  });
});
