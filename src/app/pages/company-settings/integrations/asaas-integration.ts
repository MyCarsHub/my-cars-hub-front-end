import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BackLink } from '../../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { clearServerErrors } from '../../../services/api-error';
import { SessionService } from '../../../services/session.service';
import { AsaasIntegrationService } from './asaas-integration.service';
import { AsaasEnvironment, AsaasIntegrationStatus } from './asaas-integration.types';

const ASAAS_CONFIG_URL = {
  SANDBOX: 'https://sandbox.asaas.com/config/index',
  PRODUCTION: 'https://www.asaas.com/config/index',
} as const;

@Component({
  selector: 'app-asaas-integration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BackLink,
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    AlertBanner,
    FormField,
    FieldControl,
  ],
  templateUrl: './asaas-integration.html',
})
export class AsaasIntegration implements OnInit {
  private readonly service = inject(AsaasIntegrationService);
  private readonly fb = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly session = inject(SessionService);

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly accessTokenMessages: Readonly<Record<string, string>> = {
    required: 'Informe a chave da API Asaas.',
    minlength: 'A chave parece incompleta. Cole a chave inteira.',
  };

  protected readonly status = this.service.status;
  protected readonly loading = this.service.loading;
  protected readonly saving = this.service.saving;
  protected readonly loadError = this.service.error;

  protected readonly connected = computed(() => this.status()?.connected === true);

  /**
   * Webhook quebrado: conectado, mas o Asaas recusou o registro — nenhum evento de
   * pagamento chega e a conciliação fica parada. `webhookStatus` manda; só sem ele
   * (resposta antiga) vale o booleano, e `undefined` NÃO é falha — é "não sei".
   */
  protected readonly webhookBroken = computed(() => {
    const s = this.status();
    if (!s?.connected) return false;
    if (s.webhookStatus) return s.webhookStatus === 'FAILED';
    return s.webhookAutoConfigured === false;
  });

  protected readonly webhookOk = computed(() => {
    const s = this.status();
    if (!s?.connected) return false;
    if (s.webhookStatus) return s.webhookStatus === 'REGISTERED';
    return s.webhookAutoConfigured === true;
  });

  protected readonly webhookBusy = this.service.webhookBusy;
  /** Falha HTTP do re-registro (a recusa do Asaas vem no status, não aqui). */
  protected readonly webhookError = signal<string | null>(null);
  /** A última tentativa de re-registro terminou sem sucesso (recusa do Asaas). */
  protected readonly webhookRetryFailed = signal(false);
  protected readonly hasLoaded = computed(() => this.status() !== null);
  protected readonly isPlatformAdmin = computed(() => this.session.isPlatformAdmin());

  protected readonly showDisconnectDialog = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly showAccessToken = signal(false);

  // Wizard state — kept as a signal so we can highlight the active step and
  // progress the user forward without losing their entries.
  protected readonly step = signal<1 | 2 | 3>(1);

  protected readonly connectForm = this.fb.nonNullable.group({
    accessToken: ['', [Validators.required, Validators.minLength(10)]],
    environment: ['PRODUCTION' as AsaasEnvironment, [Validators.required]],
  });

  protected readonly selectedEnv = signal<AsaasEnvironment>('PRODUCTION');

  protected readonly asaasConfigUrl = computed(() =>
    this.selectedEnv() === 'PRODUCTION'
      ? ASAAS_CONFIG_URL.PRODUCTION
      : ASAAS_CONFIG_URL.SANDBOX,
  );

  ngOnInit(): void {
    // Claim the load failure: the banner already renders `loadError`, so letting the
    // interceptor safety net fire would show the same problem twice.
    this.service.load().subscribe({ error: (err: HttpErrorResponse) => this.apiErrors.claim(err) });
  }

  protected selectEnvironment(env: AsaasEnvironment): void {
    if (env === 'SANDBOX' && !this.isPlatformAdmin()) return;
    this.selectedEnv.set(env);
    this.connectForm.controls.environment.setValue(env);
  }

  protected goToStep(n: 1 | 2 | 3): void {
    this.step.set(n);
  }

