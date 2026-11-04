/**
 * Texto SUGERIDO de cláusula de assinatura digital (Autentique). Um único lugar para o dono
 * editar. Redação não revisada juridicamente: a tela avisa para o advogado dele revisar
 * antes de usar.
 */
export const AUTENTIQUE_CLAUSE_TEXT =
  'DA ASSINATURA DIGITAL. Ao assinar este contrato por meio da plataforma Autentique, as partes afirmam e confirmam a autenticidade de suas assinaturas digitais por esse meio e reconhecem a validade jurídica do documento assinado eletronicamente, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001 e da Lei nº 14.063/2020.';

export const AUTENTIQUE_NOTICE_TITLE = 'Este contrato não menciona a assinatura eletrônica.';

export const AUTENTIQUE_NOTICE_NOTE =
  'Sugestão de texto. Peça para o seu advogado revisar antes de usar.';

/** Expressões que mostram que o contrato já fala da assinatura eletrônica. */
const E_SIGNATURE_MARKERS = ['autentique', 'assinatura eletr', 'assinatura digital'];

function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** `true` quando algum trecho cita Autentique, assinatura eletrônica ou digital (sem acento, sem caixa). */
export function mentionsESignature(texts: readonly string[]): boolean {
  const all = plain(texts.join(' '));
  return E_SIGNATURE_MARKERS.some((m) => all.includes(m));
}
