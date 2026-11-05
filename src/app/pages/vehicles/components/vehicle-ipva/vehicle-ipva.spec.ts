import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VehicleIpva } from './vehicle-ipva';
import { VehicleIpvaService } from '../../../../services/vehicle-ipva.service';
import { NotificationService } from '../../../../services/notification.service';
import type { IpvaInstallment, IpvaYear } from '../../../../types/vehicle-ipva.types';

/**
 * IPVA por exercício (FEAT-0422): ano vazio → gerar três parcelas → editar uma.
 *
 * O fixture usa o arredondamento REAL do backend (R$ 1.000,00 em 3x →
 * 333,34 / 333,33 / 333,33), e o resumo vem pronto do `IpvaYear` — a tela não
 * soma, então o teste confere que ela mostra o que o backend mandou.
 */
describe('VehicleIpva', () => {
  const VEHICLE_ID = 'veh-1';
  const YEAR = Number(new Date().toISOString().slice(0, 4));

  function inst(number: number, amountCents: number, paid = false): IpvaInstallment {
    return {
      id: `i-${number}`,
      vehicleId: VEHICLE_ID,
      year: YEAR,
      number,
      dueDate: `${YEAR + 1}-0${number}-10`,
      amountCents,
      paidDate: paid ? `${YEAR}-01-05` : null,
      paidAmountCents: paid ? amountCents : null,
      paid,
      status: paid ? 'PAID' : 'PENDING',
    };
  }

  function yearOf(installments: IpvaInstallment[]): IpvaYear {
    const total = installments.reduce((a, i) => a + (i.amountCents ?? 0), 0);
    const paid = installments.filter((i) => i.paid).reduce((a, i) => a + (i.amountCents ?? 0), 0);
    const open = installments.filter((i) => !i.paid);
    return {
      vehicleId: VEHICLE_ID,
      year: YEAR,
      totalCents: total,
      paidCents: paid,
      openCents: total - paid,
      installmentsCount: installments.length,
      paidCount: installments.length - open.length,
      nextDueDate: open[0]?.dueDate ?? null,
      status: installments.length === 0 ? null : open.length === 0 ? 'PAID' : 'PENDING',
      installments,
    };
  }

  const generated = yearOf([inst(1, 33_334), inst(2, 33_333), inst(3, 33_333)]);

  let svc: {
    listYears: ReturnType<typeof vi.fn>;
    generate: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    pay: ReturnType<typeof vi.fn>;
    unpay: ReturnType<typeof vi.fn>;
  };
  let fixture: ComponentFixture<VehicleIpva>;

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(node: Element | null): string {
    return (node?.textContent ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function brl(cents: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
      .format(cents / 100)
      .replace(/[  ]/g, ' ');
  }

  /** Digita no campo real, pela máscara pt-BR — o controle guarda TEXTO. */
  function type(selector: string, value: string): void {
    const input = el().ownerDocument.querySelector<HTMLInputElement>(selector);
    expect(input, selector).not.toBeNull();
    input!.value = value;
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function submitSheet(): void {
    const form = el().ownerDocument.querySelector<HTMLFormElement>('#ipva-sheet-form');
    expect(form).not.toBeNull();
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  async function render(years: IpvaYear[] = [], sold = false): Promise<void> {
    svc.listYears.mockReturnValue(of(years));
    fixture = TestBed.createComponent(VehicleIpva);
    fixture.componentRef.setInput('vehicleId', VEHICLE_ID);
    fixture.componentRef.setInput('sold', sold);
    fixture.componentRef.setInput('lockReason', sold ? 'Veículo vendido.' : null);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    svc = {
      listYears: vi.fn(),
      generate: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      pay: vi.fn(),
      unpay: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [VehicleIpva],
      providers: [
        provideNoopAnimations(),
        { provide: VehicleIpvaService, useValue: svc },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
  });

  it('shows the empty state for a year without IPVA', async () => {
    await render([]);
    expect(text(el().querySelector('[data-ipva-empty]'))).toContain(
      `Sem IPVA cadastrado para ${YEAR}`,
    );
    expect(el().querySelector('[data-ipva-kpis]')).toBeNull();
  });

  it('generates three installments, then edits one through the pt-BR money control', async () => {
    await render([]);

    (el().querySelector('[data-ipva-generate]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().ownerDocument.querySelector('[data-ipva-sheet="generate"]')).not.toBeNull();

    type('#ipva-total', '1000,00');
    type('#ipva-count', '3');
    type('#ipva-first-due', `${YEAR + 1}-01-10`);
    fixture.detectChanges();
    // A máscara escreve a gramática pt-BR; o preview mostra a divisão real.
    expect(
      el().ownerDocument.querySelector<HTMLInputElement>('#ipva-total')!.value,
    ).toBe('1.000,00');
    expect(text(el().ownerDocument.querySelector('[data-ipva-preview]'))).toContain(
      `1x de ${brl(33_334)} e 2x de ${brl(33_333)}`,
    );

    svc.generate.mockReturnValue(of(generated));
    submitSheet();

    expect(svc.generate).toHaveBeenCalledWith(VEHICLE_ID, YEAR, {
      totalCents: 100_000,
      installments: 3,
      firstDueDate: `${YEAR + 1}-01-10`,
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const rows = el().querySelectorAll('[data-ipva-installment]');
    expect(rows.length).toBe(3);
    expect(text(rows[0])).toContain(brl(33_334));
    expect(text(el().querySelector('[data-ipva-kpi="total"]'))).toContain('Total');

    // Editar a parcela 2: o campo abre com o valor em TEXTO pt-BR, não número.
    (fixture.componentInstance as unknown as { openEdit(r: IpvaInstallment): void }).openEdit(
      generated.installments[1],
    );
    fixture.detectChanges();
    const amount = el().ownerDocument.querySelector<HTMLInputElement>('#ipva-amount')!;
    expect(amount.value).toBe('333,33');

    type('#ipva-amount', '400,00');
    type('#ipva-due-date', `${YEAR + 1}-02-15`);
    fixture.detectChanges();
    const edited = yearOf([inst(1, 33_334), { ...inst(2, 40_000), dueDate: `${YEAR + 1}-02-15` }, inst(3, 33_333)]);
    svc.update.mockReturnValue(of(edited));
    submitSheet();

    expect(svc.update).toHaveBeenCalledWith(VEHICLE_ID, YEAR, 'i-2', {
      dueDate: `${YEAR + 1}-02-15`,
      amountCents: 40_000,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el().querySelectorAll('[data-ipva-installment]')[1])).toContain(brl(40_000));
  });

  it('refuses to submit a money field the pt-BR grammar rejects', async () => {
    await render([]);
    (el().querySelector('[data-ipva-generate]') as HTMLButtonElement).click();
    fixture.detectChanges();
    type('#ipva-first-due', `${YEAR + 1}-01-10`);
    submitSheet();
    expect(svc.generate).not.toHaveBeenCalled();
  });

  it('pays and unpays an installment, sending the typed amount in cents', async () => {
    await render([generated]);
    const api = fixture.componentInstance as unknown as {
      openPay(r: IpvaInstallment): void;
      askUnpay(r: IpvaInstallment): void;
      confirmUnpay(): void;
    };
    api.openPay(generated.installments[0]);
    fixture.detectChanges();
    type('#ipva-paid-amount', '350,00');
    const paidYear = yearOf([inst(1, 33_334, true), inst(2, 33_333), inst(3, 33_333)]);
    svc.pay.mockReturnValue(of(paidYear));
    submitSheet();
    expect(svc.pay).toHaveBeenCalledWith(VEHICLE_ID, YEAR, 'i-1', {
      paidDate: expect.any(String),
      paidAmountCents: 35_000,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el().querySelector('[data-ipva-installment="1"]'))).toContain('Paga');

    svc.unpay.mockReturnValue(of(generated));
    api.askUnpay(paidYear.installments[0]);
    api.confirmUnpay();
    fixture.detectChanges();
    expect(svc.unpay).toHaveBeenCalledWith(VEHICLE_ID, YEAR, 'i-1');
    expect(text(el().querySelector('[data-ipva-installment="1"]'))).toContain('Em aberto');
  });

  it('deletes an installment and falls back to the empty state when the year empties', async () => {
    const single = yearOf([inst(1, 50_000)]);
    await render([single]);
    const api = fixture.componentInstance as unknown as {
      askDelete(r: IpvaInstallment): void;
      confirmDelete(): void;
    };
    svc.remove.mockReturnValue(of(yearOf([])));
    api.askDelete(single.installments[0]);
    api.confirmDelete();
    fixture.detectChanges();
    expect(svc.remove).toHaveBeenCalledWith(VEHICLE_ID, YEAR, 'i-1');
    expect(text(el().querySelector('[data-ipva-empty]'))).toContain(`Sem IPVA cadastrado para ${YEAR}`);
  });

  it('switches years with the pill tabs and opens on the newest year with data', async () => {
    const old: IpvaYear = { ...yearOf([{ ...inst(1, 20_000, true), year: YEAR - 1 }]), year: YEAR - 1 };
    await render([old]);
    // Ano corrente sem parcelas → abre no exercício cadastrado mais novo.
    expect(el().querySelectorAll('[data-ipva-installment]').length).toBe(1);
    const current = el().querySelector<HTMLButtonElement>(`[data-testid="ipva-year-${YEAR}"]`);
    expect(current).not.toBeNull();
    current!.click();
    fixture.detectChanges();
    expect(text(el().querySelector('[data-ipva-empty]'))).toContain(`Sem IPVA cadastrado para ${YEAR}`);
  });

  it('locks generate and add on a sold vehicle', async () => {
    await render([], true);
    const generate = el().querySelector<HTMLButtonElement>('[data-ipva-generate]')!;
    expect(generate.disabled).toBe(true);
    expect(generate.title).toBe('Veículo vendido.');
    generate.click();
    fixture.detectChanges();
    expect(el().ownerDocument.querySelector('[data-ipva-sheet]')).toBeNull();
  });

  it('shows the load failure with a retry instead of an empty year', async () => {
    svc.listYears.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500 })) as Observable<IpvaYear[]>,
    );
    fixture = TestBed.createComponent(VehicleIpva);
    fixture.componentRef.setInput('vehicleId', VEHICLE_ID);
    fixture.detectChanges();
    expect(el().querySelector('[data-ipva-load-error]')).not.toBeNull();
    expect(el().querySelector('[data-ipva-empty]')).toBeNull();
  });
});
