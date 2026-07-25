import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
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
  imports: [RouterLink, DefaultPageLayout],
  templateUrl: './integrations-hub.html',
})
export class IntegrationsHub implements OnInit {
  private readonly asaas = inject(AsaasIntegrationService);

  protected readonly integrations = INTEGRATIONS;

  protected readonly asaasConnected = computed(
    () => this.asaas.status()?.connected === true,
  );

  ngOnInit(): void {
    // Silenciosamente tenta hidratar o status — 404 significa "não configurado"
    // e o service já normaliza pra { connected: false }.
    this.asaas.load().subscribe({ error: () => void 0 });
  }

  protected isConnected(key: IntegrationStatusKey): boolean {
    if (key === 'asaas') return this.asaasConnected();
    return false;
  }
}
