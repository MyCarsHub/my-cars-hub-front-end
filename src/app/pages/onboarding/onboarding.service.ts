import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, tap, catchError, finalize, throwError, timeout, map, of } from 'rxjs';
import { OnboardingData, OnboardingState, OnboardingStepPayload } from './onboarding.types';
import { SessionService } from '../../services/session.service';
import { ApiErrorService } from '../../services/api-error.service';
import { environment } from '../../../environments/environment';
import { normalizeDocument } from '../../utils/document-mask';

export interface OnboardingFinishResponse {
  message: string;
  token: string;
  companyId: string;
  companyName: string;
  role: string;
}

/** `POST /onboarding/cnpj-availability` — `available` is always true on 200. */
export interface CnpjAvailabilityResponse {
  available: boolean;
}

const API_BASE = `${environment.apiUrl}/onboarding`;

const INITIAL_STATE: OnboardingState = {
  step: 1,
  // Load-bearing: onboardingGuard fails closed on !isCompleted — do not flip to true here.
  isCompleted: false,
  data: {},
};

function isInitialState(s: OnboardingState): boolean {
  return s.step === 1 && s.isCompleted === false && Object.keys(s.data).length === 0;
}

const MIN_STEP = 1;
const MAX_STEP = 4;

/**
 * Clamp the step returned by the backend into the valid range [1, MAX_STEP].
 * Defensive against legacy backends that may return step=0 (no-record default)
 * or any out-of-range value: without this, @switch (currentStep()) in the
 * container wouldn't match any case and the step body would render blank.
 */
function normalizeState(s: OnboardingState): OnboardingState {
  const raw = Number(s?.step);
  const step = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw) || MIN_STEP, MIN_STEP), MAX_STEP) : MIN_STEP;
  return {
    step,
    isCompleted: !!s?.isCompleted,
    data: s?.data ?? {},
  };
}

