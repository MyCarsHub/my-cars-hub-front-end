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
import { AlertsService } from '../../services/alerts.service';
import { ApiErrorService } from '../../services/api-error.service';
import {
  AlertWindow,
  DOCUMENT_ALERTS_CAP,
  DocumentAlert,
  NotificationSeverity,
  NotificationType,
} from '../../types/notification-feed.types';

/** Chip de filtro por tipo de documento. `'ALL'` é o chip "Todos". */
interface TypeChip {
  value: NotificationType | 'ALL';
  label: string;
}

const TYPE_CHIPS: readonly TypeChip[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'CNH_DUE_SOON', label: 'CNH' },
  { value: 'LICENSING_DUE_SOON', label: 'CRLV' },
  { value: 'INSURANCE_DUE_SOON', label: 'Seguro' },
  { value: 'FINANCING_INSTALLMENT_DUE', label: 'Financiamento' },
];

const WINDOW_OPTIONS: readonly AlertWindow[] = [1, 7, 15, 30];

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

/** Seção da página, na ordem fixa exigida pelo brief. */
export interface AlertGroup {
  key: string;
  label: string;
  alerts: DocumentAlert[];
}

/**
 * `/alertas` — vencimentos de documentos da frota agrupados por urgência.
 *
 * O backend devolve uma lista plana ordenada por `dueDate` asc e limitada a
 * 200 linhas silenciosamente; o agrupamento e o filtro por tipo são feitos
 * aqui, sobre a resposta já carregada.
 */
@Component({
  selector: 'app-alerts-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DefaultPageLayout, PageCard, AlertBanner],
  templateUrl: './alerts-page.html',
})
export class AlertsPage implements OnInit {
  private readonly alertsService = inject(AlertsService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly typeChips = TYPE_CHIPS;
  protected readonly windowOptions = WINDOW_OPTIONS;

  protected readonly loading = this.alertsService.loading;
  protected readonly error = this.alertsService.error;

  protected readonly withinDays = signal<AlertWindow>(30);
  protected readonly typeFilter = signal<NotificationType | 'ALL'>('ALL');

  private readonly all = this.alertsService.documentAlerts;

  /** A lista pode estar truncada quando vem exatamente no teto do backend. */
  protected readonly capped = computed(() => this.all().length === DOCUMENT_ALERTS_CAP);

  protected readonly filtered = computed<DocumentAlert[]>(() => {
    const type = this.typeFilter();
    const list = this.all();
    return type === 'ALL' ? list : list.filter((a) => a.type === type);
  });

  /** Seções na ordem Vencidos → 7 → 15 → 30. Grupos vazios são descartados. */
  protected readonly groups = computed<AlertGroup[]>(() => {
    const overdue: DocumentAlert[] = [];
    const in7: DocumentAlert[] = [];
    const in15: DocumentAlert[] = [];
    const in30: DocumentAlert[] = [];

    for (const alert of this.filtered()) {
      const days = alert.daysRemaining;
      if (days < 0) overdue.push(alert);
      else if (days <= 7) in7.push(alert);
      else if (days <= 15) in15.push(alert);
      else in30.push(alert);
    }

    return [
      { key: 'overdue', label: 'Vencidos', alerts: overdue },
      { key: 'd7', label: 'Próximos 7 dias', alerts: in7 },
      { key: 'd15', label: 'Próximos 15 dias', alerts: in15 },
      { key: 'd30', label: 'Próximos 30 dias', alerts: in30 },
    ].filter((g) => g.alerts.length > 0);
  });

  protected readonly isEmpty = computed(() => !this.loading() && this.filtered().length === 0);

  ngOnInit(): void {
    this.reload();
  }

  protected onWindowChange(value: AlertWindow): void {
    if (this.withinDays() === value) return;
    this.withinDays.set(value);
    this.reload();
  }

  /** Filtro por tipo é local: não refaz a requisição. */
  protected onTypeChange(value: NotificationType | 'ALL'): void {
    this.typeFilter.set(value);
  }

  /** "1 dia" / "N dias" — a janela de 1 dia não pode sair no plural. */
  protected windowLabel(option: AlertWindow): string {
    return option === 1 ? '1 dia' : `${option} dias`;
  }

  protected severityChip(severity: NotificationSeverity): string {
    return SEVERITY_CHIP[severity] ?? SEVERITY_CHIP.INFO;
  }

  protected severityLabel(severity: NotificationSeverity): string {
    return SEVERITY_LABEL[severity] ?? SEVERITY_LABEL.INFO;
  }

  /** "faltam N dias" / "vencido há N dias" / "vence hoje". */
  protected daysLabel(alert: DocumentAlert): string {
    const days = alert.daysRemaining;
    if (days === 0) return 'vence hoje';
    if (days < 0) return `vencido há ${Math.abs(days)} dia(s)`;
    return `faltam ${days} dia(s)`;
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('pt-BR');
  }

  private reload(): void {
    this.alertsService
      .listDocumentAlerts(this.withinDays())
      // O service já grava a falha no signal `error` (banner inline) — reivindica
      // o erro para a rede de segurança não disparar um toast duplicado.
      .subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
  }
}
