import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, map, of, switchMap, tap } from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { DocumentPreviewService } from '../../../components/document-preview/document-preview.service';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import { DriverRentalChargesService } from '../../../services/driver-rental-charges.service';
import { DriverCharge } from '../../../types/driver-charges.types';
import {
  RentalDocumentDto,
  RentalDocumentKind,
  RentalListItemDto,
  RentalResponseDto,
} from '../../../types/rental.types';
import { paidDayOf } from '../../../utils/driver-charges';
import { rentalStatusMeta } from '../../../utils/status-maps';
import { RentalService } from '../../rentals/rental.service';
import { DriverPaySheet } from './driver-pay-sheet';
import {
  ChargeRow,
  DRIVER_RENTAL_TODAY,
  HeroTone,
  buildChargeList,
  buildHero,
  buildTerms,
  chargeTitle,
  collapsedRows,
  fullDate,
  plural,
  reservedBanner,
} from './driver-rental-view';

const LOAD_ERROR = 'Não foi possível carregar o aluguel.';
const NOT_FOUND = 'Não encontramos este aluguel.';
const CHARGES_ERROR = 'Não foi possível carregar as cobranças.';
const DOCS_ERROR = 'Não foi possível carregar os documentos.';

/** Sizes the identity lookup when the list is not in memory (a driver has a handful). */
const IDENTITY_PAGE_SIZE = 100;

const HERO_BG: Record<HeroTone, string> = {
  overdue: 'bg-rose-700',
  next: 'bg-primary-500',
  clear: 'bg-success-800',
  ended: 'bg-neutral-800 dark:bg-neutral-700',
};

const DOC_NAMES: Record<RentalDocumentKind, string> = {
  CONTRACT: 'Contrato de locação',
  CHECKIN: 'Laudo da vistoria de retirada',
  CHECKOUT: 'Laudo da vistoria de devolução',
};
const DOC_ORDER: readonly RentalDocumentKind[] = ['CONTRACT', 'CHECKIN', 'CHECKOUT'];

interface DocRow {
  readonly doc: RentalDocumentDto;
  readonly name: string;
  readonly sub: string;
}

/**
 * "Meu aluguel" — the DRIVER's own rental: what to pay now (the colored block), the charges
 * with a "Pagar" per open one, what was agreed and the documents. Built from the owner's
 * prototype (`Motorista Alugueis.dc.html`).
 *
 * Reads only what the driver may reach: `GET /v1/rentals/{id}` (terms), the driver's own
 * `GET /v1/rentals/{id}/charges` (never the operator's `charges` of the detail, which carry
 * fields a driver must not see) and `GET /v1/rentals/{id}/documents`. Plate and model come
 * from the rental LIST row (`/v1/vehicles/{id}` is a 403 for him).
 *
 * Left out on purpose, because no endpoint the driver reaches carries the data: the
 * prototype's "Multas do veículo", "Fale com a locadora" (company phone) and the weekly km
 * bar. They come back when the backend serves them; inventing them would be worse.
 *
 * The driver leaves the app to pay and comes back to this tab, so the charges are refetched
 * quietly (no skeleton, no error banner) whenever the tab becomes visible again.
 */
@Component({
  selector: 'app-driver-rental-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, DefaultPageLayout, DriverPaySheet, RouterLink],
  templateUrl: './driver-rental-detail.html',
})
export class DriverRentalDetail {
  /** Route param, bound by `withComponentInputBinding`. */
  readonly id = input.required<string>();

