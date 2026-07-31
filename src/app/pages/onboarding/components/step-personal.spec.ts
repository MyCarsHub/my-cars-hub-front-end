import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { StepPersonal } from './step-personal';
import type { OnboardingData } from '../onboarding.types';

/**
 * CPF é sempre STRING: um `Number('012...')` derrubaria o zero à esquerda e mandaria
 * um documento diferente para o backend. As validações locais são de forma + dígito
 * verificador (mod 11), ambas sobre string.
 */
describe('StepPersonal — CPF no onboarding', () => {
  /** CPF válido pelo mod 11 e começando com zero. */
  const CPF_WITH_LEADING_ZERO = '012.345.678-90';

  let fixture: ComponentFixture<StepPersonal>;
  let component: StepPersonal;
  let emitted: Partial<OnboardingData>[];

  function cpfInput(): HTMLInputElement {
    const input = fixture.nativeElement.querySelector('#ob-cpf');
    if (!(input instanceof HTMLInputElement)) throw new Error('campo de CPF ausente');
    return input;
  }

  function lastEmitted(): Partial<OnboardingData> {
    return emitted[emitted.length - 1];
  }

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [StepPersonal] });
    fixture = TestBed.createComponent(StepPersonal);
    component = fixture.componentInstance;

    emitted = [];
    component.formChange.subscribe((value) => emitted.push(value));
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserva o zero à esquerda do CPF até o valor emitido', () => {
    component.form.get('cpf')?.setValue(CPF_WITH_LEADING_ZERO);

    expect(component.form.get('cpf')?.errors).toBeNull();
    expect(lastEmitted().cpf).toBe('01234567890');
    expect(typeof lastEmitted().cpf).toBe('string');
    expect(lastEmitted().cpf?.startsWith('0')).toBe(true);
  });

  it('mascara mantendo o zero inicial e o cursor na posição editada', () => {
    const input = cpfInput();
    input.value = '01234567890';
    input.setSelectionRange(3, 3);
    input.dispatchEvent(new Event('input'));

    expect(component.form.get('cpf')?.value).toBe('012.345.678-90');
    expect(input.selectionStart).toBe(3);
  });

  it('recusa CPF com menos de 11 dígitos pela validação de forma', () => {
    component.form.get('cpf')?.setValue('012.345');

    expect(component.form.get('cpf')?.errors?.['cpfShape']).toBe(true);
  });

  it('recusa letras no CPF — elas não sobrevivem à normalização', () => {
    component.form.get('cpf')?.setValue('01a.345.678-90');

    // As letras somem, sobram 10 dígitos → forma inválida.
    expect(component.form.get('cpf')?.errors?.['cpfShape']).toBe(true);
  });

  it('recusa dígito verificador errado com a mensagem de CPF inválido', () => {
    component.form.get('cpf')?.setValue('012.345.678-91');

    expect(component.form.get('cpf')?.errors?.['cpfInvalid']).toBe(true);
    expect(component.form.get('cpf')?.errors?.['cpfShape']).toBeUndefined();
  });

  /**
   * Voltar reidrata o passo com os dígitos crus do backend (`52998224725`); a máscara
   * precisa ser reaplicada na hidratação — e o valor mascarado continua válido.
   */
  it('reidrata CPF e telefone COM máscara e o formulário permanece válido', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [StepPersonal] });
    const local = TestBed.createComponent(StepPersonal);
    local.componentRef.setInput('initialData', {
      name: 'Ada Lovelace',
      cpf: '52998224725',
      phoneNumber: '11987654321',
    });
    local.detectChanges();

    const form = local.componentInstance.form;
    expect(form.get('cpf')?.value).toBe('529.982.247-25');
    expect(form.get('phoneNumber')?.value).toBe('(11) 98765-4321');
    expect(form.valid).toBe(true);
  });
});
