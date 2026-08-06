/**
 * Bloco de contato da LOCADORA (backend V52) — telefone, e-mail, endereço da sede
 * e o representante que assina o contrato.
 *
 * Alimenta as variáveis `{{companyPhone}}`, `{{companyEmail}}`, `{{companyAddress}}`,
 * `{{companyCep}}`, `{{companyRepresentative}}` e `{{companyRepresentativeRole}}` do
 * template de contrato. Campo vazio aqui vira literal vazio no contrato gerado.
 */

/**
 * Como o bloco CHEGA em `GET /v1/companies/{id}`.
 *
 * O backend devolve o objeto sempre — empresa que nunca preencheu recebe o bloco
 * com os onze campos nulos, e não `contact: null`. Ainda assim o serviço trata o
 * ausente/nulo defensivamente, porque o frontend pode subir antes do backend numa
 * janela de deploy.
 */
export interface CompanyContact {
  phone: string | null;
  email: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressDistrict: string | null;
  addressCep: string | null;
  addressCity: string | null;
  /** Exatamente duas letras, maiúsculas. */
  addressUf: string | null;
  representativeName: string | null;
  representativeRole: string | null;
}

/**
 * Como o bloco SAI em `PUT /v1/companies/me`.
 *
 * **A escrita é tudo-ou-nada e é a armadilha central deste bloco.** No backend,
 * `contact` ausente ou nulo significa "não mexa em nada"; `contact` PRESENTE
 * substitui as onze colunas de uma vez, e campo em branco é gravado como `NULL`.
 * Ou seja: mandar meio bloco APAGA a outra metade no banco.
 *
 * O `-?` e o `string` (não `string | null`) existem para que o compilador recuse
 * um payload parcial: toda chave é obrigatória e o "vazio" tem que ser dito com
 * `''` de propósito, nunca por omissão. Quem mexer aqui depois não vai adivinhar
 * essa regra — o tipo a impõe.
 */
export type CompanyContactPayload = { [K in keyof CompanyContact]-?: string };

/** Bloco totalmente vazio — o que uma empresa que nunca preencheu devolve. */
export const EMPTY_COMPANY_CONTACT: CompanyContact = {
  phone: null,
  email: null,
  addressStreet: null,
  addressNumber: null,
  addressComplement: null,
  addressDistrict: null,
  addressCep: null,
  addressCity: null,
  addressUf: null,
  representativeName: null,
  representativeRole: null,
};

/**
 * O recorte de `GET /v1/companies/{id}` que esta tela lê.
 *
 * Só `name` e `contact`: o `name` não é enfeite, é obrigatório no `PUT` (`@NotBlank`),
 * então salvar contato exige devolvê-lo junto — ver `CompanyContactService.save`.
 */
export interface CompanyContactSnapshot {
  name: string;
  contact: CompanyContact;
}
