import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, catchError, from, mergeMap } from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { BackLink } from '../../../components/core/back-link/back-link';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { PillTabOption, PillTabs } from '../../../components/core/pill-tabs/pill-tabs';
import { FilterChipOption } from '../../../components/filter-chip-group/filter-chip-group';
import { KpiCard } from '../../../components/kpi-card/kpi-card';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { NotificationService } from '../../../services/notification.service';
import { AdminCoupon, CouponCompany } from '../../../types/admin-coupon.types';
import { formatBRL } from '../../../types/dashboard.types';
import { mediaQuerySignal } from '../../../utils/viewport';
import { AdminCouponsService } from './admin-coupons.service';
import {
  copyCouponCode,
  couponErrorMessage,
  couponDate,
  couponPlanName,
  couponStatus,
  discountLabel,
  durationLabel,
  kindLabel,
  usesLabel,
} from './coupon-copy';
import {
  SituationFilter,
  TypeFilter,
  couponSituation,
  filterCoupons,
  shortDate,
  situationCounts,
  usesProgress,
  usesSpaced,
} from './coupon-list';
import { computeCouponStats, monthlyPriceByPlan } from './coupon-stats';
import { CouponDetail } from './coupon-detail';
import { CouponSheet } from './coupon-sheet';

const TYPE_OPTIONS: readonly FilterChipOption<TypeFilter>[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'OPEN_CODE', label: 'Para qualquer pessoa' },
  { value: 'PROMOTION_CODE', label: 'Código de empresa' },
  { value: 'APPLIED_TO_SUBSCRIPTION', label: 'Direto na assinatura' },
];

/** Quanto a linha leva para encolher (casa com `.collapse-row` em styles.css). */
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

/**
 * Admin > Cupons. A lista mora na Stripe, então uma falha aqui costuma ser dela.
 * `cupom.gerir` libera criar e desativar; os outros papéis só leem. O servidor
 * confere de novo em toda rota.
 */
