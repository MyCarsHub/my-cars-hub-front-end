import { HttpErrorResponse } from '@angular/common/http';

/** Código estável do `ApiError {message, code?}` do backend, ou `null`. */
export function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse)) return null;
  const body = err.error as { code?: unknown } | null;
  return body && typeof body.code === 'string' ? body.code : null;
}

/** O nome do provedor nunca aparece para a locadora (regra do dono). */
const PROVIDER_NAME = /asaas/i;

/** Texto do servidor só passa se não citar o provedor; senão, o `fallback`. */
export function companySafe(serverMessage: string | null | undefined, fallback: string): string {
  const text = (serverMessage ?? '').trim();
  return text && !PROVIDER_NAME.test(text) ? text : fallback;
}

/**
 * Recusas do plano e das parcelas (contrato B2/B3/B4), na língua da locadora. O texto B2 do
 * mínimo cita o provedor ("limite do Asaas"); aqui ele vira "valor mínimo por parcela".
 */
export const PLAN_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  CHARGE_PLAN_SPLIT_COUNT: 'Escolha de 2 a 12 parcelas.',
  CHARGE_PLAN_INTERVAL: 'O intervalo entre as parcelas deve ser de 1 a 31 dias.',
  CHARGE_PLAN_DISCOUNT_PERIODS: 'O desconto vale para mais cobranças do que o aluguel tem. Diminua o número.',
  CHARGE_PLAN_DISCOUNT_TOO_LARGE: 'Com esse desconto a cobrança ficaria abaixo de R$ 5,00.',
  CHARGE_BELOW_MINIMUM: 'Cada parcela precisa ser de pelo menos R$ 5,00 (valor mínimo por parcela).',
  CHARGE_DUE_DATE_PAST: 'As datas das parcelas precisam ser de hoje em diante.',
  INSTALMENT_DATES_ORDER: 'As datas das parcelas precisam estar em ordem.',
  INSTALMENTS_SUM_MISMATCH: 'As parcelas não somam o valor da cobrança. Confira os valores.',
  CHARGE_PLAN_OVERRIDE_TARGET: 'Um dos períodos parcelados não existe mais neste aluguel. Parcele de novo.',
  CHARGE_PLAN_PAST_PERIOD: 'Período já vencido não pode ser parcelado.',
  CHARGE_PLAN_FINE_EXCEEDS_INSTALMENT: 'A multa fixa dividida precisa ser menor que cada parcela.',
};

/** Recorta a parte específica ("A parcela 3 ficou com R$ 4,99.") quando o servidor manda. */
const DETAIL_PATTERNS: Readonly<Record<string, RegExp>> = {
  CHARGE_BELOW_MINIMUM: /A parcela \d+ ficou com R\$\s?[\d.,]+\.?/,
  INSTALMENTS_SUM_MISMATCH: /As parcelas somam R\$\s?[\d.,]+, mas o valor da cobrança é R\$\s?[\d.,]+\.?/,
  CHARGE_PLAN_FINE_EXCEEDS_INSTALMENT: /A multa fixa dividida \(R\$\s?[\d.,]+\) precisa ser menor que a parcela \(R\$\s?[\d.,]+\)\.?/,
};

/** Mensagem de um `blocker {code, message}` da prévia, já segura para a locadora. */
export function planBlockerMessage(blocker: { code?: string | null; message?: string | null }): string {
  const code = blocker.code ?? '';
  const own = PLAN_ERROR_MESSAGES[code];
  if (!own) return companySafe(blocker.message, 'Não é possível usar este plano. Confira os valores e as datas.');
  const detail = DETAIL_PATTERNS[code]?.exec(blocker.message ?? '')?.[0];
  if (!detail) return own;
  return code === 'CHARGE_BELOW_MINIMUM' ? `${own} ${detail.endsWith('.') ? detail : detail + '.'}` : detail.endsWith('.') ? detail : `${detail}.`;
}

/**
 * Texto da recusa para a LOCADORA. Código conhecido usa a nossa frase (sem nome de
 * provedor nem jargão); desconhecido cai no texto do servidor — só se ele não citar o
 * provedor — e por fim no `fallback`.
 */
export function flexErrorMessage(
  err: unknown,
  byCode: Readonly<Record<string, string>>,
  serverMessage: string,
  fallback = 'Não foi possível concluir. Tente de novo.',
): string {
  const code = apiErrorCode(err);
  if (code && byCode[code]) return byCode[code];
  if (code && PLAN_ERROR_MESSAGES[code]) {
    const body = (err as HttpErrorResponse).error as { message?: string } | null;
    return planBlockerMessage({ code, message: body?.message ?? null });
  }
  return companySafe(serverMessage, fallback);
}
