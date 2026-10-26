import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminNotifications, brtIsoDate, shiftIsoDate } from './admin-notifications';
import { AdminChargeNotificationsService } from '../admin-charge-notifications.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type {
  AsaasNotificationsOverview,
  ChargeEmailResendResult,
  ChargeNotificationDay,
  ChargeNotificationItem,
} from '../../../types/admin-charge-notifications.types';

function item(overrides: Partial<ChargeNotificationItem> = {}): ChargeNotificationItem {
  return {
    chargeId: 'ch-1',
    companyId: 'cmp-a',
    companyName: 'Facilita',
    companyInternal: false,
    driverFirstName: 'Rennan',
    driverEmailMasked: 'r***@g***.com',
    amountCents: 70000,
    dueDate: '2026-10-25',
    chargeStatus: 'PENDING',
    email: {
      state: 'SENT',
      providerConfirmed: true,
      label: 'Entregue (confirmado pelo provedor)',
      reason: null,
      attempts: 1,
      finishedAt: '2026-10-25T08:00:05Z',
    },
    asaas: {
      state: 'CONFIGURED',
      label: 'Configurado',
      dueDayOn: true,
      overdueD1On: true,
      email: true,
      sms: true,
      whatsapp: true,
      outdatedPolicy: false,
      reason: null,
      lastAttemptAt: null,
    },
    lastResend: null,
    notified: true,
    notNotifiedReason: null,
    resend: { allowed: true, blockedReason: null },
    ...overrides,
  };
}

const NOT_NOTIFIED = item({
  chargeId: 'ch-2',
  companyId: 'cmp-b',
  companyName: 'Outra Locadora',
  driverFirstName: 'Ana',
  notified: false,
  notNotifiedReason: 'E-mail: Motorista sem e-mail cadastrado · Asaas: Aviso do Asaas ainda não configurado',
  email: {
    state: 'SKIPPED',
    providerConfirmed: false,
    label: 'Pulado',
    reason: 'Motorista sem e-mail cadastrado',
    attempts: 0,
    finishedAt: null,
  },
  asaas: {
    state: 'NEVER',
    label: 'Nunca configurado',
    dueDayOn: false,
    overdueD1On: false,
    email: false,
    sms: false,
    whatsapp: false,
    outdatedPolicy: false,
    reason: 'Aviso do Asaas ainda não configurado',
    lastAttemptAt: null,
  },
  resend: { allowed: false, blockedReason: 'Motorista sem e-mail cadastrado.' },
});

function day(items: ChargeNotificationItem[]): ChargeNotificationDay {
  const notified = items.filter((i) => i.notified).length;
  return {
    date: '2026-10-25',
    today: true,
    summary: { due: items.length, notified, notNotified: items.length - notified },
    companies: [
      { companyId: 'cmp-a', companyName: 'Facilita', internal: false, due: 1, notified: 1, notNotified: 0 },
      { companyId: 'cmp-b', companyName: 'Outra Locadora', internal: false, due: 1, notified: 0, notNotified: 1 },
    ],
    items,
    truncated: false,
  };
}

const ASAAS: AsaasNotificationsOverview = {
  activeDrivers: 3,
  configured: 1,
  notConfigured: 2,
  withoutWhatsapp: 2,
  policyVersion: 5,
  failures: [
    {
      companyId: 'cmp-b',
      companyName: 'Outra Locadora',
      companyInternal: false,
      driverFirstName: 'Ana',
      state: 'FAILED',
      label: 'Falhou',
      email: true,
      sms: false,
      whatsapp: false,
      reason: 'Falha ao configurar o aviso do Asaas: WhatsApp recusado',
      lastAttemptAt: '2026-10-25T07:00:00Z',
    },
  ],
  withoutWhatsappDrivers: [
    {
      companyId: 'cmp-b',
      companyName: 'Outra Locadora',
      companyInternal: false,
      driverFirstName: 'Ana',
      state: 'FAILED',
      label: 'Falhou',
      email: true,
      sms: false,
      whatsapp: false,
      reason: null,
      lastAttemptAt: null,
    },
  ],
};

