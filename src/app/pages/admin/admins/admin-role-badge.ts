import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AdminRole } from '../../../types/admin-roles.types';

export const ADMIN_ROLE_LABEL: Record<AdminRole, string> = {
  OWNER: 'Dono da plataforma',
  SUPPORT: 'Suporte',
  READONLY: 'Leitura',
};

const TONE: Record<AdminRole | 'NONE', string> = {
  OWNER: 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300',
  SUPPORT: 'bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
  READONLY: 'bg-surface-sunken text-fg-soft',
  NONE: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
};

/** Selo do papel de admin. Reutilizável na lista, no detalhe e nas folhas. */
@Component({
  selector: 'app-admin-role-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold"
      [class]="tone()"
      data-testid="admin-role-badge"
      >{{ label() }}</span
    >
  `,
})
export class AdminRoleBadge {
  readonly role = input<AdminRole | null>(null);

  protected readonly label = computed(() => {
    const r = this.role();
    return r ? ADMIN_ROLE_LABEL[r] : 'Sem papel';
  });

  protected readonly tone = computed(() => TONE[this.role() ?? 'NONE']);
}
