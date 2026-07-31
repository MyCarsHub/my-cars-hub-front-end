import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../../services/api-error.service';
import { AsaasIntegrationService } from './asaas-integration.service';

type IntegrationStatusKey = 'asaas';

interface IntegrationCardConfig {
  readonly key: IntegrationStatusKey;
  readonly name: string;
  readonly description: string;
  readonly logo: string;
  readonly logoAlt: string;
  readonly route: string;
}

const INTEGRATIONS: readonly IntegrationCardConfig[] = [
  {
    key: 'asaas',
    name: 'Asaas',
    description: 'Cobranças automáticas para aluguéis e caução (PIX, boleto e cartão).',
    logo: 'logos/integrations/asaas.svg',
    logoAlt: 'Logo Asaas',
    route: '/configuracoes/integracoes/asaas',
  },
];

/**
 * Hub de integrações da empresa. Lista cards clicáveis, um por provedor,
 * com badge de status ("Conectado" / "Não configurado"). Preparado para
 * receber novos provedores (Autentique, Stripe, etc.) sem mexer na página.
 */
@Component({
  selector: 'app-integrations-hub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DefaultPageLayout, AlertBanner],
  templateUrl: './integrations-hub.html',
})
export class IntegrationsHub implements OnInit {
  private readonly asaas = inject(AsaasIntegrationService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly integrations = INTEGRATIONS;

  /**
   * Falha ao CARREGAR o status das integrações. Sem isso o usuário lia
   * "Não configurado" para uma integração que talvez esteja conectada.
   */
  protected readonly error = signal<string | null>(null);

  protected readonly asaasConnected = computed(
    () => this.asaas.status()?.connected === true,
  );

  ngOnInit(): void {
    this.error.set(null);
    this.asaas.load().subscribe({
      error: (err: HttpErrorResponse) => {
        // 404 é o estado legítimo "não configurado" — o service já normaliza
        // pra { connected: false }. Reivindica mesmo assim pra calar o safety net.
        if (err.status === 404) {
          this.apiErrors.claim(err);
          return;
        }
        this.error.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar o status das integrações.'),
        );
      },
    });
  }

  protected isConnected(key: IntegrationStatusKey): boolean {
    if (key === 'asaas') return this.asaasConnected();
    return false;
  }
}
