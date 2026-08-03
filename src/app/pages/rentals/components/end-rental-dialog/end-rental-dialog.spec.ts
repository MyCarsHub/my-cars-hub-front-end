import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Component, signal } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';

import { EndRentalDialog, EndRentalDialogPayload } from './end-rental-dialog';
import { RentalChargeDto, RentalResponseDto } from '../../../../types/rental.types';

/**
 * Opt-in de apagar as cobranças VENCIDAS e não pagas no Asaas. Regra de negócio:
 * desmarcado por padrão sempre — apagar dívida é irreversível.
 */
describe('EndRentalDialog — opt-in removeOverdueCharges', () => {
  const rental: RentalResponseDto = {
    id: 'r-1',
    vehicleId: 'v-1',
    driverId: 'd-1',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    periodRate: 10_000,
    totalAmount: 100_000,
    caucaoAmount: 0,
    caucaoPaid: false,
    status: 'ACTIVE',
    billingFrequency: 'MONTHLY',
    notes: null,
    initialKm: null,
    pickupDate: null,
    firstPaymentDate: null,
    dailyInterestAmount: null,
    lateFineType: null,
    lateFineValue: null,
    contractSource: null,
    franchiseKm: null,
    returnFuelPolicy: null,
    charges: [],
    createdAt: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
  };

  @Component({
    imports: [EndRentalDialog],
    template: `<app-end-rental-dialog
      [open]="open()"
      [rental]="rental"
      [intent]="'cancel'"
      (confirmed)="last.set($event)"
    />`,
  })
  class Host {
    readonly open = signal(true);
    readonly rental = rental;
    readonly last = signal<EndRentalDialogPayload | null>(null);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideNoopAnimations()],
    });
  });

  function checkbox(root: HTMLElement): HTMLInputElement {
    const el = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!el) throw new Error('checkbox de cobranças vencidas não renderizado');
    return el;
  }

  function confirmButton(root: HTMLElement): HTMLButtonElement {
    const btn = Array.from(root.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Cancelar aluguel'),
    );
    if (!btn) throw new Error('botão de confirmação não encontrado');
    return btn;
  }

  it('nasce desmarcado e emite removeOverdueCharges=false', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(checkbox(root).checked).toBe(false);

    confirmButton(root).click();
    expect(fixture.componentInstance.last()?.removeOverdueCharges).toBe(false);
  });

  it('emite removeOverdueCharges=true quando marcado e reseta ao reabrir', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    const box = checkbox(root);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    confirmButton(root).click();
    expect(fixture.componentInstance.last()?.removeOverdueCharges).toBe(true);

    fixture.componentInstance.open.set(false);
    await fixture.whenStable();
    fixture.componentInstance.open.set(true);
    // `whenStable` (e não `detectChanges`) porque o reset roda no `effect` de
    // abertura — precisa do flush de efeitos antes do re-render do [checked].
    await fixture.whenStable();

    expect(checkbox(fixture.nativeElement as HTMLElement).checked).toBe(false);
  });

  it('o aviso comunica as três garantias sobre as cobranças', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('ainda não venceram');
    expect(text).toContain('permanecem cobráveis');
    expect(text).toContain('não são estornadas');
  });
});

/**
 * Devolução da caução — a seção aparece SEMPRE que houver caução, e a copy muda
 * conforme o estado real da charge CAUCAO (não conforme `automaticCharge`).
 *
 * Fronteira do backend respeitada aqui (`RentalService.validateRefundRequest`):
 * `AUTOMATIC` exige charge CAUCAO PAID; `MANUAL` só exige `caucaoAmount > 0`.
 */
