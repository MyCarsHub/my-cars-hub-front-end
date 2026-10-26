import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { BackLink } from '../../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import {
  FilterChipGroup,
  FilterChipOption,
} from '../../../components/filter-chip-group/filter-chip-group';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import { AdminChargeNotificationsService } from '../admin-charge-notifications.service';
import {
  AsaasNotificationsOverview,
  ChargeAsaasStatus,
  ChargeNotificationDay,
  ChargeNotificationItem,
} from '../../../types/admin-charge-notifications.types';

export type DayPreset = 'today' | 'yesterday' | 'custom';

const DAY_PRESETS: readonly FilterChipOption<DayPreset>[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'custom', label: 'Escolher' },
];

const CHIP_OK = 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200';
const CHIP_WARN = 'bg-amber-100 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200';
const CHIP_BAD = 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-200';
const CHIP_MUTED = 'bg-surface-sunken text-fg-soft';

const BRT = 'America/Sao_Paulo';

/** `YYYY-MM-DD` do dia em Brasília — o mesmo fuso em que o backend decide "hoje". */
export function brtIsoDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BRT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Soma dias a um `YYYY-MM-DD` sem passar por fuso (meio-dia UTC não vira outro dia). */
export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Aba Notificações do painel da plataforma: por dia, se os motoristas foram
 * avisados das cobranças (e-mail das 05:00 e aviso do Asaas), com o motivo de
 * quem não foi e o reenvio do e-mail. Autocontida: só usa componentes
 * existentes do admin e não mexe no shell.
 */
