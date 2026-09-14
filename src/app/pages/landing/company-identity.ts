import { InjectionToken } from '@angular/core';

/**
 * Identidade legal da empresa, publicada no rodapé de todas as páginas públicas.
 *
 * <h4>Por que existe (FIX-0294)</h4>
 * Nenhuma página pública dizia QUEM está por trás do produto: sem razão social,
 * sem CNPJ e sem endereço. Isso custa confiança na hora de assinar — o
 * benchmark aponta a Conta Azul como o modelo a copiar — e é o que a LGPD
 * espera de quem trata dado pessoal: o titular precisa saber a identidade do
 * controlador para exercer qualquer direito.
 *
 * <h4>Por que é um token, e por que o padrão é `null`</h4>
 * Os valores reais NÃO estão neste repositório e não podem ser inventados: um
 * número de registro de empresa inventado é documento falso publicado, não um
 * placeholder. Enquanto o token for `null` o rodapé não renderiza o bloco —
 * exatamente o que ele faz hoje — e nada de mentira vai ao ar.
 *
 * Ligar é uma edição só, aqui, e vale para as SEIS páginas que montam este
 * rodapé (landing, blog, post, termos, privacidade e 404).
 *
 * Token com `factory` em vez de constante exportada pelo mesmo motivo de
 * `VEHICLE_LOOKUPS`: a tela fica testável nos dois estados sem reescrever
 * módulo nenhum.
 */
export interface CompanyIdentity {
  /** Razão social, como consta no registro. */
  readonly legalName: string;
  /** CNPJ já formatado (`00.000.000/0000-00`). */
  readonly cnpj: string;
  /** Endereço em uma linha, como aparece no rodapé. */
  readonly address: string;
}

export const COMPANY_IDENTITY = new InjectionToken<CompanyIdentity | null>('COMPANY_IDENTITY', {
  factory: () => null,
});
