import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AlertBanner } from '../alert-banner/alert-banner';
import { FilterChipGroup, FilterChipOption } from '../filter-chip-group/filter-chip-group';
import { AlertsService } from '../../services/alerts.service';
import { AlertSettingsService } from '../../services/alert-settings.service';
import { ApiErrorService } from '../../services/api-error.service';
import {
  AlertWindow,
  DOCUMENT_ALERTS_PAGE_SIZE,
  DocumentAlert,
  NotificationSeverity,
  NotificationType,
} from '../../types/notification-feed.types';
import { alertWindowLabel, formatAlertWindows, sortWindowsAsc } from '../../utils/alert-windows';

/** Chip de filtro por tipo de documento. `'ALL'` é o chip "Todos". */
type TypeChip = FilterChipOption<NotificationType | 'ALL'>;

const TYPE_CHIPS: readonly TypeChip[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'CNH_DUE_SOON', label: 'CNH' },
  { value: 'LICENSING_DUE_SOON', label: 'CRLV' },
  { value: 'IPVA_DUE_SOON', label: 'IPVA' },
  { value: 'INSURANCE_DUE_SOON', label: 'Seguro' },
  { value: 'FINANCING_INSTALLMENT_DUE', label: 'Financiamento' },
];

/** Prazo como texto em fundo tingido (sem bolinha), no tom da severidade. */
const SEVERITY_CHIP: Record<NotificationSeverity, string> = {
  DANGER: 'bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300',
  WARNING: 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200',
  INFO: 'bg-surface-sunken text-fg-muted',
};

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  DANGER: 'Crítico',
  WARNING: 'Atenção',
  INFO: 'Informativo',
};

/** Seção da lista, na ordem fixa de urgência (a mesma que a página `/alertas` usava). */
export interface DueAlertGroup {
  key: string;
  label: string;
  /** Data ao lado de "Vence hoje"/"Vence amanhã": o "hoje" é o do backend, em UTC. */
  dateHint: string | null;
  alerts: DocumentAlert[];
}

/**
 * Aba **Vencimentos** do sino — o que a página `/alertas` mostrava, dentro do painel:
 * janela de vencimento pelos chips da empresa (`/companies/current/alert-settings`),
 * filtro por tipo, grupos por urgência com contagem, detalhes por item e "Carregar mais"
 * no lugar da paginação (mesma fonte: `GET /v1/alerts/documents`, 20 por página).
 *
 * Carregada sob demanda (`@defer` no sino): não pesa no pacote inicial.
 *
 * O filtro por tipo é local, como era na página — o backend não tem parâmetro de tipo —,
 * então ele recorta só o que já foi carregado, e a aba diz isso enquanto houver mais.
 */
@Component({
  selector: 'app-due-alerts-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AlertBanner, FilterChipGroup],
  templateUrl: './due-alerts-panel.html',
})
export class DueAlertsPanel implements OnInit {
  private readonly alertsService = inject(AlertsService);
  private readonly alertSettings = inject(AlertSettingsService);
  private readonly apiErrors = inject(ApiErrorService);

  /** Um item foi escolhido: o sino fecha antes de a página abrir. */
  readonly selected = output<void>();

  protected readonly typeChips = TYPE_CHIPS;

  protected readonly loading = this.alertsService.loading;
  protected readonly error = this.alertsService.error;
  protected readonly total = this.alertsService.total;
  private readonly page = this.alertsService.page;
  private readonly all = this.alertsService.documentAlerts;

  /** `null` até a configuração chegar: o backend responde pela maior janela da empresa. */
  protected readonly withinDays = signal<AlertWindow | null>(null);
  protected readonly typeFilter = signal<NotificationType | 'ALL'>('ALL');
  /** Carregando a PRÓXIMA página (a lista atual fica na tela). */
  protected readonly loadingMore = signal(false);

  protected readonly windowChips = computed<FilterChipOption<AlertWindow>[]>(() =>
    sortWindowsAsc(this.alertSettings.settings()?.windows ?? []).map((days) => ({
      value: days,
      label: alertWindowLabel(days),
    })),
  );

  protected readonly windowsSummary = computed(() => {
    const settings = this.alertSettings.settings();
    if (!settings) return '';
    const origin = settings.customized ? 'configurado pela empresa' : 'padrão do sistema';
    return `${formatAlertWindows(settings.windows)} antes do vencimento (${origin})`;
  });

  protected readonly loadedCount = computed(() => this.all().length);
  protected readonly hasMore = computed(() => this.loadedCount() < this.total());

  protected readonly filtered = computed<DocumentAlert[]>(() => {
    const type = this.typeFilter();
    const list = this.all();
    return type === 'ALL' ? list : list.filter((a) => a.type === type);
  });

  /** O filtro por tipo vale para o que já foi carregado; avisar só enquanto houver mais. */
  protected readonly typeFilterIsPartial = computed(
    () => this.typeFilter() !== 'ALL' && this.hasMore(),
  );

