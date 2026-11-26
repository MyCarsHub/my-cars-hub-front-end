import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BackLink } from '../../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { StatusChip, StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { PaintedCard } from '../../../components/core/painted-card/painted-card';
import { ListRow } from '../../../components/core/list-group/list-group';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { parseApiError } from '../../../services/api-error';
import { SessionService } from '../../../services/session.service';
import { environment as appEnv } from '../../../../environments/environment';
import { formatDayMonth, parseServerTime } from '../../../utils/server-time';
import { AsaasIntegrationService } from './asaas-integration.service';
import { AsaasIcon, AsaasIconName } from './asaas-integration.icons';
import {
  ASAAS_SWITCH_CODES,
  AsaasEnvironment,
  AsaasIntegrationStatus,
  AsaasReceipt,
} from './asaas-integration.types';
import {
  cardFeeLabel,
  centsParts,
  checkAsaasKey,
  currentMonthName,
  dayLabel,
  formatCents,
  noticeLabel,
  shortDate,
} from './asaas-integration.view';
import { AsaasViewer, deriveAsaasViewer } from './asaas-integration.viewer';

const ASAAS_HOME_URL: Record<AsaasEnvironment, string> = {
  PRODUCTION: 'https://www.asaas.com',
  SANDBOX: 'https://sandbox.asaas.com',
};
/** Onde a chave de API é gerada (Integrações → Chaves de API). */
const ASAAS_KEYS_URL = 'https://www.asaas.com/customerApiAccessToken/index';
/** Página inicial do Asaas: a criação de conta parte dela. */
const ASAAS_SIGNUP_URL = 'https://www.asaas.com/';

type Sheet = 'menu' | 'confirm-switch' | 'change-key' | 'how-to';
type PageState = 'loading' | 'error' | 'denied' | 'empty' | 'data';

interface FlowStep {
  key: string;
  state: 'done' | 'bad' | 'idle' | 'warn';
  subWarn: boolean;
  title: string;
  sub: string | null;
  subBad: boolean;
  value: string | null;
  valueOk: boolean;
  relink: boolean;
}

interface ReceiptView {
  key: string;
  driver: string;
  plate: string | null;
  label: string | null;
  when: string;
  amount: string;
  rentalId: string | null;
}

