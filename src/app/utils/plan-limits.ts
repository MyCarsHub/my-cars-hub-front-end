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
 * A tabela `plans` do backend (migration `V59__plans_starter_pro_restructure.sql`,
 * que sucede a V44). `PLAN_CAPACITY` é uma CÓPIA desses números, necessária só
 * porque a landing é pública e `GET /v1/billing/plans` exige autenticação —
 * billing e dashboard recebem os limites reais da API e não devem ler daqui. Se
 * a `plans` mudar, atualize `PLAN_CAPACITY` junto (o spec da landing quebra
 * para lembrar).
 *
 * <h4>Maquiagem do ENTERPRISE</h4>
 * O backend guarda e APLICA 100 veículos / 300 motoristas no ENTERPRISE (V59;
 * eram 500/1000 na V44); a apresentação como "ilimitado" é decisão de produto,
 * deliberada, e vale só na UI. Nenhuma guarda de limite consulta este arquivo.
 */

/** Planos do catálogo, pelo `name` da tabela `plans` (V59:7-15). */
export type PlanTier = 'TRIAL' | 'STARTER' | 'PRO' | 'ENTERPRISE';

export interface PlanCapacity {
  vehicles: number;
  drivers: number;
}

/**
 * Tetos reais aplicados pelo backend após a V59. Cada par vem dos UPDATEs de
 * limite da própria migration, não da tabela do cabeçalho dela:
 * TRIAL V59:325-328 · STARTER V59:330-333 · PRO V59:335-338 ·
 * ENTERPRISE V59:340-343 (conferem com o estado-alvo em V59:9-15).
 */
export const PLAN_CAPACITY: Readonly<Record<PlanTier, PlanCapacity>> = {
  TRIAL: { vehicles: 3, drivers: 4 },
  STARTER: { vehicles: 15, drivers: 45 },
  PRO: { vehicles: 25, drivers: 75 },
  ENTERPRISE: { vehicles: 100, drivers: 300 },
};

/**
 * Planos cujo teto real NÃO é exibido — a UI diz "ilimitado" no lugar do
 * número. Hoje só o ENTERPRISE; incluir um plano aqui é decisão de produto.
 */
const UNLIMITED_FACADE_PLANS: readonly string[] = ['ENTERPRISE'];

/**
 * Forma canônica do `name` vindo da API, antes de qualquer comparação.
 *
 * EXPORTADA de propósito. A normalização não é exclusividade da maquiagem: o
 * tier de um plano é decidido em `utils/plan-features.ts` (`planTierOf`) e a
 * partir dele saem o tom do card, a fita, a descrição e o hero do billing. Se
 * cada ponto normalizasse por conta própria, dois deles acabariam discordando
 * sobre o que é `" enterprise "` — e a divergência apareceria como um card
 * pintado errado, não como erro.
 */
export function normalizePlanName(planName: string | null | undefined): string {
  return (planName ?? '').trim().toUpperCase();
}

/**
 * A maquiagem, isolada: `true` quando o plano se apresenta como ilimitado
 * independentemente do número que a API devolver.
 *
 * Recebe o `name` do plano (`plans.name` / `AccessStatusPlan.name`), não o
 * `code` — o code varia por período e gateway (`PRO_MONTHLY_STRIPE`…), o name
 * é a política de produto.
 */
export function planPresentsAsUnlimited(planName: string | null | undefined): boolean {
  const name = normalizePlanName(planName);
  if (!name) return false;
  return UNLIMITED_FACADE_PLANS.includes(name);
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
