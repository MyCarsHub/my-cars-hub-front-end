import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, catchError, from, mergeMap } from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { BackLink } from '../../../components/core/back-link/back-link';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { FilterChipGroup, FilterChipOption } from '../../../components/filter-chip-group/filter-chip-group';
import { ListGroup, ListRow } from '../../../components/core/list-group/list-group';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { NotificationService } from '../../../services/notification.service';
import { AdminCoupon, CouponCompany } from '../../../types/admin-coupon.types';
import { AdminCouponsService } from './admin-coupons.service';
import {
  copyCouponCode,
  couponErrorMessage,
  couponDate,
  couponPlanName,
  couponStatus,
  discountSummary,
  kindLabel,
  usesLabel,
} from './coupon-copy';
import { CouponSheet } from './coupon-sheet';

type TypeFilter = 'ALL' | AdminCoupon['mode'];
type SituationFilter = 'ALL' | 'ACTIVE' | 'EXHAUSTED' | 'DEACTIVATED';

const TYPE_OPTIONS: readonly FilterChipOption<TypeFilter>[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'OPEN_CODE', label: 'Para qualquer pessoa' },
  { value: 'PROMOTION_CODE', label: 'Código de empresa' },
  { value: 'APPLIED_TO_SUBSCRIPTION', label: 'Direto na assinatura' },
];

const SITUATION_OPTIONS: readonly FilterChipOption<SituationFilter>[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'ACTIVE', label: 'Ativos' },
  { value: 'EXHAUSTED', label: 'Esgotados' },
  { value: 'DEACTIVATED', label: 'Desativados' },
];

const GROUP_ORDER: readonly AdminCoupon['mode'][] = ['OPEN_CODE', 'PROMOTION_CODE', 'APPLIED_TO_SUBSCRIPTION'];
const GROUP_HEADING: Record<AdminCoupon['mode'], string> = {
  OPEN_CODE: 'Códigos para qualquer pessoa',
  PROMOTION_CODE: 'Códigos de empresas',
  APPLIED_TO_SUBSCRIPTION: 'Direto na assinatura',
};

/** Parâmetro do atalho "Criar cupom" no detalhe da empresa. */
const COMPANY_PARAM = 'empresa';

/** A lista traz todos os cupons da Stripe: os nomes não saem todos de uma vez. */
export const MAX_NAME_READS = 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tamanho do id quando o nome da empresa não pôde ser lido. */
const SHORT_ID_LENGTH = 8;

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
    CouponSheet,
    DefaultPageLayout,
    FilterChipGroup,
    ListGroup,
    ListRow,
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

  private readonly now = new Date();
  private readonly requestedNames = new Set<string>();
  private readonly items = signal<AdminCoupon[]>([]);
  private readonly names = signal<Record<string, string>>({});

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly sheetOpen = signal(false);
  protected readonly prefill = signal<CouponCompany | null>(null);

  protected readonly deactivating = signal<AdminCoupon | null>(null);
  protected readonly deactivateBusy = signal(false);

  protected readonly canManage = computed(() => this.caps.can('cupom.gerir'));

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly situationOptions = SITUATION_OPTIONS;
  protected readonly searchControl = new FormControl('', { nonNullable: true });
  private readonly search = toSignal(this.searchControl.valueChanges, { initialValue: '' });
  protected readonly typeFilter = signal<TypeFilter>('ALL');
  protected readonly situationFilter = signal<SituationFilter>('ALL');

  private readonly allRows = computed(() =>
    this.items().map((coupon) => {
      const status = couponStatus(coupon, this.now);
      const isCode = coupon.mode !== 'APPLIED_TO_SUBSCRIPTION';
      const company = this.companyName(coupon.companyId);
      const situation: SituationFilter =
        coupon.status === 'DEACTIVATED'
          ? 'DEACTIVATED'
          : status.label === 'Esgotado' || status.label === 'Usado'
            ? 'EXHAUSTED'
            : status.live
              ? 'ACTIVE'
              : 'ALL';
      return {
        coupon,
        status,
        situation,
        kind: kindLabel(coupon.mode),
        isCode,
        isOpen: coupon.mode === 'OPEN_CODE',
        // Quem lê procura pelo código; o desconto direto só tem a empresa.
        title: coupon.promotionCode ?? company,
        company,
        plan: `${couponPlanName(coupon.planCode)} · ${discountSummary(coupon)}`,
        meta: isCode
          ? `usos ${usesLabel(coupon)} · vale até ${coupon.expiresAt ? couponDate(coupon.expiresAt) : '—'}`
          : status.live
            ? 'nas próximas faturas'
            : 'desconto encerrado',
        canDeactivate: this.canManage() && status.live,
      };
    }),
  );

  protected readonly rows = computed(() => {
    const term = this.search().trim().toLocaleLowerCase('pt-BR');
    const type = this.typeFilter();
    const situation = this.situationFilter();
    return this.allRows().filter(
      (row) =>
        (type === 'ALL' || row.coupon.mode === type) &&
        (situation === 'ALL' || row.situation === situation) &&
        (term === '' ||
          row.title.toLocaleLowerCase('pt-BR').includes(term) ||
          row.company.toLocaleLowerCase('pt-BR').includes(term)),
    );
  });

  /** Uma seção por espécie, na ordem do dono; seção sem cupom não aparece. */
  protected readonly groups = computed(() =>
    GROUP_ORDER.map((mode) => ({
      mode,
      heading: GROUP_HEADING[mode],
      rows: this.rows().filter((row) => row.coupon.mode === mode),
    })).filter((group) => group.rows.length > 0),
  );

  protected readonly hasAny = computed(() => this.items().length > 0);

  protected readonly confirmMessage = computed(() => {
    const coupon = this.deactivating();
    if (!coupon) return '';
    return coupon.promotionCode
      ? `O código ${coupon.promotionCode} para de funcionar na hora.`
      : `O desconto sai da assinatura de ${this.companyName(coupon.companyId)}. As próximas faturas voltam ao valor cheio.`;
  });

  ngOnInit(): void {
    this.load();
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
    this.typeFilter.set(value);
  }

  protected setSituationFilter(value: SituationFilter): void {
    this.situationFilter.set(value);
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

  protected copy(code: string): void {
    void copyCouponCode(this.doc.defaultView, this.notify, code);
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
        this.items.update((list) => list.map((c) => (c.couponId === updated.couponId ? updated : c)));
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
