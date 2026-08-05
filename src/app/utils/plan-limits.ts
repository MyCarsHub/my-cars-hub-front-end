/**
 * Capacidade dos planos e a ÚNICA decisão de "este plano se apresenta como
 * ilimitado?".
 *
 * <h4>Por que existe</h4>
 * Landing (lista fixa), billing (tabela comparativa vinda da API) e dashboard
 * (cards de KPI) decidiam isso cada uma do seu jeito. Toda vez que um limite
 * mudou no backend, pelo menos uma das três ficou mentindo. Aqui a regra é
 * escrita uma vez e as três consomem.
 *
 * <h4>Fonte de verdade</h4>
 * A tabela `plans` do backend (migration `V44__plans_real_limits_all_plans.sql`).
 * `PLAN_CAPACITY` é uma CÓPIA desses números, necessária só porque a landing é
 * pública e `GET /v1/billing/plans` exige autenticação — billing e dashboard
 * recebem os limites reais da API e não devem ler daqui. Se a `plans` mudar,
 * atualize `PLAN_CAPACITY` junto (o spec da landing quebra para lembrar).
 *
 * <h4>Maquiagem do ENTERPRISE</h4>
 * O backend guarda e APLICA 500 veículos / 1000 motoristas no ENTERPRISE; a
 * apresentação como "ilimitado" é decisão de produto, deliberada, e vale só na
 * UI. Nenhuma guarda de limite consulta este arquivo.
 */

/** Planos do catálogo, pelo `name` da tabela `plans`. */
export type PlanTier = 'TRIAL' | 'PRO' | 'ENTERPRISE';

export interface PlanCapacity {
  vehicles: number;
  drivers: number;
}

/** Tetos reais aplicados pelo backend após a V44. */
export const PLAN_CAPACITY: Readonly<Record<PlanTier, PlanCapacity>> = {
  TRIAL: { vehicles: 3, drivers: 4 },
  PRO: { vehicles: 20, drivers: 40 },
  ENTERPRISE: { vehicles: 500, drivers: 1000 },
};

/**
 * Planos cujo teto real NÃO é exibido — a UI diz "ilimitado" no lugar do
 * número. Hoje só o ENTERPRISE; incluir um plano aqui é decisão de produto.
 */
const UNLIMITED_FACADE_PLANS: readonly string[] = ['ENTERPRISE'];

/**
 * A maquiagem, isolada: `true` quando o plano se apresenta como ilimitado
 * independentemente do número que a API devolver.
 *
 * Recebe o `name` do plano (`plans.name` / `AccessStatusPlan.name`), não o
 * `code` — o code varia por período e gateway (`PRO_MONTHLY_STRIPE`…), o name
 * é a política de produto.
 */
export function planPresentsAsUnlimited(planName: string | null | undefined): boolean {
  if (!planName) return false;
  return UNLIMITED_FACADE_PLANS.includes(planName.trim().toUpperCase());
}

/**
 * Predicado único consumido pelas telas: este limite deve ser exibido como
 * "ilimitado"?
 *
 * Dois motivos, ambos preservados de propósito:
 * <ul>
 *   <li>limite nulo — sentinela documentado da coluna (`plans.vehicle_limit` /
 *       `plans.driver_limit` nulas = sem teto). Depois da V44 nenhum plano em
 *       produção usa o sentinela, mas a semântica segue válida e um plano
 *       futuro pode voltar a usá-la;</li>
 *   <li>plano com maquiagem — o ENTERPRISE, que tem teto real e mesmo assim se
 *       apresenta como ilimitado.</li>
 * </ul>
 */
export function showsAsUnlimited(
  planName: string | null | undefined,
  limit: number | null | undefined,
): boolean {
  return limit === null || limit === undefined || planPresentsAsUnlimited(planName);
}

/** Eixo de capacidade de um plano. */
export type CapacityAxis = 'vehicles' | 'drivers';

const AXIS_PLURAL: Readonly<Record<CapacityAxis, string>> = {
  vehicles: 'veículos',
  drivers: 'motoristas',
};

const AXIS_UNLIMITED_LINE: Readonly<Record<CapacityAxis, string>> = {
  vehicles: 'Veículos ilimitados',
  drivers: 'Motoristas ilimitados',
};

/**
 * Bullet de capacidade para listas escritas sem API (landing). Respeita a
 * maquiagem: se o plano se apresenta como ilimitado, o número nunca aparece.
 */
export function planCapacityLine(tier: PlanTier, axis: CapacityAxis): string {
  if (planPresentsAsUnlimited(tier)) return AXIS_UNLIMITED_LINE[axis];
  return `Até ${PLAN_CAPACITY[tier][axis]} ${AXIS_PLURAL[axis]}`;
}
