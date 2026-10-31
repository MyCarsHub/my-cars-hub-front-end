import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import {
  couponDate,
  couponErrorMessage,
  couponPlanLabel,
  couponStatus,
  discountLabel,
  durationLabel,
  modeCopy,
  validityLabel,
} from './coupon-copy';

const NOW = new Date('2026-10-30T12:00:00Z');
const apiError = (status: number, code?: string, message = 'texto do servidor'): HttpErrorResponse =>
  new HttpErrorResponse({ status, error: { message, code } });

describe('coupon-copy', () => {
  it('escreve o desconto em reais ou em percentual', () => {
    expect(discountLabel({ amountOffCents: 4990, percentOff: null })).toBe('R$ 49,90');
    expect(discountLabel({ amountOffCents: null, percentOff: 20 })).toBe('20%');
    expect(discountLabel({ amountOffCents: null, percentOff: 12.5 })).toBe('12,5%');
    expect(discountLabel({ amountOffCents: null, percentOff: null })).toBe('—');
  });

  it('concorda o plural da duração', () => {
    expect(durationLabel(1)).toBe('1 mês');
    expect(durationLabel(2)).toBe('2 meses');
    expect(durationLabel(null)).toBe('—');
  });

  it('código vale até a data; desconto na assinatura não tem prazo de resgate', () => {
    expect(validityLabel({ mode: 'PROMOTION_CODE', expiresAt: '2026-11-29T10:00:00' })).toBe('Até 29/11/2026');
    expect(validityLabel({ mode: 'PROMOTION_CODE', expiresAt: null })).toBe('—');
    expect(validityLabel({ mode: 'APPLIED_TO_SUBSCRIPTION', expiresAt: null })).toBe('Nas próximas faturas');
  });

  it('lê datas da API no fuso do negócio', () => {
    expect(couponDate('2026-11-14T02:00:00')).toBe('13/11/2026');
    expect(couponDate(null)).toBe('—');
  });

  it('nomeia o plano pelo código', () => {
    expect(couponPlanLabel('PRO_MONTHLY_STRIPE')).toBe('Pro mensal');
    expect(couponPlanLabel('STARTER_YEARLY_STRIPE')).toBe('Starter anual');
    expect(couponPlanLabel(null)).toBe('—');
  });

  describe('situação', () => {
    const base = { mode: 'PROMOTION_CODE', status: 'ACTIVE', expiresAt: '2026-11-29T10:00:00', timesRedeemed: 0 } as const;

    it('ativo', () => {
      expect(couponStatus(base, NOW)).toEqual({ label: 'Ativo', tone: 'green', live: true });
    });

    it('desativado vence qualquer outra leitura', () => {
      expect(couponStatus({ ...base, status: 'DEACTIVATED', timesRedeemed: 1 }, NOW)).toMatchObject({
        label: 'Desativado',
        live: false,
      });
    });

    it('código de uso único já usado não se apresenta como ativo', () => {
      expect(couponStatus({ ...base, timesRedeemed: 1 }, NOW)).toMatchObject({ label: 'Usado', live: false });
    });

    it('código vencido não se apresenta como ativo', () => {
      expect(couponStatus({ ...base, expiresAt: '2026-10-01T10:00:00' }, NOW)).toMatchObject({
        label: 'Vencido',
        live: false,
      });
    });

    it('na assinatura, depois da janela, não se apresenta como ativo', () => {
      expect(
        couponStatus(
          { mode: 'APPLIED_TO_SUBSCRIPTION', status: 'ACTIVE', expiresAt: null, timesRedeemed: 1, createdAt: '2026-07-01T10:00:00', durationMonths: 2 },
          NOW,
        ),
      ).toMatchObject({ label: 'Encerrado', live: false });
    });

    it('na assinatura, dentro da janela, continua ativo', () => {
      expect(
        couponStatus(
          { mode: 'APPLIED_TO_SUBSCRIPTION', status: 'ACTIVE', expiresAt: null, timesRedeemed: 1, createdAt: '2026-10-01T10:00:00', durationMonths: 2 },
          NOW,
        ),
      ).toMatchObject({ label: 'Ativo', live: true });
    });

    it('na assinatura, ter sido resgatado é o normal: continua ativo', () => {
      expect(
        couponStatus({ mode: 'APPLIED_TO_SUBSCRIPTION', status: 'ACTIVE', expiresAt: null, timesRedeemed: 1 }, NOW),
      ).toMatchObject({ label: 'Ativo', live: true });
    });
  });

  it('diz qual dos dois modos o servidor escolheu', () => {
    expect(modeCopy('APPLIED_TO_SUBSCRIPTION').title).toMatch(/direto na assinatura/i);
    expect(modeCopy('PROMOTION_CODE').title).toMatch(/código para enviar/i);
  });

  describe('erros', () => {
    it.each([
      ['COUPON_ZEROES_PLAN', 400, /zera o plano/i],
      ['COUPON_PLAN_MISMATCH', 409, /plano atual/i],
      ['COUPON_ALREADY_APPLIED', 409, /já tem um desconto/i],
      ['COUPON_NO_OWNER', 409, /dono/i],
    ])('%s tem texto próprio, não o do servidor', (code, status, copy) => {
      const message = couponErrorMessage(apiError(status, code), 'preview');
      expect(message).toMatch(copy);
      expect(message).not.toContain('texto do servidor');
    });

    it('COUPON_INVALID usa a frase do servidor, que diz qual campo', () => {
      expect(couponErrorMessage(apiError(400, 'COUPON_INVALID', 'A duração vai de 1 a 12 meses.'), 'create')).toBe(
        'A duração vai de 1 a 12 meses.',
      );
    });

    it('503 diz que a Stripe falhou e o que aconteceu com cada ação', () => {
      expect(couponErrorMessage(apiError(503), 'create')).toMatch(/stripe.*confira a lista/i);
      expect(couponErrorMessage(apiError(503), 'create')).not.toMatch(/nenhum cupom foi criado/i);
      expect(couponErrorMessage(apiError(503), 'deactivate')).toMatch(/stripe.*continua como estava/i);
      expect(couponErrorMessage(apiError(503), 'preview')).toMatch(/stripe/i);
      expect(couponErrorMessage(apiError(503), 'load')).toMatch(/stripe/i);
    });

    it('404 fala de empresa ou plano na criação e de cupom ao desativar', () => {
      expect(couponErrorMessage(apiError(404), 'create')).toMatch(/empresa ou plano/i);
      expect(couponErrorMessage(apiError(404), 'deactivate')).toMatch(/cupom não encontrado/i);
    });

    it('403 diz que é coisa do papel Dono', () => {
      expect(couponErrorMessage(apiError(403), 'create')).toMatch(/dono/i);
      expect(couponErrorMessage(apiError(403), 'deactivate')).toMatch(/dono/i);
    });

    it('403 ao ler não fala de criar nem desativar', () => {
      for (const action of ['load', 'preview'] as const) {
        expect(couponErrorMessage(apiError(403), action)).toMatch(/seu papel não acessa/i);
        expect(couponErrorMessage(apiError(403), action)).not.toMatch(/cria e desativa/i);
      }
    });

    it('sem resposta na criação não diz que nada aconteceu', () => {
      for (const err of [new HttpErrorResponse({ status: 0 }), apiError(504), new TimeoutError()]) {
        expect(couponErrorMessage(err, 'create')).toMatch(/confira a lista/i);
      }
    });

    it('sem rede não mostra texto do navegador', () => {
      expect(couponErrorMessage(new HttpErrorResponse({ status: 0 }), 'load')).toMatch(/conexão/i);
    });
  });
});
