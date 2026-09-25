import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { inviteAcceptCause, inviteErrorCopy } from './invite-errors';

/**
 * FIX-0555 — o 403 do aceite tem DUAS causas e a tela afirmava sempre a mesma.
 *
 * O caso que doeu em producao: quem nao tem cadastro de motorista lia "este convite foi
 * enviado para outro e-mail", trocava de conta, e falhava igual — com o e-mail CERTO. A
 * frase tambem virou a hipotese de quem foi investigar, que saiu atras da conta errada.
 */
describe('invite-errors — as duas causas do 403 no aceite (FIX-0555)', () => {
  function err(status: number, body: unknown = { message: 'falhou' }): HttpErrorResponse {
    return new HttpErrorResponse({ status, error: body });
  }

  it('DRIVER_IDENTITY_NOT_RESOLVED nomeia a causa real e aponta o GESTOR', () => {
    const copy = inviteErrorCopy(err(403, { code: 'DRIVER_IDENTITY_NOT_RESOLVED' }), 'accept');

    expect(copy).toContain('cadastro de motorista');
    expect(copy).toContain('gestor');
    // O ponto do defeito: NAO pode continuar acusando o e-mail do usuario.
    expect(copy).not.toContain('outro e-mail');
  });

  it('INVITE_EMAIL_MISMATCH mantem a copy de hoje, que para ESTE caso esta certa', () => {
    const copy = inviteErrorCopy(err(403, { code: 'INVITE_EMAIL_MISMATCH' }), 'accept');

    expect(copy).toContain('outro e-mail');
    expect(copy).not.toContain('cadastro de motorista');
  });

  /**
   * O STATUS REAL da divergencia e 400, nao 403: o backend lanca InvalidDataException e o
   * handler devolve BAD REQUEST. Classificar pelo status deixava este caso caindo em "este
   * convite nao e mais valido, peca um novo" - uma instrucao que nao conserta nada, porque o
   * convite esta valido e o problema e a conta. Por isso a leitura e pelo CODIGO.
   */
  it('INVITE_EMAIL_MISMATCH e reconhecido no 400, que e o status REAL dele', () => {
    const copy = inviteErrorCopy(err(400, { code: 'INVITE_EMAIL_MISMATCH' }), 'accept');

    expect(copy).toContain('outro e-mail');
    expect(copy).not.toContain('não é mais válido');
    expect(inviteAcceptCause(err(400, { code: 'INVITE_EMAIL_MISMATCH' }))).toBe('email-mismatch');
  });

  it('o codigo vale INDEPENDENTE do status - nao so nos dois que o backend usa hoje', () => {
    expect(inviteAcceptCause(err(409, { code: 'DRIVER_IDENTITY_NOT_RESOLVED' }))).toBe(
      'driver-identity-missing',
    );
    expect(inviteAcceptCause(err(500, { code: 'INVITE_EMAIL_MISMATCH' }))).toBe('email-mismatch');
  });

  /**
   * O MESMO 400 mudo ainda e lancado por token em branco e por convite nao-PENDING. So a
   * divergencia ganhou codigo. Sem codigo, o 400 NAO pode virar "outro e-mail": seria trocar
   * uma afirmacao errada por outra, que e o defeito deste no repetido uma camada acima.
   */
  it('400 MUDO nao vira divergencia de e-mail - segue com a copy generica', () => {
    const copy = inviteErrorCopy(err(400), 'accept');

    expect(copy).toContain('não é mais válido');
    expect(copy).not.toContain('outro e-mail');
    expect(inviteAcceptCause(err(400))).toBeNull();
  });

  /**
   * FEAT-0167 — a TERCEIRA causa, e a unica cuja acao e corrigir um campo em vez de sair
   * da tela. Precisa ser distinguivel das outras duas, senao quem errou um digito de CPF
   * recebe "troque de conta" e recomeca o fluxo inteiro a toa.
   */
  it('INVITE_CPF_MISMATCH aponta o CPF, e nao a conta nem o gestor', () => {
    const copy = inviteErrorCopy(err(400, { code: 'INVITE_CPF_MISMATCH' }), 'accept');

    expect(copy).toContain('CPF');
    expect(copy).not.toContain('Saia da conta');
    expect(copy).not.toContain('cadastro de motorista');
    expect(inviteAcceptCause(err(400, { code: 'INVITE_CPF_MISMATCH' }))).toBe('cpf-mismatch');
  });

  it('as TRES causas produzem mensagens diferentes entre si', () => {
    const driver = inviteErrorCopy(err(403, { code: 'DRIVER_IDENTITY_NOT_RESOLVED' }), 'accept');
    const mismatch = inviteErrorCopy(err(400, { code: 'INVITE_EMAIL_MISMATCH' }), 'accept');
    const cpf = inviteErrorCopy(err(400, { code: 'INVITE_CPF_MISMATCH' }), 'accept');

    expect(new Set([driver, mismatch, cpf]).size).toBe(3);
  });

  it('as duas causas produzem mensagens DIFERENTES', () => {
    const driver = inviteErrorCopy(err(403, { code: 'DRIVER_IDENTITY_NOT_RESOLVED' }), 'accept');
    const mismatch = inviteErrorCopy(err(403, { code: 'INVITE_EMAIL_MISMATCH' }), 'accept');

    expect(driver).not.toBe(mismatch);
  });

  /**
   * O backend ainda pode nao emitir `code`. A tela NAO pode quebrar por um campo ausente:
   * sem ele, tudo segue exatamente como hoje, e o caso novo so se ativa quando o servidor
   * de fato o afirma.
   */
  it('SEM `code` o comportamento de hoje e preservado', () => {
    expect(inviteErrorCopy(err(403), 'accept')).toContain('outro e-mail');
    expect(inviteErrorCopy(err(403, null), 'accept')).toContain('outro e-mail');
    expect(inviteErrorCopy(err(403, 'texto solto'), 'accept')).toContain('outro e-mail');
    expect(inviteAcceptCause(err(403))).toBe('email-mismatch');
  });

  it('um `code` DESCONHECIDO tambem cai no comportamento de hoje', () => {
    expect(inviteErrorCopy(err(403, { code: 'ALGO_QUE_NAO_EXISTE' }), 'accept')).toContain(
      'outro e-mail',
    );
  });

  it('o code e lido sem depender de caixa ou espaco em volta', () => {
    const copy = inviteErrorCopy(err(403, { code: '  driver_identity_not_resolved  ' }), 'accept');

    expect(copy).toContain('cadastro de motorista');
  });

  it('sem codigo, so o 403 significa divergencia - os demais status nao ganham causa', () => {
    expect(inviteAcceptCause(err(403, { code: 'DRIVER_IDENTITY_NOT_RESOLVED' }))).toBe(
      'driver-identity-missing',
    );
    expect(inviteAcceptCause(err(403))).toBe('email-mismatch');
    expect(inviteAcceptCause(err(410))).toBeNull();
    expect(inviteAcceptCause(err(409))).toBeNull();
    expect(inviteAcceptCause(new Error('nao e HttpErrorResponse'))).toBeNull();
  });

  /** O 403 de GERENCIAR convites e outro assunto e nao pode pegar a copy do motorista. */
  it('o contexto `manage` nao e afetado', () => {
    const copy = inviteErrorCopy(err(403, { code: 'DRIVER_IDENTITY_NOT_RESOLVED' }), 'manage');

    expect(copy).toContain('permissão para gerenciar convites');
  });

  it('os demais status do aceite seguem intactos', () => {
    expect(inviteErrorCopy(err(410), 'accept')).toContain('expirou');
    expect(inviteErrorCopy(err(409), 'accept')).toContain('já foi utilizado');
    expect(inviteErrorCopy(err(418), 'accept')).toBeNull();
  });
});
