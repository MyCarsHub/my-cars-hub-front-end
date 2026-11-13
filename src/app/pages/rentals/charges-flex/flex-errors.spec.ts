import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { AGREEMENT_ERROR_MESSAGES } from '../../../types/agreement.types';
import { companySafe, flexErrorMessage, planBlockerMessage } from './flex-errors';

/** FEAT-0573 (M4) — a locadora nunca lê o nome do provedor nos fluxos novos. */
describe('flex-errors', () => {
  const err = (code: string | null, message: string) =>
    new HttpErrorResponse({ status: 400, error: code ? { code, message } : { message } });

  it('companySafe troca texto que cita o provedor pelo fallback', () => {
    expect(companySafe('Falhou no Asaas.', 'Tente de novo.')).toBe('Tente de novo.');
    expect(companySafe('Aluguel cancelado.', 'Tente de novo.')).toBe('Aluguel cancelado.');
    expect(companySafe('', 'Tente de novo.')).toBe('Tente de novo.');
  });

  it('códigos do plano viram texto próprio; o detalhe específico é mantido', () => {
    expect(
      planBlockerMessage({
        code: 'CHARGE_BELOW_MINIMUM',
        message: 'Cada parcela precisa ser de pelo menos R$ 5,00 (limite do Asaas). A parcela 3 ficou com R$ 4,99.',
      }),
    ).toBe('Cada parcela precisa ser de pelo menos R$ 5,00 (valor mínimo por parcela). A parcela 3 ficou com R$ 4,99.');
    expect(
      planBlockerMessage({
        code: 'INSTALMENTS_SUM_MISMATCH',
        message: 'As parcelas somam R$ 700,00, mas o valor da cobrança é R$ 750,00.',
      }),
    ).toBe('As parcelas somam R$ 700,00, mas o valor da cobrança é R$ 750,00.');
    expect(planBlockerMessage({ code: 'CHARGE_PLAN_INTERVAL', message: 'qualquer coisa do Asaas' })).toBe(
      'O intervalo entre as parcelas deve ser de 1 a 31 dias.',
    );
    expect(planBlockerMessage({ code: 'UNKNOWN', message: 'erro do Asaas' })).not.toContain('Asaas');
  });

  it('flexErrorMessage: código mapeado, código de plano, e desconhecido com o provedor', () => {
    expect(flexErrorMessage(err('AGREEMENT_SOURCE_BUSY', 'x'), AGREEMENT_ERROR_MESSAGES, 'x')).toBe(
      AGREEMENT_ERROR_MESSAGES['AGREEMENT_SOURCE_BUSY'],
    );
    expect(
      flexErrorMessage(err('CHARGE_BELOW_MINIMUM', 'limite do Asaas'), AGREEMENT_ERROR_MESSAGES, 'limite do Asaas'),
    ).toContain('valor mínimo por parcela');
    expect(flexErrorMessage(err(null, 'O Asaas caiu.'), AGREEMENT_ERROR_MESSAGES, 'O Asaas caiu.')).not.toContain('Asaas');
  });
});
