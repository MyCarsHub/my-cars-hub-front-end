import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { ApiErrorService } from '../../../services/api-error.service';
import { SILENT_HTTP_ERRORS } from '../../../services/http-errors.context';
import { ImpersonationService } from '../../../services/impersonation.service';
import { NotificationService } from '../../../services/notification.service';
import { supportEditLifecycleMessage } from '../../../services/support-edit-errors';
import { SupportEditStatus } from '../../../types/impersonation.types';

const STATUS_URL = `${environment.apiUrl}/admin/impersonation/edit/status`;

/**
 * Entrada do modo edição de suporte, ao lado de "Ver como empresa (leitura)".
 *
 * Botão SEPARADO e confirmado: abrir uma sessão que ESCREVE nos dados do
 * cliente nunca é um clique só. A chave do servidor (`GET /status`) decide se o
 * botão está habilitado — desligada, ele fica desabilitado COM a explicação
 * visível, não escondido sem aviso.
 *
 * Importado estaticamente pela página de detalhe, que já é rota preguiçosa: o
 * custo fica no chunk dela, nunca no bundle inicial.
 */
@Component({
  selector: 'app-support-edit-entry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, ConfirmDialog],
  template: `
    <div class="flex w-full flex-col gap-1 sm:w-auto">
      <button
        type="button"
        class="min-h-11 w-full rounded-xl border border-rose-200 dark:border-rose-500/30 bg-surface px-4 py-2.5 text-sm
               font-semibold text-rose-700 dark:text-rose-300 transition-colors hover:bg-rose-50 dark:hover:bg-rose-500/10 focus:outline-none
               focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2
               disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        [disabled]="!canOpen()"
        [attr.aria-describedby]="hint() ? 'support-edit-hint' : null"
        (click)="openDialog()"
      >
        {{ starting() ? 'Abrindo sessão…' : 'Editar como empresa' }}
      </button>
      @if (hint(); as text) {
        <p id="support-edit-hint" class="text-xs text-fg-subtle">{{ text }}</p>
      }
      @if (error(); as message) {
        <app-alert-banner variant="error" [message]="message" />
      }
    </div>

    <app-confirm-dialog
      [open]="dialogOpen()"
      variant="danger"
      title="Editar como empresa"
      [message]="dialogMessage()"
      confirmLabel="Abrir sessão de edição"
      cancelLabel="Cancelar"
      [busy]="starting()"
      (confirmed)="confirm()"
      (cancelled)="closeDialog()"
    />
  `,
})
export class SupportEditEntry implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly impersonation = inject(ImpersonationService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly router = inject(Router);

  readonly companyId = input.required<string>();
  readonly companyName = input<string>('');

  protected readonly status = signal<SupportEditStatus | null>(null);
  /** `true` quando o `GET /status` falhou — a chave fica desconhecida, não "ligada". */
  protected readonly statusFailed = signal(false);
  protected readonly dialogOpen = signal(false);
  protected readonly starting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly canOpen = computed(
    () => this.status()?.enabled === true && !this.starting() && !this.impersonation.active(),
  );

  protected readonly hint = computed(() => {
    if (this.statusFailed()) {
      return 'Não foi possível verificar se o modo edição está liberado.';
    }
    const status = this.status();
    if (status && !status.enabled) return 'O modo edição está desligado na plataforma.';
    return null;
  });

  protected readonly dialogMessage = computed(() => {
    const name = this.companyName() || 'esta empresa';
    const minutes = this.status()?.ttlMinutes;
    const window = minutes ? ` A sessão dura ${minutes} minutos e pode ser estendida.` : '';
    return (
      `Você vai poder alterar aluguéis e cancelar cobranças de caução de ${name}, ` +
      `como se fosse a própria empresa. Tudo é registrado e visível para a empresa.${window}`
    );
  });

  ngOnInit(): void {
    // SILENT: a falha vira a dica inline abaixo do botão, sem toast por cima.
    const context = new HttpContext().set(SILENT_HTTP_ERRORS, true);
    this.http.get<SupportEditStatus>(STATUS_URL, { context }).subscribe({
      next: (status) => this.status.set(status),
      error: () => this.statusFailed.set(true),
    });
  }

  protected openDialog(): void {
    if (!this.canOpen()) return;
    this.error.set(null);
    this.dialogOpen.set(true);
  }

  protected closeDialog(): void {
    if (this.starting()) return;
    this.dialogOpen.set(false);
  }

  protected confirm(): void {
    if (this.starting()) return;
    this.starting.set(true);
    this.impersonation.startEdit(this.companyId()).subscribe({
      next: (session) => {
        this.starting.set(false);
        this.dialogOpen.set(false);
        this.notifications.info(`Modo edição aberto para ${session.companyName}.`);
        void this.router.navigate(['/dashboard']);
      },
      error: (err: HttpErrorResponse) => {
        this.starting.set(false);
        this.dialogOpen.set(false);
        this.error.set(
          supportEditLifecycleMessage(err) ??
            this.apiErrors.messageFor(err, 'Não foi possível abrir a sessão de edição.'),
        );
      },
    });
  }
}
