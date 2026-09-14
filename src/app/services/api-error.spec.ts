import { HttpErrorResponse } from '@angular/common/http';
import { FormArray, FormBuilder, FormControl, Validators } from '@angular/forms';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyFieldErrors,
  clearServerErrors,
  flatErrorMessage,
  formLevelMessage,
  parseApiError,
  toControlPath,
} from './api-error';
import { SERVER_ERROR_KEY } from './validation-messages';

function httpError(status: number, body?: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body, url: 'http://localhost/v1/x' });
}

describe('parseApiError', () => {
  it('reads shape 1 (bean validation) with fieldErrors', () => {
    const parsed = parseApiError(
      httpError(400, {
        message: 'Dados de entrada inválidos',
        errors: [{ field: 'plate', message: 'obrigatório' }],
        fieldErrors: { plate: 'Placa é obrigatória', 'address.zipCode': 'CEP inválido' },
      }),
    );

    expect(parsed.status).toBe(400);
    expect(parsed.message).toBe('Dados de entrada inválidos');
    expect(parsed.hasFieldErrors).toBe(true);
    expect(parsed.fieldErrors['address.zipCode']).toBe('CEP inválido');
  });

  it('reads shape 3 (message only) with fieldErrors absent', () => {
    const parsed = parseApiError(httpError(409, { message: 'Veículo em uso' }));
    expect(parsed.message).toBe('Veículo em uso');
    expect(parsed.hasFieldErrors).toBe(false);
    expect(parsed.fieldErrors).toEqual({});
  });

  it('never returns null fieldErrors for a non-JSON body', () => {
    expect(parseApiError(httpError(404, undefined).valueOf() as unknown).fieldErrors).toEqual({});
    expect(parseApiError(httpError(500, 'boom')).message).toBe('boom');
    expect(parseApiError('not an http error').fieldErrors).toEqual({});
  });

  /**
   * FIX-0050 — falha de rede mostrava a string crua "Failed to fetch" no banner.
   *
   * Quando a requisição nem chega a ter resposta (backend fora, sem conexão, CORS),
   * quem preenche `HttpErrorResponse.error` é o NAVEGADOR, não o backend: um
   * `TypeError` no fetch, um `ProgressEvent` no XHR. Os dois são objeto, não-nulo e
   * não-array, então passavam pela guarda de record e `body['message']` entregava a
   * string do motor de JavaScript como se fosse a mensagem do backend — o fallback em
   * português do chamador nunca era alcançado.
   */
  describe('corpo que não veio do backend (falha de rede)', () => {
    it('ignora o TypeError do fetch em vez de tratá-lo como envelope', () => {
      const parsed = parseApiError(httpError(0, new TypeError('Failed to fetch')));

      expect(parsed.status).toBe(0);
      expect(parsed.message).toBeNull();
      expect(parsed.fieldErrors).toEqual({});
      expect(parsed.hasFieldErrors).toBe(false);
    });

    it('ignora o ProgressEvent do XHR — mesmo caso com outro nome', () => {
      const parsed = parseApiError(httpError(0, new ProgressEvent('error')));

      expect(parsed.message).toBeNull();
    });

    it('deixa o chamador chegar no proprio fallback em portugues', () => {
      const parsed = parseApiError(httpError(0, new TypeError('Failed to fetch')));

      expect(flatErrorMessage(parsed)).toBe('Não foi possível concluir a operação.');
      expect(formLevelMessage(parsed, { applied: [], unmatched: {} })).toBe(
        'Não foi possível concluir a operação.',
      );
      expect(flatErrorMessage(parsed, 'Não foi possível salvar a empresa.')).toBe(
        'Não foi possível salvar a empresa.',
      );
    });

    /** A correção não pode calar o backend: envelope legítimo continua sendo lido. */
    it('não suprime mensagem legítima — envelope do backend segue intacto', () => {
      const parsed = parseApiError(
        httpError(409, { message: 'CPF já cadastrado.', fieldErrors: { 'document.value': 'CPF já cadastrado.' } }),
      );

      expect(parsed.message).toBe('CPF já cadastrado.');
      expect(parsed.fieldErrors).toEqual({ 'document.value': 'CPF já cadastrado.' });
    });

    /** Envelope entregue como string (responseType text) vira objeto simples no parse. */
    it('não suprime envelope que chegou como string', () => {
      expect(parseApiError(httpError(409, '{"message":"Conflito."}')).message).toBe('Conflito.');
    });
  });

  /**
   * Requisições feitas com `responseType: 'text'` (todo DELETE do app) NÃO passam
   * pelo JSON.parse do Angular — ele só desserializa quando o responseType é 'json'
   * (@angular/common 21.1.5: `FetchBackend.parseBody` e `HttpXhrBackend`). O envelope
   * chega então como a string literal `{"message":"..."}`. Sem reinterpretar aqui, o
   * usuário lê o JSON cru na tela.
   */
  describe('envelope que chegou sem parse (responseType: text)', () => {
    it('extrai o message de um envelope entregue como string', () => {
      const parsed = parseApiError(
        httpError(409, '{"message":"Autor não pode remover próprio combustível."}'),
      );

      expect(parsed.message).toBe('Autor não pode remover próprio combustível.');
      expect(parsed.status).toBe(409);
      expect(parsed.hasFieldErrors).toBe(false);
    });

    it('preserva fieldErrors de um envelope entregue como string', () => {
      const parsed = parseApiError(
        httpError(400, '{"message":"Placa inválida","fieldErrors":{"plate":"Placa inválida"}}'),
      );

      expect(parsed.message).toBe('Placa inválida');
      expect(parsed.hasFieldErrors).toBe(true);
      expect(parsed.fieldErrors['plate']).toBe('Placa inválida');
    });

    it('mantém texto puro verbatim — só JSON de objeto é reinterpretado', () => {
      expect(parseApiError(httpError(500, 'Erro interno inesperado')).message).toBe(
        'Erro interno inesperado',
      );
      // JSON válido que NÃO é objeto continua sendo a própria mensagem
      expect(parseApiError(httpError(400, '"só um texto"')).message).toBe('"só um texto"');
      expect(parseApiError(httpError(400, '[1,2]')).message).toBe('[1,2]');
      expect(parseApiError(httpError(400, '42')).message).toBe('42');
    });

    it('flatErrorMessage nunca devolve o JSON serializado', () => {
      const parsed = parseApiError(
        httpError(409, '{"message":"Autor não pode remover próprio combustível."}'),
      );

      const shown = flatErrorMessage(parsed, 'fallback');
      expect(shown).toBe('Autor não pode remover próprio combustível.');
      expect(shown).not.toContain('{');
      expect(shown).not.toContain('"message"');
    });
  });
});

