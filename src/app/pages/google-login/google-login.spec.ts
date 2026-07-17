import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { LoginService } from '../../services/loginService';
import { GoogleLogin } from './google-login';

describe('GoogleLogin', () => {
  let component: GoogleLogin;
  let fixture: ComponentFixture<GoogleLogin>;
  const loginWithGoogle = vi.fn();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GoogleLogin],
      providers: [{ provide: LoginService, useValue: { loginWithGoogle } }],
    }).compileComponents();

    fixture = TestBed.createComponent(GoogleLogin);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts the Google OAuth flow once and shows a loading state', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');

    button.click();
    fixture.detectChanges();
    button.click();

    expect(loginWithGoogle).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Redirecionando para o Google');
  });
});
