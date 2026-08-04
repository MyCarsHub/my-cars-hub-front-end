import { describe, it, expect } from 'vitest';
import { FormControl } from '@angular/forms';

import { applyMaskedPhoneInput, caretAfterDigits, maskPhone, normalizePhone } from './phone-mask';

describe('phone-mask — telefone brasileiro', () => {
  describe('normalizePhone', () => {
    it('remove separadores, corta em 11 dígitos e preserva zero à esquerda', () => {
      expect(normalizePhone('(11) 98765-4321')).toBe('11987654321');
      expect(normalizePhone('11987654321999')).toBe('11987654321');
      expect(normalizePhone('011987654321')).toBe('01198765432');
      expect(normalizePhone(null)).toBe('');
      expect(normalizePhone(undefined)).toBe('');
    });
  });

  describe('maskPhone', () => {
    it('formata progressivamente enquanto o usuário digita', () => {
      expect(maskPhone('')).toBe('');
      expect(maskPhone('1')).toBe('(1');
      expect(maskPhone('11')).toBe('(11');
      expect(maskPhone('119')).toBe('(11) 9');
      expect(maskPhone('119876')).toBe('(11) 9876');
      expect(maskPhone('1198765')).toBe('(11) 98765-');
    });

    it('formata o número completo', () => {
      expect(maskPhone('11987654321')).toBe('(11) 98765-4321');
      // Já mascarado entra e sai igual — a hidratação do Back reusa a mesma função.
      expect(maskPhone('(11) 98765-4321')).toBe('(11) 98765-4321');
    });

    it('ignora caracteres não numéricos', () => {
      expect(maskPhone('1a1b9c8765d4321')).toBe('(11) 98765-4321');
      expect(maskPhone('abc')).toBe('');
    });
  });

  describe('caretAfterDigits — conta dígitos, não caracteres', () => {
    it('devolve a posição logo após o n-ésimo dígito', () => {
      expect(caretAfterDigits('(11) 98765-4321', 0)).toBe(0);
      expect(caretAfterDigits('(11) 98765-4321', 1)).toBe(2);
      expect(caretAfterDigits('(11) 98765-4321', 2)).toBe(3);
      // O 3º dígito vem depois de ') ' — um índice cru erraria em dois caracteres.
      expect(caretAfterDigits('(11) 98765-4321', 3)).toBe(6);
      expect(caretAfterDigits('(11) 98765-4321', 7)).toBe(10);
      expect(caretAfterDigits('(11) 98765-4321', 8)).toBe(12);
      expect(caretAfterDigits('(11) 98765-4321', 99)).toBe(15);
    });
  });

  describe('applyMaskedPhoneInput', () => {
    it('formata o controle e mantém o cursor no dígito editado no meio do texto', () => {
      const input = document.createElement('input');
      const control = new FormControl('(11) 98765-432');
      input.addEventListener('input', (event) => applyMaskedPhoneInput(event, control));

      // Usuário posiciona o cursor depois do "8" e digita "1".
      input.value = '(11) 918765-432';
      input.setSelectionRange(7, 7);
      input.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '1' }));

      expect(control.value).toBe('(11) 91876-5432');
      expect(input.value).toBe('(11) 91876-5432');
      // 4 dígitos antes do cursor ("1","1","9","1") → logo após o 4º.
      expect(input.selectionStart).toBe(7);
      expect(input.selectionEnd).toBe(7);
    });

    it('no backspace de um dígito no meio, o cursor fica onde o dígito estava', () => {
      const input = document.createElement('input');
      const control = new FormControl('(11) 98765-4321');
      input.addEventListener('input', (event) => applyMaskedPhoneInput(event, control));

      // Apagou o "8" (3º dígito depois do DDD).
      input.value = '(11) 9765-4321';
      input.setSelectionRange(6, 6);
      input.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward' }));

      // A máscara é posicional: com 10 dígitos o bloco de 5 puxa o resto para a esquerda.
      expect(control.value).toBe('(11) 97654-321');
      // O que importa é o cursor: continua logo depois de "(11) 9", onde o "8" estava.
      expect(input.selectionStart).toBe(6);
    });

    it('no backspace sobre um separador, apaga também o dígito anterior', () => {
      const input = document.createElement('input');
      const control = new FormControl('(11) 98765-4321');
      input.addEventListener('input', (event) => applyMaskedPhoneInput(event, control));

      // O navegador removeu só o "-"; sem tratamento a máscara o recolocaria e a tecla
      // pareceria morta.
      input.value = '(11) 987654321';
      input.setSelectionRange(10, 10);
      input.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward' }));

      expect(normalizePhone(control.value)).toBe('1198764321');
      expect(control.value).toBe('(11) 98764-321');
    });

    it('ao colar um número inteiro, mascara e leva o cursor para o fim', () => {
      const input = document.createElement('input');
      const control = new FormControl('');
      input.addEventListener('input', (event) => applyMaskedPhoneInput(event, control));

      input.value = '11987654321';
      input.setSelectionRange(11, 11);
      input.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste' }));

      expect(control.value).toBe('(11) 98765-4321');
      expect(input.selectionStart).toBe(15);
    });

    it('ao colar no meio, o cursor para logo depois do trecho colado', () => {
      const input = document.createElement('input');
      const control = new FormControl('(11) 4321');
      input.addEventListener('input', (event) => applyMaskedPhoneInput(event, control));

      // Colou "98765" logo após o DDD.
      input.value = '(11) 987654321';
      input.setSelectionRange(10, 10);
      input.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste' }));

      expect(control.value).toBe('(11) 98765-4321');
      // 7 dígitos antes do cursor → logo após o 7º, antes do hífen.
      expect(input.selectionStart).toBe(10);
    });

    it('ignora alvos que não são input', () => {
      const control = new FormControl('x');
      applyMaskedPhoneInput({ target: null } as unknown as Event, control);
      expect(control.value).toBe('x');
    });
  });
});
