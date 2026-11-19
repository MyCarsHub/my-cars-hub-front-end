import type { PlatformCost, PlatformCostSchedule, PlatformVendor } from '../../../types/admin-finance.types';

/** Dados de teste da página de Custos (valores ilustrativos do canvas 18/11). */
export function schedule(p: Partial<PlatformCostSchedule> = {}): PlatformCostSchedule {
  return {
    id: 's1',
    vendorId: 'v-vercel',
    vendorName: 'Vercel',
    vendorCategory: 'FRONTEND',
    service: 'Plano Pro',
    amountCents: 11_000,
    billingDay: 12,
    startMonth: '2026-07',
    endMonth: null,
    status: 'ACTIVE',
    previousScheduleId: null,
    latest: true,
    ...p,
  };
}

export function cost(p: Partial<PlatformCost> = {}): PlatformCost {
  return {
    id: 'c1',
    vendorId: 'v-render',
    vendorName: 'Render',
    vendorCategory: 'BACKEND',
    month: '2026-11',
    kind: 'FIXED',
    scheduleId: 's-render',
    description: 'Servidor da API',
    amountCents: 16_800,
    scheduleAmountCents: 14_000,
    dueDate: '2026-11-05',
    overridden: true,
    note: 'Instância extra',
    ...p,
  };
}

export function vendor(p: Partial<PlatformVendor> = {}): PlatformVendor {
  return { id: 'v-render', name: 'Render', category: 'BACKEND', categoryLabel: null, active: true, ...p };
}
