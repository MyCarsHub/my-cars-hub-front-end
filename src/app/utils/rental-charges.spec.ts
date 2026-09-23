import { describe, it, expect } from 'vitest';

import { RentalChargeDto } from '../types/rental.types';
import {
  hasGatewayCharges,
  isOpenChargeStatus,
  openNotOverdueGatewayCharges,
  overdueUnpaidGatewayCharges,
  shouldWarnAboutGatewayCharges,
} from './rental-charges';

const TODAY = '2026-09-17';

function charge(over: Partial<RentalChargeDto> = {}): RentalChargeDto {
  return {
    id: 'c-1',
    kind: 'RENTAL_PERIOD',
    amount: 150_00,
    status: 'PENDING',
    provider: 'ASAAS',
    externalId: 'pay_123',
    checkoutUrl: null,
    paidAt: null,
    dueDate: '2026-09-20',
    periodIndex: 1,
    ...over,
  };
}

describe('criterios de cobranca no gateway', () => {
  /**
   * O CASO REAL que originou o node: TES-1T01, 7 parcelas TODAS PAGAS, cobranca
   * automatica DESLIGADA. O dialogo falava de um gateway que nao estava
   * envolvido.
   */
  it('aluguel quitado sem gateway NAO gera aviso', () => {
    const pagas = [1, 2, 3].map((i) =>
      charge({ id: `c-${i}`, status: 'PAID', externalId: null, paidAt: '2026-09-10T12:00:00Z' }),
    );

    expect(hasGatewayCharges(pagas)).toBe(false);
    expect(shouldWarnAboutGatewayCharges(pagas, TODAY)).toBe(false);
  });

  /**
   * `provider` e o literal 'ASAAS' em TODA cobranca (rental.types.ts:112), entao
   * um criterio baseado nele seria sempre verdadeiro — o mesmo defeito escrito
   * de outro jeito. Quem prova existencia no gateway e o `externalId`.
   */
  it('provider ASAAS sozinho NAO significa cobranca no gateway', () => {
    const semGateway = [charge({ provider: 'ASAAS', externalId: null })];

    expect(semGateway[0].provider).toBe('ASAAS');
    expect(hasGatewayCharges(semGateway)).toBe(false);
  });

  it('cobranca com externalId conta como gateway', () => {
    expect(hasGatewayCharges([charge({ externalId: 'pay_9' })])).toBe(true);
  });

  describe('em aberto e ainda nao vencidas', () => {
    it('entram — sao as que o encerramento apaga sem perguntar', () => {
      const abertas = [charge({ dueDate: '2026-09-20' })];

      expect(openNotOverdueGatewayCharges(abertas, TODAY)).toHaveLength(1);
    });

    it('vencer hoje ainda NAO e vencida', () => {
      expect(openNotOverdueGatewayCharges([charge({ dueDate: TODAY })], TODAY)).toHaveLength(1);
    });

    /** Legado sem `dueDate` e apagado no encerramento; omitir esconderia isso. */
    it('sem dueDate conta como nao vencida', () => {
      const legado = [charge({ kind: 'RENTAL_TOTAL', dueDate: null })];

      expect(openNotOverdueGatewayCharges(legado, TODAY)).toHaveLength(1);
    });

    it('paga nao entra — paga nunca e apagada', () => {
      expect(openNotOverdueGatewayCharges([charge({ status: 'PAID' })], TODAY)).toHaveLength(0);
    });
  });

  describe('vencidas e nao pagas', () => {
    it('entram — sao o alvo do opt-in destrutivo', () => {
      const vencida = [charge({ dueDate: '2026-09-01', status: 'PAST_DUE' })];

      expect(overdueUnpaidGatewayCharges(vencida, TODAY)).toHaveLength(1);
    });

    it('PENDING com vencimento passado tambem conta', () => {
      const vencida = [charge({ dueDate: '2026-09-01', status: 'PENDING' })];

      expect(overdueUnpaidGatewayCharges(vencida, TODAY)).toHaveLength(1);
    });

    it('paga no passado NAO e vencida-nao-paga', () => {
      const paga = [charge({ dueDate: '2026-09-01', status: 'PAID' })];

      expect(overdueUnpaidGatewayCharges(paga, TODAY)).toHaveLength(0);
    });

    it('sem nenhuma vencida, o opt-in nao tem sobre o que agir', () => {
      expect(overdueUnpaidGatewayCharges([charge()], TODAY)).toHaveLength(0);
    });
  });

  describe('quando avisar', () => {
    it('avisa havendo cobranca em aberto no gateway', () => {
      expect(shouldWarnAboutGatewayCharges([charge()], TODAY)).toBe(true);
    });

    it('avisa havendo vencida nao paga no gateway', () => {
      const vencida = [charge({ dueDate: '2026-09-01', status: 'PAST_DUE' })];

      expect(shouldWarnAboutGatewayCharges(vencida, TODAY)).toBe(true);
    });

    it('nao avisa quando tudo esta pago', () => {
      const pagas = [charge({ status: 'PAID' }), charge({ id: 'c-2', status: 'PAID' })];

      expect(shouldWarnAboutGatewayCharges(pagas, TODAY)).toBe(false);
    });

    it('nao avisa sem cobranca nenhuma', () => {
      expect(shouldWarnAboutGatewayCharges([], TODAY)).toBe(false);
    });

    /** Cancelada/estornada nao e cobravel: nao ha o que apagar nem avisar. */
    it('nao avisa sobre cobranca cancelada ou estornada', () => {
      const encerradas = [
        charge({ status: 'CANCELED' }),
        charge({ id: 'c-2', status: 'REFUNDED' }),
      ];

      expect(shouldWarnAboutGatewayCharges(encerradas, TODAY)).toBe(false);
    });
  });
});

