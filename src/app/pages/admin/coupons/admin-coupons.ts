import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { BackLink } from '../../../components/core/back-link/back-link';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { NotificationService } from '../../../services/notification.service';
import { AdminCoupon, CouponCompany } from '../../../types/admin-coupon.types';
import { AdminCouponsService } from './admin-coupons.service';
import {
  copyCouponCode,
  couponErrorMessage,
  couponPlanLabel,
  couponStatus,
  discountLabel,
  durationLabel,
  validityLabel,
} from './coupon-copy';
import { CouponSheet } from './coupon-sheet';

/** Parâmetro do atalho "Criar cupom" no detalhe da empresa. */
const COMPANY_PARAM = 'empresa';

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

  protected readonly rows = computed(() =>
    this.items().map((coupon) => {
      const status = couponStatus(coupon, this.now);
      return {
        coupon,
        status,
        code: coupon.promotionCode ?? 'Direto na assinatura',
        company: this.companyName(coupon.companyId),
        plan: couponPlanLabel(coupon.planCode),
        discount: discountLabel(coupon),
        duration: durationLabel(coupon.durationMonths),
        validity: validityLabel(coupon),
        canDeactivate: this.canManage() && status.live,
      };
    }),
  );

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
   * falha aqui deixa a linha com o id curto, sem derrubar a lista.
   */
  private resolveNames(list: AdminCoupon[]): void {
    for (const { companyId } of list) {
      if (!companyId || this.requestedNames.has(companyId) || this.names()[companyId]) continue;
      this.requestedNames.add(companyId);
      this.service.company(companyId).subscribe({
        next: (company) => this.rememberName(company),
        error: () => undefined,
      });
    }
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
    if (!id || !this.canManage()) return;
    this.service.company(id).subscribe({
      next: (company) => {
        this.prefill.set(company);
        this.sheetOpen.set(true);
      },
      error: () => this.sheetOpen.set(true),
    });
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

  protected onSaved({ coupon, company }: { coupon: AdminCoupon; company: CouponCompany }): void {
    this.rememberName(company);
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
