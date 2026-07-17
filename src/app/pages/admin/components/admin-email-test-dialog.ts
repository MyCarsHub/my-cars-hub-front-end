import { animate, style, transition, trigger } from '@angular/animations';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SessionService } from '../../../services/session.service';
import { NotificationService } from '../../../services/notification.service';
import { AdminService } from '../admin.service';

@Component({
  selector: 'app-admin-email-test-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  animations: [
    trigger('backdrop', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('150ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('dialog', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95) translateY(-8px)' }),
        animate(
          '200ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 1, transform: 'scale(1) translateY(0)' }),
        ),
      ]),
      transition(':leave', [
        animate(
          '150ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 0, transform: 'scale(0.95) translateY(-8px)' }),
        ),
      ]),
    ]),
  ],
  template: `
    @if (open()) {
      <div
        @backdrop
        class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        (click)="onCancel()"
        aria-hidden="true"
      ></div>

      <div
        @dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-email-test-title"
        aria-describedby="admin-email-test-description"
        class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 pointer-events-none"
      >
        <div
          class="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-neutral-100 w-full max-w-md pointer-events-auto overflow-hidden"
        >
          <div class="flex items-start gap-3 sm:gap-4 p-4 sm:p-6 pb-3 sm:pb-4">
            <div
              class="shrink-0 w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center"
              aria-hidden="true"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-primary-500"
              >
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <div class="flex-1 min-w-0">
              <h2
                id="admin-email-test-title"
                class="text-base font-semibold text-neutral-900 leading-snug"
              >
                Testar templates de email
              </h2>
              <p
                id="admin-email-test-description"
                class="mt-1 text-sm text-neutral-500 leading-relaxed"
              >
                Todos os 13 templates de email serão disparados com dados mock.
                Verifique a caixa de entrada.
              </p>
            </div>
          </div>

          <form
            (ngSubmit)="onSubmit()"
            class="px-4 sm:px-6 pb-4 sm:pb-6"
            novalidate
          >
            <label
              for="admin-email-test-input"
              class="block text-sm font-medium text-neutral-700 mb-1"
            >
              Email de destino
            </label>
            <input
              id="admin-email-test-input"
              name="email"
              type="email"
              required
              autocomplete="email"
              [disabled]="loading()"
              [ngModel]="email()"
              (ngModelChange)="email.set($event)"
              placeholder="voce@exemplo.com"
              class="w-full min-h-[48px] px-3 py-2 rounded-xl border border-neutral-200 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 disabled:bg-neutral-50 disabled:text-neutral-500"
            />

            <div
              class="mt-4 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3"
            >
              <button
                type="button"
                (click)="onCancel()"
                [disabled]="loading()"
                class="w-full sm:w-auto min-h-[48px] px-4 py-2.5 text-sm font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="submit"
                [disabled]="loading() || !isValidEmail()"
                class="w-full sm:w-auto min-h-[48px] px-4 py-2.5 text-sm font-semibold rounded-xl bg-primary-500 text-white hover:bg-primary-600 focus:ring-primary-400 transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 active:scale-[0.98] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                @if (loading()) {
                  <svg
                    class="animate-spin h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    ></circle>
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    ></path>
                  </svg>
                  <span>Enviando…</span>
                } @else {
                  <span>Enviar</span>
                }
              </button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
})
export class AdminEmailTestDialog {
  private readonly session = inject(SessionService);
  private readonly adminService = inject(AdminService);
  private readonly notifications = inject(NotificationService);

  open = input.required<boolean>();
  cancelled = output<void>();
  sent = output<void>();

  protected readonly email = signal<string>('');
  protected readonly loading = signal(false);

  constructor() {
    effect(() => {
      if (this.open()) {
        const current = this.email();
        if (!current) {
          this.email.set(this.session.getItem('email') ?? '');
        }
      }
    });
  }

  protected isValidEmail(): boolean {
    const value = this.email().trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  protected onCancel(): void {
    if (this.loading()) return;
    this.cancelled.emit();
  }

  protected onSubmit(): void {
    if (this.loading() || !this.isValidEmail()) return;
    const target = this.email().trim();
    this.loading.set(true);
    this.adminService.testNotifications(target).subscribe({
      next: () => {
        this.loading.set(false);
        this.notifications.success(
          `13 emails enviados para ${target}. Verifique a caixa de entrada.`,
        );
        this.sent.emit();
      },
      error: () => {
        this.loading.set(false);
        this.notifications.error(
          'Não foi possível enviar. Verifique se o SMTP está configurado.',
        );
      },
    });
  }
}
