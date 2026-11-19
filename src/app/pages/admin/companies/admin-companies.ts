import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import type { FilterChipOption } from '../../../components/filter-chip-group/filter-chip-group';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import {
  DataList,
  DataListActions,
  DataListCell,
  type DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import { buildCsv, downloadCsv } from '../../../components/lists/data-list/data-list-csv';
import { ListToolbar } from '../../../components/lists/list-toolbar/list-toolbar';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { TrialExtensionResponse } from '../../../services/admin-trial.service';
import { AdminCompaniesService } from '../admin-companies.service';
import { AdminSegmentsService } from '../segments/admin-segments.service';
import { ContactRevealActions } from '../contact/contact-reveal-actions';
import { RegisterContactSheet } from '../contact/register-contact-sheet';
import { TrialExtensionSheet } from './trial-extension-sheet';
import { TodayStrip, type CompanyActionTarget } from './today-strip';
import type { AdminCompanyListItem } from '../../../types/admin-company.types';
import {
  COMPANY_SEGMENTS,
  type CompanySegment,
  type RegisterContactResponse,
  type TodayList,
} from '../../../types/admin-segments.types';
import {
  SEGMENT_CHIPS,
  SEGMENT_QUERY_PARAM,
  deadlineText,
  fleetText,
  isTrialSegment,
  lastContactText,
  lastSignalText,
  nextActionTitle,
  segmentChip,
  trialActionLabel,
  whatsAppMessage,
} from '../segments/segment-copy';

type SegmentFilter = 'ALL' | CompanySegment;

const PAGE_SIZE = 20;

/** Rótulos das pílulas, na ordem do desenho de 18/11 ("Todas" é a padrão). */
const SEGMENT_FILTERS: readonly SegmentFilter[] = ['ALL', ...COMPANY_SEGMENTS];

/**
 * Empresas (rodada de 18/11/2026, desenho `Adm18Empresas`): "Hoje, para agir" no topo, pílulas de
 * segmento com contagem no lugar das abas "Todas | Converter testes", e a lista no `app-data-list`
 * (tabela a partir de 1024px, cartões abaixo). Cada linha mostra o segmento, o último sinal REAL
 * (ações do admin não contam), o prazo, a frota e a próxima ação sugerida; toda ação mora no ⋮:
 * WhatsApp com mensagem pronta, Registrar contato, Estender/Reabrir teste e Ver detalhe.
 *
 * As oito contas internas ficam fora das pílulas (o servidor não as conta); o ⋮ do topo troca a
 * lista para elas e exporta o que está na tela.
 */
@Component({
  selector: 'app-admin-companies',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    ActionsMenu,
    DataList,
    DataListCell,
    DataListActions,
    DataListMenuItem,
    ListToolbar,
    StatusChip,
    RouterLink,
    TodayStrip,
    RegisterContactSheet,
    TrialExtensionSheet,
  ],
  templateUrl: './admin-companies.html',
})
export class AdminCompanies implements OnInit {
  private readonly companiesService = inject(AdminCompaniesService);
  private readonly segmentsService = inject(AdminSegmentsService);
  private readonly reveal = inject(ContactRevealActions);
  private readonly notify = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly caps = inject(AdminCapabilitiesService);

  protected readonly companies = this.companiesService.companies;
  protected readonly loading = this.companiesService.loading;
  protected readonly total = this.companiesService.total;
  protected readonly segmentCounts = this.companiesService.segmentCounts;
  /** Falha ao CARREGAR a lista — banner inline, nunca toast. */
  protected readonly error = signal<string | null>(null);

  protected readonly search = signal<string>('');
  protected readonly segment = signal<SegmentFilter>('ALL');
  /** `true`: a lista mostra só as contas internas (fora das pílulas e da contagem). */
  protected readonly internalView = signal(false);
  protected readonly currentPage = signal(0);

  protected readonly today = signal<TodayList | null>(null);
  protected readonly todayLoading = signal(false);
  protected readonly todayError = signal<string | null>(null);

  /** Empresa do "Registrar contato" aberto; nulo = folha fechada. */
  protected readonly contactTarget = signal<CompanyActionTarget | null>(null);
  /** Empresa do "Estender teste" aberto. */
  protected readonly trialTarget = signal<(CompanyActionTarget & { trialEndsAt: string | null }) | null>(null);

