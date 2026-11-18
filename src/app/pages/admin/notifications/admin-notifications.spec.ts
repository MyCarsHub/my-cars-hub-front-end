import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  AdminNotifications,
  NOTIFICATIONS_PAGE_SIZE,
  brtIsoDate,
  pageCount,
  pageSlice,
  shiftIsoDate,
} from './admin-notifications';
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

const CARDS = '[data-testid="charge-list"] [data-card]';

/** Abre o kebab da linha `index` (cartão do celular) e devolve o item "Reenviar e-mail". */
function openResend(el: HTMLElement, fixture: { detectChanges(): void }, index: number): HTMLButtonElement {
  const card = el.querySelectorAll<HTMLElement>(CARDS)[index];
  (card.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement).click();
  fixture.detectChanges();
  return card.querySelector('[data-testid="resend-button"]') as HTMLButtonElement;
}

function pill(el: HTMLElement, group: string, label: string): HTMLButtonElement {
  const buttons = el.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`);
  return Array.from(buttons).find((b) => b.textContent?.trim() === label)!;
}

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
    expect(el.querySelectorAll(CARDS)).toHaveLength(2);
  });

  it('mostra o motivo em pt-BR de quem não foi avisado', () => {
    const { el } = render();
    const reasons = el.querySelectorAll(`${CARDS} [data-testid="not-notified-reason"]`);
    expect(reasons).toHaveLength(1);
    expect(reasons[0].textContent).toContain('Motorista sem e-mail cadastrado');
  });

  it('mostra canais do Asaas e "dia + D+1" para quem está configurado', () => {
    const { el } = render();
    const first = el.querySelectorAll(CARDS)[0].textContent!;
    expect(first).toContain('No dia do vencimento + D+1');
    expect(first).toContain('E-mail · SMS · WhatsApp');
    expect(first).toContain('Entregue (confirmado pelo provedor)');
  });

  it('chips longos de e-mail e Asaas quebram linha no cartão em vez de serem cortados (375px)', () => {
    const { el } = render();
    const chips = el.querySelectorAll(`${CARDS} [data-testid="email-chip"], ${CARDS} [data-testid="asaas-chip"]`);
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach((chip) => {
      expect(chip.className).toContain('whitespace-normal');
      expect(chip.className).not.toContain('whitespace-nowrap');
      expect(chip.className).toContain('max-w-full');
    });
  });

  it('nunca mostra e-mail completo: só o mascarado que veio do backend', () => {
    const { el } = render();
    expect(el.textContent).toContain('r***@g***.com');
  });

  it('filtra "só não avisados" e por empresa sem nova requisição', () => {
    const { fixture, el } = render();
    pill(el, 'Filtrar por aviso', 'Não avisadas').click();
    fixture.detectChanges();
    expect(el.querySelectorAll(CARDS)).toHaveLength(1);
    expect(el.querySelector(CARDS)!.textContent).toContain('Ana');

    pill(el, 'Filtrar por aviso', 'Todas').click();
    fixture.detectChanges();
    const select = el.querySelector<HTMLSelectElement>('[data-testid="company-filter"]')!;
    select.value = 'cmp-a';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelectorAll(CARDS)).toHaveLength(1);
    expect(el.querySelector(CARDS)!.textContent).toContain('Rennan');
    expect(loadDay).toHaveBeenCalledTimes(1);
  });

  it('pede o dia de ontem ao trocar o chip', () => {
    const { fixture } = render();
    (fixture.componentInstance as unknown as { setPreset(v: string): void }).setPreset('yesterday');
    const today = brtIsoDate(new Date());
    expect(loadDay).toHaveBeenLastCalledWith({ date: shiftIsoDate(today, -1) });
  });

  it('reenvio bloqueado: item desabilitado no kebab, motivo na linha, sem chamar o backend', () => {
    const { fixture, el } = render();
    expect(el.querySelectorAll(CARDS)[1].textContent).toContain('Motorista sem e-mail cadastrado.');
    const blocked = openResend(el, fixture, 1);
    expect(blocked.disabled).toBe(true);
    blocked.click();
    expect(resendEmail).not.toHaveBeenCalled();
  });

  it('reenvio trava o botão enquanto está em curso (clique duplo não sai duas vezes)', () => {
    const pending = new Subject<ChargeEmailResendResult>();
    resendEmail.mockReturnValue(pending);
    const { fixture, el } = render();

    openResend(el, fixture, 0).click();
    fixture.detectChanges();
    // Reabrir o kebab no meio do envio: o item está travado.
    const again = openResend(el, fixture, 0);
    again.click();
    expect(resendEmail).toHaveBeenCalledTimes(1);
    expect(again.disabled).toBe(true);
    expect(again.textContent).toContain('Reenviando');

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
    openResend(el, fixture, 0).click();
    fixture.detectChanges();
    expect(el.querySelectorAll(CARDS)[0].textContent).toContain(
      'acabou de ser reenviado',
    );
  });

  it('estado vazio quando o dia não tem cobranças', () => {
    loadDay.mockReturnValue(of({ ...day([]), companies: [], summary: { due: 0, notified: 0, notNotified: 0 } }));
    const { el } = render();
    expect(el.querySelector('[data-testid="charge-list"] [data-empty-text]')!.textContent).toContain(
      'Nenhuma cobrança vencendo',
    );
  });

  it('erro ao carregar o dia mostra banner e não derruba a seção do Asaas', () => {
    loadDay.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    const { el } = render();
    expect(el.textContent).toContain('Tentar novamente');
    expect(el.querySelector('[data-testid="asaas-summary"]')).not.toBeNull();
  });

  it('padrão: situação em chip sem bolinha, nada pintado em volta do registro, sem linhas', () => {
    const { el } = render();
    const chips = Array.from(el.querySelectorAll(`${CARDS} app-status-chip`)).map((c) => c.textContent?.trim());
    expect(chips).toContain('Avisado');
    expect(chips).toContain('Não avisado');
    const list = el.querySelector('[data-testid="charge-list"]')!.innerHTML;
    expect(list).not.toMatch(/border-red|bg-red-50|border-t|divide-/);
    expect(el.querySelector('[data-testid="company-summary"]')!.innerHTML).not.toMatch(/\bborder\b/);
  });

  it('busca por motorista ou empresa sem nova requisição, acento e caixa não importam', () => {
    vi.useFakeTimers();
    const { fixture, el } = render();
    const search = el.querySelector<HTMLInputElement>('[data-list-search]')!;
    search.value = 'OUTRA locadora';
    search.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    expect(el.querySelectorAll(CARDS)).toHaveLength(1);
    expect(el.querySelector(CARDS)!.textContent).toContain('Ana');
    expect(loadDay).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('dia grande: desenha só uma página de cada vez (a aba travou com o dia inteiro)', () => {
    const many = Array.from({ length: 2000 }, (_, i) => item({ chargeId: 'ch-' + i, driverFirstName: 'M' + i }));
    loadDay.mockReturnValue(of(day(many)));
    const { fixture, el } = render();

    expect(el.querySelectorAll(CARDS)).toHaveLength(NOTIFICATIONS_PAGE_SIZE);
    expect(el.querySelectorAll('[data-testid="charge-list"] [data-row]')).toHaveLength(NOTIFICATIONS_PAGE_SIZE);
    expect(el.querySelector('[data-testid="charge-list"] [data-pager-text]')!.textContent).toContain(
      '2.000 cobranças · página 1 de 80',
    );

    (el.querySelector('[data-testid="charge-list"] [data-page-next]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector(CARDS)!.textContent).toContain('M25');
    expect(loadDay).toHaveBeenCalledTimes(1);
  });

  it('Asaas: listas grandes também paginam', () => {
    const drivers = Array.from({ length: 300 }, (_, i) => ({ ...ASAAS.failures[0], driverFirstName: 'D' + i }));
    loadAsaas.mockReturnValue(of({ ...ASAAS, failures: drivers, withoutWhatsappDrivers: drivers }));
    const { el } = render();
    expect(el.querySelectorAll('[data-testid="asaas-failures"] [data-card]')).toHaveLength(NOTIFICATIONS_PAGE_SIZE);
    expect(el.querySelectorAll('[data-testid="asaas-without-whatsapp"] [data-card]')).toHaveLength(
      NOTIFICATIONS_PAGE_SIZE,
    );
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

describe('páginas no navegador', () => {
  it('pageSlice e pageCount', () => {
    const rows = Array.from({ length: 60 }, (_, i) => i);
    expect(pageSlice(rows, 0)).toHaveLength(NOTIFICATIONS_PAGE_SIZE);
    expect(pageSlice(rows, 2)).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
    expect(pageCount(60)).toBe(3);
    expect(pageCount(0)).toBe(1);
  });
});
