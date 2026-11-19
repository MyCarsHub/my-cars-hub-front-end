import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  ViewEncapsulation,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, catchError, from, mergeMap } from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BackLink } from '../../../components/core/back-link/back-link';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { PageCard } from '../../../components/core/page-card/page-card';
import { StatusChip, StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { FilterChipOption } from '../../../components/filter-chip-group/filter-chip-group';
import { KpiCard } from '../../../components/kpi-card/kpi-card';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import {
  DataList,
  DataListActions,
  DataListCell,
  DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import { ListFilterSelect, ListToolbar } from '../../../components/lists/list-toolbar/list-toolbar';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { NotificationService } from '../../../services/notification.service';
import { AdminCoupon, CouponCompany } from '../../../types/admin-coupon.types';
import { PlanResponse } from '../../../types/billing.types';
import { AdminCouponsService } from './admin-coupons.service';
import {
  CouponStatusView,
  copyCouponCode,
  couponBrl,
  couponErrorMessage,
  couponPlanName,
  couponStatus,
  couponValidity,
  createdLabel,
  discountLabel,
  durationText,
  isAllPlans,
  kindLabel,
} from './coupon-copy';
import { monthlySavingsLine } from './coupon-plan-prices';
import {
  CouponSituation,
  SituationFilter,
  TypeFilter,
  couponSituation,
  filterCoupons,
  situationCounts,
  usesProgress,
  usesSpaced,
} from './coupon-list';
import { computeCouponStats, monthlyPriceByPlan } from './coupon-stats';
import { CouponDetail } from './coupon-detail';
import { CouponShare } from './coupon-share';
import { CouponSheet } from './coupon-sheet';

const TYPE_OPTIONS: readonly FilterChipOption<TypeFilter>[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'OPEN_CODE', label: 'Para qualquer pessoa' },
  { value: 'PROMOTION_CODE', label: 'Código de empresa' },
  { value: 'APPLIED_TO_SUBSCRIPTION', label: 'Direto na assinatura' },
];

/** Quanto a linha leva para sair (casa com as transições de saída de admin-coupons.css). */
const COLLAPSE_MS = 300;
/** Quanto o "Copiado" fica na tela. */
const COPIED_MS = 1600;

/** Parâmetro do atalho "Criar cupom" no detalhe da empresa. */
const COMPANY_PARAM = 'empresa';

/** A lista traz todos os cupons da Stripe: os nomes não saem todos de uma vez. */
export const MAX_NAME_READS = 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tamanho do id quando o nome da empresa não pôde ser lido. */
const SHORT_ID_LENGTH = 8;

const plural = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** Uma linha da lista: o cupom e os textos que a tabela, o cartão do celular e o CSV mostram. */
export interface CouponRow {
  coupon: AdminCoupon;
  status: CouponStatusView;
  situation: CouponSituation;
  /** Saindo da lista atual (desativado fora do filtro): a linha some antes de os dados trocarem. */
  leaving: boolean;
  kind: string;
  isCode: boolean;
  /** O código; no desconto direto, a empresa. */
  title: string;
  company: string;
  /** "Todos os planos" ou "Plano Pro". */
  planLine: string;
  discount: string;
  /** "por 3 meses", "uma vez", "para sempre". */
  durationText: string;
  /** Só em % e todos os planos: quanto cada plano economiza por mês. */
  savings: string | null;
  canShare: boolean;
  canDeactivate: boolean;
  /** "2 / 5" no código; "—" no desconto direto. */
  uses: string;
  /** "2 de 5 usos": nome acessível e balão da barra. */
  usesHint: string;
  progress: number;
  /** "Até 29/11/2026", "Venceu em 02/11/2026", "Nas próximas faturas"... */
  validity: string;
  /** "Criado em 30/10/2026". */
  created: string | null;
}

/**
 * Uma configuração para a tabela (a partir de 1024px), o cartão do celular e o CSV. As células
 * são desenhadas no template (`dataListCell`); o `value` é o texto do CSV.
 */
const COLUMNS: readonly DataListColumn<CouponRow>[] = [
  { key: 'title', header: 'Código ou empresa', primary: true, value: (r) => r.title },
  { key: 'kind', header: 'Tipo', optional: true, kind: 'status', value: (r) => r.kind },
  { key: 'discount', header: 'Desconto', value: (r) => `${r.discount} ${r.durationText}` },
  { key: 'uses', header: 'Usos', optional: true, value: (r) => r.uses },
  { key: 'validity', header: 'Validade', value: (r) => r.validity },
  {
    key: 'status',
    header: 'Situação',
    kind: 'status',
    value: (r) => r.status.label,
    tone: (r): StatusChipTone => r.status.tone,
  },
];

/**
 * Admin > Cupons. A lista mora na Stripe, então uma falha aqui costuma ser dela.
 * `cupom.gerir` libera criar e desativar; os outros papéis só leem. O servidor
 * confere de novo em toda rota.
 *
 * Padrão da plataforma (auditoria 18/11, D1): `app-page-card "Lista"` + `app-list-toolbar`
 * (busca, "Tipo: X", pílulas de situação) + `app-data-list` (tabela a partir de 1024px,
 * cartões abaixo, sem linhas, kebab por linha).
 */
@Component({
  selector: 'app-admin-coupons',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Os seletores de admin-coupons.css começam por `app-admin-coupons`: sem encapsulamento eles
  // alcançam as linhas que a `app-data-list` desenha, e não vazam para outra tela.
  encapsulation: ViewEncapsulation.None,
  imports: [
    AlertBanner,
    BackLink,
    ConfirmDialog,
    CouponDetail,
    CouponShare,
    CouponSheet,
    DataList,
    DataListActions,
    DataListCell,
    DataListMenuItem,
    DefaultPageLayout,
    KpiCard,
    ListFilterSelect,
    ListToolbar,
    PageCard,
    RouterLink,
    StatusChip,
  ],
  templateUrl: './admin-coupons.html',
  styleUrl: './admin-coupons.css',
})
export class AdminCoupons implements OnInit {
  private readonly service = inject(AdminCouponsService);
  private readonly caps = inject(AdminCapabilitiesService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly now = new Date();
  private readonly requestedNames = new Set<string>();
  private readonly items = signal<AdminCoupon[]>([]);
  private readonly names = signal<Record<string, string>>({});
  private readonly prices = signal<Record<string, number>>({});
  /** A tabela de planos: preços do "Quanto cada plano paga" e do desconto por mês. */
  protected readonly plans = signal<PlanResponse[]>([]);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly sheetOpen = signal(false);
  protected readonly prefill = signal<CouponCompany | null>(null);

  /** Cupom aberto no detalhe; a linha vem de `allRows`, então o nome da empresa chega sozinho. */
  private readonly detailId = signal<string | null>(null);
  /** Cupom aberto em "Compartilhar"; vem da lista, igual ao detalhe. */
  private readonly shareId = signal<string | null>(null);

  protected readonly deactivating = signal<AdminCoupon | null>(null);
  protected readonly deactivateBusy = signal(false);

  /** Cupons que estão encolhendo antes de sair da lista (desativados fora do filtro atual). */
  private readonly leaving = signal<ReadonlySet<string>>(new Set());
  protected readonly copiedId = signal<string | null>(null);
  /** Troca a cada mudança de tipo/situação: a lista é refeita e a cascata de entrada recomeça. */
  protected readonly epoch = signal(0);
  protected readonly epochs = computed(() => [{ id: this.epoch() }]);

  protected readonly canManage = computed(() => this.caps.can('cupom.gerir'));

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly columns = COLUMNS;
  protected readonly rowId = (row: CouponRow): string => row.coupon.couponId;
  /** Each kebab is named after its row, so a screen reader can tell them apart. */
  protected readonly kebabLabel = (row: CouponRow): string => `Ações do cupom ${row.title}`;
  /** A busca é local: a lista inteira já veio da Stripe, filtrar aqui mostra exatamente o que existe. */
  protected readonly search = signal('');
  protected readonly typeFilter = signal<TypeFilter>('ALL');
  protected readonly situationFilter = signal<SituationFilter>('ALL');

  private readonly allRows = computed<CouponRow[]>(() =>
    this.items().map((coupon) => {
      const status = couponStatus(coupon, this.now);
      const isCode = coupon.mode !== 'APPLIED_TO_SUBSCRIPTION';
      const company = this.companyName(coupon.companyId);
      const plan = couponPlanName(coupon.planCode);
      const used = coupon.timesRedeemed ?? 0;
      const max = coupon.maxRedemptions ?? 1;
      return {
        coupon,
        status,
        situation: couponSituation(coupon, this.now),
        leaving: this.leaving().has(coupon.couponId),
        kind: kindLabel(coupon.mode),
        isCode,
        // Quem lê procura pelo código; o desconto direto só tem a empresa.
        title: coupon.promotionCode ?? company,
        company,
        planLine: isAllPlans(coupon) ? plan : `Plano ${plan}`,
        discount: discountLabel(coupon),
        durationText: durationText(coupon),
        savings: monthlySavingsLine(coupon, this.plans()),
        canShare: isCode && status.live && !!coupon.promotionCode,
        canDeactivate: this.canManage() && status.live,
        uses: isCode ? usesSpaced(coupon) : '—',
        usesHint: `${used} de ${max} ${max === 1 ? 'uso' : 'usos'}`,
        progress: isCode ? usesProgress(coupon) : 0,
        validity: couponValidity(coupon, this.now),
        created: createdLabel(coupon),
      };
    }),
  );

  private readonly filters = computed(() => ({
    term: this.search(),
    type: this.typeFilter(),
    situation: this.situationFilter(),
  }));

  protected readonly rows = computed(() => filterCoupons(this.allRows(), this.filters()));

  /**
   * Pílulas de situação (filtro, não troca de visão: `app-filter-chip-group` do toolbar). Cada uma
   * conta a lista já filtrada por busca e tipo, isto é, o que aparece ao escolhê-la.
   */
  protected readonly situationOptions = computed<readonly FilterChipOption<SituationFilter>[]>(() => {
    const n = situationCounts(this.allRows(), this.filters());
    return [
      { value: 'ALL', label: 'Todos', count: n.ALL },
      { value: 'ACTIVE', label: 'Ativos', count: n.ACTIVE },
      { value: 'EXHAUSTED', label: 'Esgotados', count: n.EXHAUSTED },
      { value: 'ENDED', label: 'Encerrados', count: n.ENDED },
    ];
  });

  protected readonly anyFilter = computed(
    () => this.search().trim() !== '' || this.typeFilter() !== 'ALL' || this.situationFilter() !== 'ALL',
  );

  /** Números do topo: da lista inteira, a busca e os filtros não mexem. O desconto é estimativa. */
  protected readonly stats = computed(() => computeCouponStats(this.items(), this.now, this.prices()));

  protected readonly activeCaption = computed(() => plural(this.stats().live, 'ativo', 'ativos'));

  protected readonly totalCaption = computed(() => {
    const { live, exhausted, total } = this.stats();
    const ended = Math.max(total - live - exhausted, 0);
    return `${this.activeCaption()} · ${plural(exhausted, 'esgotado', 'esgotados')} · ${plural(ended, 'encerrado', 'encerrados')}`;
  });

  /** "+ R$ 59,80 por mês, para sempre": o que os cupons sem fim descontam, fora do total. */
  private readonly foreverCaption = computed(() => {
    const cents = this.stats().foreverMonthlyCents;
    return cents > 0 ? `+ ${couponBrl(cents)} por mês, para sempre` : null;
  });

  protected readonly discountCaption = computed(() => {
    const { monthsGranted, skippedNoPrice } = this.stats();
    const months = monthsGranted === 1 ? 'até 1 mês' : `até ${monthsGranted} meses`;
    const parts = ['estimado', months];
    const forever = this.foreverCaption();
    if (forever) parts.push(forever);
    if (skippedNoPrice > 0) parts.push(`${skippedNoPrice} sem preço`);
    return parts.join(' · ');
  });

  protected readonly discountCaptionCompact = computed(() => {
    const { monthsGranted, skippedNoPrice } = this.stats();
    if (skippedNoPrice > 0) return `${skippedNoPrice} sem preço`;
    const forever = this.foreverCaption();
    if (forever) return forever;
    return monthsGranted === 1 ? 'até 1 mês' : `até ${monthsGranted} meses`;
  });

  protected readonly expiringCaption = computed(() => {
    const n = this.stats().activeCodes;
    return n === 1 ? 'de 1 código ativo' : `de ${n} códigos ativos`;
  });

  protected readonly exhaustedCaption = computed(() => plural(this.stats().exhausted, 'esgotado', 'esgotados'));

  protected readonly detail = computed(() => {
    const id = this.detailId();
    const row = id ? this.allRows().find((r) => r.coupon.couponId === id) : undefined;
    return row ? { coupon: row.coupon, company: row.company } : null;
  });

  protected readonly share = computed(() => {
    const id = this.shareId();
    const row = id ? this.allRows().find((r) => r.coupon.couponId === id) : undefined;
    return row ? { coupon: row.coupon, company: row.coupon.companyId ? row.company : null } : null;
  });

  protected readonly hasAny = computed(() => this.items().length > 0);

  protected readonly confirmMessage = computed(() => {
    const coupon = this.deactivating();
    if (!coupon) return '';
    return coupon.promotionCode
      ? `O código ${coupon.promotionCode} para de funcionar na hora.`
      : `O desconto sai da assinatura de ${this.companyName(coupon.companyId)}. As próximas faturas voltam ao valor cheio.`;
  });

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.timers.forEach((timer) => clearTimeout(timer)));
    this.load();
    this.service.plans().subscribe({
      next: (plans) => {
        this.plans.set(plans ?? []);
        this.prices.set(monthlyPriceByPlan(plans ?? []));
      },
      error: () => this.prices.set({}),
    });
    this.caps.ensureLoaded().subscribe(() => this.openFromShortcut());
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list().subscribe({
      next: (list) => {
        this.loading.set(false);
        this.items.set(list ?? []);
        this.resolveNames(list ?? []);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.items.set([]);
        this.error.set(couponErrorMessage(err, 'load'));
      },
    });
  }

  /**
   * O item da lista só traz o id da empresa. Cada empresa é lida uma vez, e uma
   * falha aqui deixa a linha com o id curto, sem derrubar a lista; a próxima carga
   * tenta aquele nome de novo.
   */
  private resolveNames(list: AdminCoupon[]): void {
    const ids = new Set<string>();
    for (const { companyId } of list) {
      if (companyId && !this.requestedNames.has(companyId) && !this.names()[companyId]) ids.add(companyId);
    }
    ids.forEach((id) => this.requestedNames.add(id));
    from(ids)
      .pipe(
        mergeMap(
          (id) =>
            this.service.company(id).pipe(
              catchError(() => {
                this.requestedNames.delete(id);
                return EMPTY;
              }),
            ),
          MAX_NAME_READS,
        ),
      )
      .subscribe((company) => this.rememberName(company));
  }

  private rememberName(company: CouponCompany): void {
    this.names.update((names) => ({ ...names, [company.id]: company.name }));
  }

  private companyName(id: string | null): string {
    if (!id) return '—';
    return this.names()[id] ?? `Empresa ${id.slice(0, SHORT_ID_LENGTH)}`;
  }

  private openFromShortcut(): void {
    const id = this.route.snapshot.queryParamMap.get(COMPANY_PARAM);
    if (!id || !UUID.test(id) || !this.canManage()) return;
    this.service.company(id).subscribe({
      next: (company) => {
        this.prefill.set(company);
        this.sheetOpen.set(true);
      },
      error: () => this.sheetOpen.set(true),
    });
  }

  protected setTypeFilter(value: TypeFilter): void {
    if (value === this.typeFilter()) return;
    this.typeFilter.set(value);
    this.epoch.update((n) => n + 1);
  }

  protected setSituationFilter(value: SituationFilter): void {
    if (value === this.situationFilter()) return;
    this.situationFilter.set(value);
    this.epoch.update((n) => n + 1);
  }

  protected onTypeChange(event: Event): void {
    this.setTypeFilter((event.target as HTMLSelectElement).value as TypeFilter);
  }

  protected setQuery(value: string): void {
    this.search.set(value);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.setTypeFilter('ALL');
    this.setSituationFilter('ALL');
  }

  protected openDetail(couponId: string): void {
    this.detailId.set(couponId);
  }

  /** A linha inteira abre o detalhe; link, botão de copiar e kebab têm dono próprio (a lista cuida). */
  protected onRowActivate(row: CouponRow): void {
    this.openDetail(row.coupon.couponId);
  }

  protected closeDetail(): void {
    this.detailId.set(null);
  }

  /** Do kebab ou do detalhe: o detalhe fecha e a folha de compartilhar abre no lugar. */
  protected openShare(couponId: string): void {
    this.detailId.set(null);
    this.shareId.set(couponId);
  }

  protected closeShare(): void {
    this.shareId.set(null);
  }

  protected openSheet(): void {
    this.prefill.set(null);
    this.sheetOpen.set(true);
  }

  protected closeSheet(): void {
    this.sheetOpen.set(false);
    this.prefill.set(null);
    if (this.route.snapshot.queryParamMap.get(COMPANY_PARAM)) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
  }

  protected onSaved({ coupon, company }: { coupon: AdminCoupon; company: CouponCompany | null }): void {
    if (company) this.rememberName(company);
    this.items.update((list) => [coupon, ...list]);
  }

  protected copy(id: string, code: string): void {
    void copyCouponCode(this.doc.defaultView, this.notify, code).then((ok) => {
      if (!ok) return;
      this.copiedId.set(id);
      this.later(() => this.copiedId.update((current) => (current === id ? null : current)), COPIED_MS);
    });
  }

  private later(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  /** Movimento reduzido (ou sem `matchMedia`, como no jsdom): sem colapso, a troca é na hora. */
  private motionOk(): boolean {
    const view = this.doc.defaultView;
    return typeof view?.matchMedia === 'function' && !view.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  protected askDeactivate(coupon: AdminCoupon): void {
    this.actionError.set(null);
    this.deactivating.set(coupon);
  }

  protected cancelDeactivate(): void {
    this.deactivating.set(null);
  }

  protected confirmDeactivate(): void {
    const coupon = this.deactivating();
    if (!coupon || this.deactivateBusy()) return;
    this.deactivateBusy.set(true);
    this.service.deactivate(coupon.couponId).subscribe({
      next: (updated) => {
        this.deactivateBusy.set(false);
        this.deactivating.set(null);
        const commit = (): void =>
          this.items.update((list) => list.map((c) => (c.couponId === updated.couponId ? updated : c)));
        const company = this.companyName(updated.companyId);
        const stays = filterCoupons(
          [
            {
              coupon: updated,
              situation: couponSituation(updated, this.now),
              title: updated.promotionCode ?? company,
              company,
            },
          ],
          this.filters(),
        ).length;
        if (stays === 0 && this.motionOk()) {
          // Sai da lista atual: a linha encolhe e só então os dados trocam.
          this.leaving.update((set) => new Set(set).add(updated.couponId));
          this.later(() => {
            commit();
            this.leaving.update((set) => {
              const next = new Set(set);
              next.delete(updated.couponId);
              return next;
            });
          }, COLLAPSE_MS);
        } else {
          commit();
        }
        this.notify.success('Cupom desativado.');
      },
      error: (err: unknown) => {
        this.deactivateBusy.set(false);
        this.deactivating.set(null);
        this.actionError.set(couponErrorMessage(err, 'deactivate'));
      },
    });
  }
}
