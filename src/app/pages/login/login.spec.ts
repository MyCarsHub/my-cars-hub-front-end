import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Login } from './login';
import { LoginService } from '../../services/loginService';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';

describe('Login', () => {
  let component: Login;
  let fixture: ComponentFixture<Login>;
  let login: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;

  function fillValidForm(): void {
    component.loginForm.patchValue({
      email: 'fulano@example.com',
      password: 'password123',
    });
  }

  function submit(): void {
    (fixture.componentInstance as unknown as { submit: () => void }).submit();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    login = vi.fn();
    notifyError = vi.fn();

    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: LoginService, useValue: { login, loginWithGoogle: vi.fn() } },
        {
          provide: NotificationService,
          useValue: { error: notifyError, warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * Production bug: `errorInterceptor` skips 401 on `/auth/login` on purpose, and the
   * component's error callback was empty — a wrong password produced no feedback at all.
   */
  it('shows a wrong-password 401 in the form banner and fires no toast', () => {
    const error = new HttpErrorResponse({
      status: 401,
      error: { message: 'Credenciais inválidas' },
    });
    login.mockReturnValue(throwError(() => error));

    fillValidForm();
    submit();

    const banner = fixture.nativeElement.querySelector('app-alert-banner') as HTMLElement | null;
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Credenciais inválidas');
    expect(banner?.querySelector('[role="alert"]')).not.toBeNull();

    expect(notifyError).not.toHaveBeenCalled();
  });

  it('drops a backend fieldErrors entry on the matching field, not in a toast', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        message: 'Informe um e-mail válido.',
        fieldErrors: { email: 'Informe um e-mail válido.' },
      },
    });
    login.mockReturnValue(throwError(() => error));

    fillValidForm();
    submit();

    const inline = fixture.nativeElement.querySelector('#login-email-error') as HTMLElement | null;
    expect(inline?.textContent?.trim()).toBe('Informe um e-mail válido.');

    const input = fixture.nativeElement.querySelector('#login-email') as HTMLInputElement;
    expect(input.getAttribute('aria-describedby')).toBe('login-email-error');

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