  private readonly rentals = inject(RentalService);
  private readonly chargesApi = inject(DriverRentalChargesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly preview = inject(DocumentPreviewService);
  private readonly document = inject(DOCUMENT);
  private readonly todayFn = inject(DRIVER_RENTAL_TODAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly impersonation = inject(ImpersonationService);

  /**
   * Support viewing as the company in READ-ONLY mode: the backend answers the Pix with 409
   * "Pix não disponível em sessão somente leitura.", so no "Pagar" is offered at all.
   * `?.` because older spec doubles do not know `readOnly`.
   */
  protected readonly readOnlySession = computed(() => this.impersonation.readOnly?.() === true);

  protected readonly today = signal(this.todayFn());

  protected readonly rental = signal<RentalResponseDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notFound = signal(false);

  protected readonly charges = signal<DriverCharge[]>([]);
  protected readonly chargesLoaded = signal(false);
  protected readonly chargesError = signal<string | null>(null);

  protected readonly docs = signal<RentalDocumentDto[]>([]);
  protected readonly docsLoaded = signal(false);
  protected readonly docsError = signal<string | null>(null);

  private readonly identity = signal<RentalListItemDto | null>(null);

  protected readonly showAll = signal(false);
  protected readonly payingId = signal<string | null>(null);

  protected readonly statusChip = computed(() => {
    const r = this.rental();
    return r ? rentalStatusMeta(r.status) : null;
  });

  /** "SJH-2B17 · Fiat Mobi". Empty while the list row is unknown. */
  protected readonly vehicleLine = computed(() => {
    const row = this.identity();
    if (!row) return '';
    const car = [row.vehicleBrand, row.vehicleModel].filter(Boolean).join(' ');
    return [row.vehiclePlate?.toUpperCase(), car].filter(Boolean).join(' · ');
  });

  protected readonly hero = computed(() => {
    const r = this.rental();
    if (!r || !this.chargesLoaded()) return null;
    return buildHero(r.status, this.charges(), this.today(), r);
  });

  protected readonly heroClass = computed(() => {
    const h = this.hero();
    return h ? HERO_BG[h.tone] : '';
  });

  protected readonly banner = computed(() => {
    const r = this.rental();
    return r ? reservedBanner(r.status, r.startDate, this.charges(), this.today()) : '';
  });

  private readonly chargeList = computed(() =>
    buildChargeList(this.charges(), this.today(), this.rental()?.billingFrequency ?? null),
  );

  protected readonly rows = computed<readonly ChargeRow[]>(() => {
    const list = this.chargeList();
    return this.showAll() ? list.rows : collapsedRows(list);
  });

  protected readonly chargeCount = computed(() => {
    const list = this.chargeList();
    return `${list.openCount} em aberto · ${plural(list.paidCount, 'paga', 'pagas')}`;
  });

  protected readonly hasMore = computed(
    () => this.showAll() || this.chargeList().rows.length > collapsedRows(this.chargeList()).length,
  );

  protected readonly moreLabel = computed(() =>
    this.showAll() ? 'Mostrar menos' : `Ver todas as ${this.chargeList().rows.length} cobranças`,
  );

  protected readonly terms = computed(() => {
    const r = this.rental();
    return r ? buildTerms(r, this.charges(), this.today()) : [];
  });

  protected readonly docRows = computed<readonly DocRow[]>(() =>
    [...this.docs()]
      .filter((d) => DOC_ORDER.includes(d.kind))
      .sort(
        (a, b) =>
          DOC_ORDER.indexOf(a.kind) - DOC_ORDER.indexOf(b.kind) ||
          (b.createdDate ?? '').localeCompare(a.createdDate ?? ''),
      )
      .map((doc) => {
        const day = paidDayOf(doc.createdDate ?? null);
        return {
          doc,
          name: DOC_NAMES[doc.kind],
          sub: day ? `Adicionado em ${fullDate(day)}` : '',
        };
      }),
  );

  protected readonly payingCharge = computed(
    () => this.charges().find((c) => c.id === this.payingId()) ?? null,
  );

  protected readonly payingTitle = computed(() => {
    const c = this.payingCharge();
    return c ? chargeTitle(c, this.rental()?.billingFrequency ?? null) : '';
  });

  private readonly rental$ = new Subject<string>();
  private readonly charges$ = new Subject<{ id: string; quiet: boolean }>();
  private readonly docs$ = new Subject<string>();

  constructor() {
    this.rental$
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
          this.notFound.set(false);
        }),
        switchMap((id) =>
          this.rentals.getById(id).pipe(
            catchError((err: unknown) => {
              const missing = err instanceof HttpErrorResponse && err.status === 404;
              this.notFound.set(missing);
              this.error.set(missing ? NOT_FOUND : this.apiErrors.messageFor(err, LOAD_ERROR));
              if (missing) this.apiErrors.claim(err);
              this.loading.set(false);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((rental) => {
        this.rental.set(rental);
        this.loading.set(false);
      });

    this.charges$
      .pipe(
        tap(({ quiet }) => {
          this.today.set(this.todayFn());
          if (quiet) return;
          this.chargesError.set(null);
        }),
        switchMap(({ id, quiet }) =>
          this.chargesApi.list(id).pipe(
            catchError((err: unknown) => {
              this.apiErrors.claim(err);
              if (!quiet) this.chargesError.set(CHARGES_ERROR);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((list) => {
        this.charges.set(list);
        this.chargesLoaded.set(true);
        this.chargesError.set(null);
      });

    this.docs$
      .pipe(
        tap(() => this.docsError.set(null)),
        switchMap((id) =>
          this.rentals.listDocuments(id).pipe(
            catchError((err: unknown) => {
              this.apiErrors.claim(err);
              this.docsError.set(DOCS_ERROR);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((docs) => {
        this.docs.set(Array.isArray(docs) ? docs : []);
        this.docsLoaded.set(true);
      });

    // First load, and every change of rental. Nothing of the previous rental stays on screen.
    // ONLY `id` is tracked: `loadIdentity` reads `rentals.items()`, which `rentals.list()`
    // rewrites — tracked, that re-ran this effect (double load on a deep link, and an endless
    // loop when the row is not in the list).
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });

    const onVisible = (): void => {
      if (this.document.visibilityState === 'visible' && this.chargesLoaded()) {
        this.charges$.next({ id: this.id(), quiet: true });
      }
    };
    this.document.addEventListener('visibilitychange', onVisible);
    this.destroyRef.onDestroy(() =>
      this.document.removeEventListener('visibilitychange', onVisible),
    );
  }

  private load(id: string): void {
    this.rental.set(null);
    this.charges.set([]);
    this.chargesLoaded.set(false);
    this.docs.set([]);
    this.docsLoaded.set(false);
    this.showAll.set(false);
    this.payingId.set(null);
    this.rental$.next(id);
    this.charges$.next({ id, quiet: false });
    this.docs$.next(id);
    this.loadIdentity(id);
  }

  protected reload(): void {
    this.rental$.next(this.id());
    this.charges$.next({ id: this.id(), quiet: false });
    this.docs$.next(this.id());
  }

  protected reloadCharges(): void {
    this.charges$.next({ id: this.id(), quiet: false });
  }

  protected reloadDocs(): void {
    this.docs$.next(this.id());
  }

  protected toggleAll(): void {
    this.showAll.update((v) => !v);
  }

  protected pay(charge: DriverCharge | null): void {
    if (charge && !this.readOnlySession()) this.payingId.set(charge.id);
  }

  protected closePay(): void {
    this.payingId.set(null);
  }

  protected openDoc(row: DocRow): void {
    const rentalId = this.id();
    this.preview.open({
      source: () => this.rentals.documentSignedUrl(rentalId, row.doc.id),
      fileName: `${row.name}.pdf`,
      title: row.name,
      errorMessage: 'Não foi possível abrir o documento.',
    });
  }

  /**
   * Plate and model from the LIST row. Arrived by the list, it is in memory; opened by a
   * link or a reload, the driver's list is asked for once (`GET /v1/rentals` is his own).
   * A failure only leaves the line empty: the rest of the screen does not depend on it.
   */
  private loadIdentity(id: string): void {
    const cached = this.rentals.items().find((row) => row.id === id);
    if (cached) {
      this.identity.set(cached);
      return;
    }
    this.identity.set(null);
    this.rentals
      .list({ size: IDENTITY_PAGE_SIZE })
      .pipe(
        map((page) => (page.content ?? []).find((row) => row.id === id) ?? null),
        catchError((err: unknown) => {
          this.apiErrors.claim(err);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((row) => {
        if (this.id() === id) this.identity.set(row);
      });
  }
}
