import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, tap, catchError, finalize, throwError, timeout, map, of } from 'rxjs';
import { OnboardingData, OnboardingState, OnboardingStepPayload } from './onboarding.types';
import { SessionService } from '../../services/session.service';
import { NotificationService } from '../../services/notification.service';
import { environment } from '../../../environments/environment';

export interface OnboardingFinishResponse {
  message: string;
  token: string;
  companyId: string;
  companyName: string;
  role: string;
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

@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private readonly http = inject(HttpClient);
  private readonly sessionService = inject(SessionService);
  private readonly notify = inject(NotificationService);

  /** Local cache of backend state — backend is source of truth */
  private readonly _state = signal<OnboardingState>({ ...INITIAL_STATE });
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Debounces error toasts across concurrent loadState() subscribers. */
  private errorNotified = false;

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
    this.error.set(null);
    return this.http.get<OnboardingState>(API_BASE).pipe(
      tap((state) => {
        if (state) {
          this._state.set(state);
          this.errorNotified = false;
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
        if (err.status !== 404 && !this.errorNotified) {
          this.errorNotified = true;
          this.notify.error(
            'Não conseguimos carregar seu progresso — começando do zero. Tente novamente se precisar.',
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
    this.error.set(null);

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

        const currentStepNumber = Number(state.step);
        const previousStepNumber = Number(payload.step);

        this._state.set(state);

        if (currentStepNumber === previousStepNumber) {
          this.advanceStep();
        }
      }),
      catchError((err) => {
        this.error.set('Não foi possível salvar. Tente novamente.');
        return throwError(() => err);
      }),
      finalize(() => this.loading.set(false)),
    );
  }

  finish(): Observable<OnboardingFinishResponse | null> {
    this.loading.set(true);
    this.error.set(null);
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
          this._state.update((s) => ({ ...s, isCompleted: true }));
          this.sessionService.setOnboardingCompleted(true);
          return of(null);
        }
        this.error.set('Não foi possível finalizar o cadastro. Tente novamente.');
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
