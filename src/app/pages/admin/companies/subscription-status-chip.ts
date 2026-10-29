import { AdminCompanySubscriptionStatus } from '../../../types/admin-company.types';

export interface SubscriptionChip {
  label: string;
  chip: string;
}

const CHIPS: Record<AdminCompanySubscriptionStatus, SubscriptionChip> = {
  TRIALING: {
    label: 'Em teste',
    chip: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300',
  },
  ACTIVE: {
    label: 'Ativa',
    chip: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  PAST_DUE: {
    label: 'Atrasada',
    chip: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  CANCELED: { label: 'Cancelada', chip: 'bg-surface-strong text-fg-soft' },
  // EXPIRED só é escrito pelo job que encerra o teste vencido (backend V124).
  EXPIRED: {
    label: 'Teste vencido',
    chip: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300',
  },
};

const TRIAL_ENDED: SubscriptionChip = {
  label: 'Teste vencido',
  chip: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300',
};

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
  return CHIPS[status] ?? { label: status, chip: 'bg-surface-sunken text-fg-soft' };
}