  protected nextStep(): void {
    const current = this.step();
    if (current === 1) {
      this.step.set(2);
      return;
    }
    if (current === 2) {
      const token = this.connectForm.controls.accessToken.value?.trim() ?? '';
      if (token.length < 10) {
        this.connectForm.controls.accessToken.markAsTouched();
        this.formError.set('Cole a chave completa da API Asaas para continuar.');
        return;
      }
      this.formError.set(null);
      this.step.set(3);
    }
  }

  protected submitConnect(): void {
    if (this.saving()) return;
    if (this.connectForm.invalid) {
      this.connectForm.markAllAsTouched();
      this.formError.set('Preencha os campos obrigatórios.');
      return;
    }
    this.formError.set(null);
    clearServerErrors(this.connectForm);
    const raw = this.connectForm.getRawValue();
    const environment: AsaasEnvironment = this.isPlatformAdmin()
      ? raw.environment
      : 'PRODUCTION';
    this.selectEnvironment(environment);
    this.service
      .connect({
        accessToken: raw.accessToken.trim(),
        environment,
      })
      .subscribe({
        next: (status) => {
          // Conectar devolve 200 mesmo quando o Asaas recusa o webhook: dizer
          // "conectada com sucesso" aqui esconderia o problema que a tela mostra.
          if (status.webhookStatus === 'FAILED') {
            this.notifications.push(
              'warning',
              'Integração conectada, mas o webhook não foi registrado. Veja o aviso na página.',
            );
          } else {
            this.notifications.push('success', 'Integração Asaas conectada com sucesso.');
          }
          // Reset wizard for next time.
          this.step.set(1);
          this.connectForm.reset({ accessToken: '', environment: 'PRODUCTION' });
          this.selectedEnv.set('PRODUCTION');
        },
        error: (err: HttpErrorResponse) => {
          const { formMessage } = this.apiErrors.handleForm(
            err,
            this.connectForm,
            err.status === 400
              ? 'Não conseguimos validar essa chave. Verifique se você copiou a chave completa e se o ambiente escolhido está correto (Sandbox vs Produção).'
              : 'Não foi possível conectar. Tente novamente.',
          );
          this.formError.set(formMessage);
        },
      });
  }

  protected reregisterWebhook(): void {
    if (this.webhookBusy()) return;
    this.webhookError.set(null);
    this.webhookRetryFailed.set(false);
    this.service.reregisterWebhook().subscribe({
      next: (status) => {
        if (this.isRegistered(status)) {
          this.notifications.push('success', 'Webhook registrado no Asaas.');
        } else {
          // 200 com FAILED: o Asaas recusou de novo. O banner já mostra o motivo novo.
          this.webhookRetryFailed.set(true);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.webhookError.set(
          this.apiErrors.messageFor(
            err,
            'Não foi possível registrar o webhook agora. Tente novamente.',
          ),
        );
      },
    });
  }

  private isRegistered(status: AsaasIntegrationStatus): boolean {
    if (status.webhookStatus) return status.webhookStatus === 'REGISTERED';
    return status.webhookAutoConfigured === true;
  }

  protected askDisconnect(): void {
    this.showDisconnectDialog.set(true);
  }

  protected cancelDisconnect(): void {
    if (this.saving()) return;
    this.showDisconnectDialog.set(false);
  }

  protected confirmDisconnect(): void {
    this.service.disconnect().subscribe({
      next: () => {
        this.showDisconnectDialog.set(false);
        this.notifications.push('success', 'Integração Asaas desconectada.');
      },
      error: (err: HttpErrorResponse) => {
        this.showDisconnectDialog.set(false);
        // Inline, not a toast: HTTP failures belong to the screen.
        this.formError.set(
          this.apiErrors.messageFor(err, 'Não foi possível desconectar. Tente novamente.'),
        );
      },
    });
  }

  protected toggleAccessTokenVisibility(): void {
    this.showAccessToken.update((v) => !v);
  }

  protected environmentLabel(env: AsaasEnvironment | null): string {
    if (env === 'PRODUCTION') return 'Produção';
    if (env === 'SANDBOX') return 'Sandbox';
    return '—';
  }

  protected formatDateTime(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
