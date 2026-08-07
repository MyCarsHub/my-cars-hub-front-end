import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import {
  FilterChipGroup,
  FilterChipOption,
} from '../../components/filter-chip-group/filter-chip-group';
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

const SEVERITY_CHIP: Record<NotificationSeverity, string> = {
  DANGER: 'bg-rose-100 text-rose-700',
  WARNING: 'bg-amber-100 text-amber-800',
  INFO: 'bg-sky-100 text-sky-800',
};

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  DANGER: 'Crítico',
  WARNING: 'Atenção',
  INFO: 'Informativo',
};

/**
 * Seção da página, na ordem fixa de urgência.
 *
 * `dateHint` só é preenchido nos grupos "Vence hoje" e "Vence amanhã": esses
 * dois rótulos são relativos e o "hoje" que os define é o do backend, em UTC.
 * Mostrar a data ao lado torna o rótulo verificável em vez de enganoso — ver o
 * comentário de `DocumentAlert` em `types/notification-feed.types.ts`.
 */
export interface AlertGroup {
  key: string;
  label: string;
  dateHint: string | null;
  alerts: DocumentAlert[];
}

/**
 * `/alertas` — vencimentos de documentos da frota agrupados por urgência.
 *
 * O backend devolve o envelope paginado (`content`/`page`/`size`/`total`)
 * ordenado por `dueDate` asc; a página navega entre as páginas pelo servidor e
 * agrupa localmente o que está na página corrente.
 *
 * O filtro por tipo é local — o backend não tem parâmetro de tipo —, então ele
 * recorta apenas a página visível. A UI diz isso explicitamente quando há mais
 * de uma página, para o usuário não ler "1 resultado" como "1 na frota".
 */
