/**
 * Single source of truth for the prices the landing ADVERTISES.
 *
 * Extracted from `landing-pricing.component.ts` so the JSON-LD `Product`/`Offer` blocks
 * cannot drift from the cards the visitor actually reads — a price that disagrees with
 * the page is a Google structured-data violation, not just a cosmetic bug.
 *
 * These are NOT derived from the API on purpose: `GET /v1/billing/plans` requires
 * authentication and the landing is public (see the note in `landing-pricing.component.ts`).
 *
 * <h4>Fonte de verdade</h4>
 * A tabela `plans` (migration `V59__plans_starter_pro_restructure.sql`). Cada
 * valor abaixo cita as linhas da V59 de onde saiu — o INSERT que semeia a
 * linha, o UPDATE que a faz convergir e a linha correspondente da tabela de
 * preço esperado no bloco de guarda (V59:487-513, tabela em V59:494-500), que
 * derruba o BOOT do backend se o banco divergir.
 *
 * <h4>Anual é um PREÇO, não um desconto</h4>
 * Os totais anuais são valores TABELADOS, não `mensal × 12 × fator`. A V59 fixa
 * ENTERPRISE anual em 2990,00 enquanto `299 × 12 × 0,85` daria 3049,80 — foi
 * exatamente essa fórmula que fazia a landing anunciar um total que a `plans`
 * não pratica. Nenhum total anual daqui pode voltar a ser calculado.
 */
export const PLAN_PRICES = {
  /** Free trial, no card. Só o TRIAL concede dias (V59:348-349; pagos zerados em V59:351-352). */
  trialDays: 14,
  /** TRIAL: 0,00 (V59:168-169, UPDATE V59:303-310, guarda V59:494). */
  trialMonthly: 0,
  /** STARTER mensal: 79,90 (V59:171-172, UPDATE V59:240-247, guarda V59:495). */
  starterMonthly: 79.9,
  /** STARTER anual TOTAL: 799,00 (V59:173-174, UPDATE V59:249-256, guarda V59:496). */
  starterYearlyTotal: 799,
  /** PRO mensal: 149,90 — era 79,90 antes da V59 (V59:176-177, UPDATE V59:260-267, guarda V59:497). */
  proMonthly: 149.9,
  /** PRO anual TOTAL: 1499,00 — era 795,80 antes da V59 (V59:178-179, UPDATE V59:270-277, guarda V59:498). */
  proYearlyTotal: 1499,
  /** ENTERPRISE mensal: 299,00, inalterado pela V59 (V59:181-182, UPDATE V59:291-298, guarda V59:499). */
  enterpriseMonthly: 299,
  /** ENTERPRISE anual TOTAL: 2990,00 — era 3049,80 antes da V59 (V59:183-184, UPDATE V59:280-287, guarda V59:500). */
  enterpriseYearlyTotal: 2990,
} as const;

/**
 * ENTERPRISE yearly total, TABELADO pela V59:183-184.
 *
 * Era `enterpriseMonthly * 12 * 0.85` (= 3049,80). O fator de 15% nunca esteve
 * na `plans`: era uma reconstrução da landing que por acaso batia com o valor
 * de então e deixou de bater na V59. Mantido como named export só porque
 * `landing-structured-data.ts` e `landing-pricing.component.ts` já o importam.
 */
export const ENTERPRISE_YEARLY_TOTAL = PLAN_PRICES.enterpriseYearlyTotal;