  protected readonly canContact = computed(() => this.caps.can('contato.ver'));
  protected readonly canExtend = computed(() => this.caps.can('empresa.teste'));

  protected readonly columns: readonly DataListColumn<AdminCompanyListItem>[] = [
    { key: 'name', header: 'Empresa', primary: true, value: (c) => c.name },
    { key: 'segment', header: 'Segmento', value: (c) => segmentChip(c.engagement?.segment)?.label ?? '' },
    { key: 'signal', header: 'Último sinal real', value: (c) => lastSignalText(c.engagement) },
    { key: 'deadline', header: 'Prazo', value: (c) => deadlineText(c.engagement) },
    { key: 'fleet', header: 'Frota', value: (c) => fleetText(c.engagement) },
    { key: 'next', header: 'Próxima ação sugerida', value: (c) => nextActionTitle(c.engagement) ?? '—' },
  ];

  /** Sem a coluna "Segmento" na tela: o chip já mora embaixo do nome. Ela existe só no CSV. */
  protected readonly visibleColumns = this.columns.filter((c) => c.key !== 'segment');

  protected readonly rowId = (company: AdminCompanyListItem): string => company.id;
  protected readonly kebabLabel = (company: AdminCompanyListItem): string => `Ações da empresa ${company.name}`;

  /** Pílulas com a contagem do servidor; zero continua visível. */
  protected readonly segmentOptions = computed<readonly FilterChipOption<SegmentFilter>[]>(() => {
    const counts = this.segmentCounts();
    return SEGMENT_FILTERS.map((value) => ({
      value,
      label: value === 'ALL' ? 'Todas' : SEGMENT_CHIPS[value].label,
      count: counts[value] ?? null,
    }));
  });

  protected readonly totalPages = computed(() => {
    const t = this.total();
    return t <= 0 ? 1 : Math.max(1, Math.ceil(t / PAGE_SIZE));
  });

  protected readonly filtersActive = computed(() => this.search() !== '' || this.segment() !== 'ALL');

  protected readonly emptyText = computed(() => {
    if (this.internalView()) return 'Nenhuma conta interna.';
    if (this.search()) return 'Nenhuma empresa com essa busca.';
    const s = this.segment();
    if (s === 'EX_CLIENT') return 'Nenhum ex-cliente até hoje.';
    return s === 'ALL' ? 'Nenhuma empresa encontrada.' : `Nenhuma empresa em “${SEGMENT_CHIPS[s].label}”.`;
  });

  constructor() {
    effect(() => {
      const search = this.search();
      const segment = this.segment();
      const internal = this.internalView();
      const page = this.currentPage();
      this.error.set(null);
      this.companiesService
        .load({
          search,
          segment: internal || segment === 'ALL' ? null : segment,
          internal,
          page,
          size: PAGE_SIZE,
        })
        .subscribe({
          error: (err: HttpErrorResponse) =>
            this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar as empresas. Tente novamente.')),
        });
    });
  }

  ngOnInit(): void {
    this.caps.ensureLoaded().subscribe();
    const fromUrl = this.route.snapshot?.queryParamMap?.get(SEGMENT_QUERY_PARAM);
    if (fromUrl && (COMPANY_SEGMENTS as readonly string[]).includes(fromUrl)) {
      this.segment.set(fromUrl as CompanySegment);
    }
    this.loadToday();
  }