describe('toControlPath', () => {
  it('keeps a flat key', () => {
    expect(toControlPath('plate')).toBe('plate');
  });

  it('keeps a dotted nested path', () => {
    expect(toControlPath('address.zipCode')).toBe('address.zipCode');
  });

  it('converts collection indexes to path segments', () => {
    expect(toControlPath('signers[0].name')).toBe('signers.0.name');
    expect(toControlPath('items[12]')).toBe('items.12');
    expect(toControlPath('a[0].b[1].c')).toBe('a.0.b.1.c');
  });
});

describe('applyFieldErrors', () => {
  const fb = new FormBuilder();
  let form: ReturnType<typeof buildForm>;

  function buildForm() {
    return fb.nonNullable.group({
      plate: ['', [Validators.required]],
      address: fb.nonNullable.group({ zipCode: [''] }),
      signers: fb.array([fb.nonNullable.group({ name: [''] })]),
    });
  }

  beforeEach(() => {
    form = buildForm();
  });

  it('flags a flat control and marks it touched', () => {
    const result = applyFieldErrors(form, { plate: 'Placa já cadastrada.' });

    expect(result.applied).toEqual(['plate']);
    expect(result.unmatched).toEqual({});
    expect(form.controls.plate.errors?.[SERVER_ERROR_KEY]).toEqual({
      message: 'Placa já cadastrada.',
    });
    expect(form.controls.plate.touched).toBe(true);
  });

  it('flags a nested control via dotted path', () => {
    applyFieldErrors(form, { 'address.zipCode': 'CEP inválido.' });
    expect(form.controls.address.controls.zipCode.errors?.[SERVER_ERROR_KEY]).toEqual({
      message: 'CEP inválido.',
    });
  });

  it('flags a collection item via indexed path', () => {
    applyFieldErrors(form, { 'signers[0].name': 'Nome obrigatório.' });
    const signers = form.controls.signers as FormArray;
    expect(signers.at(0).get('name')?.errors?.[SERVER_ERROR_KEY]).toEqual({
      message: 'Nome obrigatório.',
    });
  });

  /**
   * FIX-0060 — chave que resolve para GRUPO fazia o erro sumir por completo.
   *
   * `root.get('address')` devolve o FormGroup. Tratado como match, o `serverError`
   * ia parar num nó que nenhum `<app-form-field>` renderiza, `unmatched` ficava
   * vazio, `formLevelMessage` devolvia `null` e o toast do interceptor já tinha sido
   * suprimido pelo `claim()`: o usuário clicava em salvar e não acontecia nada.
   * Falhar alto é melhor que falhar calado — grupo cai em `unmatched` e ao menos
   * aparece no banner.
   */
  describe('chave que não resolve para folha (FIX-0060)', () => {
    it('trata chave de FormGroup como não-casada', () => {
      const result = applyFieldErrors(form, { address: 'Endereço inválido.' });

      expect(result.applied).toEqual([]);
      expect(result.unmatched).toEqual({ address: 'Endereço inválido.' });
      // Nada foi escrito no grupo, que ninguém renderiza.
      expect(form.controls.address.errors).toBeNull();
    });

    it('trata chave de FormArray como não-casada', () => {
      const result = applyFieldErrors(form, { signers: 'Assinantes inválidos.' });

      expect(result.applied).toEqual([]);
      expect(result.unmatched).toEqual({ signers: 'Assinantes inválidos.' });
      expect((form.controls.signers as FormArray).errors).toBeNull();
    });

    it('o item do array continua casando — o que não casa é o array inteiro', () => {
      const result = applyFieldErrors(form, { 'signers[0]': 'Assinante inválido.' });

      expect(result.applied).toEqual([]);
      expect(result.unmatched).toEqual({ 'signers[0]': 'Assinante inválido.' });
    });

    it('a mensagem engolida passa a chegar no banner', () => {
      const parsed = parseApiError(
        httpError(409, {
          message: 'CPF já cadastrado.',
          fieldErrors: { address: 'Endereço inválido.' },
        }),
      );
      const result = applyFieldErrors(form, parsed.fieldErrors);

      expect(formLevelMessage(parsed, result)).toBe('Endereço inválido.');
    });

    it('folha continua casando — o endurecimento não fecha o caminho normal', () => {
      const result = applyFieldErrors(form, {
        'address.zipCode': 'CEP inválido.',
        'signers[0].name': 'Nome obrigatório.',
        plate: 'Placa já cadastrada.',
      });

      expect(result.applied).toEqual(['address.zipCode', 'signers.0.name', 'plate']);
      expect(result.unmatched).toEqual({});
    });
  });

  it('reports entries with no matching control as unmatched', () => {
    const result = applyFieldErrors(form, { unknownField: 'Algo deu errado.' });
    expect(result.applied).toEqual([]);
    expect(result.unmatched).toEqual({ unknownField: 'Algo deu errado.' });
  });

  it('preserves pre-existing client validator errors', () => {
    form.controls.plate.markAsTouched();
    form.controls.plate.updateValueAndValidity();
    applyFieldErrors(form, { plate: 'Placa já cadastrada.' });

    expect(form.controls.plate.errors?.['required']).toBe(true);
    expect(form.controls.plate.errors?.[SERVER_ERROR_KEY]).toBeDefined();
  });

  it('clears the server error on the next value change', () => {
    applyFieldErrors(form, { plate: 'Placa já cadastrada.' });
    form.controls.plate.setValue('ABC1D23');
    expect(form.controls.plate.errors?.[SERVER_ERROR_KEY]).toBeUndefined();
  });
});

