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
import { PageCard } from '../../../components/core/page-card/page-card';
import { PillTabs, type PillTabOption } from '../../../components/core/pill-tabs/pill-tabs';
import { StatusChip, type StatusChipTone } from '../../../components/core/status-chip/status-chip';
import {
  DataList,
  DataListActions,
  DataListCell,
  type DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import { ListToolbar } from '../../../components/lists/list-toolbar/list-toolbar';
import { BrlPipe } from '../../../pipes/brl.pipe';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { canCancelCharge, canReceiveCharge, canRetryCharge } from './charge-action-rules';
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
import { PersonNamePipe } from '../../../pipes/person-name.pipe';

const STATUS_LABELS: Record<string, string> = {
  FAILED: 'Falhou',
  PAST_DUE: 'Atrasada',
  PENDING: 'Pendente',
  RENEGOTIATED: 'Renegociada',
};

/** Situação = cor do chip (decisão D1): falha vermelho, atrasada âmbar, renegociada azul. */
const STATUS_TONES: Record<string, StatusChipTone> = {
  FAILED: 'red',
  PAST_DUE: 'amber',
  RENEGOTIATED: 'blue',
};

const KIND_LABELS: Record<string, string> = {
  RENTAL_TOTAL: 'Aluguel (total)',
  RENTAL_PERIOD: 'Aluguel',
  CAUCAO: 'Caução',
  OVERDUE_FEE: 'Multa por atraso',
  ADJUSTMENT: 'Ajuste',
  AGREEMENT: 'Acordo',
};

/**
 * Cobranças (admin v2): cobranças que FALHARAM na emissão e as ATRASADAS, de
 * todas as empresas.
 *
 * <p>P1: ações sem impersonar, na folha {@link ChargeActionsSheet} — comparar
 * com o Asaas, recebida por fora (também FAILED, G13), tentar de novo (só FAILED no prazo),
 * corrigir nome do motorista e atualizar o cliente no Asaas.</p>
 *
 * <p>"Atrasado é nossa prova" (regra do dono): atrasada nunca é reemitida,
 * re-datada nem passada para falha — a tela nem oferece, e o backend recusa.</p>
 *
 * <p>Layout (padrão de lista do admin, 18/11/2026): `app-page-card "Lista"` + abas com contagem
 * + `app-list-toolbar` + `app-data-list` (cartões abaixo de 1024px, tabela a partir dele, kebab
 * por linha, sem linhas entre registros). Dinheiro pelo pipe `brl`.</p>
 */
@Component({
  selector: 'app-admin-charges',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PersonNamePipe,
    BrlPipe,
    DefaultPageLayout,
    PageCard,
    PillTabs,
    StatusChip,
    ListToolbar,
    DataList,
    DataListCell,
    DataListActions,
    DataListMenuItem,
    AlertBanner,
    RouterLink,
    ContactActions,
    ChargeActionsSheet,
  ],
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

  /** Abas com a contagem do servidor (sem número enquanto a primeira resposta não chega). */
  protected readonly tabOptions = computed<PillTabOption<AdminChargeTab>[]>(() => {
    const d = this.data();
    return [
      { value: 'FAILED', label: 'Com falha', count: d?.failedCount, testId: 'tab-failed' },
      { value: 'OVERDUE', label: 'Atrasadas', count: d?.overdueCount, testId: 'tab-overdue' },
    ];
  });

  /**
   * Uma config para a tabela e para o cartão. Células com conteúdo próprio (link da empresa,
   * contato, vencimento relativo) vêm dos `dataListCell` do template; `value` alimenta o CSV.
   */
  protected readonly columns: readonly DataListColumn<AdminChargeListItem>[] = [
    { key: 'company', header: 'Empresa · motorista', primary: true, value: (c) => c.companyName },
    { key: 'kind', header: 'Tipo', value: (c) => this.kindLabel(c.kind) },
    { key: 'amount', header: 'Valor', kind: 'money-cents', end: true, value: (c) => c.amountCents },
    { key: 'due', header: 'Vencimento', value: (c) => this.dueDate(c.dueDate) },
    {
      key: 'status',
      header: 'Situação',
      kind: 'status',
      value: (c) => this.statusLabel(c.status),
      tone: (c) => STATUS_TONES[c.status] ?? 'neutral',
    },
  ];

  protected readonly rowId = (c: AdminChargeListItem): string => c.chargeId;
  /** Each kebab is named after its row, so a screen reader can tell them apart. */
  protected readonly kebabLabel = (c: AdminChargeListItem): string =>
    `Ações da cobrança de ${c.driverName ?? c.companyName}`;

  /**
   * O kebab é da lista inteira (`app-data-list`): some quando NENHUMA linha tem ação para o papel
   * (perfil Leitura). Uma linha sem ação, numa lista em que outras têm, mostra o item desabilitado.
   */
  /**
   * A row with nothing to do draws no kebab (instead of a menu holding a disabled "nenhuma ação");
   * when no row has one (the read-only profile) the actions column goes away entirely.
   */
  protected readonly rowHasActions = (item: AdminChargeListItem): boolean => this.hasAnyAction(item);
  protected readonly anyRowAction = computed(() => this.items().some((i) => this.hasAnyAction(i)));
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

  /** FEAT-0553: "Cancelar cobrança" só para o Dono (cobranca.cancelar) e cobrança em aberto; falha fechada. */
  protected canCancel(item: AdminChargeListItem): boolean {
    return this.caps.can('cobranca.cancelar') && canCancelCharge(item);
  }

  /** O papel tem pelo menos uma ação nesta cobrança (senão a linha fica sem kebab). */
  protected hasAnyAction(item: AdminChargeListItem): boolean {
    return (
      this.canCancel(item) ||
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

}
