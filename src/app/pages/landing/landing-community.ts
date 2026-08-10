/**
 * Canais públicos do "construindo em público" — usados pela seção de prova social
 * (`landing-testimonials`) e pela faixa `landing-building-public`.
 *
 * CONTRATO: **string vazia = canal omitido em silêncio**. O CTA some, o resto da
 * seção continua, e NADA aparece no lugar dele — nem aviso, nem `href` vazio. A
 * landing é pública; um marcador do tipo "link pendente" é texto de rascunho na
 * cara do visitante, e foi exatamente isso que estas constantes já renderizaram.
 *
 * O convite da **Comunidade dos Locadores no WhatsApp** abaixo foi fornecido pelo dono
 * do produto e NÃO foi inventado aqui. Esvaziar a string desliga os dois CTAs sozinhos,
 * sem tocar em template — por isso o tipo é `string` e não o literal, senão o teste que
 * cobre o caso vazio para de compilar.
 */
export const COMMUNITY_WHATSAPP_URL: string = 'https://chat.whatsapp.com/EoKcu2xoLYg0aVBoA7qTh1';

/**
 * Handle informado pelo dono do produto. A existência da conta não foi verificada —
 * se o perfil ainda não estiver publicado, esvazie `INSTAGRAM_URL` e o botão do
 * Instagram desaparece pela mesma regra, também sem deixar aviso na tela.
 */
export const INSTAGRAM_HANDLE = '@mycarshub';
export const INSTAGRAM_URL = 'https://www.instagram.com/mycarshub/';