describe('clearServerErrors', () => {
  it('removes server errors recursively and re-runs real validators', () => {
    const fb = new FormBuilder();
    const form = fb.nonNullable.group({
      plate: ['', [Validators.required]],
      address: fb.nonNullable.group({ zipCode: ['12345'] }),
    });
    applyFieldErrors(form, { plate: 'dup', 'address.zipCode': 'ruim' });

    clearServerErrors(form);

    expect(form.controls.plate.errors).toEqual({ required: true });
    expect(form.controls.address.controls.zipCode.errors).toBeNull();
  });

  it('is a no-op on a clean control', () => {
    const control = new FormControl('x');
    clearServerErrors(control);
    expect(control.errors).toBeNull();
  });
});

describe('formLevelMessage', () => {
  it('returns null when every field error landed inline (no double reading)', () => {
    const parsed = parseApiError(
      httpError(409, {
        message: 'Placa já cadastrada.',
        fieldErrors: { plate: 'Placa já cadastrada.' },
      }),
    );
    const form = new FormBuilder().nonNullable.group({ plate: [''] });
    const result = applyFieldErrors(form, parsed.fieldErrors);

    expect(formLevelMessage(parsed, result)).toBeNull();
  });

  it('surfaces unmatched field errors in the banner', () => {
    const parsed = parseApiError(
      httpError(400, { message: 'x', fieldErrors: { ghost: 'Sem campo.' } }),
    );
    const form = new FormBuilder().nonNullable.group({ plate: [''] });
    const result = applyFieldErrors(form, parsed.fieldErrors);

    expect(formLevelMessage(parsed, result)).toBe('Sem campo.');
  });

  it('falls back to the backend message when there are no field errors', () => {
    const parsed = parseApiError(httpError(409, { message: 'Veículo em uso.' }));
    expect(formLevelMessage(parsed, { applied: [], unmatched: {} })).toBe('Veículo em uso.');
  });

  it('falls back to the caller fallback when the body has no message', () => {
    const parsed = parseApiError(httpError(400));
    expect(formLevelMessage(parsed, { applied: [], unmatched: {} }, 'Falhou.')).toBe('Falhou.');
  });
});

describe('flatErrorMessage', () => {
  it('joins field errors for screens without a form', () => {
    const parsed = parseApiError(
      httpError(400, { message: 'm', fieldErrors: { a: 'A.', b: 'B.' } }),
    );
    expect(flatErrorMessage(parsed)).toBe('A. B.');
  });

  it('uses the message when there are no field errors', () => {
    expect(flatErrorMessage(parseApiError(httpError(404, { message: 'Sumiu.' })))).toBe('Sumiu.');
  });
});
