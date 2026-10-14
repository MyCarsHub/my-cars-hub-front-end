import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import {
  FIELD_LABELS,
  failureMessage,
  fieldLabel,
  httpErrorMessage,
} from './contract-ai.messages';

/** Lista fechada do backend (ContractTemplateService.SUPPORTED_VARIABLES @ origin/main). */
const SUPPORTED_VARIABLES = [
  'companyName', 'companyCnpj', 'companyPhone', 'companyEmail', 'companyAddress', 'companyCep',
  'companyRepresentative', 'companyRepresentativeRole',
  'driverName', 'driverCpf', 'driverRg', 'driverEmail', 'driverPhone',
  'driverLicense', 'driverLicenseCategory', 'driverLicenseExpiry', 'driverAddress', 'driverCep',
  'vehiclePlate', 'vehicleBrand', 'vehicleModel', 'vehicleYear', 'vehicleColor', 'vehicleChassi',
  'vehicleRenavam', 'vehicleMileage', 'vehicleFuel',
  'rentalId', 'contractDate', 'startDate', 'endDate', 'totalAmount', 'caucaoAmount', 'periodRate',
  'billingFrequency', 'initialKm', 'pickupDate', 'firstPaymentDate', 'dailyInterest', 'lateFine',
  'franchiseKm', 'returnFuelPolicy',
];

describe('contract-ai.messages', () => {
  it('toda variável suportada tem rótulo pt-BR sem nome técnico', () => {
    for (const v of SUPPORTED_VARIABLES) {
      const label = fieldLabel(v);
      expect(FIELD_LABELS[v], v).toBeTruthy();
      expect(label, v).not.toBe(v);
      expect(label, v).not.toMatch(/^[a-z]+[A-Z]/);
    }
    expect(SUPPORTED_VARIABLES.length).toBe(42);
  });

  it('campo desconhecido nunca vaza o identificador cru', () => {
    expect(fieldLabel('algoNovoDoBackend')).toBe('Campo do contrato');
  });

  it('o rótulo da API vence o do espelho local', () => {
    expect(fieldLabel('driverName', 'Motorista')).toBe('Motorista');
  });

  it('códigos de falha desconhecidos caem em mensagem genérica', () => {
    expect(failureMessage('ALGO_NOVO')).toContain('Não foi possível analisar');
    expect(failureMessage(null)).toContain('Não foi possível analisar');
  });

  it('mapeia códigos e status HTTP do envio', () => {
    const e = (status: number, code?: string): HttpErrorResponse =>
      new HttpErrorResponse({ status, error: code ? { code, message: 'x' } : null });
    expect(httpErrorMessage(e(503, 'AI_BUSY'), 'f')).toContain('fila');
    expect(httpErrorMessage(e(503, 'AI_DISABLED'), 'f')).toContain('indisponível');
    expect(httpErrorMessage(e(409, 'DRAFT_LIMIT'), 'f')).toContain('em andamento');
    expect(httpErrorMessage(e(413), 'f')).toContain('5 MB');
    expect(httpErrorMessage(e(429), 'f')).toContain('Aguarde');
    expect(httpErrorMessage(e(418), 'fallback')).toBe('fallback');
  });
});
