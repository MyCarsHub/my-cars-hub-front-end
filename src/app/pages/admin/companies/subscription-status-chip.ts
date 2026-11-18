import type { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { AdminCompanySubscriptionStatus } from '../../../types/admin-company.types';

/** Texto e tom de `app-status-chip` (cor só no chip, sem bolinha). */
export interface SubscriptionChip {
  label: string;
  tone: StatusChipTone;
}

const CHIPS: Record<AdminCompanySubscriptionStatus, SubscriptionChip> = {
  TRIALING: { label: 'Em teste', tone: 'blue' },
  ACTIVE: { label: 'Ativa', tone: 'green' },
  PAST_DUE: { label: 'Atrasada', tone: 'amber' },
  CANCELED: { label: 'Cancelada', tone: 'neutral' },
  // EXPIRED só é escrito pelo job que encerra o teste vencido (backend V124).
  EXPIRED: { label: 'Teste vencido', tone: 'red' },
};

const TRIAL_ENDED: SubscriptionChip = { label: 'Teste vencido', tone: 'red' };

/**
 * Chip da assinatura no admin.
 *
 * O status TRIALING sozinho mente: o teste vencido continua TRIALING no banco, e o backend
 * bloqueia a empresa como TRIAL_EXPIRED (`BillingAccessService`). Em 2026-10-25, 34 das 37
 * assinaturas em teste já tinham passado da data — e a tela as pintava de "Trial" azul
 * (AUDIT 2026-10-25 D1). Mesma regra do backend: vencido quando `agora >= fim do teste`.
 */
export function subscriptionChip(
  status: AdminCompanySubscriptionStatus | null | undefined,
  trialEndsAt: string | null | undefined,
  now: number = Date.now(),
): SubscriptionChip | null {
  if (!status) return null;
  if (status === 'TRIALING' && trialEndsAt) {
    const end = Date.parse(trialEndsAt);
    if (!Number.isNaN(end) && now >= end) return TRIAL_ENDED;
  }
  return CHIPS[status] ?? { label: status, tone: 'neutral' };
}
