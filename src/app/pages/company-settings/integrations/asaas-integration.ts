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
import { RouterLink } from '@angular/router';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { NotificationService } from '../../../services/notification.service';
import { AsaasIntegrationService } from './asaas-integration.service';
import { AsaasEnvironment } from './asaas-integration.types';

const ASAAS_CONFIG_URL = {
  SANDBOX: 'https://sandbox.asaas.com/config/index',
  PRODUCTION: 'https://www.asaas.com/config/index',
} as const;

@Component({
  selector: 'app-asaas-integration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
  ],
  templateUrl: './asaas-integration.html',
})
export class AsaasIntegration implements OnInit {
  private readonly service = inject(AsaasIntegrationService);
  private readonly fb = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);

  protected readonly status = this.service.status;
  protected readonly loading = this.service.loading;
  protected readonly saving = this.service.saving;
  protected readonly loadError = this.service.error;

  protected readonly connected = computed(() => this.status()?.connected === true);
  protected readonly hasLoaded = computed(() => this.status() !== null);

  protected readonly showDisconnectDialog = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly showAccessToken = signal(false);

  // Wizard state — kept as a signal so we can highlight the active step and
  // progress the user forward without losing their entries.
  protected readonly step = signal<1 | 2 | 3>(1);

  protected readonly connectForm = this.fb.nonNullable.group({
    accessToken: ['', [Validators.required, Validators.minLength(10)]],
    environment: ['SANDBOX' as AsaasEnvironment, [Validators.required]],
  });

  protected readonly selectedEnv = signal<AsaasEnvironment>('SANDBOX');

  protected readonly asaasConfigUrl = computed(() =>
    this.selectedEnv() === 'PRODUCTION'
      ? ASAAS_CONFIG_URL.PRODUCTION
      : ASAAS_CONFIG_URL.SANDBOX,
  );

  ngOnInit(): void {
    this.service.load().subscribe({ error: () => {} });
  }

  protected selectEnvironment(env: AsaasEnvironment): void {
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
    const raw = this.connectForm.getRawValue();
    this.service
      .connect({
        accessToken: raw.accessToken.trim(),
        environment: raw.environment,
      })
      .subscribe({
        next: () => {
          this.notifications.push('success', 'Integração Asaas conectada com sucesso.');
          // Reset wizard for next time.
          this.step.set(1);
          this.connectForm.reset({ accessToken: '', environment: 'SANDBOX' });
          this.selectedEnv.set('SANDBOX');
        },
        error: (err: HttpErrorResponse) => {
          this.formError.set(
            this.extractError(
              err,
              err.status === 400
                ? 'Não conseguimos validar essa chave. Verifique se você copiou a chave completa e se o ambiente escolhido está correto (Sandbox vs Produção).'
                : 'Não foi possível conectar. Tente novamente.',
            ),
          );
        },
      });
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
        this.notifications.push(
          'error',
          this.extractError(err, 'Não foi possível desconectar. Tente novamente.'),
        );
      },
    });
  }

  protected toggleAccessTokenVisibility(): void {
    this.showAccessToken.update((v) => !v);
  }

  protected fieldInvalid(name: string): boolean {
    const c = this.connectForm.get(name);
    return !!c && c.invalid && c.touched;
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

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
