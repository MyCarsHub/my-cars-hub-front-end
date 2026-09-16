import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';

import { VehicleRoiItem } from '../../../types/reports.types';
import { VehicleRoiList } from './vehicle-roi-list';

/** Carro saudável: se pagou alugando, sem venda. */
function vehicle(over: Partial<VehicleRoiItem> = {}): VehicleRoiItem {
  return {
    vehicleId: 'v-1',
    plate: 'ABC1D23',
    brand: 'Fiat',
    model: 'Argo',
    returnedCents: 8_000_00,
    returnBreakdown: { rentalCents: 8_000_00, saleCents: 0 },
    costCents: 5_000_00,
    costBreakdown: {
      acquisitionCents: 4_000_00,
      maintenanceCents: 600_00,
      insuranceCents: 250_00,
      fineCents: 100_00,
      incidentCents: 50_00,
    },
    netCents: 3_000_00,
    roiPercent: 60,
    paybackMonth: '2026-03',
    paybackReached: true,
    remainingToPaybackCents: 0,
    ...over,
  };
}

describe('VehicleRoiList', () => {
  let fixture: ComponentFixture<VehicleRoiList>;

  function render(items: VehicleRoiItem[]): string {
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VehicleRoiList],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(VehicleRoiList);
  });

  it('mostra placa, quanto voltou e quanto custou', () => {
    const text = render([vehicle()]);

    expect(text).toContain('ABC1D23');
    expect(text).toContain('Fiat Argo');
    expect(text).toContain('8.000,00');
    expect(text).toContain('5.000,00');
  });

  /**
   * CASO 1 — custo zero. `roiPercent` e `paybackMonth` chegam nulos e isso
   * significa INDETERMINADO, nao zero: dizer "0%" faria o dono concluir que o
   * carro nao deu retorno, quando o que falta e o preco de compra. A saida tem
   * de ser ACIONAVEL.
   */
  describe('custo zero (ROI indeterminado)', () => {
    const semCusto = vehicle({
      costCents: 0,
      costBreakdown: {
        acquisitionCents: 0,
        maintenanceCents: 0,
        insuranceCents: 0,
        fineCents: 0,
        incidentCents: 0,
      },
      netCents: 8_000_00,
      roiPercent: null,
      paybackMonth: null,
      paybackReached: false,
      remainingToPaybackCents: 0,
    });

    it('explica que falta o preco de compra em vez de mostrar 0%', () => {
      const text = render([semCusto]);

      expect(text).toContain('preço de compra');
      expect(text).not.toContain('0%');
      expect(text).not.toContain('Falta');
    });

    it('leva para a tela onde o preco se cadastra', () => {
      render([semCusto]);

      const link = (fixture.nativeElement as HTMLElement).querySelector('a[href]');
      expect(link?.getAttribute('href')).toBe('/veiculos/v-1/editar');
    });

    /**
     * O caso que a review pegou: com custo zero, `netCents` = `returnedCents`,
     * entao o cabecalho mostrava "+R$ X" em VERDE com "no lucro" tres linhas
     * acima do aviso ambar que confessa nao saber se o carro se pagou. O mesmo
     * cartao afirmava lucro e ignorancia. Lucro e afirmacao sobre retorno MENOS
     * custo: sem o custo, ela nao pode ser feita — e errar para o lado otimista
     * num produto de dinheiro e o pior dos dois lados. O VALOR fica (e fato
     * medido); o JULGAMENTO sai.
     */
    it('nao afirma lucro quando o custo e desconhecido', () => {
      const text = render([semCusto]);

      expect(text).not.toContain('no lucro');
      expect(text).not.toContain('no prejuízo');
      expect(text).toContain('retorno acumulado');
      expect(text).toContain('8.000,00');
    });

    it('nao usa a cor de lucro nem a de prejuizo no indeterminado', () => {
      render([semCusto]);
      const host = fixture.nativeElement as HTMLElement;

      expect(host.innerHTML).not.toContain('text-emerald-700');
      expect(host.innerHTML).not.toContain('text-rose-700');
    });

    it('a borda fica neutra — rose e reservada ao prejuizo AFIRMADO', () => {
      render([semCusto]);
      const li = (fixture.nativeElement as HTMLElement).querySelector('li');

      expect(li?.className).toContain('border-neutral-200');
      expect(li?.className).not.toContain('border-rose-200');
    });

    it('nao anuncia payback nem prejuizo quando o dado e indeterminado', () => {
      const text = render([semCusto]);

      expect(text).not.toContain('Já se pagou');
      expect(text).not.toContain('para se pagar');
    });
  });

  /**
   * CASO 2 — `netCents` negativo. Tem de ser visivelmente diferente do
   * positivo: no celular um sinal de menos some na leitura rapida.
   */
  describe('prejuizo', () => {
    const sangrando = vehicle({
      returnedCents: 1_000_00,
      returnBreakdown: { rentalCents: 1_000_00, saleCents: 0 },
      netCents: -4_000_00,
      roiPercent: -80,
      paybackMonth: null,
      paybackReached: false,
      remainingToPaybackCents: 4_000_00,
    });

    it('rotula como prejuizo, nao so com o sinal de menos', () => {
      expect(render([sangrando])).toContain('no prejuízo');
    });

    it('usa cor propria na borda e no valor', () => {
      render([sangrando]);
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('li')?.className).toContain('border-rose-200');
      expect(host.innerHTML).toContain('text-rose-700');
    });

    it('o carro no lucro NAO usa a cor do prejuizo', () => {
      const text = render([vehicle()]);
      const host = fixture.nativeElement as HTMLElement;

      expect(text).toContain('no lucro');
      expect(host.querySelector('li')?.className).not.toContain('border-rose-200');
    });
  });

  /**
   * CASO 3 — quanto FALTA. E a informacao mais util da tela e fica no cartao
   * fechado, nunca atras do expandir.
   */
  it('mostra quanto falta para o carro se pagar, sem expandir nada', () => {
    const text = render([
      vehicle({
        returnedCents: 3_000_00,
        returnBreakdown: { rentalCents: 3_000_00, saleCents: 0 },
        netCents: -2_000_00,
        roiPercent: -40,
        paybackMonth: null,
        paybackReached: false,
        remainingToPaybackCents: 2_000_00,
      }),
    ]);

    expect(text).toContain('Falta');
    expect(text).toContain('2.000,00');
    expect(text).toContain('para se pagar');
  });

  it('anuncia o mes em que o carro se pagou', () => {
    expect(render([vehicle()])).toContain('mar/2026');
  });

  /**
   * O breakdown de retorno existe para distinguir o carro que se pagou ALUGANDO
   * do que so se pagou porque foi VENDIDO — decisoes opostas do dono. Por isso
   * a divisao fica no cartao fechado quando ha venda, e some quando nao ha (sem
   * venda o total JA e o aluguel).
   */
  describe('aluguel x venda', () => {
    it('separa as duas pontas quando o carro foi vendido', () => {
      const text = render([
        vehicle({
          returnedCents: 7_500_00,
          returnBreakdown: { rentalCents: 4_000_00, saleCents: 3_500_00 },
        }),
      ]);

      expect(text).toContain('aluguel');
      expect(text).toContain('4.000,00');
      expect(text).toContain('venda');
      expect(text).toContain('3.500,00');
    });

    it('nao repete a divisao quando nao houve venda', () => {
      expect(render([vehicle()])).not.toContain('venda');
    });
  });

  /** As cinco pontas de custo ficam no detalhe — 13 campos por carro nao cabem. */
  describe('composicao do custo', () => {
    it('fica fechada por padrao', () => {
      const text = render([vehicle()]);

      expect(text).not.toContain('Manutenção');
      expect(text).not.toContain('Sinistros');
    });

    it('abre com as cinco pontas ao tocar', () => {
      render([vehicle()]);
      const botao = (fixture.nativeElement as HTMLElement).querySelector('button');
      botao?.dispatchEvent(new Event('click'));
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Compra');
      expect(text).toContain('Manutenção');
      expect(text).toContain('Seguro');
      expect(text).toContain('Multas');
      expect(text).toContain('Sinistros');
    });

    it('o alvo de toque do expandir tem 44px', () => {
      render([vehicle()]);
      const botao = (fixture.nativeElement as HTMLElement).querySelector('button');

      expect(botao?.className).toContain('min-h-[44px]');
    });
  });

  it('mostra estado vazio quando nao ha veiculo', () => {
    expect(render([])).toContain('Nenhum veículo');
  });
});
