import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { StepDocument } from './step-document';
import type { OnboardingData } from '../onboarding.types';

/**
 * CNPJ é ALFANUMÉRICO desde julho de 2026 (12 posições alfanuméricas + 2 dígitos
 * verificadores numéricos). O passo de documento do onboarding precisa aceitá-lo, e o
 * valor emitido para o backend é sempre STRING — nunca convertido para número.
 */
describe('StepDocument — CNPJ no onboarding', () => {
  let fixture: ComponentFixture<StepDocument>;
  let component: StepDocument;
  let emitted: Partial<OnboardingData>[];
  let validity: boolean[];

  function render(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [StepDocument] });
    fixture = TestBed.createComponent(StepDocument);
    component = fixture.componentInstance;

    emitted = [];
    validity = [];
    component.formChange.subscribe((value) => emitted.push(value));
    component.isValid.subscribe((value) => validity.push(value));

    fixture.detectChanges();
    component.form.get('hasCnpj')?.setValue(true);
    fixture.detectChanges();
  }

  function cnpjInput(): HTMLInputElement {
    const input = fixture.nativeElement.querySelector('#ob-cnpj');
    if (!(input instanceof HTMLInputElement)) throw new Error('campo de CNPJ ausente');
    return input;
  }

  function lastEmitted(): Partial<OnboardingData> {
    return emitted[emitted.length - 1];
  }

  beforeEach(() => {
    vi.useFakeTimers();
    render();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aceita um CNPJ alfanumérico e o emite em maiúsculo, sem máscara', () => {
    component.form.get('cnpj')?.setValue('12.abc.345/01de-35');

    expect(component.form.get('cnpj')?.valid).toBe(true);
    expect(lastEmitted().cnpj).toBe('12ABC34501DE35');
    expect(typeof lastEmitted().cnpj).toBe('string');
    expect(validity[validity.length - 1]).toBe(true);
  });

  it('continua aceitando um CNPJ puramente numérico', () => {
    component.form.get('cnpj')?.setValue('12.345.678/0001-95');

    expect(component.form.get('cnpj')?.valid).toBe(true);
    expect(lastEmitted().cnpj).toBe('12345678000195');
  });

  it('preserva zeros à esquerda — o documento nunca vira número', () => {
    component.form.get('cnpj')?.setValue('00.000.000/0001-91');

    expect(lastEmitted().cnpj).toBe('00000000000191');
    expect(lastEmitted().cnpj?.startsWith('00')).toBe(true);
  });

  it('recusa comprimentos inválidos com a mensagem de shape', () => {
    component.form.get('cnpj')?.setValue('12.345');

    expect(component.form.get('cnpj')?.errors?.['cnpjShape']).toBe(true);
    expect(validity[validity.length - 1]).toBe(false);
  });

  it('recusa dígitos verificadores não numéricos', () => {
    component.form.get('cnpj')?.setValue('12ABC34501DEAB');

    expect(component.form.get('cnpj')?.errors?.['cnpjShape']).toBe(true);
  });

  it('recusa mod 11 errado sem gastar um round-trip', () => {
    component.form.get('cnpj')?.setValue('12.345.678/0001-96');

    expect(component.form.get('cnpj')?.errors?.['cnpjInvalid']).toBe(true);
    expect(component.form.get('cnpj')?.errors?.['cnpjShape']).toBeUndefined();
    expect(validity[validity.length - 1]).toBe(false);
  });

  it('mascara no layout de CNPJ mesmo com poucos caracteres e mantém o cursor', () => {
    const input = cnpjInput();
    input.value = '12abc34501de35';
    input.setSelectionRange(4, 4);
    input.dispatchEvent(new Event('input'));

    expect(component.form.get('cnpj')?.value).toBe('12.ABC.345/01DE-35');
    expect(input.selectionStart).toBe(5);
  });

  it('emite CNPJ vazio quando o usuário diz que não tem CNPJ', () => {
    component.form.get('cnpj')?.setValue('12.345.678/0001-95');
    component.form.get('hasCnpj')?.setValue(false);

    expect(lastEmitted().cnpj).toBe('');
    expect(validity[validity.length - 1]).toBe(true);
  });
});
