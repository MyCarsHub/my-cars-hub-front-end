import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Signup } from './signup';
import { LoginService } from '../../services/loginService';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';

describe('Signup', () => {
  let component: Signup;
  let fixture: ComponentFixture<Signup>;
  let signup: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;

  function submit(): void {
    (fixture.componentInstance as unknown as { submit: () => void }).submit();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    signup = vi.fn();
    notifyError = vi.fn();

    await TestBed.configureTestingModule({
      imports: [Signup],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: LoginService, useValue: { signup, loginWithGoogle: vi.fn() } },
        {
          provide: NotificationService,
          useValue: { error: notifyError, warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Signup);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('blocks the request until acceptedTerms is checked', () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    signup.mockReturnValue(of({}));

    component.signupForm.patchValue({
      name: 'Fulano',
      email: 'fulano@example.com',
      password: 'password123',
      passwordConfirm: 'password123',
      acceptedTerms: false,
    });
    expect(component.signupForm.valid).toBe(false);

    submit();

    // the whole point: an unchecked checkbox must never reach the backend
    expect(signup).not.toHaveBeenCalled();
    expect(component.signupForm.touched).toBe(true);
    expect(fixture.nativeElement.querySelector('app-alert-banner')).not.toBeNull();

    component.signupForm.patchValue({ acceptedTerms: true });
    expect(component.signupForm.valid).toBe(true);

    submit();

    expect(signup).toHaveBeenCalledTimes(1);
    expect(signup).toHaveBeenCalledWith('Fulano', 'fulano@example.com', 'password123');
  });

  it('is invalid when passwords do not match; valid when they match', () => {
    component.signupForm.patchValue({
      name: 'Fulano',
      email: 'fulano@example.com',
      password: 'password123',
      passwordConfirm: 'different1',
      acceptedTerms: true,
    });
    expect(component.signupForm.hasError('passwordMismatch')).toBe(true);
    expect(component.signupForm.valid).toBe(false);

    component.signupForm.patchValue({ passwordConfirm: 'password123' });
    expect(component.signupForm.hasError('passwordMismatch')).toBe(false);
    expect(component.signupForm.valid).toBe(true);
  });

  /**
   * Production bug: the error callback was empty and 409 is not toasted by the interceptor,
   * so a duplicate e-mail vanished. The backend sends `fieldErrors: { email: ... }`.
   */
  it('renders a duplicate-email 409 under the e-mail field, not as a banner or toast', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: {
        message: 'E-mail já cadastrado.',
        fieldErrors: { email: 'E-mail já cadastrado.' },
      },
    });
    signup.mockReturnValue(throwError(() => error));

    component.signupForm.patchValue({
      name: 'Fulano',
      email: 'fulano@example.com',
      password: 'password123',
      passwordConfirm: 'password123',
      acceptedTerms: true,
    });
    submit();

    const inline = fixture.nativeElement.querySelector('#signup-email-error') as HTMLElement | null;
    expect(inline).not.toBeNull();
    expect(inline?.textContent?.trim()).toBe('E-mail já cadastrado.');
    expect(inline?.getAttribute('role')).toBe('alert');

    const input = fixture.nativeElement.querySelector('#signup-email') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('signup-email-error');

    // not repeated in the form-level banner
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();

    // and never a toast — the safety net must stay quiet
    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
