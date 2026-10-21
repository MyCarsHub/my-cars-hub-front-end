import { describe, expect, it } from 'vitest';
import { DriverCharge } from '../../../types/driver-charges.types';
import { RentalResponseDto } from '../../../types/rental.types';
import {
  buildChargeList,
  buildHero,
  buildTerms,
  chargeTitle,
  collapsedRows,
  daysBetween,
  lateTerms,
  listAlert,
  rateLine,
  reservedBanner,
  weekday,
} from './driver-rental-view';

/** The prototype's "today": Saturday, 10/10/2026. */
const TODAY = '2026-10-10';
const PERIOD = { startDate: '2026-08-04', endDate: '2027-02-03' };

const c = (over: Partial<DriverCharge> = {}): DriverCharge => ({
  id: 'c',
  kind: 'RENTAL_PERIOD',
  amount: 65000,
  status: 'PENDING',
  dueDate: '2026-10-13',
  periodIndex: 10,
  paidAt: null,
  checkoutUrl: 'https://pay.example/i/1',
  ...over,
});

const rental = (over: Partial<RentalResponseDto> = {}): RentalResponseDto =>
  ({
    id: 'r1',
    vehicleId: 'v1',
    driverId: 'd1',
    startDate: '2026-08-04',
    endDate: '2027-02-03',
    periodRate: 65000,
    totalAmount: 0,
    caucaoAmount: 100000,
    caucaoPaid: false,
    status: 'ACTIVE',
    billingFrequency: 'WEEKLY',
    notes: null,
    initialKm: null,
    pickupDate: null,
    firstPaymentDate: '2026-08-04',
    dailyInterestAmount: null,
    lateInterestPercentPerMonth: 1,
    lateFineType: 'PERCENT',
    lateFineValue: 200,
    contractSource: null,
    franchiseKm: 200,
    returnFuelPolicy: 'Mesmo nível da retirada',
    charges: [],
    createdAt: '',
    modifiedAt: '',
    ...over,
  }) as RentalResponseDto;

