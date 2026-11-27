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
import { environment as appEnv } from '../../../../environments/environment';
import { AsaasIntegrationService } from './asaas-integration.service';
import { centsParts, currentMonthName, formatCents, noticeLabel } from './asaas-integration.view';

export const ASAAS_ROUTE = '/configuracoes/integracoes/asaas';

/** Estado do Asaas na vitrine: decide o cartão (pintado quando ligado) e o chip. */
type AsaasCardState = 'loading' | 'unknown' | 'off' | 'on' | 'test' | 'broken';

/**
 * Vitrine de integrações (desenho aprovado em 27/11): formato "loja", com a linguagem da
 * página do Asaas. Por ora só o Asaas, por decisão do dono; a grade já recebe outros cartões.
 * Ligado, o Asaas vira o cartão pintado com o saldo e o caminho do dinheiro em miniatura;
 * tocar abre a página do Asaas.
 */
@Component({
  selector: 'app-integrations-hub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DefaultPageLayout, AlertBanner],
  templateUrl: './integrations-hub.html',
  styleUrl: './integrations-hub.css',
})
export class IntegrationsHub implements OnInit {
  private readonly asaas = inject(AsaasIntegrationService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly asaasRoute = ASAAS_ROUTE;
  private readonly monthName = currentMonthName();

  protected readonly whatsappUrl = appEnv.supportWhatsapp
    ? `https://wa.me/${appEnv.supportWhatsapp}?text=${encodeURIComponent('Olá! Tenho uma dúvida sobre as integrações do MyCarsHub.')}`
    : null;

  /**
   * Falha ao CARREGAR o status das integrações. Sem isso o usuário lia
   * "Não ligado" para uma integração que talvez esteja ligada.
   */
  protected readonly error = signal<string | null>(null);

  private readonly status = this.asaas.status;
  private readonly overview = this.asaas.overview;

  private readonly webhookBroken = computed(() => {
    const s = this.status();
    if (!s?.connected) return false;
    if (s.webhookStatus) return s.webhookStatus === 'FAILED';
    return s.webhookAutoConfigured === false;
  });

  protected readonly state = computed<AsaasCardState>(() => {
    const s = this.status();
    // Status não lido: nunca "Ligar" (talvez já esteja ligado); o cartão só leva à página.
    if (s === null) return this.error() ? 'unknown' : 'loading';
    if (!s.connected) return 'off';
    if (this.webhookBroken()) return 'broken';
    return s.environment === 'SANDBOX' ? 'test' : 'on';
  });

  protected readonly chipLabel = computed(() => {
    switch (this.state()) {
      case 'test':
        return 'Testes';
      case 'broken':
        return 'Aviso parado';
      default:
        return 'Ligado';
    }
  });

  /** Saldo do cartão: só com o número em mãos; sem ele o cartão diz que não leu, nunca inventa. */
  protected readonly balance = computed<
    { kind: 'loading' } | { kind: 'none' } | { kind: 'ok'; int: string; dec: string; n: number }
  >(() => {
    const ov = this.overview();
    if (!ov) return this.asaas.overviewLoading() ? { kind: 'loading' } : { kind: 'none' };
    const cents = ov.asaas?.balanceCents;
    if (cents == null) return { kind: 'none' };
    const p = centsParts(cents);
    return { kind: 'ok', int: p.int, dec: p.dec, n: p.int.length };
  });

  /**
   * As quatro paradas do caminho do dinheiro (enviada, paga, avisou, baixa). Aviso parado
   * apaga as duas últimas; pagamento esperando baixa apaga só a última — a mesma régua da página.
   */
  protected readonly stops = computed<readonly boolean[]>(() => {
    if (this.webhookBroken()) return [true, true, false, false];
    const waiting = this.overview()?.awaitingSettlementCount ?? 0;
    return waiting > 0 ? [true, true, true, false] : [true, true, true, true];
  });

  protected readonly stopsLabel = computed(() => {
    const on = this.stops().filter(Boolean).length;
    return `Caminho do dinheiro: ${on} de 4 paradas funcionando`;
  });

  protected readonly paidThisMonth = computed(() => {
    const m = this.overview()?.month;
    return m ? { label: `Recebido em ${this.monthName}`, value: formatCents(m.paidCents) } : null;
  });

  protected readonly lastNotice = computed(() => {
    const at = this.overview()?.lastPaymentNoticeAt;
    return at ? `Último aviso ${noticeLabel(at)}` : null;
  });

  ngOnInit(): void {
    this.error.set(null);
    this.asaas.load().subscribe({
      next: (s) => {
        if (s.connected) this.loadOverview();
      },
      error: (err: HttpErrorResponse) => {
        // 404 é o estado legítimo "não ligado" — o service já normaliza
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

  /** Números do cartão: falha não é erro da tela (o cartão segue, só sem saldo). */
  private loadOverview(): void {
    this.asaas.loadOverview().subscribe({ error: () => void 0 });
  }
}
