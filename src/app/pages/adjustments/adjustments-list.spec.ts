import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdjustmentsService } from '../../services/adjustments.service';
import { DriverService } from '../../services/driver.service';
import { NotificationService } from '../../services/notification.service';
import { Adjustment, AdjustmentListResponse } from '../../types/adjustment.types';
import { addDaysIso } from '../../utils/adjustments-view';
import { todayInBusinessTz } from '../../utils/business-clock';
import { AdjustmentsList } from './adjustments-list';

const TODAY = todayInBusinessTz();

function adj(over: Partial<Adjustment> = {}): Adjustment {
  return {
    id: 'a1',
    driverId: 'd1',
    driverName: 'Carlos Mendes',
    description: 'Reabastecimento na devolução',
    amountCents: 18000,
    dueDate: addDaysIso(TODAY, 5),
    status: 'PENDING',
    paymentMethod: 'PIX',
    paidAt: null,
    paidAmountCents: null,
    createdAt: `${TODAY}T14:02:00`,
    createdByName: 'Lorran',
    issuedAt: `${TODAY}T14:02:00`,
    canceledAt: null,
    failureReason: null,
    pixAvailable: true,
    rentalId: 'r1',
    chargeId: 'c1',
    driver: null,
    history: null,
    ...over,
  };
}

function response(rows: Adjustment[], over: Partial<AdjustmentListResponse> = {}): AdjustmentListResponse {
  return {
    month: TODAY.slice(0, 7),
    summary: {
      toReceiveCents: 45000,
      toReceiveCount: 2,
      toReceiveDrivers: 2,
      receivedCents: 38000,
      receivedCount: 2,
      overdueCents: 0,
      overdueCount: 0,
    },
    statusCounts: { all: rows.length, pending: 2, overdue: 0, paid: 2, canceled: 0 },
    page: { content: rows, page: 0, size: 20, total: rows.length },
    ...over,
  };
}

const ROWS: Adjustment[] = [
  adj({ id: 'a1' }),
  adj({ id: 'a2', driverName: 'Bruno Almeida', description: 'Chave reserva perdida', amountCents: 27000 }),
  adj({ id: 'a3', driverName: 'Luma Oliveira', status: 'PAID', paidAt: `${TODAY}T09:41:00`, pixAvailable: false }),
  adj({ id: 'a4', driverName: 'Rafael Costa', status: 'ISSUING', pixAvailable: false, chargeId: null }),
  adj({ id: 'a5', driverName: 'Ana Souza', status: 'ISSUE_FAILED', pixAvailable: false }),
  adj({ id: 'a6', driverName: 'Pedro Lima', status: 'PENDING', dueDate: addDaysIso(TODAY, -1) }),
  adj({ id: 'a7', driverName: 'Júlia Reis', status: 'CANCELED', pixAvailable: false }),
];

