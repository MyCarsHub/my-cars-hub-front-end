import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type AlertVariant = 'error' | 'warning' | 'success' | 'info';

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  error: 'bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/20 text-rose-800 dark:text-rose-200',
  warning: 'bg-amber-50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/20 text-amber-800 dark:text-amber-200',
  success: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-200',
  info: 'bg-sky-50 dark:bg-sky-500/10 border-sky-100 dark:border-sky-500/20 text-sky-800 dark:text-sky-200',
};

/**
 * Inline banner for form-level / screen-level messages that have no single field
 * to attach to (business rules, load failures, permission notices).
 *
 * Errors and warnings get `role="alert"` (interrupts the screen reader); success and
 * info get `role="status"` (polite). Render it inside an `@if` so the role is present
 * at insertion time — that is what makes it announce.
 *
 * Business errors go HERE, never in a toast.
 */
@Component({
  selector: 'app-alert-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      [class]="classes()"
      [attr.role]="role()"
      class="rounded-xl border p-3 text-sm flex items-start gap-2"
    >
      <span class="flex-1 min-w-0 break-words">
        @if (message()) {
          {{ message() }}
        }
        <ng-content />
      </span>
    </div>
  `,
})
export class AlertBanner {
  readonly variant = input<AlertVariant>('error');
  readonly message = input('');

  protected readonly classes = computed(() => VARIANT_CLASSES[this.variant()]);
  protected readonly role = computed(() =>
    this.variant() === 'error' || this.variant() === 'warning' ? 'alert' : 'status',
  );
}