  protected loadToday(): void {
    this.todayLoading.set(true);
    this.todayError.set(null);
    this.segmentsService
      .today()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.today.set(res);
          this.todayLoading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.todayLoading.set(false);
          this.todayError.set(this.apiErrors.messageFor(err, 'Não foi possível carregar a lista de hoje.'));
        },
      });
  }

  protected openCompany(company: AdminCompanyListItem): void {
    void this.router.navigate(['/admin/companies', company.id]);
  }

  /** Busca no servidor (o toolbar já espera 300ms depois da última tecla). */
  protected setSearch(value: string): void {
    const next = value.trim();
    if (next === this.search()) return;
    this.currentPage.set(0);
    this.search.set(next);
  }

  protected setSegment(value: SegmentFilter): void {
    this.currentPage.set(0);
    this.segment.set(value);
  }

  protected clearFilters(): void {
    this.currentPage.set(0);
    this.search.set('');
    this.segment.set('ALL');
  }

  protected toggleInternalView(): void {
    this.currentPage.set(0);
    this.internalView.update((v) => !v);
  }

  protected goToPage(page: number): void {
    if (page < 0 || page >= this.totalPages()) return;
    this.currentPage.set(page);
  }

  /** CSV do que está na tela (o segmento escolhido), com o segmento numa coluna própria. */
  protected exportList(): void {
    const name = this.internalView()
      ? 'empresas-internas'
      : this.segment() === 'ALL'
        ? 'empresas'
        : `empresas-${SEGMENT_CHIPS[this.segment() as CompanySegment].label.toLowerCase().replace(/\s+/g, '-')}`;
    downloadCsv(
      name,
      buildCsv(
        this.columns.map((c) => ({ key: c.key, header: c.header, kind: c.kind, value: c.value })),
        this.companies(),
      ),
    );
  }

  // ---- Linha ---------------------------------------------------------------------------

  protected chip(company: AdminCompanyListItem) {
    return segmentChip(company.engagement?.segment);
  }

  protected signalText(company: AdminCompanyListItem): string {
    return lastSignalText(company.engagement);
  }

  protected deadline(company: AdminCompanyListItem): string {
    return deadlineText(company.engagement);
  }

  protected fleet(company: AdminCompanyListItem): string {
    return fleetText(company.engagement);
  }

  protected nextAction(company: AdminCompanyListItem): string {
    return nextActionTitle(company.engagement) ?? '—';
  }

  protected contactLine(company: AdminCompanyListItem): string | null {
    return lastContactText(company.engagement);
  }

  protected message(company: AdminCompanyListItem): string | null {
    return whatsAppMessage(company.engagement, company.name, company.ownerName);
  }

  protected isTrial(company: AdminCompanyListItem): boolean {
    return isTrialSegment(company.engagement?.segment);
  }

  protected trialLabel(company: AdminCompanyListItem): string {
    return trialActionLabel(company.engagement?.segment);
  }

  protected isTrialTarget(target: CompanyActionTarget): boolean {
    return isTrialSegment(target.engagement?.segment);
  }

  protected targetOf(company: AdminCompanyListItem): CompanyActionTarget {
    return {
      companyId: company.id,
      name: company.name,
      ownerName: company.ownerName ?? null,
      engagement: company.engagement ?? null,
    };
  }

  // ---- Ações (⋮) -----------------------------------------------------------------------

  protected whatsApp(target: CompanyActionTarget): void {
    void this.reveal.whatsApp(
      'COMPANY',
      target.companyId,
      whatsAppMessage(target.engagement, target.name, target.ownerName),
    );
  }

  protected openContact(target: CompanyActionTarget): void {
    this.contactTarget.set(target);
  }

  protected closeContact(): void {
    this.contactTarget.set(null);
  }

  /** O contato tira a empresa de "Hoje, para agir": a linha troca o bloco e a fila recarrega. */
  protected onContactSaved(target: CompanyActionTarget, res: RegisterContactResponse): void {
    this.companiesService.patchEngagement(target.companyId, res.engagement);
    const ext = res.trialExtension;
    const extra = ext ? ` Teste estendido em ${ext.days} dias.` : '';
    this.notify.success(`Contato registrado.${extra}`);
    this.loadToday();
  }

  protected openTrial(target: CompanyActionTarget, trialEndsAt: string | null = null): void {
    const deadline = target.engagement?.deadline;
    const fallback = deadline && deadline.kind !== 'RENEWAL' ? deadline.at : null;
    this.trialTarget.set({ ...target, trialEndsAt: trialEndsAt ?? fallback });
  }

  protected closeTrial(): void {
    this.trialTarget.set(null);
  }

  protected onTrialExtended(res: TrialExtensionResponse): void {
    this.trialTarget.set(null);
    const email = res.emailRecipients > 0
      ? ' A empresa foi avisada por e-mail.'
      : ' A empresa não tem e-mail cadastrado para o aviso.';
    this.notify.success(`Teste estendido em ${res.days} dias.${email}`);
    this.reloadList();
    this.loadToday();
  }

  private reloadList(): void {
    this.companiesService
      .load({
        search: this.search(),
        segment: this.internalView() || this.segment() === 'ALL' ? null : (this.segment() as CompanySegment),
        internal: this.internalView(),
        page: this.currentPage(),
        size: PAGE_SIZE,
      })
      .subscribe({ error: () => undefined });
  }
}
