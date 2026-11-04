import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import { KpiCard } from '../../../components/kpi-card/kpi-card';
import { NotificationService } from '../../../services/notification.service';
import { AdminCoupon, CouponRedemptions } from '../../../types/admin-coupon.types';
import { formatBRL } from '../../../types/dashboard.types';
import { AdminCouponsService } from './admin-coupons.service';
import {
  copyCouponCode,
  couponErrorMessage,
  couponPlanName,
  couponStatus,
  discountLabel,
  durationLabel,
  kindLabel,
  validityLabel,
} from './coupon-copy';
import {
  EMPTY_TITLE,
  PENDING_INVOICE,
  REFUND_NOTE,
  STAGGER_CAP,
  TRUNCATED_NOTE,
  emptyHint,
  redemptionView,
} from './coupon-detail-copy';
import { usesProgress, usesSpaced } from './coupon-list';

const SKELETON_ROWS = [0, 1, 2];
const COPIED_MS = 1600;

/**
 * Detalhe do cupom: quem usou e quando. Os usos moram na Stripe e a leitura
 * pode levar um ou dois segundos, então o cabeçalho (que a lista já tem) abre
 * na hora e só a parte dos usos espera, com esqueleto.
 */
@Component({
  selector: 'app-coupon-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, KpiCard, StatusChip],
  templateUrl: './coupon-detail.html',
})
export class CouponDetail implements OnInit {
  private readonly service = inject(AdminCouponsService);
  private readonly notify = inject(NotificationService);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly now = new Date();

  readonly coupon = input.required<AdminCoupon>();
  /** Nome da empresa do cupom; vem da lista, que já o resolveu. */
  readonly company = input<string>('—');
  readonly closed = output<void>();

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notFound = signal(false);
  protected readonly data = signal<CouponRedemptions | null>(null);
  protected readonly copied = signal(false);
  protected readonly skeletonRows = SKELETON_ROWS;

  protected readonly texts = {
    pending: PENDING_INVOICE,
    refund: REFUND_NOTE,
    truncated: TRUNCATED_NOTE,
    empty: EMPTY_TITLE,
  };

  /** O servidor devolve o cupom fresco junto dos usos; enquanto isso vale o da lista. */
  protected readonly live = computed(() => this.data()?.coupon ?? this.coupon());
  protected readonly isCode = computed(() => this.live().mode !== 'APPLIED_TO_SUBSCRIPTION');
  protected readonly isOpen = computed(() => this.live().mode === 'OPEN_CODE');
  protected readonly code = computed(() => this.live().promotionCode);
  protected readonly title = computed(() => this.code() ?? this.company());
  protected readonly status = computed(() => couponStatus(this.live(), this.now));
  protected readonly kind = computed(() => kindLabel(this.live().mode));
  protected readonly discount = computed(() => discountLabel(this.live()));
  protected readonly duration = computed(() => durationLabel(this.live().durationMonths));
  protected readonly plan = computed(() => couponPlanName(this.live().planCode));
  protected readonly validity = computed(() => validityLabel(this.live()));
  protected readonly usesText = computed(() => usesSpaced(this.live()));
  protected readonly progress = computed(() => usesProgress(this.live()));
  protected readonly hint = computed(() => emptyHint(this.isOpen()));
  protected readonly rows = computed(() =>
    (this.data()?.redemptions ?? []).map((item, i) => ({
      ...redemptionView(item, i),
      stagger: Math.min(i, STAGGER_CAP),
    })),
  );

  protected readonly formatMoney = (cents: number): string =>
    formatBRL(Math.round(cents)).replace(/\u00A0/g, ' ');

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.notFound.set(false);
    const sub = this.service.redemptions(this.coupon().couponId).subscribe({
      next: (result) => {
        this.data.set(result);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.notFound.set(err instanceof HttpErrorResponse && err.status === 404);
        this.error.set(couponErrorMessage(err, 'detail'));
      },
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  protected copy(): void {
    const code = this.code();
    if (!code) return;
    void copyCouponCode(this.doc.defaultView, this.notify, code).then((ok) => {
      if (!ok) return;
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), COPIED_MS);
    });
  }
}
