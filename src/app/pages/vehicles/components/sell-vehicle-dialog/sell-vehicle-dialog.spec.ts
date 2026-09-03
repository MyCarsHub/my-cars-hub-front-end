import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it } from 'vitest';

import { SellVehicleDialog, SellVehicleFormValue } from './sell-vehicle-dialog';

/**
 * O diálogo de venda, testado sozinho (FEAT-0072).
 *
 * O que vive aqui e não no spec da tela: a CONVERSÃO pt-BR → centavos e as
 * recusas do formulário. Dinheiro é o ponto caro — "45.000,00" são 4.500.000
 * centavos, e um `type="number"` leria 45. Cada caso abaixo é uma forma de
 * errar isso.
 */
describe('SellVehicleDialog', () => {
  const HOJE = '2026-08-31';

  let fixture: ComponentFixture<SellVehicleDialog>;
  /** Payloads emitidos, na ordem — tipados, para o `toEqual` valer alguma coisa. */
  let payloads: SellVehicleFormValue[];
  let cancelCount: number;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function typeInto(selector: string, value: string): void {
    const input = host().querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`campo ${selector} não está na tela`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function clickConfirm(): void {
    const btn = Array.from(host().querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Registrar venda'),
    );
    if (!btn) throw new Error('o botão de confirmar não está na tela');
    btn.click();
    fixture.detectChanges();
  }

  /** Preenche nome e data válidos e digita o valor pedido. */
  function fillWithAmount(raw: string): void {
    typeInto('#sell-vehicle-buyer', 'Maria Compradora');
    typeInto('#sell-vehicle-date', '2026-08-20');
    if (raw !== '') typeInto('#sell-vehicle-amount', raw);
  }

  function emitted(): SellVehicleFormValue | undefined {
    return payloads[0];
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideNoopAnimations()] });

    fixture = TestBed.createComponent(SellVehicleDialog);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('maxSaleDate', HOJE);
    payloads = [];
    cancelCount = 0;
    fixture.componentInstance.confirmed.subscribe((value: SellVehicleFormValue) => {
      payloads.push(value);
    });
    fixture.componentInstance.cancelled.subscribe(() => {
      cancelCount += 1;
    });
    fixture.detectChanges();
  });

  // ------------------------------------------------- conversão para centavos

  it('converte "45.000,00" em 4500000 centavos', () => {
    fillWithAmount('45.000,00');
    clickConfirm();

    expect(emitted()?.saleValueCents).toBe(4_500_000);
  });

  it('converte "0,05" em 5 centavos — o menor valor aceito', () => {
    fillWithAmount('0,05');
    clickConfirm();

    expect(emitted()?.saleValueCents).toBe(5);
  });

  /** Uma casa decimal só: "1.234,5" é mil duzentos e trinta e quatro e cinquenta. */
  it('converte "1.234,5" em 123450 centavos', () => {
    fillWithAmount('1.234,5');
    clickConfirm();

    expect(emitted()?.saleValueCents).toBe(123_450);
  });

  it('valor vazio não emite nada e mostra o erro inline', () => {
    fillWithAmount('');
    clickConfirm();

    expect(payloads).toHaveLength(0);
    expect(host().textContent).toContain('Informe o valor da venda.');
  });

  /**
   * DIVERGÊNCIA DELIBERADA: o backend aceita `@Min(0)`, o formulário exige
   * `> 0`. Zero num campo de venda é quase sempre engano, e gravar venda de
   * R$ 0 é estrago silencioso no financeiro.
   */
  it('recusa R$ 0 mesmo o backend aceitando @Min(0)', () => {
    fillWithAmount('0,00');
    clickConfirm();

    expect(payloads).toHaveLength(0);
    expect(host().textContent).toContain('Informe um valor maior que zero');
  });

  it('recusa texto que não é número pt-BR', () => {
    fillWithAmount('quarenta mil');
    clickConfirm();

    expect(payloads).toHaveLength(0);
    expect(host().textContent).toContain('Informe um valor maior que zero');
  });

  // ------------------------------------------------------------------ datas

  /**
   * O `max` do `input[type=date]` é dica do browser: teclado e colagem passam
   * por cima dele, e o jsdom nem o aplica. A recusa tem de estar no CONFIRM.
   */
  it('recusa data futura no confirm, não só pelo atributo max', () => {
    typeInto('#sell-vehicle-buyer', 'Maria Compradora');
    typeInto('#sell-vehicle-date', '2099-01-01');
    typeInto('#sell-vehicle-amount', '45.000,00');
    clickConfirm();

    expect(payloads).toHaveLength(0);
    expect(host().textContent).toContain('A venda não pode ser no futuro.');
    // E o atributo continua lá, para o date picker do browser ajudar antes.
    expect(host().querySelector('#sell-vehicle-date')?.getAttribute('max')).toBe(HOJE);
  });

  it('aceita a data de HOJE (o teto é inclusivo, como o @PastOrPresent)', () => {
    typeInto('#sell-vehicle-buyer', 'Maria Compradora');
    typeInto('#sell-vehicle-date', HOJE);
    typeInto('#sell-vehicle-amount', '10,00');
    clickConfirm();

    expect(emitted()?.saleDate).toBe(HOJE);
  });

  // ---------------------------------------------------------------- payload

  it('emite o payload já no formato do POST, com o nome sem espaços nas bordas', () => {
    typeInto('#sell-vehicle-buyer', '  Maria Compradora  ');
    typeInto('#sell-vehicle-date', '2026-08-20');
    typeInto('#sell-vehicle-amount', '45.000,00');
    clickConfirm();

    expect(emitted()).toEqual({
      buyerName: 'Maria Compradora',
      saleDate: '2026-08-20',
      saleValueCents: 4_500_000,
    });
  });

  it('nome em branco não emite e é cobrado inline', () => {
    typeInto('#sell-vehicle-date', '2026-08-20');
    typeInto('#sell-vehicle-amount', '45.000,00');
    clickConfirm();

    expect(payloads).toHaveLength(0);
    expect(host().textContent).toContain('Informe o nome de quem comprou o veículo.');
  });

  // ------------------------------------------------------------- fechamento

  it('o clique no backdrop NÃO descarta um formulário preenchido', () => {
    typeInto('#sell-vehicle-buyer', 'Maria Compradora');

    host().querySelector<HTMLElement>('[aria-hidden="true"]')?.click();
    fixture.detectChanges();

    expect(cancelCount).toBe(0);
  });

  it('o clique no backdrop fecha quando nada foi digitado', () => {
    host().querySelector<HTMLElement>('[aria-hidden="true"]')?.click();
    fixture.detectChanges();

    expect(cancelCount).toBe(1);
  });

  it('o botão Voltar sempre fecha, mesmo com o formulário preenchido', () => {
    typeInto('#sell-vehicle-buyer', 'Maria Compradora');

    Array.from(host().querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').includes('Voltar'))
      ?.click();
    fixture.detectChanges();

    expect(cancelCount).toBe(1);
  });
});
