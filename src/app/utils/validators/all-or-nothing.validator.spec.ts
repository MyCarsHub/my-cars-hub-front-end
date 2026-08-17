import { FormControl, FormGroup, Validators } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { allOrNothingBlock } from './all-or-nothing.validator';

/**
 * O que estes testes protegem:
 *  - bloco inteiro em branco continua VÁLIDO — é o caminho de apagar o bloco;
 *  - um campo preenchido torna os outros obrigatórios, e o erro cai NO campo que falta;
 *  - o campo isento nunca fica obrigatório, mas preenchê-lo começa o bloco;
 *  - a chave `required` some sozinha quando o buraco é tapado, sem levar junto os
 *    erros dos validadores próprios do campo.
 */
describe('allOrNothingBlock', () => {
  function build() {
    return new FormGroup(
      {
        a: new FormControl('', { nonNullable: true }),
        b: new FormControl('', { nonNullable: true }),
        livre: new FormControl('', { nonNullable: true }),
      },
      { validators: allOrNothingBlock(['livre']) },
    );
  }

  it('bloco inteiro em branco é válido e nenhum campo fica marcado', () => {
    const group = build();

    expect(group.valid).toBe(true);
    expect(group.errors).toBeNull();
    expect(group.controls.a.errors).toBeNull();
    expect(group.controls.b.errors).toBeNull();
  });

  it('só espaço em branco continua contando como vazio', () => {
    const group = build();

    group.controls.a.setValue('   ');

    expect(group.valid).toBe(true);
    expect(group.controls.b.errors).toBeNull();
  });

  it('um campo preenchido torna os irmãos obrigatórios, com o erro NO irmão', () => {
    const group = build();

    group.controls.a.setValue('valor');

    expect(group.valid).toBe(false);
    expect(group.errors).toEqual({ blockIncomplete: { missing: ['b'] } });
    expect(group.controls.b.errors).toEqual({ required: true });
    // O campo que o usuário preencheu não é acusado.
    expect(group.controls.a.errors).toBeNull();
  });

  it('o campo isento nunca fica obrigatório — mas preenchê-lo começa o bloco', () => {
    const group = build();

    group.controls.livre.setValue('opcional');

    expect(group.controls.livre.errors).toBeNull();
    expect(group.errors).toEqual({ blockIncomplete: { missing: ['a', 'b'] } });
  });

  it('completar o bloco limpa o `required` de todo mundo', () => {
    const group = build();

    group.controls.a.setValue('valor');
    expect(group.controls.b.errors).toEqual({ required: true });

    group.controls.b.setValue('outro');

    expect(group.valid).toBe(true);
    expect(group.errors).toBeNull();
    expect(group.controls.b.errors).toBeNull();
  });

  it('esvaziar tudo de novo volta a ser válido', () => {
    const group = build();

    group.controls.a.setValue('valor');
    group.controls.a.setValue('');

    expect(group.valid).toBe(true);
    expect(group.controls.b.errors).toBeNull();
  });

  it('campo preenchido com formato inválido guarda o erro dele, sem ganhar `required`', () => {
    const group = new FormGroup(
      {
        a: new FormControl('', { nonNullable: true }),
        uf: new FormControl('', {
          nonNullable: true,
          validators: [Validators.pattern(/^[A-Za-z]{2}$/)],
        }),
      },
      { validators: allOrNothingBlock() },
    );

    group.controls.uf.setValue('S');

    expect(group.controls.uf.errors).toMatchObject({ pattern: expect.anything() });
    expect(group.controls.uf.errors?.['required']).toBeUndefined();
    // O irmão vazio é que fica obrigatório.
    expect(group.controls.a.errors).toEqual({ required: true });
  });

  it('campo desabilitado não ganha `required` nem trava o bloco', () => {
    const group = build();

    group.controls.b.disable();
    group.controls.a.setValue('valor');

    // `b` não pode ser preenchido, então cobrá-lo seria um bloqueio permanente e
    // invisível (o `app-form-field` não mostra mensagem de controle desabilitado).
    expect(group.controls.b.errors).toBeNull();
    expect(group.errors).toBeNull();
    expect(group.valid).toBe(true);
  });

  it('campo desabilitado preenchido não começa o bloco sozinho', () => {
    const group = build();

    group.controls.b.setValue('valor');
    group.controls.b.disable();

    // Só sobrou `a` vazio e `livre` isento: sem participante habilitado preenchido,
    // o bloco continua "em branco" e ninguém vira obrigatório.
    expect(group.controls.a.errors).toBeNull();
    expect(group.errors).toBeNull();
  });

  it('soma e remove só a própria chave — o erro do servidor sobrevive', () => {
    const group = build();
    const serverError = { message: 'Valor recusado pelo servidor.' };

    group.controls.a.setErrors({ serverError });
    // Preencher `b` começa o bloco e torna `a` obrigatório por cima do erro do servidor.
    group.controls.b.setValue('valor');
    expect(group.controls.a.errors).toEqual({ serverError, required: true });

    // Esvaziar o bloco tira só o `required`.
    group.controls.b.setValue('');
    expect(group.controls.a.errors).toEqual({ serverError });
  });
});
