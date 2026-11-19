import type { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import type { AdminCompanyStatus } from '../../../types/admin-company.types';

/** Texto e tom de `app-status-chip` para a situação da empresa (`companies.status`). */
export interface CompanyStatusChip {
  label: string;
  tone: StatusChipTone;
}

/**
 * A MESMA tradução na lista e no detalhe: o rótulo sai do `status` do servidor, nunca do
 * booleano `active` (que é falso tanto para suspensa quanto para cancelada).
 */
const COMPANY_STATUS: Record<AdminCompanyStatus, CompanyStatusChip> = {
  ACTIVE: { label: 'Ativa', tone: 'green' },
  SUSPENDED: { label: 'Suspensa', tone: 'red' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
};

export function companyStatusChip(status: string | null | undefined): CompanyStatusChip | null {
  if (!status) return null;
  return COMPANY_STATUS[status as AdminCompanyStatus] ?? { label: status, tone: 'neutral' };
}
