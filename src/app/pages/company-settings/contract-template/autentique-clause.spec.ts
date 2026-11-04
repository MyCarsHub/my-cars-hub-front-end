import { describe, expect, it } from 'vitest';
import { AUTENTIQUE_CLAUSE_TEXT, mentionsESignature } from './autentique-clause';

describe('mentionsESignature', () => {
  it('reconhece Autentique, assinatura eletrônica e assinatura digital, sem caixa nem acento', () => {
    expect(mentionsESignature(['As partes assinam pelo AUTENTIQUE.'])).toBe(true);
    expect(mentionsESignature(['DA ASSINATURA ELETRÔNICA'])).toBe(true);
    expect(mentionsESignature(['Valerá a assinatura eletronica das partes'])).toBe(true);
    expect(mentionsESignature(['cláusula', 'da Assinatura Digital'])).toBe(true);
  });

  it('contrato sem nenhuma das expressões não conta como menção', () => {
    expect(mentionsESignature(['CLÁUSULA 1ª. O locador cede o veículo.', 'Foro de São Paulo.'])).toBe(false);
    expect(mentionsESignature([])).toBe(false);
  });

  it('a cláusula sugerida cita a MP 2.200-2/2001 e a Lei 14.063/2020 e conta como menção', () => {
    expect(AUTENTIQUE_CLAUSE_TEXT).toContain('Medida Provisória nº 2.200-2/2001');
    expect(AUTENTIQUE_CLAUSE_TEXT).toContain('Lei nº 14.063/2020');
    expect(mentionsESignature([AUTENTIQUE_CLAUSE_TEXT])).toBe(true);
  });
});