describe('driver-rental-view', () => {
  describe('datas', () => {
    it('dia da semana do próprio dia de negócio, sem escorregar de fuso', () => {
      expect(weekday('2026-10-13')).toBe('terça');
      expect(weekday('2026-10-10')).toBe('sábado');
      expect(daysBetween('2026-10-06', '2026-10-10')).toBe(4);
      expect(daysBetween('2026-10-10', '2026-10-13')).toBe(3);
    });
  });

  describe('chargeTitle', () => {
    it('nomeia pelo tipo e pela frequência, com o período a partir de 1', () => {
      expect(chargeTitle(c({ periodIndex: 9 }), 'WEEKLY')).toBe('Semana 10 · Aluguel semanal');
      expect(chargeTitle(c({ periodIndex: 0 }), 'MONTHLY')).toBe('Mês 1 · Aluguel mensal');
      expect(chargeTitle(c({ kind: 'CAUCAO' }), 'WEEKLY')).toBe('Caução');
      expect(chargeTitle(c({ kind: 'OVERDUE_FEE' }), 'WEEKLY')).toBe('Multa por atraso');
      expect(chargeTitle(c({ kind: 'RENTAL_TOTAL' }), 'WEEKLY')).toBe('Aluguel');
    });
  });

  describe('buildHero', () => {
    it('atrasada: rosa, valor da mais antiga, dias de atraso e SEM multa calculada', () => {
      const overdue = c({ id: 'late', dueDate: '2026-10-06', status: 'PENDING', amount: 65000 });
      const hero = buildHero('ACTIVE', [overdue, c({ id: 'next' })], TODAY, PERIOD);

      expect(hero.tone).toBe('overdue');
      expect(hero.label).toBe('Cobrança atrasada');
      expect(hero.value).toBe('R$ 650,00');
      expect(hero.sub).toBe(
        'Venceu em 06/10 (4 dias de atraso). Pode incluir multa e juros.',
      );
      expect(hero.payCharge?.id).toBe('late');
    });

    it('duas atrasadas: diz quantas e de qual é a data', () => {
      const hero = buildHero(
        'ACTIVE',
        [c({ id: 'a', dueDate: '2026-09-29' }), c({ id: 'b', dueDate: '2026-10-06' })],
        TODAY,
        PERIOD,
      );
      expect(hero.label).toBe('2 cobranças atrasadas');
      expect(hero.sub).toContain('A mais antiga venceu em 29/09 (11 dias de atraso)');
      expect(hero.payCharge?.id).toBe('a');
    });

    it('próxima: laranja, "Vence terça, 13/10 · em 3 dias"', () => {
      const hero = buildHero('ACTIVE', [c()], TODAY, PERIOD);

      expect(hero.tone).toBe('next');
      expect(hero.label).toBe('Próxima cobrança');
      expect(hero.sub).toBe('Vence terça, 13/10 · em 3 dias');
      expect(hero.payCharge?.id).toBe('c');
    });

    it('vence hoje diz "hoje"; reservado chama de "Primeira cobrança" e pula a caução', () => {
      expect(buildHero('ACTIVE', [c({ dueDate: TODAY })], TODAY, PERIOD).sub).toBe(
        'Vence sábado, 10/10 · hoje',
      );
      const reserved = buildHero(
        'RESERVED',
        [
          c({ id: 'cau', kind: 'CAUCAO', dueDate: '2026-10-15', amount: 100000 }),
          c({ id: 'w1', dueDate: '2026-10-20', amount: 69000 }),
        ],
        TODAY,
        PERIOD,
      );
      expect(reserved.label).toBe('Primeira cobrança');
      expect(reserved.payCharge?.id).toBe('w1');
    });

    it('sem link de pagamento: sem botão, e diz que o pagamento é com a locadora', () => {
      const hero = buildHero('ACTIVE', [c({ checkoutUrl: null })], TODAY, PERIOD);
      expect(hero.payCharge).toBeNull();
      expect(hero.sub).toContain('combinado com a locadora');
    });

    it('nada em aberto: verde "Tudo em dia"; encerrado: cinza "Aluguel encerrado"', () => {
      const paid = c({ status: 'PAID', paidAt: '2026-10-06T10:00:00' });
      expect(buildHero('ACTIVE', [paid], TODAY, PERIOD)).toMatchObject({
        tone: 'clear',
        value: 'Tudo em dia',
        sub: 'Nenhuma cobrança em aberto.',
      });
      expect(buildHero('COMPLETED', [paid], TODAY, PERIOD)).toMatchObject({
        tone: 'ended',
        label: 'Aluguel encerrado',
        sub: '04/08/2026 a 03/02/2027',
      });
    });

    it('encerrado com dívida continua rosa: a dívida é o que importa', () => {
      const hero = buildHero('COMPLETED', [c({ dueDate: '2026-10-01' })], TODAY, PERIOD);
      expect(hero.tone).toBe('overdue');
    });
  });

  describe('buildChargeList', () => {
    const charges = [
      c({ id: 'p1', status: 'PAID', dueDate: '2026-09-29', paidAt: '2026-09-29T10:00:00' }),
      c({ id: 'next', dueDate: '2026-10-13' }),
      c({ id: 'late', dueDate: '2026-10-06' }),
      c({ id: 'p2', status: 'PAID', dueDate: '2026-09-22', paidAt: '2026-09-22T10:00:00' }),
      c({ id: 'p3', status: 'PAID', dueDate: '2026-09-15', paidAt: '2026-09-15T10:00:00' }),
      c({ id: 'p4', status: 'PAID', dueDate: '2026-09-08', paidAt: '2026-09-08T10:00:00' }),
      c({ id: 'gone', status: 'CANCELED' }),
      c({ id: 'later', dueDate: '2026-10-20' }),
    ];

    it('abertas primeiro (atrasada na frente), depois pagas da mais recente; canceladas fora', () => {
      const list = buildChargeList(charges, TODAY, 'WEEKLY');

      expect(list.rows.map((r) => r.charge.id)).toEqual([
        'late',
        'next',
        'later',
        'p1',
        'p2',
        'p3',
        'p4',
      ]);
      expect(list.openCount).toBe(3);
      expect(list.paidCount).toBe(4);
    });

    it('cada linha traz rótulo, data, chip do status-map e se pode pagar', () => {
      const [late, next, , paid] = buildChargeList(charges, TODAY, 'WEEKLY').rows;

      expect(late).toMatchObject({
        overdue: true,
        sub: 'Venceu em 06/10/2026',
        chipLabel: 'Atrasada',
        payable: true,
      });
      expect(next.sub).toBe('Vence terça, 13/10/2026');
      expect(next.chipLabel).toBe('Pendente');
      expect(paid).toMatchObject({ sub: 'Pago · venc. 29/09/2026', chipLabel: 'Pago', payable: false });
    });

    it('recolhido: as 2 primeiras abertas e as 3 últimas pagas', () => {
      const list = buildChargeList(charges, TODAY, 'WEEKLY');
      expect(collapsedRows(list).map((r) => r.charge.id)).toEqual(['late', 'next', 'p1', 'p2', 'p3']);
    });
  });

  describe('buildTerms', () => {
    it('lista o combinado na ordem do protótipo, com o dia de cobrança derivado', () => {
      const terms = buildTerms(
        rental({ caucaoPaid: true }),
        [c({ periodIndex: 0, dueDate: '2026-08-04' })],
        TODAY,
      );

      expect(terms.map((t) => [t.label, t.value])).toEqual([
        ['Valor semanal', 'R$ 650,00'],
        ['Cobrança', 'Toda terça-feira'],
        ['Início', '04/08/2026'],
        ['Fim previsto', '03/02/2027'],
        ['Caução', 'R$ 1.000,00 · Paga'],
        ['Km por dia', '200 km'],
        ['Combustível', 'Mesmo nível da retirada'],
        ['Atraso no pagamento', 'Multa de 2% + juros de 1% ao mês'],
      ]);
      // Texto longo ocupa a linha inteira; curto fica na metade.
      const wide = Object.fromEntries(terms.map((t) => [t.label, t.wide]));
      expect(wide['Combustível']).toBe(true);
      expect(wide['Cobrança']).toBe(false);
      expect(wide['Km por dia']).toBe(false);
    });

    it('omite o que não foi combinado e lê a devolução da caução', () => {
      const terms = buildTerms(
        rental({
          franchiseKm: null,
          returnFuelPolicy: null,
          lateFineType: null,
          lateFineValue: null,
          lateInterestPercentPerMonth: null,
          caucaoRefundedAt: '2026-07-29T12:00:00',
        }),
        [],
        TODAY,
      );
      const labels = terms.map((t) => t.label);
      expect(labels).not.toContain('Km por dia');
      expect(labels).not.toContain('Combustível');
      expect(labels).not.toContain('Atraso no pagamento');
      expect(terms.find((t) => t.label === 'Caução')?.value).toBe(
        'R$ 1.000,00 · Devolvida em 29/07/2026',
      );
    });

    it('multa fixa e juros por dia (aluguel legado)', () => {
      expect(
        lateTerms(
          rental({
            lateFineType: 'FIXED',
            lateFineValue: 500,
            lateInterestPercentPerMonth: null,
            dailyInterestAmount: 50,
          }),
        ),
      ).toBe('Multa de R$ 5,00 + juros de R$ 0,50 por dia');
    });
  });

  describe('lista', () => {
    it('alerta: atrasada > próxima (ativo) > começa em (reservado)', () => {
      expect(listAlert('ACTIVE', '2026-08-04', [c({ dueDate: '2026-10-06' })], TODAY)).toEqual({
        text: '1 cobrança atrasada',
        tone: 'danger',
      });
      expect(listAlert('ACTIVE', '2026-08-04', [c()], TODAY)).toEqual({
        text: 'Próxima cobrança em 13/10',
        tone: 'warning',
      });
      expect(listAlert('RESERVED', '2026-10-20', [], TODAY)).toEqual({
        text: 'Começa em 20/10',
        tone: 'warning',
      });
      expect(listAlert('COMPLETED', '2026-01-06', [], TODAY)).toBeNull();
      expect(listAlert('RESERVED', '2026-10-20', null, TODAY)?.text).toBe('Começa em 20/10');
    });

    it('valor por período: o mais comum entre as cobranças de aluguel; sem elas, nada', () => {
      const charges = [c({ amount: 65000 }), c({ amount: 65000 }), c({ amount: 32500 })];
      expect(rateLine(charges, 'WEEKLY')).toBe('R$ 650,00 por semana');
      expect(rateLine([c({ kind: 'CAUCAO' })], 'WEEKLY')).toBe('');
      expect(rateLine(null, 'WEEKLY')).toBe('');
    });
  });

  describe('reservedBanner', () => {
    it('pede a caução só quando ela está em aberto', () => {
      expect(reservedBanner('RESERVED', '2026-10-20', [c({ kind: 'CAUCAO' })], TODAY)).toBe(
        'Seu aluguel começa em 20/10/2026. Pague a caução e faça a vistoria de retirada para pegar o carro.',
      );
      expect(reservedBanner('RESERVED', '2026-10-20', [], TODAY)).toBe(
        'Seu aluguel começa em 20/10/2026. Faça a vistoria de retirada para pegar o carro.',
      );
      expect(reservedBanner('ACTIVE', '2026-10-20', [], TODAY)).toBe('');
    });
  });
});
