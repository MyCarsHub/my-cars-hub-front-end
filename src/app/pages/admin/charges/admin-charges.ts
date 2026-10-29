import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { canReceiveCharge, canRetryCharge } from './charge-action-rules';
import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import { NotificationService } from '../../../services/notification.service';
import {
  AdminChargeListItem,
  AdminChargeTab,
  AdminChargesPage,
} from '../../../types/admin-charges.types';
import { ContactActions } from '../contact/contact-actions';
import { AdminChargesService } from './admin-charges.service';
import { ChargeActionMode, ChargeActionsSheet } from './charge-actions-sheet';

const STATUS_LABELS: Record<string, string> = {
  FAILED: 'Falhou',
  PAST_DUE: 'Atrasada',
  PENDING: 'Pendente',
};

const KIND_LABELS: Record<string, string> = {
  RENTAL_TOTAL: 'Aluguel (total)',
  RENTAL_PERIOD: 'Aluguel',
  CAUCAO: 'Caução',
  OVERDUE_FEE: 'Multa por atraso',
};

/**
 * Cobranças (admin v2): cobranças que FALHARAM na emissão e as ATRASADAS, de
 * todas as empresas.
 *
 * <p>P1: ações sem impersonar, na folha {@link ChargeActionsSheet} — comparar
 * com o Asaas, recebida por fora (caução), tentar de novo (só FAILED no prazo),
 * corrigir nome do motorista e atualizar o cliente no Asaas.</p>
 *
 * <p>"Atrasado é nossa prova" (regra do dono): atrasada nunca é reemitida,
 * re-datada nem passada para falha — a tela nem oferece, e o backend recusa.</p>
 *
 * <p>Layout: cards no celular e tablet; tabela com colunas e hover a partir de 1024px.</p>
 */
@Component({
  selector: 'app-admin-charges',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DefaultPageLayout, AlertBanner, RouterLink, ContactActions, ChargeActionsSheet, ActionsMenu],
  templateUrl: './admin-charges.html',
})
export class AdminCharges implements OnInit {
  /** Lote 2A: as ações da linha seguem o papel (o servidor confere de novo). */
  protected readonly caps = inject(AdminCapabilitiesService);
  private readonly service = inject(AdminChargesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly impersonation = inject(ImpersonationService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly tab = signal<AdminChargeTab>('FAILED');
  protected readonly includeInternal = signal(false);
  protected readonly page = signal(0);
  protected readonly data = signal<AdminChargesPage | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly opening = signal<string | null>(null);
  /** Cobrança com a folha de ações aberta, e em qual ação ela abre. */
  protected readonly sheetItem = signal<AdminChargeListItem | null>(null);
  protected readonly sheetMode = signal<ChargeActionMode>('menu');

  protected readonly items = computed(() => this.data()?.content ?? []);
  protected readonly totalPages = computed(() => {
    const d = this.data();
    return d ? Math.max(1, Math.ceil(d.total / d.size)) : 1;
  });

  ngOnInit(): void {
    this.caps.ensureLoaded().subscribe();
    this.load();
  }

  protected selectTab(tab: AdminChargeTab): void {
    if (this.tab() === tab) return;
    this.tab.set(tab);
    this.page.set(0);
    this.load();
  }

  protected toggleInternal(event: Event): void {
    this.includeInternal.set((event.target as HTMLInputElement).checked);
    this.page.set(0);
    this.load();
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .list(this.tab(), this.includeInternal(), this.page())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.data.set(res);
          this.loading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar as cobranças.'));
        },
      });
  }

  /** Abre a sessão SOMENTE LEITURA da empresa já no aluguel (auditada como "ver como empresa"). */
  protected openRental(item: AdminChargeListItem): void {
    if (this.opening()) return;
    this.opening.set(item.chargeId);
    this.impersonation.start(item.companyId).subscribe({
      next: (session) => {
        this.opening.set(null);
        this.notify.info(`Você está vendo ${session.companyName} em modo somente leitura.`);
        void this.router.navigate(['/alugueis', item.rentalId]);
      },
      error: (err: HttpErrorResponse) => {
        this.opening.set(null);
        this.notify.error(this.apiErrors.messageFor(err, 'Não foi possível abrir o aluguel.'));
      },
    });
  }

  protected canReceive(item: AdminChargeListItem): boolean {
    return canReceiveCharge(item);
  }

  protected canRetry(item: AdminChargeListItem): boolean {
    return canRetryCharge(item);
  }

  /** O kebab só aparece se o papel tiver pelo menos uma ação nesta cobrança. */
  protected hasAnyAction(item: AdminChargeListItem): boolean {
    return (
      this.caps.can('asaas.comparar') ||
      this.caps.can('ver_como') ||
      (this.caps.can('cobranca.agir') && (canReceiveCharge(item) || canRetryCharge(item) || item.driverId !== null))
    );
  }

  protected openActions(item: AdminChargeListItem, mode: ChargeActionMode = 'menu'): void {
    this.sheetMode.set(mode);
    this.sheetItem.set(item);
  }

  /** "Ver aluguel" agora mora em "Mais ações": fecha a folha e abre a sessão somente leitura. */
  protected viewRentalFromSheet(item: AdminChargeListItem): void {
    this.sheetItem.set(null);
    this.openRental(item);
  }

  protected closeActions(): void {
    this.sheetItem.set(null);
  }

  /** Algo mudou (recebida por fora, gerada de novo, nome): recarrega a lista por trás da folha. */
  protected onActionChanged(): void {
    this.load();
  }

  protected statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  protected kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? kind;
  }

  protected statusChip(status: string): string {
    if (status === 'FAILED') return 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200';
    if (status === 'PAST_DUE') return 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100';
    return 'bg-surface-sunken text-fg-soft';
  }

  protected money(cents: number): string {
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  protected dueDate(iso: string | null): string {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  protected overdueLabel(item: AdminChargeListItem): string {
    const n = item.daysOverdue;
    if (n === 0) return 'vence hoje';
    if (n > 0) return n === 1 ? 'há 1 dia' : `há ${n} dias`;
    const ahead = -n;
    return ahead === 1 ? 'vence amanhã' : `vence em ${ahead} dias`;
  }

  protected tabClass(selected: boolean): string {
    const base =
      'inline-flex items-center gap-2 min-h-[44px] px-4 rounded-full text-sm font-medium whitespace-nowrap ' +
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ';
    return selected
      ? base + 'bg-primary-500 text-white'
      : base + 'border border-edge text-fg-soft hover:bg-canvas';
  }
}
