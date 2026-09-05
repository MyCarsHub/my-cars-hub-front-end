import { describe, expect, it } from 'vitest';
import { applyPtBrMoneyMask, maskPtBrMoneyInput } from './ptbr-money-mask';

/**
 * A máscara de milhar do dinheiro (FIX-0261), testada como função pura: valor
 * cru + caret entram, valor formatado + caret saem. O contrato central é que
 * todo valor COMPLETO que a máscara escreve é aceito de volta por
 * `parsePtBrMoneyCents` — a máscara reusa `formatPtBrNumber` exatamente para
 * isso. Estados intermediários de digitação ("1.234,") são preservados pela
 * máscara mas recusados pelo parser, por design: o campo só precisa parsear
 * no confirm, quando o valor está completo.
 */
describe('ptbr-money-mask', () => {
  // ------------------------------------------------------ digitação incremental

  it('agrupa o milhar a cada tecla: 4 → 45 → … → 45.000, caret sempre no fim', () => {
    expect(maskPtBrMoneyInput('4', 1)).toEqual({ value: '4', caret: 1 });
    expect(maskPtBrMoneyInput('45', 2)).toEqual({ value: '45', caret: 2 });
    expect(maskPtBrMoneyInput('450', 3)).toEqual({ value: '450', caret: 3 });
    expect(maskPtBrMoneyInput('4500', 4)).toEqual({ value: '4.500', caret: 5 });
    expect(maskPtBrMoneyInput('45000', 5)).toEqual({ value: '45.000', caret: 6 });
    expect(maskPtBrMoneyInput('450000', 6)).toEqual({ value: '450.000', caret: 7 });
    expect(maskPtBrMoneyInput('4500000', 7)).toEqual({ value: '4.500.000', caret: 9 });
  });

  it('digitar um dígito depois de um valor já mascarado reagrupa ("45.000" + "0")', () => {
    // O campo tinha "45.000"; o usuário digitou "0" no fim → cru "45.0000".
    expect(maskPtBrMoneyInput('45.0000', 7)).toEqual({ value: '450.000', caret: 7 });
  });

  it('vazio permanece vazio', () => {
    expect(maskPtBrMoneyInput('', 0)).toEqual({ value: '', caret: 0 });
  });

  // ------------------------------------------------------------ caret no meio

  it('digitar no MEIO mantém o caret atrás do dígito digitado', () => {
    // "45.000" com caret após o 5 (índice 2); digitou "9" → cru "459.000", caret 3.
    const result = maskPtBrMoneyInput('459.000', 3);
    expect(result.value).toBe('459.000');
    expect(result.caret).toBe(3);
  });

  it('digitar no meio quando o reagrupo MOVE o ponto não joga o caret para o fim', () => {
    // "1.500" com caret após o 1 (índice 1); digitou "2" → cru "12.500", caret 2.
    const result = maskPtBrMoneyInput('12.500', 2);
    expect(result.value).toBe('12.500');
    expect(result.caret).toBe(2);
    // "12.500" caret após o 2 (índice 2); digitou "3" → cru "123.500", caret 3.
    const grown = maskPtBrMoneyInput('123.500', 3);
    expect(grown.value).toBe('123.500');
    expect(grown.caret).toBe(3);
    // Mais um dígito e nasce um ponto NOVO antes do caret: cru "1234.500", caret 4.
    const regrouped = maskPtBrMoneyInput('1234.500', 4);
    expect(regrouped.value).toBe('1.234.500');
    expect(regrouped.caret).toBe(5);
  });

  it('apagar um dígito no meio reflui os grupos', () => {
    // "45.000" apagou o 5 (backspace no índice 2 → cru "4.000"... não: o dígito
    // saiu de verdade, então a contagem cai e NÃO é o caso da tecla morta).
    const result = maskPtBrMoneyInput('4.000', 1, {
      previous: '45.000',
      deletedBackwards: true,
    });
    expect(result.value).toBe('4.000');
    expect(result.caret).toBe(1);
  });

  // -------------------------------------------------------- decimais parciais

  it('preserva a vírgula parcial: "1234," e "1234,5" durante a digitação', () => {
    expect(maskPtBrMoneyInput('1234,', 5)).toEqual({ value: '1.234,', caret: 6 });
    expect(maskPtBrMoneyInput('1234,5', 6)).toEqual({ value: '1.234,5', caret: 7 });
    expect(maskPtBrMoneyInput('1234,50', 7)).toEqual({ value: '1.234,50', caret: 8 });
  });

  it('a terceira casa decimal é tecla morta — dinheiro tem 2', () => {
    // "1.234,50" e o usuário digita "9" no fim.
    expect(maskPtBrMoneyInput('1.234,509', 9)).toEqual({ value: '1.234,50', caret: 8 });
  });

  it('segunda vírgula é tecla morta', () => {
    // "1.234,5" e o usuário digita "," de novo.
    expect(maskPtBrMoneyInput('1.234,5,', 8)).toEqual({ value: '1.234,5', caret: 7 });
  });

  it('",5" vale meio real e não ganha zero inventado', () => {
    expect(maskPtBrMoneyInput(',5', 2)).toEqual({ value: ',5', caret: 2 });
  });

  // ------------------------------------------------------------------ colagem

  it('aceita colar um valor já formatado, com R$ e espaços', () => {
    const result = maskPtBrMoneyInput('R$ 45.000,00', 12, { pasted: true });
    expect(result.value).toBe('45.000,00');
    expect(result.caret).toBe(9);
  });

  it('colar um valor sem agrupamento agrupa ("1500,5" → "1.500,5")', () => {
    expect(maskPtBrMoneyInput('1500,5', 6, { pasted: true }).value).toBe('1.500,5');
  });

  it('colar decimal en-US ("45.99") fica INTACTO para a validação recusar', () => {
    // Coagir para "4.599" seria o erro de 100x silencioso. A máscara não mexe;
    // o parser recusa e o erro inline aparece.
    expect(maskPtBrMoneyInput('45.99', 5, { pasted: true })).toEqual({
      value: '45.99',
      caret: 5,
    });
  });

  it('colar lixo ("1.23.456", "abc") também fica intacto', () => {
    expect(maskPtBrMoneyInput('1.23.456', 8, { pasted: true }).value).toBe('1.23.456');
    expect(maskPtBrMoneyInput('abc', 3, { pasted: true }).value).toBe('abc');
  });

  // ------------------------------------------------- apagar o separador (ponto)

  it('backspace em cima do ponto não é tecla morta: o dígito anterior cai junto', () => {
    // Campo "1.234", backspace no ponto → cru "1234", caret 1. Sem tratamento o
    // reagrupo devolveria "1.234" e nada teria acontecido.
    const result = maskPtBrMoneyInput('1234', 1, {
      previous: '1.234',
      deletedBackwards: true,
    });
    expect(result.value).toBe('234');
    expect(result.caret).toBe(0);
  });

  it('DELETE (para frente) em cima do ponto também não é tecla morta: o dígito seguinte cai', () => {
    // Campo "1.234", caret antes do ponto (índice 1), tecla Delete → cru
    // "1234", caret 1. Sem tratamento o reagrupo devolveria "1.234" com o
    // caret no mesmo lugar — tecla morta total. O dígito à direita cai junto.
    const result = maskPtBrMoneyInput('1234', 1, {
      previous: '1.234',
      deletedForwards: true,
    });
    expect(result.value).toBe('134');
    expect(result.caret).toBe(1);
  });

  it('backspace em cima da VÍRGULA é edição real: só a vírgula sai', () => {
    // Campo "1.234,50", backspace na vírgula → cru "1.23450", caret 5. A vírgula
    // conta como significativa, então a contagem caiu e nenhum dígito é comido.
    const result = maskPtBrMoneyInput('1.23450', 5, {
      previous: '1.234,50',
      deletedBackwards: true,
    });
    expect(result.value).toBe('123.450');
    expect(result.caret).toBe(5);
  });

  // ------------------------------------------------------------------- higiene

  it('zero à esquerda não sobrevive — "0.450" seria recusado pelo parser', () => {
    expect(maskPtBrMoneyInput('0450', 4).value).toBe('450');
  });

  it('letras e símbolos digitados são descartados', () => {
    expect(maskPtBrMoneyInput('45a00', 5).value).toBe('4.500');
  });

  // -------------------------------------------- aplicador de DOM (o caminho
  // realmente ligado ao teclado: InputEvent.inputType decide o modo)

  /** Monta um input real, posiciona o caret e dispara um InputEvent de verdade. */
  function fire(
    value: string,
    caret: number,
    previous: string,
    inputType?: string,
  ): { element: HTMLInputElement; result: { value: string; caret: number } } {
    const element = document.createElement('input');
    element.type = 'text';
    element.value = value;
    element.setSelectionRange(caret, caret);
    let result = { value: '', caret: -1 };
    element.addEventListener('input', (event) => {
      result = applyPtBrMoneyMask(event, previous);
    });
    const event =
      inputType === undefined
        ? new Event('input')
        : new InputEvent('input', { inputType });
    element.dispatchEvent(event);
    return { element, result };
  }

  describe('applyPtBrMoneyMask', () => {
    it('insertText usa o modo digitação: tecla "." é morta, não vira modo estrito', () => {
      // Campo "45", usuário digita "." → cru "45." caret 3. No modo estrito
      // "45." ficaria intacto; no de digitação o ponto morre. É a diferença
      // observável entre os dois branches.
      const { element, result } = fire('45.', 3, '45', 'insertText');
      expect(result).toEqual({ value: '45', caret: 2 });
      expect(element.value).toBe('45');
      expect(element.selectionStart).toBe(2);
    });

    it('insertText reescreve o campo agrupado e devolve o caret do meio', () => {
      // "45.000" com caret após o 5; digitou "9" → cru "459.000" caret 3.
      const { element, result } = fire('459.000', 3, '45.000', 'insertText');
      expect(result).toEqual({ value: '459.000', caret: 3 });
      expect(element.selectionStart).toBe(3);
    });

    it('deleteContentBackward em cima do ponto come o dígito anterior', () => {
      const { element } = fire('1234', 1, '1.234', 'deleteContentBackward');
      expect(element.value).toBe('234');
      expect(element.selectionStart).toBe(0);
    });

    it('deleteContentForward em cima do ponto come o dígito seguinte', () => {
      const { element } = fire('1234', 1, '1.234', 'deleteContentForward');
      expect(element.value).toBe('134');
      expect(element.selectionStart).toBe(1);
    });

    it('insertFromPaste é o modo estrito: "45.99" fica intacto', () => {
      const { element } = fire('45.99', 5, '', 'insertFromPaste');
      expect(element.value).toBe('45.99');
    });

    it('Event sem inputType (specs legadas) cai no modo estrito e formata o que é válido', () => {
      const { element } = fire('45000', 5, '');
      expect(element.value).toBe('45.000');
    });
  });
});
