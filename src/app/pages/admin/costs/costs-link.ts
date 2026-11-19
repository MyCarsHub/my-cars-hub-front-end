import type { Params } from '@angular/router';

/** Rota da página de Custos (Dinheiro › Custos). */
export const COSTS_ROUTE = '/admin/custos';
/** `?aba=fixos|mes|fornecedores`: a aba que abre. */
export const COSTS_TAB_PARAM = 'aba';
/** `?acao=fixo|avulso|fornecedor`: a folha que abre (só para quem tem `custo.gerir`). */
export const COSTS_ACTION_PARAM = 'acao';
/** `?categoria=ACQUISITION`: a folha abre no fornecedor dessa categoria (ou no cadastro dele). */
export const COSTS_CATEGORY_PARAM = 'categoria';

export type CostsTab = 'fixos' | 'mes' | 'fornecedores';

/**
 * Os atalhos do Painel para a página de Custos. `cost`: o mês sem custo (abre "Novo custo fixo",
 * que lança o mês corrente na hora); `acquisition`: o CAC sem gasto de aquisição (abre "Lançar
 * custo avulso" no fornecedor de aquisição).
 */
export type CostsShortcut = 'cost' | 'acquisition';

export function costsShortcutParams(shortcut: CostsShortcut): Params {
  return shortcut === 'acquisition'
    ? { [COSTS_ACTION_PARAM]: 'avulso', [COSTS_CATEGORY_PARAM]: 'ACQUISITION' }
    : { [COSTS_ACTION_PARAM]: 'fixo' };
}
