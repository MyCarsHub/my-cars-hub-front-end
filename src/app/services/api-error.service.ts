import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { NotificationService } from './notification.service';
import {
  ApplyFieldErrorsResult,
  ParsedApiError,
  applyFieldErrors,
  fallbackMessageForStatus,
  flatErrorMessage,
  formLevelMessage,
  parseApiError,
} from './api-error';

export interface HandleFormErrorResult extends ApplyFieldErrorsResult {
  /** Message for the form-level banner, or `null` when everything is already inline. */
  formMessage: string | null;
  parsed: ParsedApiError;
}

/**
 * Grace period between the interceptor scheduling the safety net and the toast firing.
 * Component `error:` callbacks run synchronously on the same tick the error propagates,
 * so any screen that handles the error claims it long before this elapses.
 */
const SAFETY_NET_DELAY_MS = 250;

/**
 * Owns the "who shows what" contract for HTTP errors.
 *
 * - 0 / 401 / 403 / 5xx → toast, fired by `errorInterceptor` only.
 * - 4xx → the screen shows it inline (field-level or banner). The interceptor merely
 *   schedules a **safety net**: if no screen claims the error within
 *   `SAFETY_NET_DELAY_MS`, a toast fires so the user is never left without feedback.
 *
 * A screen claims an error by calling `handleForm()` or `messageFor()`.
 */
@Injectable({ providedIn: 'root' })
export class ApiErrorService {
  private readonly notifications = inject(NotificationService);

  /** Errors already claimed by a screen. Weak so entries die with the response object. */
  private readonly claimed = new WeakSet<HttpErrorResponse>();

  /** Called by `errorInterceptor` for 4xx statuses it deliberately does not toast. */
  scheduleSafetyNet(error: HttpErrorResponse): void {
    if (typeof window === 'undefined') return;

    window.setTimeout(() => {
      if (this.claimed.has(error)) return;
      const parsed = parseApiError(error);
      this.notifications.error(flatErrorMessage(parsed, fallbackMessageForStatus(parsed.status)));
    }, SAFETY_NET_DELAY_MS);
  }

  /** Marks an error as handled by the screen, suppressing the safety-net toast. */
  claim(error: unknown): void {
    if (error instanceof HttpErrorResponse) this.claimed.add(error);
  }

  /**
   * Distributes `fieldErrors` into `form` and returns what is left for the banner.
   * Claims the error — no toast will be shown for it.
   */
  handleForm(error: unknown, form: AbstractControl, fallback?: string): HandleFormErrorResult {
    this.claim(error);
    const parsed = parseApiError(error);
    const result = applyFieldErrors(form, parsed.fieldErrors);
    return { ...result, parsed, formMessage: formLevelMessage(parsed, result, fallback) };
  }

  /**
   * Flat message for screens with no form (lists, detail pages, dialogs).
   * Claims the error — no toast will be shown for it.
   */
  messageFor(error: unknown, fallback?: string): string {
    this.claim(error);
    const parsed = parseApiError(error);
    return flatErrorMessage(parsed, fallback ?? fallbackMessageForStatus(parsed.status));
  }
}
