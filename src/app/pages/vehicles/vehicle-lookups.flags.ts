import { InjectionToken } from '@angular/core';

export interface VehicleLookupsFlags {
  /** Listas encadeadas marca → modelo → ano da FIPE no formulário (FEAT-0084). */
  fipeCatalog: boolean;
  /** Botão "Buscar dados pela placa" no formulário (FEAT-0082). */
  plateLookup: boolean;
}

/**
 * Chaves das integrações do formulário de veículo. Ligar de volta é trocar
 * `false` por `true` aqui — nada mais.
 *
 * DESLIGADAS por ordem do dono (2026-09-12, após teste em produção):
 *
 * - `fipeCatalog: false` — o provedor gratuito da FIPE limita 500 req/dia POR
 *   IP e o backend chama de um IP único e COMPARTILHADO da Render: em prod o
 *   catálogo esgota/falha, o form abre em manual e o toggle virava controle
 *   morto. Só religar quando o backend tiver cache do catálogo no NOSSO banco
 *   (não depender da cota por requisição).
 * - `plateLookup: false` — sem provedor de placa contratado; o endpoint
 *   responde 501 em produção.
 *
 * O código das duas features continua vivo e testado (specs com a chave
 * ligada via provider); com a chave desligada o formulário é o de antes das
 * integrações: marca/modelo/anos digitados à mão.
 */
export const VEHICLE_LOOKUPS_DEFAULT: VehicleLookupsFlags = {
  fipeCatalog: false,
  plateLookup: false,
};

export const VEHICLE_LOOKUPS = new InjectionToken<VehicleLookupsFlags>('VEHICLE_LOOKUPS', {
  factory: () => VEHICLE_LOOKUPS_DEFAULT,
});