@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private readonly http = inject(HttpClient);
  private readonly sessionService = inject(SessionService);
  private readonly apiErrors = inject(ApiErrorService);

  /** Local cache of backend state — backend is source of truth */
  private readonly _state = signal<OnboardingState>({ ...INITIAL_STATE });
  readonly loading = signal(false);

  /** True while the advisory CNPJ availability check is in flight. */
  readonly checkingCnpj = signal(false);

  /** Canonical CNPJs already confirmed available — keeps the 5/60s bucket intact. */
  private readonly availableCnpjs = new Set<string>();

  /**
   * Load-failure copy for the container banner. Save/finish failures are NOT written here:
   * the container claims those so it can drop backend `fieldErrors` onto the step form.
   */
  readonly loadError = signal<string | null>(null);

  // ── Derived signals ──────────────────────────────────────────────────────
  readonly state = this._state.asReadonly();
  readonly currentStep = computed(() => this._state().step);
  readonly isCompleted = computed(() => this._state().isCompleted);
  readonly formData = computed(() => this._state().data);
  readonly isFirstStep = computed(() => this._state().step === 1);
  readonly isLastStep = computed(() => this._state().step === 4);
  readonly totalSteps = 4;

  // ── API Calls ─────────────────────────────────────────────────────────────

  /**
   * Fetch current onboarding state from backend.
   * Called on init and on every "Back" click.
   */
  loadState(): Observable<OnboardingState> {
    this.loading.set(true);
    this.loadError.set(null);
    return this.http.get<OnboardingState>(API_BASE).pipe(
      tap((state) => {
        if (state) {
          this._state.set(normalizeState(state));
        }
      }),
      catchError((err: HttpErrorResponse) => {
        // Never trap the user on an empty card. On first-load failure fall back
        // to INITIAL_STATE so the page can render step 1. If state was ALREADY
        // populated by a prior successful load, DO NOT overwrite it — a transient
        // 500 on a Back click must not yank the user back to step 1.
        // 404 = fresh user (no onboarding row yet) — expected, silent.
        const current = this._state();
        const preservePopulated = !isInitialState(current);
        // Always claim: a 404 here is the expected "fresh user" case and must not reach
        // the interceptor safety net as a "Registro não encontrado." toast.
        if (err.status === 404) {
          this.apiErrors.claim(err);
        } else {
          this.loadError.set(
            this.apiErrors.messageFor(
              err,
              'Não conseguimos carregar seu progresso — começando do zero. Tente novamente se precisar.',
            ),
          );
        }
        if (preservePopulated) {
          return of(current);
        }
        const initial: OnboardingState = { ...INITIAL_STATE };
        this._state.set(initial);
        return of(initial);
      }),
      finalize(() => this.loading.set(false)),
    );
  }

  /**
   * Save current step data to backend.
   * Sends the FULL data object merged with new step data.
   * Called on every "Next" click.
   */
  saveStep(step: number, stepData: Partial<OnboardingData>): Observable<OnboardingState> {
    this.loading.set(true);
    this.loadError.set(null);

    // Merge new data with existing — never lose previously saved fields
    const fullData: OnboardingData = {
      ...this._state().data,
      ...stepData,
    };

    const payload: OnboardingStepPayload = { step, data: fullData };

    return this.http.post<OnboardingState>(`${API_BASE}/step`, payload).pipe(
      timeout(15000),
      tap((state) => {
        if (!state) {
          this.advanceStep();
          return;
        }

        const normalized = normalizeState(state);
        const currentStepNumber = normalized.step;
        const previousStepNumber = Number(payload.step);

        this._state.set(normalized);

        if (currentStepNumber === previousStepNumber) {
          this.advanceStep();
        }
      }),
      // The container owns the message: it distributes backend `fieldErrors` onto the
      // step form and only banners what is left. Setting it here too showed it twice.
      finalize(() => this.loading.set(false)),
    );
  }

  /**
   * Advisory check that a CNPJ can still be claimed, so the user is told at the document
   * step instead of at "Finalizar" — where the whole transaction aborts.
   *
   * NOT a guarantee: a database trigger is what actually enforces uniqueness at write
   * time, and someone else may claim the document between this call and `/finish`.
   *
   * POST, not GET, on purpose: the document is PII and must never reach a query string,
   * access log, browser history or `Referer`.
   *
   * The endpoint is rate-limited to 5 requests / 60s per IP, so results are memoised per
   * canonical document — re-clicking "Próximo" with an unchanged value costs nothing.
   * Callers must not invoke this while the local mod-11 check is failing.
   */
  checkCnpjAvailability(cnpj: string): Observable<CnpjAvailabilityResponse> {
    // Always a string — canonical form, letters upper-cased, separators stripped.
    const document = normalizeDocument(cnpj);
    if (this.availableCnpjs.has(document)) {
      return of({ available: true });
    }

    this.checkingCnpj.set(true);
    return this.http
      .post<CnpjAvailabilityResponse>(`${API_BASE}/cnpj-availability`, { cnpj: document })
      .pipe(
        timeout(15000),
        tap(() => this.availableCnpjs.add(document)),
        finalize(() => this.checkingCnpj.set(false)),
      );
  }

  finish(): Observable<OnboardingFinishResponse | null> {
    this.loading.set(true);
    this.loadError.set(null);
    return this.http.post<OnboardingFinishResponse>(`${API_BASE}/finish`, {}).pipe(
      tap((response) => {
        this._state.update((s) => ({ ...s, isCompleted: true }));
        this.sessionService.setOnboardingCompleted(true);
        // Backend agora retorna JWT já com companyId — elimina race com /auth/me.
        if (response?.token) {
          this.sessionService.setToken(response.token);
        }
        if (response?.companyId) {
          this.sessionService.setItem('selectedCompanyId', response.companyId);
          this.sessionService.setItem('selectedCompanyName', response.companyName ?? '');
          this.sessionService.setItem('selectedRole', response.role ?? 'OWNER');
        }
      }),
      catchError((err: HttpErrorResponse) => {
        const errorText = typeof err.error === 'string' ? err.error : JSON.stringify(err.error || {});
        if (err.status === 409 || errorText.includes('já finalizado')) {
          // Not a failure for the user: swallow it AND claim it so the safety net stays quiet.
          this.apiErrors.claim(err);
          this._state.update((s) => ({ ...s, isCompleted: true }));
          this.sessionService.setOnboardingCompleted(true);
          return of(null);
        }
        return throwError(() => err);
      }),
      finalize(() => this.loading.set(false)),
    );
  }

  /** Advance step locally after successful save */
  advanceStep(): void {
    this._state.update((s) => ({
      ...s,
      step: Math.min(s.step + 1, this.totalSteps),
    }));
  }

  /** Decrement step locally after re-sync with backend */
  goBackStep(): void {
    this._state.update((s) => ({
      ...s,
      step: Math.max(s.step - 1, 1),
    }));
  }

}