/**
 * FIX-0433 — FAILED e cobranca ABERTA.
 *
 * O caso real: 17 cobrancas FAILED num unico aluguel da UBLOC, ativo desde
 * 02/08. Ali FAILED nao e "falhou ao criar" — e OVERDUE promovido por job:
 * cobrancas vivas no gateway, vencidas ha semanas. Fora do conjunto de
 * "abertas", a tela dizia que estava tudo em dia.
 *
 * A forma do defeito e OMISSAO DE CATEGORIA, nao erro de conta: um conjunto
 * incompleto tem a aparencia exata de um conjunto completo.
 */
describe('FAILED conta como cobranca aberta', () => {
  const HOJE = '2026-09-17';

  function falhada(over: Partial<RentalChargeDto> = {}): RentalChargeDto {
    return {
      id: 'c-f',
      kind: 'RENTAL_PERIOD',
      amount: 150_00,
      status: 'FAILED',
      provider: 'ASAAS',
      externalId: 'pay_failed',
      checkoutUrl: null,
      paidAt: null,
      dueDate: '2026-08-02',
      periodIndex: 1,
      ...over,
    };
  }

  it('o predicado reconhece FAILED', () => {
    expect(isOpenChargeStatus('FAILED')).toBe(true);
  });

  it('nao alarga o conceito: pago e encerrado continuam fechados', () => {
    expect(isOpenChargeStatus('PAID')).toBe(false);
    expect(isOpenChargeStatus('CANCELED')).toBe(false);
    expect(isOpenChargeStatus('REFUNDED')).toBe(false);
    expect(isOpenChargeStatus('RELEASED')).toBe(false);
  });

  it('FAILED vencida entra nas vencidas e nao pagas', () => {
    expect(overdueUnpaidGatewayCharges([falhada()], HOJE)).toHaveLength(1);
  });

  it('o aluguel com FAILED deixa de parecer em dia', () => {
    expect(shouldWarnAboutGatewayCharges([falhada()], HOJE)).toBe(true);
  });

  /** O caso da UBLOC em miniatura: so FAILED, nada mais. */
  it('17 FAILED e nada mais: todas contadas', () => {
    const dezessete = Array.from({ length: 17 }, (_, i) =>
      falhada({ id: `c-${i}`, periodIndex: i + 1 }),
    );

    expect(overdueUnpaidGatewayCharges(dezessete, HOJE)).toHaveLength(17);
    expect(shouldWarnAboutGatewayCharges(dezessete, HOJE)).toBe(true);
  });

  it('FAILED ainda nao vencida cai no balde das nao vencidas', () => {
    const futura = [falhada({ dueDate: '2026-09-30' })];

    expect(openNotOverdueGatewayCharges(futura, HOJE)).toHaveLength(1);
    expect(overdueUnpaidGatewayCharges(futura, HOJE)).toHaveLength(0);
  });
});
