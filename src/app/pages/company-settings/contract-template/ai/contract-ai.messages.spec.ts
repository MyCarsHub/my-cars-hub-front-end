import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import {
  FIELD_LABELS,
  failureMessage,
  fieldLabel,
  httpErrorMessage,
} from './contract-ai.messages';
import { FIELD_KEYS, fieldCode, fieldExample, isKnownField } from '../contract-fields';

/**
 * Lista fechada do backend (ContractTemplateService.SUPPORTED_VARIABLES). `companyCity`
 * (companies.address_city, «Local e data» do Montar do zero) entra junto com o backend.
 */
const SUPPORTED_VARIABLES = [
  'companyName', 'companyCnpj', 'companyPhone', 'companyEmail', 'companyAddress', 'companyCep',
  'companyCity',
  'companyRepresentative', 'companyRepresentativeRole',
  'driverName', 'driverCpf', 'driverRg', 'driverEmail', 'driverPhone',
  'driverLicense', 'driverLicenseCategory', 'driverLicenseExpiry', 'driverAddress', 'driverCep',
  'vehiclePlate', 'vehicleBrand', 'vehicleModel', 'vehicleYear', 'vehicleColor', 'vehicleChassi',
  'vehicleRenavam', 'vehicleMileage', 'vehicleFuel',
  'rentalId', 'contractDate', 'startDate', 'endDate', 'totalAmount', 'caucaoAmount', 'periodRate',
  'billingFrequency', 'initialKm', 'pickupDate', 'firstPaymentDate', 'dailyInterest',
  'lateInterestPercent', 'lateInterestTerms', 'lateFine',
  'franchiseKm', 'returnFuelPolicy', 'extraKmPrice', 'lateFineTerms', 'kmTerms',
];

describe('contract-ai.messages', () => {
  it('códigos do backend têm mensagem própria (DRAFT_LIMIT_REACHED, envio, montar do zero)', () => {
    const err = (code: string, status = 409) =>
      new HttpErrorResponse({ status, error: { code, message: 'x' } });
    expect(httpErrorMessage(err('DRAFT_LIMIT_REACHED'), 'fallback')).toContain(
      'Você já tem análises em andamento',
    );
    expect(httpErrorMessage(err('PDF_NOT_SUPPORTED', 400), 'fallback')).toContain('PDF');
    expect(httpErrorMessage(err('SUPPORT_SESSION_NOT_ALLOWED', 403), 'fallback')).toContain(
      'modo de suporte',
    );
    expect(httpErrorMessage(err('CONTRACT_BASE_VERSION_CHANGED'), 'fallback')).toContain(
      'O modelo de contrato foi atualizado',
    );
    expect(httpErrorMessage(err('CONTRACT_BASE_FORBIDDEN', 403), 'fallback')).toContain(
      'Só o dono ou o gerente',
    );
    expect(httpErrorMessage(err('DRAFT_LIMIT'), 'fallback')).toBe('fallback'); // código antigo não existe mais
  });

  it('toda variável suportada tem rótulo pt-BR sem nome técnico', () => {
    for (const v of SUPPORTED_VARIABLES) {
      const label = fieldLabel(v);
      expect(FIELD_LABELS[v], v).toBeTruthy();
      expect(label, v).not.toBe(v);
      expect(label, v).not.toMatch(/^[a-z]+[A-Z]/);
    }
    expect(SUPPORTED_VARIABLES.length).toBe(48);
  });

  it('companyCity («Local e data» do Montar do zero): rótulo, exemplo, código e escolha na lista', () => {
    expect(FIELD_LABELS['companyCity']).toBe('Cidade da empresa');
    expect(fieldLabel('companyCity')).toBe('Cidade da empresa');
    expect(fieldExample('companyCity')).toBe('São Paulo');
    expect(fieldCode('companyCity')).toBe('{{companyCity}}');
    expect(FIELD_KEYS).toContain('companyCity');
  });

  it('campos da cláusula de km e da multa (V113): rótulos e exemplos iguais aos do backend', () => {
    expect(fieldLabel('extraKmPrice')).toBe('Preço do km excedente');
    expect(fieldLabel('lateFineTerms')).toBe('Multa de mora (frase)');
    expect(fieldLabel('kmTerms')).toBe('Cláusula de quilometragem');
    expect(fieldExample('extraKmPrice')).toBe('R$ 0,50');
    expect(fieldExample('lateFineTerms')).toBe(
      'multa de mora de 2,00% sobre o valor da parcela em atraso, cobrada uma única vez',
    );
    expect(fieldExample('kmTerms')).toMatch(/^A franquia de quilometragem é de 300 km\/dia/);
    expect(fieldExample('kmTerms')).toContain('custa R$ 0,50');
  });

  it('campo desconhecido nunca vaza o identificador cru', () => {
    expect(fieldLabel('algoNovoDoBackend')).toBe('Campo do contrato');
  });

  it('o rótulo da API vence o do espelho local', () => {
    expect(fieldLabel('driverName', 'Motorista')).toBe('Motorista');
  });

  it('códigos de falha desconhecidos caem em mensagem genérica', () => {
    expect(failureMessage('ALGO_NOVO')).toContain('Não foi possível ler');
    expect(failureMessage(null)).toContain('Não foi possível ler');
  });

  it('mapeia códigos e status HTTP do envio', () => {
    const e = (status: number, code?: string): HttpErrorResponse =>
      new HttpErrorResponse({ status, error: code ? { code, message: 'x' } : null });
    expect(httpErrorMessage(e(503, 'AI_BUSY'), 'f')).toContain('fila');
    expect(httpErrorMessage(e(503, 'AI_DISABLED'), 'f')).toContain('indisponível');
    expect(httpErrorMessage(e(409, 'DRAFT_LIMIT_REACHED'), 'f')).toContain('em andamento');
    expect(httpErrorMessage(e(413), 'f')).toContain('5 MB');
    expect(httpErrorMessage(e(429), 'f')).toContain('Aguarde');
    expect(httpErrorMessage(e(418), 'fallback')).toBe('fallback');
  });
});

describe('contrato que já chega com {{campo}}', () => {
  const refused = (code: string) =>
    httpErrorMessage(new HttpErrorResponse({ status: 400, error: { code } }), 'genérico');

  it('token desconhecido é recusado com instrução do que fazer, sem ecoar o nome', () => {
    const message = refused('TEMPLATE_UNKNOWN_PLACEHOLDER');

    expect(message).not.toBe('genérico');
    expect(message).toContain('não reconhece');
    expect(message).toContain('Word');
  });

  it('token quebrado é recusado com instrução do que fazer, sem ecoar o conteúdo', () => {
    const message = refused('TEMPLATE_MALFORMED_PLACEHOLDER');

    expect(message).not.toBe('genérico');
    expect(message).toContain('Word');
    expect(message).toMatch(/incompleto|escrito errado/);
  });

  it('contrato sem campo nenhum diz o que falta', () => {
    expect(refused('TEMPLATE_NO_FIELDS')).toContain('pelo menos um');
  });

  it('isKnownField só reconhece a lista fechada', () => {
    expect(isKnownField('driverName')).toBe(true);
    expect(isKnownField('lateInterestTerms')).toBe(true);
    expect(isKnownField('campoEstranho')).toBe(false);
    expect(isKnownField('toString')).toBe(false);
  });
});