@Component({
  selector: 'app-admin-coupons',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionsMenu,
    AlertBanner,
    BackLink,
    ConfirmDialog,
    CouponDetail,
    CouponSheet,
    DefaultPageLayout,
    KpiCard,
    PillTabs,
    ReactiveFormsModule,
    NgTemplateOutlet,
    RouterLink,
    StatusChip,
  ],
  templateUrl: './admin-coupons.html',
})
export class AdminCoupons implements OnInit {
  private readonly service = inject(AdminCouponsService);
  private readonly caps = inject(AdminCapabilitiesService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  /** `md` do Tailwind: daí para cima é tabela, abaixo é cartão-ingresso. */
  protected readonly wide = mediaQuerySignal('(min-width: 48rem)');

  private readonly now = new Date();
  private readonly requestedNames = new Set<string>();
  private readonly items = signal<AdminCoupon[]>([]);
  private readonly names = signal<Record<string, string>>({});
  private readonly prices = signal<Record<string, number>>({});
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly sheetOpen = signal(false);
  protected readonly prefill = signal<CouponCompany | null>(null);

  /** Cupom aberto no detalhe; a linha vem de `allRows`, então o nome da empresa chega sozinho. */
  private readonly detailId = signal<string | null>(null);

  protected readonly deactivating = signal<AdminCoupon | null>(null);
  protected readonly deactivateBusy = signal(false);

  /** Cupons que estão encolhendo antes de sair da lista (desativados fora do filtro atual). */
  private readonly leaving = signal<ReadonlySet<string>>(new Set());
  protected readonly copiedId = signal<string | null>(null);
  /** Troca a cada mudança de tipo/aba: a lista é refeita e a cascata de entrada recomeça. */
  protected readonly epoch = signal(0);
  protected readonly epochs = computed(() => [{ id: this.epoch() }]);

  protected readonly canManage = computed(() => this.caps.can('cupom.gerir'));

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly searchControl = new FormControl('', { nonNullable: true });
  private readonly search = toSignal(this.searchControl.valueChanges, { initialValue: '' });
  protected readonly typeFilter = signal<TypeFilter>('ALL');
  protected readonly situationFilter = signal<SituationFilter>('ALL');

  private readonly allRows = computed(() =>
    this.items().map((coupon) => {
      const status = couponStatus(coupon, this.now);
      const isCode = coupon.mode !== 'APPLIED_TO_SUBSCRIPTION';
      const company = this.companyName(coupon.companyId);
      const expires = coupon.expiresAt ? couponDate(coupon.expiresAt) : '—';
      return {
        coupon,
        status,
        situation: couponSituation(coupon, this.now),
        leaving: this.leaving().has(coupon.couponId),
        kind: kindLabel(coupon.mode),
        isCode,
        isOpen: coupon.mode === 'OPEN_CODE',
        // Quem lê procura pelo código; o desconto direto só tem a empresa.
        title: coupon.promotionCode ?? company,
        company,
        plan: couponPlanName(coupon.planCode),
        discount: discountLabel(coupon),
        duration: durationLabel(coupon.durationMonths),
        usesAria: usesLabel(coupon),
        uses: isCode ? usesSpaced(coupon) : '—',
        progress: isCode ? usesProgress(coupon) : 0,
        validity: isCode ? expires : status.live ? 'Próximas faturas' : 'Encerrado',
        validityShort: isCode ? shortDate(expires) : '',
        canDeactivate: this.canManage() && status.live,
      };
    }),
  );

  private readonly filters = computed(() => ({
    term: this.search(),
    type: this.typeFilter(),
    situation: this.situationFilter(),
  }));

  protected readonly rows = computed(() => filterCoupons(this.allRows(), this.filters()));

  /** As abas contam a lista já filtrada por busca e tipo; cada uma mostra o que aparece ao escolhê-la. */
  protected readonly situationTabs = computed<readonly PillTabOption<SituationFilter>[]>(() => {
    const n = situationCounts(this.allRows(), this.filters());
    return [
      { value: 'ALL', label: 'Todos', count: n.ALL, testId: 'tab-ALL' },
      { value: 'ACTIVE', label: 'Ativos', count: n.ACTIVE, testId: 'tab-ACTIVE' },
      { value: 'EXHAUSTED', label: 'Esgotados', count: n.EXHAUSTED, testId: 'tab-EXHAUSTED' },
      { value: 'ENDED', label: 'Encerrados', shortLabel: 'Enc.', count: n.ENDED, testId: 'tab-ENDED' },
    ];
  });

  protected readonly anyFilter = computed(
    () => this.search().trim() !== '' || this.typeFilter() !== 'ALL' || this.situationFilter() !== 'ALL',
  );

  protected readonly resultsText = computed(() => {
    const n = this.rows().length;
    return n === 0 ? 'Nenhum resultado' : n === 1 ? '1 resultado' : `${n} resultados`;
  });

  /** Números do topo: da lista inteira, a busca e os filtros não mexem. O desconto é estimativa. */
  protected readonly stats = computed(() => computeCouponStats(this.items(), this.now, this.prices()));

  protected readonly activeCaption = computed(() => plural(this.stats().live, 'ativo', 'ativos'));

  protected readonly totalCaption = computed(() => {
    const { live, exhausted, total } = this.stats();
    const ended = Math.max(total - live - exhausted, 0);
    return `${this.activeCaption()} · ${plural(exhausted, 'esgotado', 'esgotados')} · ${plural(ended, 'encerrado', 'encerrados')}`;
  });

  /** Estimativa contada em centavos e sempre mostrada com o `≈` na frente. */
  protected readonly formatDiscount = (cents: number): string =>
    `≈ ${formatBRL(Math.round(cents))}`.replace(new RegExp(String.fromCharCode(160), 'g'), ' ');
  protected readonly formatDiscountCompact = (cents: number): string =>
    `≈ R$ ${Math.round(cents / 100).toLocaleString('pt-BR')}`;

  protected readonly discountCaption = computed(() => {
    const { monthsGranted, skippedNoPrice } = this.stats();
    const months = monthsGranted === 1 ? 'até 1 mês' : `até ${monthsGranted} meses`;
    return skippedNoPrice > 0 ? `estimado · ${months} · ${skippedNoPrice} sem preço` : `estimado · ${months}`;
  });

  protected readonly discountCaptionCompact = computed(() => {
    const { monthsGranted, skippedNoPrice } = this.stats();
    if (skippedNoPrice > 0) return `${skippedNoPrice} sem preço`;
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
      next: (plans) => this.prices.set(monthlyPriceByPlan(plans ?? [])),
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

  protected clearFilters(): void {
    this.searchControl.setValue('');
    this.setTypeFilter('ALL');
    this.setSituationFilter('ALL');
  }

  protected openDetail(couponId: string): void {
    this.detailId.set(couponId);
  }

  protected closeDetail(): void {
    this.detailId.set(null);
  }

  /** Cliques em link, botão de copiar e kebab têm dono próprio e não abrem o detalhe. */
  protected onRowClick(event: Event, couponId: string): void {
    const target = event.target;
    if (target instanceof Element && target.closest('a, button, [role="menuitem"]')) return;
    this.openDetail(couponId);
  }

  /** Enter e Espaço na própria linha; nas teclas dos controles de dentro, nada. */
  protected onRowKey(event: KeyboardEvent, couponId: string): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.openDetail(couponId);
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
          // Sai da lista atual: a altura encolhe e só então os dados trocam.
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
