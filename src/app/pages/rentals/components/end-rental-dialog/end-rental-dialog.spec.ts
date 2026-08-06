import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Component, signal } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';

import { provideRouter } from '@angular/router';

import { EndRentalDialog, EndRentalDialogPayload } from './end-rental-dialog';
import { OverdueFeeSummary } from '../../../../types/overdue.types';
import { RentalChargeDto, RentalResponseDto } from '../../../../types/rental.types';
import { nowHhMmInBusinessTz, todayInBusinessTz } from '../../../../utils/business-clock';

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

/**
 * Multa por devolução em atraso (V53) no popup de conclusão.
 *
 * As quatro garantias que a interface precisa manter:
 *  1. atraso mostra a CONTA, não só o total;
 *  2. devolução no prazo não mostra multa nenhuma — nem um "R$ 0,00";
 *  3. mudar a data/hora de devolução pede uma prévia nova;
 *  4. confirmar só destrava depois do "ciente".
 */
describe('EndRentalDialog — prévia da multa por atraso', () => {
  const overdueRental: RentalResponseDto = {
    id: 'r-9',
    vehicleId: 'v-1',
    driverId: 'd-1',
    startDate: '2026-07-01',
    endDate: '2026-07-20',
    periodRate: 10_000,
    totalAmount: 200_000,
    caucaoAmount: 0,
    caucaoPaid: false,
    status: 'ACTIVE',
    billingFrequency: 'DAILY',
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
    createdAt: '2026-07-01T00:00:00Z',
    modifiedAt: '2026-07-01T00:00:00Z',
  };

  /** 2 diárias × R$ 100,00 × 1,5x = R$ 300,00. */
  const OVERDUE: OverdueFeeSummary = {
    chargeId: null,
    overdue: true,
    overdueDays: 2,
    dailyRate: 10_000,
    multiplierBps: 15_000,
    graceHours: 3,
    amount: 30_000,
    dueAt: '2026-07-21T03:00:00',
    returnedAt: '2026-07-22T23:00:00',
  };

  const ON_TIME: OverdueFeeSummary = {
    chargeId: null,
    overdue: false,
    overdueDays: 0,
    dailyRate: 0,
    multiplierBps: 15_000,
    graceHours: 3,
    amount: 0,
    dueAt: '2026-07-21T03:00:00',
    returnedAt: '2026-07-20T18:00:00',
  };

  @Component({
    imports: [EndRentalDialog],
    template: `<app-end-rental-dialog
      [open]="open()"
      [rental]="rental"
      [intent]="'complete'"
      [overduePreview]="preview()"
      [overduePreviewLoading]="loading()"
      (returnAtChanged)="requested.set([...requested(), $event])"
      (confirmed)="last.set($event)"
    />`,
  })
  class PreviewHost {
    readonly open = signal(true);
    readonly rental = overdueRental;
    readonly preview = signal<OverdueFeeSummary | null>(null);
    readonly loading = signal(false);
    readonly requested = signal<string[]>([]);
    readonly last = signal<EndRentalDialogPayload | null>(null);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PreviewHost],
      providers: [provideNoopAnimations(), provideRouter([])],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(PreviewHost);
    fixture.detectChanges();
    return fixture;
  }

  function el(fixture: { nativeElement: unknown }): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * `Intl.NumberFormat('pt-BR')` separa "R$" do número com NBSP (U+00A0). Sem
   * normalizar, `not.toContain('R$ 0,00')` passaria por engano — e o teste que
   * garante "nem um zero" seria decorativo.
   */
  function text(root: HTMLElement): string {
    return (root.textContent ?? '').replace(/\u00a0/g, ' ');
  }

  function confirmBtn(root: HTMLElement): HTMLButtonElement {
    const btn = Array.from(root.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Concluir aluguel'),
    );
    if (!btn) throw new Error('botão de conclusão não encontrado');
    return btn;
  }

  function ackBox(root: HTMLElement): HTMLInputElement | null {
    return root.querySelector<HTMLInputElement>('input[type="checkbox"][class*="accent-amber-700"]');
  }

  it('pede a prévia assim que abre, com a data-e-hora local escolhida', () => {
    const fixture = render();

    const asked = fixture.componentInstance.requested();
    expect(asked.length).toBeGreaterThan(0);
    // Local, sem offset: `yyyy-MM-ddTHH:mm:ss` e nada de `Z`.
    expect(asked[asked.length - 1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/);
  });

  it('mostra a CONTA, não só o total, quando há atraso', () => {
    const fixture = render();
    fixture.componentInstance.preview.set(OVERDUE);
    fixture.detectChanges();

    const rendered = text(el(fixture));
    expect(rendered).toContain('Devolução em atraso');
    expect(rendered).toContain('2 diárias');
    expect(rendered).toContain('1,5x');
    expect(rendered).toContain('R$ 300,00');
    // Os instantes chegam sem conversão de fuso — 03:00 continua 03:00.
    expect(rendered).toContain('21/07/2026 às 03:00');
    expect(rendered).toContain('22/07/2026 às 23:00');
  });

  it('devolução no prazo não mostra multa nenhuma — nem um zero', () => {
    const fixture = render();
    fixture.componentInstance.preview.set(ON_TIME);
    fixture.detectChanges();

    const rendered = text(el(fixture));
    expect(rendered).toContain('Devolução dentro do prazo');
    expect(rendered).not.toContain('R$ 0,00');
    expect(rendered).not.toContain('0,00');
    expect(rendered).not.toContain('Devolução em atraso');
    expect(ackBox(el(fixture))).toBeNull();
    expect(confirmBtn(el(fixture)).disabled).toBe(false);
  });

  it('trava a confirmação até o usuário se declarar ciente da multa', () => {
    const fixture = render();
    fixture.componentInstance.preview.set(OVERDUE);
    fixture.detectChanges();

    const root = el(fixture);
    expect(confirmBtn(root).disabled).toBe(true);

    const ack = ackBox(root);
    expect(ack).not.toBeNull();
    ack!.click();
    fixture.detectChanges();

    expect(confirmBtn(root).disabled).toBe(false);

    confirmBtn(root).click();
    fixture.detectChanges();
    // O horário da devolução acompanha o payload, local e sem offset.
    expect(fixture.componentInstance.last()?.actualReturnAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/,
    );
  });

  it('mudar a hora da devolução pede prévia nova e derruba o "ciente"', () => {
    const fixture = render();
    fixture.componentInstance.preview.set(OVERDUE);
    fixture.detectChanges();

    const root = el(fixture);
    ackBox(root)!.click();
    fixture.detectChanges();
    expect(confirmBtn(root).disabled).toBe(false);

    const before = fixture.componentInstance.requested().length;
    const time = root.querySelector<HTMLInputElement>('#end-return-time');
    expect(time).not.toBeNull();
    time!.value = '23:45';
    time!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const asked = fixture.componentInstance.requested();
    expect(asked.length).toBeGreaterThan(before);
    expect(asked[asked.length - 1]).toContain('T23:45:00');
    // Valor pode ter mudado: o consentimento anterior não vale para o novo.
    expect(confirmBtn(root).disabled).toBe(true);
  });

  it('não deixa confirmar enquanto a prévia está sendo recalculada', () => {
    const fixture = render();
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();

    expect(confirmBtn(el(fixture)).disabled).toBe(true);
    expect(el(fixture).textContent).toContain('Calculando a multa por atraso');
  });

  it('multa já lançada informa, mas não pede novo consentimento', () => {
    const fixture = render();
    fixture.componentInstance.preview.set({ ...OVERDUE, chargeId: 'chg-1' });
    fixture.detectChanges();

    const root = el(fixture);
    expect(root.textContent).toContain('Multa por atraso já lançada');
    expect(root.textContent).toContain('concluir não gera outra');
    expect(ackBox(root)).toBeNull();
    expect(confirmBtn(root).disabled).toBe(false);
  });

  it('a prévia e o payload pedem exatamente o MESMO instante', () => {
    const fixture = render();
    const root = el(fixture);

    // Data acima do teto (`max` = hoje): o clamp normaliza. A prévia tem de ser
    // pedida para a data JÁ normalizada, senão o valor mostrado é de um dia e
    // o cobrado é de outro.
    const date = root.querySelector<HTMLInputElement>('#end-date');
    expect(date).not.toBeNull();
    date!.value = '2099-12-31';
    date!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    fixture.componentInstance.preview.set(ON_TIME);
    fixture.detectChanges();
    confirmBtn(root).click();
    fixture.detectChanges();

    const asked = fixture.componentInstance.requested();
    expect(asked[asked.length - 1]).toBe(fixture.componentInstance.last()?.actualReturnAt);
    expect(asked[asked.length - 1]).not.toContain('2099');
  });

  it('a data e a hora nascem no relógio de Brasília, não no do navegador', () => {
    const root = el(render());

    expect(root.querySelector<HTMLInputElement>('#end-date')?.value).toBe(todayInBusinessTz());
    expect(root.querySelector<HTMLInputElement>('#end-return-time')?.value).toBe(
      nowHhMmInBusinessTz(),
    );
  });
});

