import { PLAN_CAPACITY, PlanTier, planCapacityLines } from './plan-limits';
import { PLAN_TIER_ORDER, hasPrioritySupport } from './plan-features';

/**
 * Texto da grade de planos — a MESMA na Assinatura (app) e na landing, para as
 * duas telas nunca prometerem coisas diferentes. Capacidade sai de
 * `PLAN_CAPACITY`/`planCapacityLines` e o atendimento prioritário de
 * `hasPrioritySupport`; nenhuma promessa por tier é digitada aqui.
 */

/** Linhas iguais em todos os planos (resumo de `PLAN_FEATURES`). */
export const SHARED_ROWS = ['Contratos e cobranças', 'Assinatura eletrônica', 'Vistoria em 14 ângulos'];

/** Nome e frase de cada coluna da grade (owner, 2026-10-29). */
export const PLAN_COPY: Readonly<Record<PlanTier, { name: string; pitch: string }>> = {
  TRIAL: { name: 'Teste', pitch: 'Para conhecer com os primeiros carros.' },
  STARTER: { name: 'Starter', pitch: 'Para sair da planilha de vez.' },
  PRO: { name: 'Pro', pitch: 'Para a frota que está crescendo.' },
  SCALE: { name: 'Scale', pitch: 'Para operações com frota grande.' },
  ENTERPRISE: {
    name: 'Enterprise',
    pitch: `Para frotas acima de ${PLAN_CAPACITY.SCALE.vehicles} carros.`,
  },
};

/**
 * As seis linhas de uma coluna. Iguais em todos os planos para alinhar a grade;
 * capacidade sai de `PLAN_CAPACITY`/`planCapacityLines` e o atendimento
 * prioritário de `hasPrioritySupport` — nenhuma promessa por tier é digitada
 * aqui (ver `billing-claims.spec.ts`).
 */
function planRowLabels(tier: PlanTier): string[] {
  return [
    planCapacityLines(tier)[0],
    tier === 'TRIAL' ? 'Teste de 14 dias' : 'Sem prazo de uso',
    ...SHARED_ROWS,
    hasPrioritySupport(tier) ? 'Suporte prioritário' : 'Suporte no WhatsApp',
  ];
}

/** Linhas da coluna; em destaque as que mudam em relação ao plano anterior. */
export function planRows(tier: PlanTier): { label: string; hi: boolean }[] {
  const idx = PLAN_TIER_ORDER.indexOf(tier);
  const prev = idx > 0 ? planRowLabels(PLAN_TIER_ORDER[idx - 1]) : null;
  return planRowLabels(tier).map((label, i) => ({ label, hi: prev !== null && prev[i] !== label }));
}