describe('AdjustmentsList', () => {
  let list: ReturnType<typeof vi.fn>;

  function create(result: AdjustmentListResponse | 'error' | Observable<AdjustmentListResponse>) {
    TestBed.resetTestingModule();
    list = vi.fn().mockReturnValue(
      result === 'error'
        ? throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'boom' } }))
        : result instanceof Observable
          ? result
          : of(result),
    );
    TestBed.configureTestingModule({
      imports: [AdjustmentsList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AdjustmentsService, useValue: { list, pix: vi.fn().mockReturnValue(of('000201...')) } },
        {
          provide: DriverService,
          useValue: { list: vi.fn().mockReturnValue(of({ content: [{ id: 'd1', name: 'Carlos Mendes' }] })) },
        },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AdjustmentsList);
    fixture.detectChanges();
    return fixture;
  }

  const host = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const chipOf = (el: HTMLElement, id: string) =>
    text(el.querySelector(`[data-adjustment-id="${id}"] [data-adjustment-status]`));

  beforeEach(() => TestBed.resetTestingModule());

  it('pede o mês corrente, a primeira página e nenhum filtro', () => {
    create(response(ROWS));
    expect(list).toHaveBeenCalledWith({
      month: TODAY.slice(0, 7),
      status: 'ALL',
      driverId: '',
      q: '',
      page: 0,
      size: 20,
    });
  });

  it('os três cartões do mês vêm do back-end, em pt-BR', () => {
    const el = host(create(response(ROWS)));
    expect(text(el.querySelector('[data-kpi="to-receive"]'))).toContain('R$ 450,00');
    expect(text(el.querySelector('[data-kpi="to-receive"]'))).toContain('2 pendentes, de 2 motoristas');
    expect(text(el.querySelector('[data-kpi="received"]'))).toContain('R$ 380,00');
    expect(text(el.querySelector('[data-kpi="received"]'))).toContain('2 ajustes pagos');
    expect(text(el.querySelector('[data-kpi="overdue"]'))).toContain('nenhum atrasado');
  });

  it('uma linha por ajuste: motorista, motivo, vencimento e valor', () => {
    const el = host(create(response(ROWS)));
    expect(el.querySelectorAll('[data-adjustment-id]').length).toBe(7);
    const row = text(el.querySelector('[data-adjustment-id="a1"]'));
    expect(row).toContain('Carlos Mendes');
    expect(row).toContain('Reabastecimento na devolução');
    expect(row).toContain('R$ 180,00');
    expect(text(el.querySelector('[data-adjustments-footer]'))).toContain('Mostrando 7 de 7');
  });

  it('chip por estado do Asaas: emitindo, não emitida, pendente, atrasada, paga, cancelada', () => {
    const el = host(create(response(ROWS)));
    expect(chipOf(el, 'a1')).toBe('Pendente');
    expect(chipOf(el, 'a3')).toBe('Paga');
    expect(chipOf(el, 'a4')).toBe('Emitindo');
    expect(chipOf(el, 'a5')).toBe('Não emitida');
    // PENDING com vencimento passado é atrasada, como no resto do app.
    expect(chipOf(el, 'a6')).toBe('Atrasada');
    expect(chipOf(el, 'a7')).toBe('Cancelada');
  });

  it('cor só no chip: a linha não tem borda nem fundo de status', () => {
    const el = host(create(response(ROWS)));
    for (const li of Array.from(el.querySelectorAll('[data-adjustment-id]'))) {
      expect(li.className).not.toMatch(/\bborder|divide-/);
      expect(li.className).not.toMatch(/\bbg-(rose|amber|emerald|primary|blue)/);
    }
    expect(el.querySelector('[data-adjustment-id="a3"] [data-adjustment-status]')?.className).toMatch(/emerald/);
  });

  it('pílulas com as contagens; trocar a pílula pede de novo com o status, na página 0', () => {
    const fixture = create(response(ROWS));
    const el = host(fixture);
    const pills = Array.from(el.querySelectorAll('[role="radio"]')).map((b) => text(b));
    expect(pills).toEqual(['Todos 7', 'Pendentes 2', 'Atrasados 0', 'Pagos 2', 'Cancelados 0']);
    (el.querySelectorAll('[role="radio"]')[3] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'PAID', page: 0 }));
  });

  it('kebab: Ver ajuste e, se pode ser paga, Copiar Pix; nunca gerar de novo, cancelar ou marcar paga', () => {
    const fixture = create(response(ROWS));
    const el = host(fixture);
    const labelsOf = (id: string) => {
      const menu = el.querySelector(`[data-adjustment-id="${id}"] app-actions-menu`) as HTMLElement;
      menu.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
      fixture.detectChanges();
      return Array.from(menu.querySelectorAll('[role="menuitem"]')).map((n) => text(n));
    };
    expect(labelsOf('a1')).toEqual(['Ver ajuste', 'Copiar Pix copia-e-cola']);
    expect(labelsOf('a5')).toEqual(['Ver ajuste']);
    expect(labelsOf('a4')).toEqual(['Ver ajuste']);
    expect(el.textContent).not.toMatch(/Gerar de novo|Tentar de novo|Cancelar cobrança|Marcar como paga/);
  });

  it('mês sem ajustes: estado vazio com o convite ao primeiro', () => {
    const el = host(create(response([], { statusCounts: { all: 0, pending: 0, overdue: 0, paid: 0, canceled: 0 } })));
    const empty = el.querySelector('[data-adjustments-empty]');
    expect(empty).not.toBeNull();
    expect(text(empty)).toContain('Nenhum ajuste em');
    expect(text(empty)).toContain('Criar primeiro ajuste');
    expect(el.querySelector('[data-adjustment-id]')).toBeNull();
  });

  it('filtro sem resultado não é o estado vazio do mês', () => {
    const el = host(
      create(response([], { statusCounts: { all: 4, pending: 0, overdue: 0, paid: 4, canceled: 0 } })),
    );
    expect(el.querySelector('[data-adjustments-empty]')).toBeNull();
    expect(el.querySelector('[data-adjustments-no-match]')).not.toBeNull();
  });

  it('carregando: esqueleto, sem linhas nem estado vazio', () => {
    const el = host(create(new Observable<AdjustmentListResponse>(() => undefined)));
    expect(el.querySelector('[data-adjustments-loading]')).not.toBeNull();
    expect(el.querySelector('[data-adjustments-empty]')).toBeNull();
  });

  it('erro: mostra a mensagem, sem estado vazio', () => {
    const el = host(create('error'));
    expect(el.querySelector('app-alert-banner')).not.toBeNull();
    expect(el.querySelector('[data-adjustments-empty]')).toBeNull();
  });

  it('o mês volta e avança até o mês do teto do vencimento', () => {
    const fixture = create(response(ROWS));
    const el = host(fixture);
    el.querySelector<HTMLButtonElement>('[data-month-prev]')?.click();
    fixture.detectChanges();
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 0 }));
    expect(list.mock.calls.at(-1)?.[0].month).not.toBe(TODAY.slice(0, 7));
    expect(el.querySelector<HTMLButtonElement>('[data-month-next]')?.disabled).toBe(false);
  });
});
