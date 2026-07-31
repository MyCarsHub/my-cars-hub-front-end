import { describe, it, expect } from 'vitest';
import { FormControl } from '@angular/forms';

import {
  applyMaskedDocumentInput,
  caretAfterAlphanumeric,
  cnpjShapeValidator,
  cpfShapeValidator,
  documentCheckDigitValidator,
  documentShapeValidator,
  isCnpjShapeValid,
  isCpfShapeValid,
  isDocumentShapeValid,
  maskCnpj,
  maskCpf,
  maskDocument,
  normalizeCpf,
  normalizeDocument,
} from './document-mask';

describe('document-mask — CPF e CNPJ alfanumérico', () => {
  describe('normalizeDocument', () => {
    it('remove separadores, mantém letras em maiúsculo e corta em 14', () => {
      expect(normalizeDocument('12.abc.345/01de-35')).toBe('12ABC34501DE35');
      expect(normalizeDocument('123.456.789-09')).toBe('12345678909');
      expect(normalizeDocument('12345678000195999')).toBe('12345678000195');
      expect(normalizeDocument(null)).toBe('');
    });
  });

  describe('maskDocument', () => {
    it('formata progressivamente como CPF enquanto o valor é numérico e curto', () => {
      expect(maskDocument('123')).toBe('123');
      expect(maskDocument('1234')).toBe('123.4');
      expect(maskDocument('1234567')).toBe('123.456.7');
      expect(maskDocument('12345678909')).toBe('123.456.789-09');
    });

    it('formata como CNPJ ao passar de 11 caracteres', () => {
      expect(maskDocument('12345678000195')).toBe('12.345.678/0001-95');
    });

    it('formata como CNPJ assim que aparece uma letra, mesmo curto', () => {
      expect(maskDocument('12abc')).toBe('12.ABC');
      expect(maskDocument('12abc34501de35')).toBe('12.ABC.345/01DE-35');
    });
  });

  describe('isDocumentShapeValid', () => {
    it('aceita vazio, CPF de 11 dígitos e CNPJ de 14 posições alfanuméricas', () => {
      expect(isDocumentShapeValid('')).toBe(true);
      expect(isDocumentShapeValid('123.456.789-09')).toBe(true);
      expect(isDocumentShapeValid('12.345.678/0001-95')).toBe(true);
      expect(isDocumentShapeValid('12.ABC.345/01DE-35')).toBe(true);
      expect(isDocumentShapeValid('12abc34501de35')).toBe(true);
    });

    it('recusa comprimentos intermediários, letras em CPF e dígitos verificadores não numéricos', () => {
      expect(isDocumentShapeValid('123')).toBe(false);
      expect(isDocumentShapeValid('123456789012')).toBe(false);
      expect(isDocumentShapeValid('1234567890A')).toBe(false);
      expect(isDocumentShapeValid('12ABC34501DEAB')).toBe(false);
    });
  });

  describe('documentShapeValidator', () => {
    it('marca documentShape apenas para formatos inválidos', () => {
      const validator = documentShapeValidator();
      expect(validator(new FormControl(''))).toBeNull();
      expect(validator(new FormControl('12.ABC.345/01DE-35'))).toBeNull();
      expect(validator(new FormControl('123'))).toEqual({ documentShape: true });
    });
  });

  describe('normalizeCpf / maskCpf — o documento é sempre string', () => {
    it('preserva zeros à esquerda em vez de virar número', () => {
      expect(normalizeCpf('012.345.678-90')).toBe('01234567890');
      expect(maskCpf('01234567890')).toBe('012.345.678-90');
      expect(maskCpf('000')).toBe('000');
      // Um Number() aqui devolveria 1234567890 e perderia o zero inicial.
      expect(normalizeCpf('012.345.678-90').startsWith('0')).toBe(true);
    });

    it('descarta letras e corta em 11 dígitos', () => {
      expect(normalizeCpf('01a2b345678900')).toBe('01234567890');
    });
  });

  describe('maskCnpj — sempre no layout de CNPJ, mesmo curto', () => {
    it('não cai no layout de CPF em valores numéricos curtos', () => {
      expect(maskCnpj('12345678')).toBe('12.345.678');
      expect(maskCnpj('12345678000195')).toBe('12.345.678/0001-95');
      expect(maskCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35');
    });
  });

  describe('validadores por documento', () => {
    it('cpfShapeValidator recusa letras e comprimentos errados, aceita vazio', () => {
      const validator = cpfShapeValidator();
      expect(validator(new FormControl(''))).toBeNull();
      expect(validator(new FormControl('012.345.678-90'))).toBeNull();
      expect(validator(new FormControl('0123456789'))).toEqual({ cpfShape: true });
      // Letras não são dígitos: somem na normalização e o comprimento não fecha.
      expect(isCpfShapeValid('0123456789A')).toBe(false);
      expect(isCpfShapeValid('12ABC34501DE35')).toBe(false);
    });

    it('cnpjShapeValidator aceita CNPJ alfanumérico e recusa CPF', () => {
      const validator = cnpjShapeValidator();
      expect(validator(new FormControl(''))).toBeNull();
      expect(validator(new FormControl('12.ABC.345/01DE-35'))).toBeNull();
      expect(validator(new FormControl('12abc34501de35'))).toBeNull();
      expect(validator(new FormControl('012.345.678-90'))).toEqual({ cnpjShape: true });
      expect(isCnpjShapeValid('12ABC34501DEAB')).toBe(false);
    });
  });

  describe('applyMaskedDocumentInput', () => {
    it('formata o controle e devolve o cursor à posição editada', () => {
      const input = document.createElement('input');
      const control = new FormControl('');
      input.value = '12345678000195';
      input.setSelectionRange(4, 4);

      applyMaskedDocumentInput({ target: input } as unknown as Event, control, maskCnpj);

      expect(control.value).toBe('12.345.678/0001-95');
      expect(input.value).toBe('12.345.678/0001-95');
      expect(input.selectionStart).toBe(5);
    });

    it('ignora alvos que não são input', () => {
      const control = new FormControl('x');
      applyMaskedDocumentInput({ target: null } as unknown as Event, control, maskCpf);
      expect(control.value).toBe('x');
    });

    it('no backspace sobre um separador, apaga também o caractere anterior', () => {
      const input = document.createElement('input');
      const control = new FormControl('012.345.678-90');
      input.addEventListener('input', (event) =>
        applyMaskedDocumentInput(event, control, maskCpf),
      );

      // O navegador removeu só o ponto; sem tratamento a máscara o recolocaria e a
      // tecla pareceria morta.
      input.value = '012345.678-90';
      input.setSelectionRange(3, 3);
      input.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward' }));

      // O "2" saiu junto com o ponto; a máscara é posicional e o resto desliza.
      expect((control.value ?? '').replace(/\D/g, '')).toBe('0134567890');
      expect(control.value).toBe('013.456.789-0');
    });
  });

  describe('documentCheckDigitValidator — mod 11 espelhando o backend', () => {
    const validator = documentCheckDigitValidator();

    it('aceita os vetores válidos do backend', () => {
      expect(validator(new FormControl('11.222.333/0001-81'))).toBeNull();
      expect(validator(new FormControl('12ABC34501DE35'))).toBeNull();
      expect(validator(new FormControl('12.345.678/0001-95'))).toBeNull();
      expect(validator(new FormControl('012.345.678-90'))).toBeNull();
    });

    it('recusa dígitos verificadores errados, em CPF e em CNPJ', () => {
      expect(validator(new FormControl('12.345.678/0001-96'))).toEqual({ documentInvalid: true });
      expect(validator(new FormControl('012.345.678-91'))).toEqual({ documentInvalid: true });
      expect(validator(new FormControl('12ABC34501DE36'))).toEqual({ documentInvalid: true });
    });

    it('recusa documentos de caracteres repetidos', () => {
      expect(validator(new FormControl('11111111111111'))).toEqual({ documentInvalid: true });
      expect(validator(new FormControl('11111111111'))).toEqual({ documentInvalid: true });
    });

    it('fica em silêncio no vazio e em comprimentos que a validação de forma já cobre', () => {
      expect(validator(new FormControl(''))).toBeNull();
      expect(validator(new FormControl('123'))).toBeNull();
      expect(validator(new FormControl('123456789012'))).toBeNull();
    });
  });

  describe('caretAfterAlphanumeric', () => {
    it('devolve a posição logo após o n-ésimo caractere alfanumérico', () => {
      expect(caretAfterAlphanumeric('12.345.678/0001-95', 0)).toBe(0);
      expect(caretAfterAlphanumeric('12.345.678/0001-95', 2)).toBe(2);
      expect(caretAfterAlphanumeric('12.345.678/0001-95', 3)).toBe(4);
      expect(caretAfterAlphanumeric('12.345.678/0001-95', 99)).toBe(18);
    });
  });
});
