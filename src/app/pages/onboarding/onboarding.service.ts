import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, tap, catchError, finalize, throwError, timeout, map, of } from 'rxjs';
import { OnboardingData, OnboardingState, OnboardingStepPayload } from './onboarding.types';
import { SessionService } from '../../services/session.service';
import { environment } from '../../../environments/environment';

const API_BASE = `${environment.apiUrl}/onboarding`;

const INITIAL_STATE: OnboardingState = {
  step: 1,
  isCompleted: false,
  data: {},
};

@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private readonly http = inject(HttpClient);
  private readonly sessionService = inject(SessionService);

  /** Local cache of backend state — backend is source of truth */
  private readonly _state = signal<OnboardingState>({ ...INITIAL_STATE });
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

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
        }
      }),
      catchError((err: HttpErrorResponse) => {
        // Fresh users have no onboarding row yet — backend returns 404.
        // Treat as "no progress" (initial state), not an error to surface.
        if (err.status === 404) {
          const initial: OnboardingState = { ...INITIAL_STATE };
          this._state.set(initial);
          return of(initial);
        }
        this.error.set('Não foi possível carregar o progresso. Tente novamente.');
        return throwError(() => err);
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

  finish(): Observable<void> {
    this.loading.set(true);
    this.error.set(null);
    return this.http.post(`${API_BASE}/finish`, {}, { responseType: 'text' }).pipe(
      map(() => void 0),
      tap(() => {
        this._state.update((s) => ({ ...s, isCompleted: true }));
        this.sessionService.setOnboardingCompleted(true);
      }),
      catchError((err: HttpErrorResponse) => {
        const errorText = typeof err.error === 'string' ? err.error : JSON.stringify(err.error || {});
        if (err.status === 409 || errorText.includes('já finalizado')) {
          this._state.update((s) => ({ ...s, isCompleted: true }));
          this.sessionService.setOnboardingCompleted(true);
          return of(void 0);
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