interface FeeView {
  icon: AsaasIconName;
  label: string;
  value: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

@Component({
  selector: 'app-asaas-integration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BackLink,
    NgTemplateOutlet,
    RouterLink,
    ReactiveFormsModule,
    DefaultPageLayout,
    ConfirmDialog,
    BottomSheet,
    StatusChip,
    PaintedCard,
    ListRow,
    AlertBanner,
    AsaasIcon,
  ],
  templateUrl: './asaas-integration.html',
  styleUrls: ['./asaas-integration.css', './asaas-integration.flow.css'],
})
export class AsaasIntegration implements OnInit {
  private readonly service = inject(AsaasIntegrationService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly session = inject(SessionService);

  // ---------------------------------------------------------------- quem vê
  /** Impersonação primeiro (o token dela não tem papel); só depois o `system_role`. */
  protected readonly viewer: AsaasViewer = deriveAsaasViewer(this.session.getToken(), () =>
    this.session.isPlatformAdmin(),
  );
  protected readonly isAdmin = this.viewer === 'admin';
  /**
   * Sessão "ver como empresa" (decisão do dono, 26/11): vê a página como o dono, só leitura.
   * Some tudo o que muda algo (Religar, Conectar, Trocar a chave, Desligar, Ambiente);
   * "Testar a conexão" fica, porque só relê.
   */
  protected readonly readOnly = this.viewer === 'support';

  // ----------------------------------------------------------------- status
  protected readonly status = this.service.status;
  protected readonly loading = this.service.loading;
  protected readonly saving = this.service.saving;
  protected readonly loadError = this.service.error;
  /**
   * A página só confia no status que ELA pediu: um status deixado no serviço por outra tela
   * (ou outra empresa) não vale como carregado antes da resposta desta visita.
   */
  private readonly statusLoaded = signal(false);
  protected readonly hasLoaded = computed(() => this.statusLoaded() && this.status() !== null);
  protected readonly connected = computed(() => this.status()?.connected === true);

  /** 402/403 do status: o papel não abre a integração (o guard da rota já filtra; isto é a rede). */
  protected readonly statusDenied = signal(false);

  protected readonly pageState = computed<PageState>(() => {
    if (this.statusDenied() || this.service.overviewDenied()) return 'denied';
    if (!this.hasLoaded()) return this.loadError() && !this.loading() ? 'error' : 'loading';
    return this.connected() ? 'data' : 'empty';
  });

  /**
   * Aviso parado: conectado, mas o Asaas recusou o endereço de aviso. `webhookStatus` manda;
   * só sem ele (resposta antiga) vale o booleano, e `undefined` NÃO é falha.
   */
  protected readonly webhookBroken = computed(() => {
    const s = this.status();
    if (!s?.connected) return false;
    if (s.webhookStatus) return s.webhookStatus === 'FAILED';
    return s.webhookAutoConfigured === false;
  });
  protected readonly webhookBusy = this.service.webhookBusy;
  protected readonly webhookError = signal<string | null>(null);
  protected readonly webhookRetryFailed = signal(false);

  protected readonly headChip = computed<{ tone: StatusChipTone; label: string } | null>(() => {
    const state = this.pageState();
    if (state === 'empty') return { tone: 'amber', label: 'Desligado' };
    if (state !== 'data') return null;
    return this.webhookBroken()
      ? { tone: 'red', label: 'Aviso parado' }
      : { tone: 'green', label: 'Ligado' };
  });

  protected readonly description = computed(() =>
    this.pageState() === 'empty'
      ? 'Ligue sua conta para o MyCarsHub mandar as cobranças e dar baixa sozinho quando o motorista paga.'
      : 'Suas cobranças de aluguel e caução saem daqui. O dinheiro cai direto na sua conta.',
  );

  /** Chave ativa. O admin lê `activeEnvironment`; o resto, o `environment` de topo (que é a ativa). */
  protected readonly activeEnv = computed<AsaasEnvironment | null>(() => {
    const s = this.status();
    if (!s) return null;
    return s.activeEnvironment !== undefined ? s.activeEnvironment : s.environment;
  });

  protected readonly asaasUrl = computed(() => ASAAS_HOME_URL[this.activeEnv() ?? 'PRODUCTION']);
  protected readonly keysUrl = ASAAS_KEYS_URL;
  /** "O que muda quando ligar": a mesma esteira, acesa quando a chave confere. */
  protected readonly previewSteps = [
    { title: 'Cobrança enviada', sub: 'por Pix, pelo MyCarsHub' },
    { title: 'Motorista pagou', sub: 'cai direto na sua conta' },
    { title: 'Asaas avisou', sub: 'na hora, sem você fazer nada' },
    { title: 'Baixa no aluguel', sub: 'a cobrança fica paga sozinha' },
  ] as const;
  protected readonly signupUrl = ASAAS_SIGNUP_URL;
  protected readonly whatsappUrl = appEnv.supportWhatsapp
    ? `https://wa.me/${appEnv.supportWhatsapp}?text=${encodeURIComponent('Olá! Tenho uma dúvida sobre a integração com o Asaas.')}`
    : null;

  // --------------------------------------------------------------- overview
  protected readonly overview = this.service.overview;
  protected readonly overviewLoading = this.service.overviewLoading;
  protected readonly overviewError = this.service.overviewError;
  private readonly monthName = currentMonthName();

  /** Saldo: dados, carregando, ou o Asaas/servidor não respondeu (o resto da página segue). */
  /**
   * Saldo: dados, carregando, ou não lido. O bloco `asaas` guarda o que chegou mesmo quando uma
   * leitura falhou (`asaasError=UNAVAILABLE`, timeout de uma das chamadas): por isso o estado
   * "não lido" depende de `balanceCents`, não de `asaas` inteiro. Nome e documento da conta
   * aparecem cada um quando veio, também com o saldo falhado.
   */
  protected readonly balance = computed<
    | { kind: 'loading' }
    | { kind: 'failed'; reason: string; account: string | null }
    | { kind: 'ok'; int: string; dec: string; account: string | null }
  >(() => {
    const ov = this.overview();
    if (!ov) {
      if (this.overviewError()) {
        return {
          kind: 'failed',
          reason: 'O servidor não respondeu. O resto da página segue normal.',
          account: null,
        };
      }
      return { kind: 'loading' };
    }
    const a = ov.asaas;
    const account =
      [a?.accountName, a?.cpfCnpjMasked].filter((p): p is string => !!p?.trim()).join(' · ') ||
      null;
    if (a?.balanceCents == null) {
      return {
        kind: 'failed',
        reason:
          ov.asaasError === 'UNAUTHORIZED'
            ? this.readOnly
              ? 'O Asaas recusou a chave guardada. Só a empresa pode trocar a chave.'
              : 'O Asaas recusou a chave guardada. Troque a chave no menu ⋮.'
            : 'O Asaas não respondeu. O resto da página segue normal.',
        account,
      };
    }
    const parts = centsParts(a.balanceCents);
    return { kind: 'ok', int: parts.int, dec: parts.dec, account };
  });

  /** Pagamentos confirmados no Asaas ainda sem baixa (só vem com o aviso em dia). */
  private readonly awaiting = computed(() => {
    const n = this.overview()?.awaitingSettlementCount ?? null;
    return n !== null && n > 0 ? n : 0;
  });

  protected readonly flowProgress = computed(() =>
    this.webhookBroken() || this.awaiting() > 0 ? 2 / 3 : 1,
  );

  protected readonly flow = computed<FlowStep[]>(() => {
    const ov = this.overview();
    const m = ov?.month ?? null;
    const broken = this.webhookBroken();
    const sent: FlowStep = {
      key: 'sent',
      state: 'done',
      title: 'Cobrança enviada',
      sub: m ? `${m.sentCount} em ${this.monthName}` : null,
      subBad: false,
      subWarn: false,
      value: m ? formatCents(m.sentCents) : null,
      valueOk: false,
      relink: false,
    };
    const paid: FlowStep = {
      key: 'paid',
      state: 'done',
      title: 'Motorista pagou',
      sub: m
        ? plural(m.paidCount, 'paga', 'pagas') +
          (m.overdueCount > 0 ? ` · ${plural(m.overdueCount, 'atrasada', 'atrasadas')}` : '')
        : null,
      subBad: false,
      subWarn: false,
      value: m ? formatCents(m.paidCents) : null,
      valueOk: true,
      relink: false,
    };
    const notice = ov?.lastPaymentNoticeAt ?? null;
    if (broken) {
      // Sem número de propósito: com o aviso parado o backend não sabe quantos pagamentos
      // esperam (o aviso que não chegou não se conta), e `awaitingSettlementCount` vem null.
      return [
        sent,
        paid,
        {
          key: 'notice',
          state: 'bad',
          title: 'Aviso parado',
          sub: notice ? `desde ${shortDate(notice)}` : null,
          subBad: true,
          subWarn: false,
          value: null,
          valueOk: false,
          relink: true,
        },
        {
          key: 'settle',
          state: 'idle',
          title: 'Baixa no aluguel',
          sub: 'espera o aviso voltar',
          subBad: false,
          subWarn: false,
          value: 'Parada',
          valueOk: false,
          relink: false,
        },
      ];
    }
    const waiting = this.awaiting();
    return [
      sent,
      paid,
      {
        key: 'notice',
        state: 'done',
        title: 'Asaas avisou',
        sub: ov ? (notice ? `último ${noticeLabel(notice)}` : 'nenhum aviso ainda') : null,
        subBad: false,
        subWarn: false,
        value: 'Em dia',
        valueOk: true,
        relink: false,
      },
      waiting > 0
        ? {
            // O Asaas avisou, mas a baixa não aconteceu: não é "Sozinha".
            key: 'settle',
            state: 'warn',
            title: 'Baixa no aluguel',
            sub: `${waiting} esperando baixa`,
            subBad: false,
            subWarn: true,
            value: null,
            valueOk: false,
            relink: false,
          }
        : {
            key: 'settle',
            state: 'done',
            title: 'Baixa no aluguel',
            // Curto de propósito: na esteira horizontal a linha não pode cortar.
            sub: m ? plural(m.autoSettledCount, 'cobrança', 'cobranças') : null,
            subBad: false,
            subWarn: false,
            value: 'Sozinha',
            valueOk: true,
            relink: false,
          },
    ];
  });

  protected readonly receipts = computed<ReceiptView[]>(() =>
    (this.overview()?.recentReceipts ?? []).map((r: AsaasReceipt, i) => ({
      key: `${r.paidAt}-${r.rentalId ?? ''}-${i}`,
      driver: r.driverName?.trim() || 'Motorista',
      plate: r.plate?.trim() || null,
      label: r.chargeLabel?.trim() || null,
      when: dayLabel(r.paidAt),
      amount: formatCents(r.amountCents),
      rentalId: r.rentalId,
    })),
  );
  /** O celular mostra só as 3 mais recentes; a tabela do computador mostra todas. */
  protected readonly receiptsMobile = computed(() => this.receipts().slice(0, 3));

  protected readonly fees = computed<FeeView[]>(() => {
    const f = this.overview()?.asaas?.fees;
    if (!f) return [];
    // Cada taxa some sozinha: o Asaas pode informar umas e não outras.
    const rows: FeeView[] = [];
    if (f.pixFixedCents != null)
      rows.push({ icon: 'pix', label: 'Pix', value: formatCents(f.pixFixedCents) });
    if (f.boletoFixedCents != null) {
      rows.push({ icon: 'barcode', label: 'Boleto', value: formatCents(f.boletoFixedCents) });
    }
    const card = cardFeeLabel(f);
    if (card) rows.push({ icon: 'card', label: 'Cartão', value: card });
    return rows;
  });
  protected readonly feesPaid = computed(() => {
    const cents = this.overview()?.month?.feesPaidCents ?? null;
    return cents === null ? null : formatCents(cents);
  });
  protected readonly feesPaidLabel = `Pagas em ${this.monthName}`;

  // ------------------------------------------------------------- ambiente
  protected readonly showEnvironment = computed(
    () => this.isAdmin && this.connected() && Array.isArray(this.status()?.environments),
  );
  protected readonly envNotes = computed(() => ({
    test: this.envNote('SANDBOX'),
    prod: this.envNote('PRODUCTION'),
  }));
  /** Troca travada por cobrança aberta: o texto com os números do overview (ou do servidor). */
  protected readonly switchBlocked = signal<string | null>(null);
  /** Outros motivos de recusa da troca (sem chave, alteração concorrente, rede). */
  protected readonly switchError = signal<string | null>(null);
  protected readonly switchTarget = signal<AsaasEnvironment | null>(null);
  protected readonly switching = this.service.switching;

  // ---------------------------------------------------------------- chave
  protected readonly keyControl = new FormControl('', { nonNullable: true });
  private readonly keyValue = toSignal(this.keyControl.valueChanges, { initialValue: '' });
  protected readonly keyCheck = computed(() => checkAsaasKey(this.keyValue(), this.isAdmin));
  protected readonly connectError = signal<string | null>(null);

  // ---------------------------------------------------------------- folhas
  protected readonly sheet = signal<Sheet | null>(null);
  protected readonly showDisconnect = signal(false);
  private readonly sheetRef = viewChild(BottomSheet);

  ngOnInit(): void {
    this.service.forgetOverview();
    this.loadAll();
  }

  protected loadAll(): void {
    this.statusLoaded.set(false);
    this.statusDenied.set(false);
    // A falha de carga é desta tela (estado de erro com "Tentar de novo"): nada de toast duplicado.
    this.service.load().subscribe({
      next: (s) => {
        this.statusLoaded.set(true);
        if (s.connected) this.loadOverview();
      },
      error: (err: HttpErrorResponse) => {
        this.apiErrors.claim(err);
        if (err.status === 404) this.statusLoaded.set(true);
        this.statusDenied.set(err.status === 402 || err.status === 403);
      },
    });
  }

  protected loadOverview(): void {
    this.service.loadOverview().subscribe({
      error: (err: HttpErrorResponse) => this.apiErrors.claim(err),
    });
  }

  // ----------------------------------------------------------- aviso parado
  protected relink(): void {
    if (this.readOnly) return;
    if (this.webhookBusy()) return;
    this.webhookError.set(null);
    this.webhookRetryFailed.set(false);
    this.service.reregisterWebhook().subscribe({
      next: (status) => {
        if (this.isRegistered(status)) {
          this.notifications.push('success', 'Aviso do Asaas religado.');
          this.loadOverview();
        } else {
          // 200 com FAILED: o Asaas recusou de novo. O motivo novo já está no status.
          this.webhookRetryFailed.set(true);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.webhookError.set(
          this.apiErrors.messageFor(err, 'Não deu para religar agora. Tente de novo.'),
        );
      },
    });
  }

  private isRegistered(status: AsaasIntegrationStatus): boolean {
    if (status.webhookStatus) return status.webhookStatus === 'REGISTERED';
    return status.webhookAutoConfigured === true;
  }

  // ---------------------------------------------------------------- ligar
  protected submitConnect(): void {
    if (this.readOnly) return;
    if (this.saving()) return;
    const check = this.keyCheck();
    if (!check.ok || !check.environment) return;
    const environment = check.environment;
    this.connectError.set(null);
    this.service.connect({ accessToken: this.keyControl.value.trim(), environment }).subscribe({
      next: (status) => {
        const storedInactive =
          status.activeEnvironment !== undefined && status.activeEnvironment !== environment;
        if (status.webhookStatus === 'FAILED') {
          this.notifications.push(
            'warning',
            'Asaas ligado, mas o aviso de pagamento não foi registrado. Veja o caminho do dinheiro.',
          );
        } else if (storedInactive) {
          this.notifications.push(
            'success',
            'Chave de testes guardada. Troque o ambiente no card Ambiente.',
          );
        } else {
          this.notifications.push('success', 'Asaas ligado.');
        }
        this.keyControl.reset('');
        this.closeSheet();
        if (status.connected) this.loadOverview();
      },
      error: (err: HttpErrorResponse) => {
        this.apiErrors.claim(err);
        this.connectError.set(
          err.status === 400
            ? 'O Asaas não aceitou essa chave. Confira se copiou a chave inteira.'
            : this.apiErrors.messageFor(err, 'Não deu para conectar. Tente de novo.'),
        );
      },
    });
  }

  // ---------------------------------------------------------------- menu ⋮
  protected openMenu(): void {
    this.sheet.set('menu');
  }

  protected closeSheet(): void {
    const ref = this.sheetRef();
    if (ref) ref.requestClose(true);
    else this.sheet.set(null);
  }

  protected onSheetClosed(): void {
    this.sheet.set(null);
  }

  protected testConnection(): void {
    this.closeSheet();
    this.service.load().subscribe({
      next: (s) => {
        if (!s.connected) return;
        this.service.loadOverview().subscribe({
          next: (ov) => {
            // Resposta parcial (`asaasError` preenchido) é problema, não sucesso.
            if (ov.asaas && ov.asaasError === null) {
              this.notifications.push('success', 'O Asaas respondeu. Conexão em dia.');
            } else if (ov.asaasError === 'UNAUTHORIZED') {
              this.notifications.push('warning', 'O Asaas recusou a chave guardada.');
            } else {
              this.notifications.push(
                'warning',
                'O Asaas respondeu só em parte. Tente de novo em instantes.',
              );
            }
          },
          error: (err: HttpErrorResponse) => this.apiErrors.claim(err),
        });
      },
      error: (err: HttpErrorResponse) => this.apiErrors.claim(err),
    });
  }

  protected openChangeKey(): void {
    if (this.readOnly) return;
    this.keyControl.reset('');
    this.connectError.set(null);
    this.sheet.set('change-key');
  }

  protected openHowTo(): void {
    this.sheet.set('how-to');
  }

  protected askDisconnect(): void {
    if (this.readOnly) return;
    this.closeSheet();
    this.showDisconnect.set(true);
  }

  protected cancelDisconnect(): void {
    if (this.saving()) return;
    this.showDisconnect.set(false);
  }

  protected confirmDisconnect(): void {
    this.service.disconnect().subscribe({
      next: () => {
        this.showDisconnect.set(false);
        this.notifications.push('success', 'Asaas desligado.');
      },
      error: (err: HttpErrorResponse) => {
        this.showDisconnect.set(false);
        this.apiErrors.claim(err);
        this.notifications.push(
          'error',
          this.apiErrors.messageFor(err, 'Não deu para desligar. Tente de novo.'),
        );
      },
    });
  }

  // -------------------------------------------------------------- ambiente
  protected chooseEnvironment(target: AsaasEnvironment): void {
    if (this.readOnly) return;
    if (this.switching() || target === this.activeEnv()) return;
    this.switchBlocked.set(null);
    this.switchError.set(null);
    const stored = this.status()?.environments?.some((e) => e.environment === target) ?? false;
    if (!stored) {
      this.switchError.set(
        target === 'SANDBOX'
          ? 'Não há chave de testes guardada. Guarde uma em Trocar a chave, no menu ⋮.'
          : 'Não há chave de produção guardada. Guarde uma em Trocar a chave, no menu ⋮.',
      );
      return;
    }
    const open = this.overview()?.openCharges;
    if (open && open.charges > 0) {
      this.switchBlocked.set(this.blockedCopy(open.charges, open.rentals));
      return;
    }
    this.switchTarget.set(target);
    this.sheet.set('confirm-switch');
  }

  protected confirmSwitch(): void {
    const target = this.switchTarget();
    if (!target || this.switching()) return;
    this.service.switchEnvironment(target).subscribe({
      next: () => {
        this.closeSheet();
        this.notifications.push(
          'success',
          target === 'SANDBOX'
            ? 'Agora as cobranças vão para o Asaas de testes.'
            : 'Produção de volta: as cobranças são reais.',
        );
        this.loadOverview();
      },
      error: (err: HttpErrorResponse) => {
        this.apiErrors.claim(err);
        this.closeSheet();
        const parsed = parseApiError(err);
        if (parsed.code === ASAAS_SWITCH_CODES.openCharges) {
          const open = this.overview()?.openCharges;
          this.switchBlocked.set(
            open && open.charges > 0
              ? this.blockedCopy(open.charges, open.rentals)
              : (parsed.message ?? 'Não dá para trocar agora: há cobranças abertas no Asaas.'),
          );
          this.loadOverview();
          return;
        }
        this.switchError.set(
          this.apiErrors.messageFor(err, 'Não deu para trocar agora. Tente de novo.'),
        );
      },
    });
  }

  private blockedCopy(charges: number, rentals: number): string {
    return (
      `Não dá para trocar agora: há ${plural(charges, 'cobrança aberta', 'cobranças abertas')} no Asaas, ` +
      `em ${plural(rentals, 'aluguel', 'aluguéis')}. Conclua ou exclua esses aluguéis primeiro.`
    );
  }

  private envNote(env: AsaasEnvironment): string {
    const row = this.status()?.environments?.find((e) => e.environment === env);
    if (!row) return 'sem chave';
    // `connectedAt` é UTC sem sufixo (regra de `utils/server-time`): converte antes de mostrar o dia.
    const at = parseServerTime(row.connectedAt);
    const since = at ? ` desde ${formatDayMonth(at)}` : '';
    return row.active ? `em uso${since}` : `guardada${since}`;
  }
}