describe('EndRentalDialog — devolução da caução por estado', () => {
  const baseRental: RentalResponseDto = {
    id: 'r-1',
    vehicleId: 'v-1',
    driverId: 'd-1',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    periodRate: 10_000,
    totalAmount: 100_000,
    caucaoAmount: 50_000,
    caucaoPaid: false,
    status: 'ACTIVE',
    billingFrequency: 'MONTHLY',
    notes: null,
    initialKm: null,
    pickupDate: null,
    firstPaymentDate: null,
    dailyInterestAmount: null,
    lateFineType: null,
    lateFineValue: null,
    contractSource: null,
    franchiseKm: null,
    returnFuelPolicy: null,
    charges: [],
    createdAt: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
  };

  function caucaoCharge(over: Partial<RentalChargeDto>): RentalChargeDto {
    return {
      id: 'c-1',
      kind: 'CAUCAO',
      amount: 50_000,
      status: 'PENDING',
      provider: 'ASAAS',
      externalId: null,
      checkoutUrl: null,
      paidAt: null,
      dueDate: '2026-01-01',
      periodIndex: null,
      ...over,
    };
  }

  function rentalWith(over: Partial<RentalResponseDto>): RentalResponseDto {
    return { ...baseRental, ...over };
  }

  /** A — estorno pelo gateway: charge PAID com externalId. */
  const gatewayRental = rentalWith({
    charges: [
      caucaoCharge({ status: 'PAID', externalId: 'pay_123', paidAt: '2026-01-02T00:00:00Z' }),
    ],
  });

  /** B — paga, mas sem cobrança estornável (importada em andamento). */
  const paidOfflineRental = rentalWith({
    charges: [caucaoCharge({ status: 'PAID', externalId: null, paidAt: '2026-01-02T00:00:00Z' })],
  });

  /** C — caução não paga (cobrança em aberto). */
  const unpaidRental = rentalWith({ charges: [caucaoCharge({ status: 'PENDING' })] });

  /** Sem caução — nada a devolver. */
  const noCaucaoRental = rentalWith({ caucaoAmount: 0, charges: [] });

  @Component({
    imports: [EndRentalDialog],
    template: `<app-end-rental-dialog
      [open]="open()"
      [rental]="rental()"
      [intent]="'complete'"
      (confirmed)="last.set($event)"
    />`,
  })
  class RefundHost {
    readonly open = signal(true);
    readonly rental = signal<RentalResponseDto>(baseRental);
    readonly last = signal<EndRentalDialogPayload | null>(null);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RefundHost],
      providers: [provideNoopAnimations()],
    });
  });

  function render(rental: RentalResponseDto) {
    const fixture = TestBed.createComponent(RefundHost);
    fixture.componentInstance.rental.set(rental);
    fixture.detectChanges();
    return fixture;
  }

  function root(fixture: { nativeElement: unknown }): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function radio(el: HTMLElement, value: string): HTMLInputElement | null {
    return el.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  }

  function pick(el: HTMLElement, value: string): void {
    const input = radio(el, value);
    if (!input) throw new Error(`radio ${value} não renderizado`);
    input.click();
    input.dispatchEvent(new Event('change'));
  }

  function confirm(el: HTMLElement): void {
    const btn = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Concluir aluguel'),
    );
    if (!btn) throw new Error('botão de confirmação não encontrado');
    btn.click();
  }

  it('A — com charge CAUCAO paga e externalId, oferece o estorno automático', () => {
    const fixture = render(gatewayRental);
    const el = root(fixture);

    expect(el.textContent).toContain('Devolução da caução');
    expect(radio(el, 'AUTOMATIC')).not.toBeNull();
    expect(el.textContent).toContain('Devolve via Asaas (estorno na cobrança da caução).');
    expect(el.textContent).toContain('Paga:');
  });

  it('A — mesmo podendo estornar, nasce em "Não devolver"', () => {
    const el = root(render(gatewayRental));

    expect(radio(el, 'NONE')?.checked).toBe(true);
    expect(radio(el, 'AUTOMATIC')?.checked).toBe(false);
  });

  it('B — charge paga sem externalId: sem opção automática e devolução fora do sistema', () => {
    const el = root(render(paidOfflineRental));

    expect(el.textContent).toContain('Devolução da caução');
    expect(radio(el, 'AUTOMATIC')).toBeNull();
    expect(el.textContent).not.toContain('Devolve via Asaas');
    expect(el.textContent).toContain('não tem cobrança no Asaas para estornar');
    expect(el.textContent).toContain('etapa manual, feita por você fora do sistema');
    expect(el.textContent).toContain('Registrar devolução feita por fora');
  });

  it('B — a caução marcada como recebida por fora cai no mesmo estado', () => {
    const el = root(render(rentalWith({ caucaoPaid: true, charges: [] })));

    expect(radio(el, 'AUTOMATIC')).toBeNull();
    expect(el.textContent).toContain('não tem cobrança no Asaas para estornar');
  });

  it('C — caução não paga: pergunta sem afirmar que o sistema recebeu o dinheiro', () => {
    const el = root(render(unpaidRental));

    expect(el.textContent).toContain('Devolução da caução');
    expect(radio(el, 'AUTOMATIC')).toBeNull();
    expect(el.textContent).toContain('O sistema não tem registro de pagamento desta caução');
    expect(el.textContent).toContain('Prevista:');
    expect(el.textContent).not.toContain('Paga:');
    // Não pode sugerir que a caução escapa das regras das demais cobranças.
    expect(el.textContent).not.toContain('A caução é a exceção');
  });

  it('C — MANUAL emite o valor previsto da caução', () => {
    const fixture = render(unpaidRental);
    const el = root(fixture);

    pick(el, 'MANUAL');
    fixture.detectChanges();
    confirm(el);

    expect(fixture.componentInstance.last()?.caucaoRefund).toEqual({
      method: 'MANUAL',
      amount: 50_000,
    });
  });

  it('C — deixar em "Não devolver" não grava metadata de devolução', () => {
    const fixture = render(unpaidRental);

    confirm(root(fixture));

    // Nada aconteceu com a caução: gravar NONE faria o detalhe exibir
    // "Retida pelo locador" para um valor nunca registrado como recebido.
    expect(fixture.componentInstance.last()?.caucaoRefund).toBeUndefined();
  });

  it('B — "Não devolver" continua gravando a retenção (a caução foi paga)', () => {
    const fixture = render(paidOfflineRental);

    confirm(root(fixture));

    expect(fixture.componentInstance.last()?.caucaoRefund).toEqual({
      method: 'NONE',
      amount: 0,
    });
  });

  it('sem caução, a seção não aparece', () => {
    const el = root(render(noCaucaoRental));

    expect(el.textContent).not.toContain('Devolução da caução');
    expect(radio(el, 'AUTOMATIC')).toBeNull();
    expect(radio(el, 'MANUAL')).toBeNull();
    expect(radio(el, 'NONE')).toBeNull();
  });
});
