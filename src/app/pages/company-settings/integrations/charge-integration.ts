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
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { PageCard } from '../../../components/core/page-card/page-card';
import { NotificationService } from '../../../services/notification.service';
import { SessionService } from '../../../services/session.service';
import { ChargeIntegrationService } from './charge-integration.service';
import {
  ChargeEnvironment,
  ChargeProvider,
} from './charge-integration.types';

/**
 * Tela generalizada de integração de cobranças. Usuário escolhe o provider
 * (Asaas | AbacatePay), cola a chave, escolhe o ambiente e conecta.
 *
 * <p>SANDBOX só é visível/selecionável para PLATFORM_ADMIN — usuários
 * comuns são forçados a PRODUCTION.</p>
 */
@Component({
  selector: 'app-charge-integration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DefaultPageLayout, ConfirmDialog, PageCard],
  templateUrl: './charge-integration.html',
})
export class ChargeIntegration implements OnInit {
  private readonly service = inject(ChargeIntegrationService);
  private readonly fb = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);
  private readonly session = inject(SessionService);

  protected readonly status = this.service.status;
  protected readonly loading = this.service.loading;
  protected readonly saving = this.service.saving;

  protected readonly isPlatformAdmin = computed(() => this.session.isPlatformAdmin());
  protected readonly connected = computed(() => this.status()?.connected === true);

  protected readonly showDisconnectDialog = signal(false);
  protected readonly showAccessToken = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly connectForm = this.fb.nonNullable.group({
    provider: ['asaas' as ChargeProvider, [Validators.required]],
    accessToken: ['', [Validators.required, Validators.minLength(10)]],
    environment: ['PRODUCTION' as ChargeEnvironment, [Validators.required]],
  });

  protected readonly selectedProvider = signal<ChargeProvider>('asaas');
  protected readonly selectedEnv = signal<ChargeEnvironment>('PRODUCTION');

  protected readonly providerLabel = computed(() =>
    this.selectedProvider() === 'asaas' ? 'Asaas' : 'AbacatePay',
  );

  ngOnInit(): void {
    this.service.load().subscribe({ error: () => void 0 });
  }

  protected selectProvider(p: ChargeProvider): void {
    this.selectedProvider.set(p);
    this.connectForm.controls.provider.setValue(p);
    this.formError.set(null);
  }

  protected selectEnvironment(e: ChargeEnvironment): void {
    if (e === 'SANDBOX' && !this.isPlatformAdmin()) return;
    this.selectedEnv.set(e);
    this.connectForm.controls.environment.setValue(e);
  }

  protected toggleAccessTokenVisibility(): void {
    this.showAccessToken.update((v) => !v);
  }

  protected submit(): void {
    if (this.saving()) return;
    if (this.connectForm.invalid) {
      this.connectForm.markAllAsTouched();
      this.formError.set('Preencha os campos obrigatórios.');
      return;
    }
    this.formError.set(null);
    const raw = this.connectForm.getRawValue();
    const env: ChargeEnvironment = this.isPlatformAdmin() ? raw.environment : 'PRODUCTION';
    this.service
      .connect({
        provider: raw.provider,
        accessToken: raw.accessToken.trim(),
        environment: env,
      })
      .subscribe({
        next: () => {
          this.notifications.push(
            'success',
            `Integração ${this.providerLabel()} conectada com sucesso.`,
          );
          this.connectForm.reset({
            provider: this.selectedProvider(),
            accessToken: '',
            environment: 'PRODUCTION',
          });
          this.selectedEnv.set('PRODUCTION');
        },
        error: (err: HttpErrorResponse) => {
          this.formError.set(
            this.extractError(
              err,
              err.status === 400
                ? 'Chave rejeitada pelo provedor. Verifique se copiou a chave completa e se o ambiente escolhido está correto.'
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
        this.notifications.push('success', 'Integração desconectada.');
      },
      error: (err: HttpErrorResponse) => {
        this.showDisconnectDialog.set(false);
        this.notifications.push(
          'error',
          this.extractError(err, 'Não foi possível desconectar.'),
        );
      },
    });
  }

  protected fieldInvalid(name: string): boolean {
    const c = this.connectForm.get(name);
    return !!c && c.invalid && c.touched;
  }

  protected environmentLabel(env: ChargeEnvironment | null): string {
    if (env === 'PRODUCTION') return 'Produção';
    if (env === 'SANDBOX') return 'Sandbox';
    return '—';
  }

  protected providerDisplayName(p: ChargeProvider | null): string {
    if (p === 'asaas') return 'Asaas';
    if (p === 'abacatepay') return 'AbacatePay';
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