  /** Faixas "Próximos N dias", das janelas da empresa, limitadas à janela escolhida. */
  private readonly bucketBoundaries = computed<number[]>(() => {
    const selected = this.withinDays();
    const configured = this.alertSettings.settings()?.windows ?? [];
    const candidates = selected === null ? configured : [...configured, selected];
    const bounded = candidates.filter(
      (days) => days > 1 && (selected === null || days <= selected),
    );
    return sortWindowsAsc([...new Set(bounded)]);
  });

  protected readonly groups = computed<DueAlertGroup[]>(() => {
    const overdue: DocumentAlert[] = [];
    const today: DocumentAlert[] = [];
    const tomorrow: DocumentAlert[] = [];
    const boundaries = this.bucketBoundaries();
    const buckets = boundaries.map<DocumentAlert[]>(() => []);
    const rest: DocumentAlert[] = [];

    for (const alert of this.filtered()) {
      const days = alert.daysRemaining;
      if (days < 0) overdue.push(alert);
      else if (days === 0) today.push(alert);
      else if (days === 1) tomorrow.push(alert);
      else {
        const index = boundaries.findIndex((limit) => days <= limit);
        if (index >= 0) buckets[index].push(alert);
        else if (buckets.length > 0) buckets[buckets.length - 1].push(alert);
        else rest.push(alert);
      }
    }

    return [
      { key: 'overdue', label: 'Vencidos', dateHint: null, alerts: overdue },
      { key: 'today', label: 'Vence hoje', dateHint: this.dateHintOf(today), alerts: today },
      {
        key: 'tomorrow',
        label: 'Vence amanhã',
        dateHint: this.dateHintOf(tomorrow),
        alerts: tomorrow,
      },
      ...boundaries.map((limit, index) => ({
        key: `d${limit}`,
        label: `Próximos ${limit} dias`,
        dateHint: null,
        alerts: buckets[index],
      })),
      { key: 'rest', label: 'Próximos vencimentos', dateHint: null, alerts: rest },
    ].filter((g) => g.alerts.length > 0);
  });

  /** Carregando a primeira página (sem nada na tela ainda). */
  protected readonly firstLoad = computed(() => this.loading() && !this.loadingMore());

  protected readonly isEmpty = computed(
    () => !this.loading() && !this.error() && this.filtered().length === 0,
  );

  protected readonly liveStatus = computed(() => {
    if (this.firstLoad()) return 'Carregando vencimentos…';
    if (this.error()) return 'Não foi possível carregar os vencimentos.';
    const count = this.filtered().length;
    if (count === 0) return 'Nenhum vencimento neste período.';
    const shown = count === 1 ? '1 vencimento na lista.' : `${count} vencimentos na lista.`;
    return this.hasMore() ? `${shown} Há mais para carregar.` : shown;
  });

  ngOnInit(): void {
    this.reload();
    this.alertSettings.load().subscribe({
      next: (settings) => this.withinDays.set(Math.max(...settings.windows, 1)),
      // Sem a configuração (o gerente recebe 403) a aba continua útil: some só a régua.
      error: (err: unknown) => this.apiErrors.claim(err),
    });
  }

  protected onWindowChange(value: AlertWindow | null): void {
    if (value === null || this.withinDays() === value) return;
    this.withinDays.set(value);
    this.reload();
  }

  protected onTypeChange(value: NotificationType | 'ALL'): void {
    this.typeFilter.set(value);
  }

  protected loadMore(): void {
    if (!this.hasMore() || this.loading()) return;
    this.loadingMore.set(true);
    this.alertsService
      .listDocumentAlerts(this.withinDays(), this.page() + 1, DOCUMENT_ALERTS_PAGE_SIZE, true)
      .subscribe({
        next: () => this.loadingMore.set(false),
        error: (err: unknown) => {
          this.loadingMore.set(false);
          this.apiErrors.claim(err);
        },
      });
  }

  protected severityChip(severity: NotificationSeverity): string {
    return SEVERITY_CHIP[severity] ?? SEVERITY_CHIP.INFO;
  }

  protected severityLabel(severity: NotificationSeverity): string {
    return SEVERITY_LABEL[severity] ?? SEVERITY_LABEL.INFO;
  }

  /** "Vencido há N dias" / "Vence hoje" / "Vence amanhã" / "Vence em N dias". */
  protected daysLabel(alert: DocumentAlert): string {
    const days = alert.daysRemaining;
    if (days === 0) return 'Vence hoje';
    if (days === 1) return 'Vence amanhã';
    if (days < 0) {
      const n = Math.abs(days);
      return n === 1 ? 'Vencido há 1 dia' : `Vencido há ${n} dias`;
    }
    return `Vence em ${days} dias`;
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('pt-BR');
  }

  private dateHintOf(alerts: readonly DocumentAlert[]): string | null {
    const first = alerts[0];
    return first ? this.formatDate(first.dueDate) : null;
  }

  private reload(): void {
    this.alertsService
      .listDocumentAlerts(this.withinDays(), 0, DOCUMENT_ALERTS_PAGE_SIZE)
      .subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
  }
}