@Component({
  selector: 'app-admin-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackLink, DefaultPageLayout, PageCard, AlertBanner, FilterChipGroup],
  templateUrl: './admin-notifications.html',
})
export class AdminNotifications implements OnInit {
  private readonly api = inject(AdminChargeNotificationsService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly toasts = inject(NotificationService);

  protected readonly presets = DAY_PRESETS;
  protected readonly preset = signal<DayPreset>('today');
  protected readonly customDate = signal<string>('');
  protected readonly todayIso = signal<string>(brtIsoDate(new Date()));
  protected readonly minDate = computed(() => shiftIsoDate(this.todayIso(), -90));

  protected readonly day = signal<ChargeNotificationDay | null>(null);
  protected readonly dayLoading = signal(false);
  protected readonly dayError = signal<string | null>(null);

  protected readonly asaas = signal<AsaasNotificationsOverview | null>(null);
  protected readonly asaasLoading = signal(false);
  protected readonly asaasError = signal<string | null>(null);

  protected readonly companyFilter = signal<string>('');
  protected readonly onlyNotNotified = signal(false);

  /** Cobranças com reenvio em curso: o botão fica travado (clique duplo não sai). */
  protected readonly resending = signal<ReadonlySet<string>>(new Set());
  /** Resultado do último reenvio por cobrança, mostrado no próprio cartão. */
  protected readonly resendMessages = signal<Readonly<Record<string, string>>>({});

  protected readonly selectedDate = computed<string>(() => {
    switch (this.preset()) {
      case 'yesterday':
        return shiftIsoDate(this.todayIso(), -1);
      case 'custom':
        return this.customDate() || this.todayIso();
      default:
        return this.todayIso();
    }
  });

  protected readonly summary = computed(() => this.day()?.summary ?? null);
  protected readonly companies = computed(() => this.day()?.companies ?? []);

  protected readonly items = computed<ChargeNotificationItem[]>(() => {
    const all = this.day()?.items ?? [];
    const company = this.companyFilter();
    const only = this.onlyNotNotified();
    return all.filter(
      (i) => (!company || i.companyId === company) && (!only || !i.notified),
    );
  });

  protected readonly hasFilters = computed(
    () => !!this.companyFilter() || this.onlyNotNotified(),
  );

  ngOnInit(): void {
    this.loadDay();
    this.loadAsaas();
  }

  protected setPreset(value: DayPreset): void {
    if (value === 'custom' && !this.customDate()) {
      this.customDate.set(this.todayIso());
    }
    this.preset.set(value);
    this.loadDay();
  }

  protected onCustomDate(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (!value) return;
    this.customDate.set(value);
    this.preset.set('custom');
    this.loadDay();
  }

  protected onCompanyFilter(event: Event): void {
    this.companyFilter.set((event.target as HTMLSelectElement).value);
  }

  protected selectCompany(companyId: string): void {
    this.companyFilter.set(this.companyFilter() === companyId ? '' : companyId);
  }

  protected onOnlyNotNotified(event: Event): void {
    this.onlyNotNotified.set((event.target as HTMLInputElement).checked);
  }

  protected clearFilters(): void {
    this.companyFilter.set('');
    this.onlyNotNotified.set(false);
  }

  protected reloadDay(): void {
    this.loadDay();
  }

  protected reloadAsaas(): void {
    this.loadAsaas();
  }

  protected isResending(chargeId: string): boolean {
    return this.resending().has(chargeId);
  }

  protected resendMessage(chargeId: string): string | null {
    return this.resendMessages()[chargeId] ?? null;
  }

  protected resend(item: ChargeNotificationItem): void {
    if (!item.resend.allowed || this.isResending(item.chargeId)) return;
    this.resending.update((s) => new Set(s).add(item.chargeId));
    this.api.resendEmail(item.chargeId).subscribe({
      next: (res) => {
        this.finishResend(item.chargeId, res.message);
        if (res.outcome === 'SENT') {
          this.toasts.success(`E-mail reenviado para ${item.driverFirstName}.`);
          this.loadDay();
        } else {
          this.toasts.error(res.message);
        }
      },
      error: (err: HttpErrorResponse) => {
        const message = this.apiErrors.messageFor(
          err,
          'Não foi possível reenviar o e-mail. Tente novamente.',
        );
        this.finishResend(item.chargeId, message);
      },
    });
  }

  // ------------------------------------------------------------ apresentação

  protected emailChip(item: ChargeNotificationItem): string {
    switch (item.email.state) {
      case 'SENT':
        return CHIP_OK;
      case 'SKIPPED':
        return CHIP_WARN;
      case 'NOT_RECORDED':
        return item.email.reason === 'Aguardando o envio das 05:00' ? CHIP_MUTED : CHIP_BAD;
      default:
        return CHIP_BAD;
    }
  }

  protected asaasChip(status: { state: string; outdatedPolicy?: boolean }): string {
    if (status.state === 'CONFIGURED') return status.outdatedPolicy ? CHIP_WARN : CHIP_OK;
    if (status.state === 'PARTIAL') return CHIP_WARN;
    if (status.state === 'NOT_APPLICABLE') return CHIP_MUTED;
    return CHIP_BAD;
  }

  protected channels(status: { email: boolean; sms: boolean; whatsapp: boolean }): string {
    const out: string[] = [];
    if (status.email) out.push('E-mail');
    if (status.sms) out.push('SMS');
    if (status.whatsapp) out.push('WhatsApp');
    return out.length ? out.join(' · ') : 'Nenhum canal';
  }

  protected asaasSchedule(status: ChargeAsaasStatus): string | null {
    if (!status.dueDayOn) return null;
    return status.overdueD1On ? 'No dia do vencimento + D+1' : 'No dia do vencimento';
  }

  protected chargeStatusLabel(status: string): string {
    switch (status) {
      case 'PENDING':
        return 'Em aberto';
      case 'PAST_DUE':
        return 'Vencida';
      case 'FAILED':
        return 'Falhou no Asaas';
      case 'PAID':
        return 'Paga';
      case 'CANCELED':
        return 'Cancelada';
      default:
        return status;
    }
  }

  protected resendOutcomeLabel(outcome: string, confirmed: boolean): string {
    if (outcome === 'SENT') return confirmed ? 'enviado (confirmado pelo provedor)' : 'enviado';
    if (outcome === 'FAILED') return 'falhou';
    return 'em andamento';
  }

  protected formatCents(cents: number | null): string {
    if (cents === null || cents === undefined) return '—';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      cents / 100,
    );
  }

  /** `YYYY-MM-DD` → `25/10/2026`, sem passar por fuso. */
  protected formatIsoDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return y && m && d ? `${d}/${m}/${y}` : '—';
  }

  protected formatTime(value: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      timeZone: BRT,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // ----------------------------------------------------------------- dados

  private finishResend(chargeId: string, message: string): void {
    this.resending.update((s) => {
      const next = new Set(s);
      next.delete(chargeId);
      return next;
    });
    this.resendMessages.update((m) => ({ ...m, [chargeId]: message }));
  }

  private loadDay(): void {
    const date = this.selectedDate();
    this.dayLoading.set(true);
    this.dayError.set(null);
    this.api.loadDay({ date }).subscribe({
      next: (res) => {
        this.day.set(res);
        this.dayLoading.set(false);
        if (this.companyFilter() && !res.companies.some((c) => c.companyId === this.companyFilter())) {
          this.companyFilter.set('');
        }
      },
      error: (err: HttpErrorResponse) => {
        this.day.set(null);
        this.dayLoading.set(false);
        this.dayError.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar as notificações do dia.'),
        );
      },
    });
  }

  private loadAsaas(): void {
    this.asaasLoading.set(true);
    this.asaasError.set(null);
    this.api.loadAsaas().subscribe({
      next: (res) => {
        this.asaas.set(res);
        this.asaasLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.asaas.set(null);
        this.asaasLoading.set(false);
        this.asaasError.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar os avisos do Asaas.'),
        );
      },
    });
  }
}