@Component({
  selector: 'app-alerts-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DefaultPageLayout, PageCard, AlertBanner, FilterChipGroup],
  templateUrl: './alerts-page.html',
})
export class AlertsPage implements OnInit {
  private readonly alertsService = inject(AlertsService);
  private readonly alertSettings = inject(AlertSettingsService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly typeChips = TYPE_CHIPS;

  protected readonly loading = this.alertsService.loading;
  protected readonly error = this.alertsService.error;
  protected readonly page = this.alertsService.page;
  protected readonly size = this.alertsService.size;
  protected readonly total = this.alertsService.total;

  /**
   * `null` = ainda sem a configuração da empresa; a requisição sai sem
   * `withinDays` e o backend responde com a maior janela configurada. Assim que
   * a configuração chega, o chip correspondente fica marcado — sem refazer a
   * busca, porque é exatamente o mesmo recorte.
   */
  protected readonly withinDays = signal<AlertWindow | null>(null);
  protected readonly typeFilter = signal<NotificationType | 'ALL'>('ALL');

  /** Atalhos de janela derivados da empresa, em ordem crescente. */
  protected readonly windowChips = computed<FilterChipOption<AlertWindow>[]>(() =>
    sortWindowsAsc(this.alertSettings.settings()?.windows ?? []).map((days) => ({
      value: days,
      label: alertWindowLabel(days),
    })),
  );

  /** "30, 15, 7 e 1 dia" + a distinção padrão × personalizado, para leitura. */
  protected readonly windowsSummary = computed(() => {
    const settings = this.alertSettings.settings();
    if (!settings) return '';
    const origin = settings.customized ? 'configurado pela empresa' : 'padrão do sistema';
    return `${formatAlertWindows(settings.windows)} antes do vencimento (${origin})`;
  });

  private readonly all = this.alertsService.documentAlerts;

  protected readonly totalPages = computed(() => {
    const total = this.total();
    const size = this.size();
    return total === 0 || size === 0 ? 1 : Math.ceil(total / size);
  });

  /** 1-based, só para exibição — o backend continua sendo 0-based. */
  protected readonly pageNumber = computed(() => this.page() + 1);

  protected readonly hasPrev = computed(() => this.page() > 0);
  protected readonly hasNext = computed(() => this.page() + 1 < this.totalPages());

  protected readonly filtered = computed<DocumentAlert[]>(() => {
    const type = this.typeFilter();
    const list = this.all();
    return type === 'ALL' ? list : list.filter((a) => a.type === type);
  });

  /**
   * O filtro por tipo roda sobre a página carregada, não sobre a frota. Só
   * avisamos quando existe mais de uma página — com uma só, local e total
   * coincidem e o aviso seria ruído.
   */
  protected readonly typeFilterIsPartial = computed(
    () => this.typeFilter() !== 'ALL' && this.totalPages() > 1,
  );

  /**
   * Faixas de "Próximos N dias", derivadas das janelas da empresa e limitadas à
   * janela selecionada. Antes eram 7/15/30 fixos, o que passaria a mentir para
   * quem configurasse outra coisa (uma empresa com janela de 90 dias veria tudo
   * empilhado em "Próximos 30 dias").
   *
   * A janela selecionada entra sempre, mesmo que não seja uma janela
   * configurada, para nenhum item ficar fora das faixas.
   */
  private readonly bucketBoundaries = computed<number[]>(() => {
    const selected = this.withinDays();
    const configured = this.alertSettings.settings()?.windows ?? [];
    const candidates = selected === null ? configured : [...configured, selected];
    const bounded = candidates.filter(
      (days) => days > 1 && (selected === null || days <= selected),
    );
    return sortWindowsAsc([...new Set(bounded)]);
  });

  /**
   * Seções na ordem Vencidos → hoje → amanhã → faixas crescentes. Grupos vazios
   * são descartados. `daysRemaining` vem pronto do backend — a UI não recalcula
   * prazo a partir do relógio do navegador.
   */
  protected readonly groups = computed<AlertGroup[]>(() => {
    const overdue: DocumentAlert[] = [];
    const today: DocumentAlert[] = [];
    const tomorrow: DocumentAlert[] = [];

    const boundaries = this.bucketBoundaries();
    const buckets = boundaries.map<DocumentAlert[]>(() => []);
    /** Sem configuração conhecida, tudo que sobra cai numa faixa genérica. */
    const rest: DocumentAlert[] = [];

    for (const alert of this.filtered()) {
      const days = alert.daysRemaining;
      if (days < 0) {
        overdue.push(alert);
      } else if (days === 0) {
        today.push(alert);
      } else if (days === 1) {
        tomorrow.push(alert);
      } else {
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

  protected readonly isEmpty = computed(() => !this.loading() && this.filtered().length === 0);

  /**
   * Texto da região `role="status"`. Trocar um chip ou paginar substitui a
   * lista inteira sem mover foco nem rota — sem isso a mudança era invisível
   * para leitor de tela (WCAG 4.1.3).
   */
  protected readonly liveStatus = computed(() => {
    if (this.loading()) return 'Carregando vencimentos…';
    if (this.error()) return 'Não foi possível carregar os vencimentos.';
    const count = this.filtered().length;
    const pages = this.totalPages();
    const suffix = pages > 1 ? ` Página ${this.pageNumber()} de ${pages}.` : '';
    if (count === 0) return `Nenhum vencimento neste período.${suffix}`;
    if (count === 1) return `1 vencimento nesta página.${suffix}`;
    return `${count} vencimentos nesta página.${suffix}`;
  });

  /**
   * A lista sai IMEDIATAMENTE sem `withinDays` — o backend já responde pela
   * maior janela da empresa —, e a configuração chega em paralelo só para
   * montar os atalhos e marcar o chip correspondente. Encadear as duas
   * requisições atrasaria a tela sem mudar o resultado.
   */
  ngOnInit(): void {
    this.reload(0);
    this.alertSettings.load().subscribe({
      next: (settings) => this.withinDays.set(Math.max(...settings.windows, 1)),
      // Sem a configuração a tela continua útil: some só a régua de atalhos.
      error: (err: unknown) => this.apiErrors.claim(err),
    });
  }

  /**
   * `null` só existe até a configuração da empresa chegar; o grupo de chips
   * herda esse tipo do `value`, então a assinatura o acompanha e ignora o caso.
   */
  protected onWindowChange(value: AlertWindow | null): void {
    if (value === null || this.withinDays() === value) return;
    this.withinDays.set(value);
    this.reload(0);
  }

  /** Filtro por tipo é local: não refaz a requisição. */
  protected onTypeChange(value: NotificationType | 'ALL'): void {
    this.typeFilter.set(value);
  }

  protected prev(): void {
    if (this.hasPrev()) this.reload(this.page() - 1);
  }

  protected next(): void {
    if (this.hasNext()) this.reload(this.page() + 1);
  }

  protected severityChip(severity: NotificationSeverity): string {
    return SEVERITY_CHIP[severity] ?? SEVERITY_CHIP.INFO;
  }

  protected severityLabel(severity: NotificationSeverity): string {
    return SEVERITY_LABEL[severity] ?? SEVERITY_LABEL.INFO;
  }

  /** "faltam N dias" / "vencido há N dias" / "vence hoje" / "vence amanhã". */
  protected daysLabel(alert: DocumentAlert): string {
    const days = alert.daysRemaining;
    if (days === 0) return 'vence hoje';
    if (days === 1) return 'vence amanhã';
    if (days < 0) return `vencido há ${Math.abs(days)} dia(s)`;
    return `faltam ${days} dia(s)`;
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('pt-BR');
  }

  /**
   * Todos os itens de um bucket relativo compartilham a mesma `dueDate` (o
   * backend deriva `daysRemaining` dela), então o primeiro item basta.
   */
  private dateHintOf(alerts: readonly DocumentAlert[]): string | null {
    const first = alerts[0];
    return first ? this.formatDate(first.dueDate) : null;
  }

  private reload(page: number): void {
    this.alertsService
      .listDocumentAlerts(this.withinDays(), page, DOCUMENT_ALERTS_PAGE_SIZE)
      // O service já grava a falha no signal `error` (banner inline) — reivindica
      // o erro para a rede de segurança não disparar um toast duplicado.
      .subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
  }
}