describe('AdminNotifications', () => {
  let loadDay: ReturnType<typeof vi.fn>;
  let loadAsaas: ReturnType<typeof vi.fn>;
  let resendEmail: ReturnType<typeof vi.fn>;
  let toastSuccess: ReturnType<typeof vi.fn>;

  function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminNotifications],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: AdminChargeNotificationsService, useValue: { loadDay, loadAsaas, resendEmail } },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), success: toastSuccess, warning: vi.fn(), info: vi.fn(), push: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(AdminNotifications);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    loadDay = vi.fn().mockReturnValue(of(day([item(), NOT_NOTIFIED])));
    loadAsaas = vi.fn().mockReturnValue(of(ASAAS));
    resendEmail = vi.fn();
    toastSuccess = vi.fn();
  });

  it('mostra o resumo Vencendo · Avisados · Não avisados e a lista por empresa', () => {
    const { el } = render();
    const summary = el.querySelector('[data-testid="day-summary"]')!.textContent!.replace(/\s+/g, '');
    expect(summary).toContain('Vencendo2');
    expect(summary).toContain('Avisados1');
    expect(summary).toContain('Nãoavisados1');
    expect(el.querySelectorAll('[data-testid="company-summary"] li')).toHaveLength(2);
    expect(el.querySelectorAll('[data-testid="charge-card"]')).toHaveLength(2);
  });

  it('mostra o motivo em pt-BR de quem não foi avisado', () => {
    const { el } = render();
    const reasons = el.querySelectorAll('[data-testid="not-notified-reason"]');
    expect(reasons).toHaveLength(1);
    expect(reasons[0].textContent).toContain('Motorista sem e-mail cadastrado');
  });

  it('mostra canais do Asaas e "dia + D+1" para quem está configurado', () => {
    const { el } = render();
    const first = el.querySelectorAll('[data-testid="charge-card"]')[0].textContent!;
    expect(first).toContain('No dia do vencimento + D+1');
    expect(first).toContain('E-mail · SMS · WhatsApp');
    expect(first).toContain('Entregue (confirmado pelo provedor)');
  });

  it('nunca mostra e-mail completo: só o mascarado que veio do backend', () => {
    const { el } = render();
    expect(el.textContent).toContain('r***@g***.com');
  });

  it('filtra "só não avisados" e por empresa sem nova requisição', () => {
    const { fixture, el } = render();
    const only = el.querySelector<HTMLInputElement>('[data-testid="only-not-notified"]')!;
    only.checked = true;
    only.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid="charge-card"]')).toHaveLength(1);
    expect(el.querySelector('[data-testid="charge-card"]')!.textContent).toContain('Ana');

    only.checked = false;
    only.dispatchEvent(new Event('change'));
    const select = el.querySelector<HTMLSelectElement>('[data-testid="company-filter"]')!;
    select.value = 'cmp-a';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid="charge-card"]')).toHaveLength(1);
    expect(el.querySelector('[data-testid="charge-card"]')!.textContent).toContain('Rennan');
    expect(loadDay).toHaveBeenCalledTimes(1);
  });

  it('pede o dia de ontem ao trocar o chip', () => {
    const { fixture } = render();
    (fixture.componentInstance as unknown as { setPreset(v: string): void }).setPreset('yesterday');
    const today = brtIsoDate(new Date());
    expect(loadDay).toHaveBeenLastCalledWith({ date: shiftIsoDate(today, -1) });
  });

  it('botão bloqueado mostra o motivo e não chama o backend', () => {
    const { el } = render();
    const buttons = el.querySelectorAll<HTMLButtonElement>('[data-testid="resend-button"]');
    expect(buttons[1].disabled).toBe(true);
    expect(el.querySelectorAll('[data-testid="charge-card"]')[1].textContent).toContain(
      'Motorista sem e-mail cadastrado.',
    );
    buttons[1].click();
    expect(resendEmail).not.toHaveBeenCalled();
  });

  it('reenvio trava o botão enquanto está em curso (clique duplo não sai duas vezes)', () => {
    const pending = new Subject<ChargeEmailResendResult>();
    resendEmail.mockReturnValue(pending);
    const { fixture, el } = render();
    const button = () => el.querySelectorAll<HTMLButtonElement>('[data-testid="resend-button"]')[0];

    button().click();
    fixture.detectChanges();
    button().click();
    expect(resendEmail).toHaveBeenCalledTimes(1);
    expect(button().disabled).toBe(true);
    expect(button().textContent).toContain('Reenviando');

    pending.next({
      chargeId: 'ch-1',
      outcome: 'SENT',
      providerConfirmed: true,
      requestedAt: null,
      message: 'E-mail reenviado e aceito pelo provedor.',
    });
    pending.complete();
    fixture.detectChanges();
    expect(toastSuccess).toHaveBeenCalled();
    expect(loadDay).toHaveBeenCalledTimes(2);
  });

  it('409 do reenvio mostra a mensagem do backend no cartão', () => {
    resendEmail.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Este e-mail acabou de ser reenviado. Aguarde alguns minutos antes de tentar de novo.' },
          }),
      ),
    );
    const { fixture, el } = render();
    el.querySelectorAll<HTMLButtonElement>('[data-testid="resend-button"]')[0].click();
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid="charge-card"]')[0].textContent).toContain(
      'acabou de ser reenviado',
    );
  });

  it('estado vazio quando o dia não tem cobranças', () => {
    loadDay.mockReturnValue(of({ ...day([]), companies: [], summary: { due: 0, notified: 0, notNotified: 0 } }));
    const { el } = render();
    expect(el.querySelector('[data-testid="empty"]')!.textContent).toContain('Nenhuma cobrança vencendo');
  });

  it('erro ao carregar o dia mostra banner e não derruba a seção do Asaas', () => {
    loadDay.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    const { el } = render();
    expect(el.textContent).toContain('Tentar novamente');
    expect(el.querySelector('[data-testid="asaas-summary"]')).not.toBeNull();
  });

  it('seção do Asaas: configurados × falha com motivo e quem está sem WhatsApp', () => {
    const { el } = render();
    const summary = el.querySelector('[data-testid="asaas-summary"]')!.textContent!.replace(/\s+/g, '');
    expect(summary).toContain('Configurados1');
    expect(summary).toContain('Comfalha2');
    expect(summary).toContain('SemWhatsApp2');
    expect(el.querySelector('[data-testid="asaas-failures"]')!.textContent).toContain('WhatsApp recusado');
    expect(el.querySelector('[data-testid="asaas-without-whatsapp"]')!.textContent).toContain('Ana');
  });
});

describe('datas em Brasília', () => {
  it('shiftIsoDate atravessa mês sem fuso', () => {
    expect(shiftIsoDate('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('brtIsoDate usa o fuso de Brasília (02:00Z ainda é o dia anterior)', () => {
    expect(brtIsoDate(new Date('2026-10-26T02:00:00Z'))).toBe('2026-10-25');
  });
});