/**
 * **Prévia que FALHA.** O buraco que este bloco fecha: com erro na prévia o
 * caller zera `overduePreview`, o dialog concluía que "não há multa", o "ciente"
 * sumia e o botão destravava. O operador confirmava, o backend lançava a multa
 * assim mesmo e o cliente era cobrado sem ninguém ter visto o valor.
 *
 * A regra passa a distinguir três estados, não dois: TEM multa (valor à vista),
 * NÃO tem multa (prévia respondeu no prazo), e NÃO SEI (prévia falhou) — este
 * último com ciência própria, porque o risco de que se está ciente é outro.
 */
describe('EndRentalDialog — prévia da multa que falha', () => {
  const rental: RentalResponseDto = {
    id: 'r-9',
    vehicleId: 'v-1',
    driverId: 'd-1',
    startDate: '2026-07-01',
    endDate: '2026-07-20',
    periodRate: 10_000,
    totalAmount: 200_000,
    caucaoAmount: 0,
    caucaoPaid: false,
    status: 'ACTIVE',
    billingFrequency: 'DAILY',
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
    createdAt: '2026-07-01T00:00:00Z',
    modifiedAt: '2026-07-01T00:00:00Z',
  };

  const OVERDUE: OverdueFeeSummary = {
    chargeId: null,
    overdue: true,
    overdueDays: 2,
    dailyRate: 10_000,
    multiplierBps: 15_000,
    graceHours: 3,
    amount: 30_000,
    dueAt: '2026-07-21T03:00:00',
    returnedAt: '2026-07-22T23:00:00',
  };

  @Component({
    imports: [EndRentalDialog],
    template: `<app-end-rental-dialog
      [open]="open()"
      [rental]="rental"
      [intent]="'complete'"
      [overduePreview]="preview()"
      [overduePreviewLoading]="loading()"
      [overduePreviewError]="error()"
      (returnAtChanged)="requested.set([...requested(), $event])"
      (confirmed)="last.set($event)"
    />`,
  })
  class FailureHost {
    readonly open = signal(true);
    readonly rental = rental;
    readonly preview = signal<OverdueFeeSummary | null>(null);
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly requested = signal<string[]>([]);
    readonly last = signal<EndRentalDialogPayload | null>(null);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FailureHost],
      providers: [provideNoopAnimations(), provideRouter([])],
    });
  });

  function render(): ComponentFixture<FailureHost> {
    const fixture = TestBed.createComponent(FailureHost);
    fixture.detectChanges();
    return fixture;
  }

  function el(fixture: ComponentFixture<FailureHost>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function confirmBtn(root: HTMLElement): HTMLButtonElement {
    const btn = Array.from(root.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Concluir aluguel'),
    );
    if (!btn) throw new Error('botão de conclusão não encontrado');
    return btn;
  }

  /** Ciência de concluir SEM saber o valor — não é o "ciente" da multa. */
  function blindAck(root: HTMLElement): HTMLInputElement | null {
    return root.querySelector<HTMLInputElement>('#end-overdue-blind-ack');
  }

  function feeAck(root: HTMLElement): HTMLInputElement | null {
    return root.querySelector<HTMLInputElement>('input[type="checkbox"][class*="accent-amber-700"]');
  }

  function fail(fixture: ComponentFixture<FailureHost>): void {
    // Exatamente o que o `catchError` do RentalDetail faz: zera a prévia e
    // publica a mensagem. Era esta combinação que destravava o botão.
    fixture.componentInstance.preview.set(null);
    fixture.componentInstance.error.set('Não foi possível calcular a multa por atraso.');
    fixture.detectChanges();
  }

  it('NÃO destrava o confirmar: prévia falhando não é prévia sem multa', () => {
    const fixture = render();
    fail(fixture);

    const root = el(fixture);
    expect(root.textContent).toContain('Não foi possível calcular a multa por atraso.');
    expect(confirmBtn(root).disabled).toBe(true);
    // E não pode se disfarçar de "dentro do prazo".
    expect(root.textContent).not.toContain('Devolução dentro do prazo');
  });

  it('destrava só com a ciência EXPLÍCITA de concluir sem saber o valor', () => {
    const fixture = render();
    fail(fixture);

    const root = el(fixture);
    const ack = blindAck(root);
    expect(ack).not.toBeNull();
    expect(ack!.checked).toBe(false);
    // A ciência avisa o que está em jogo: pode haver cobrança, de valor incerto.
    expect(root.textContent).toContain('sem saber o valor');

    ack!.click();
    fixture.detectChanges();

    expect(confirmBtn(root).disabled).toBe(false);
    confirmBtn(root).click();
    expect(fixture.componentInstance.last()).not.toBeNull();
  });

  it('a ciência do risco não é o "ciente" da multa — são caixas distintas', () => {
    const fixture = render();
    fail(fixture);

    const root = el(fixture);
    expect(blindAck(root)).not.toBeNull();
    expect(feeAck(root)).toBeNull();
  });

  it('erro que chega DEPOIS de uma multa aceita volta a travar o botão', () => {
    const fixture = render();
    fixture.componentInstance.preview.set(OVERDUE);
    fixture.detectChanges();

    const root = el(fixture);
    feeAck(root)!.click();
    fixture.detectChanges();
    expect(confirmBtn(root).disabled).toBe(false);

    fail(fixture);

    // O "ciente" de R$ 300,00 não vale como ciência de um valor desconhecido.
    expect(confirmBtn(root).disabled).toBe(true);
  });

  it('mudar a hora derruba a ciência do risco', () => {
    const fixture = render();
    fail(fixture);

    const root = el(fixture);
    blindAck(root)!.click();
    fixture.detectChanges();
    expect(confirmBtn(root).disabled).toBe(false);

    const time = root.querySelector<HTMLInputElement>('#end-return-time');
    time!.value = '23:45';
    time!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(confirmBtn(root).disabled).toBe(true);
  });

  it('reabrir o dialog zera a ciência do risco', async () => {
    const fixture = render();
    fail(fixture);
    blindAck(el(fixture))!.click();
    fixture.detectChanges();

    fixture.componentInstance.open.set(false);
    await fixture.whenStable();
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();

    expect(blindAck(el(fixture))?.checked).toBe(false);
  });

  it('oferece tentar de novo, pedindo a prévia para o mesmo instante', async () => {
    const fixture = render();
    fail(fixture);

    const root = el(fixture);
    const before = fixture.componentInstance.requested();
    const retry = Array.from(root.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Tentar de novo'),
    );
    expect(retry).toBeDefined();

    retry!.click();
    await fixture.whenStable();

    const asked = fixture.componentInstance.requested();
    expect(asked.length).toBe(before.length + 1);
    expect(asked[asked.length - 1]).toBe(before[before.length - 1]);
  });
});
