/**
 * Nome do gateway como nome próprio ("Stripe", "Mercado Pago"). Arquivo próprio, sem Angular, para
 * Assinaturas e o detalhe da empresa usarem o mesmo rótulo sem um chunk importar a página do outro.
 */
const GATEWAY_LABELS: Record<string, string> = {
  STRIPE: 'Stripe',
  MERCADOPAGO: 'Mercado Pago',
  MERCADO_PAGO: 'Mercado Pago',
  PAGARME: 'Pagar.me',
  PAGAR_ME: 'Pagar.me',
  ASAAS: 'Asaas',
  IUGU: 'Iugu',
  MANUAL: 'Manual',
  NONE: 'Sem gateway',
};

/**
 * `subscriptions[].gateway` chega MAIÚSCULO (`"STRIPE"`) e `mrr.byPlan[].gateway`
 * minúsculo (`"stripe"`). É divergência de schema declarada pelo backend, sem
 * correção prevista. Normalizar aqui é o que impede a mesma marca de aparecer de
 * dois jeitos na mesma tela.
 */
export function gatewayKey(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

/** Gateway fora da lista: "MEU_GATEWAY" vira "Meu gateway", nunca o valor cru. */
export function gatewayLabel(raw: string | null | undefined): string {
  const key = gatewayKey(raw);
  if (!key) return '—';
  const known = GATEWAY_LABELS[key];
  if (known) return known;
  const spaced = key.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
