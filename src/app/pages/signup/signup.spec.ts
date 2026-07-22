import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Signup } from './signup';

describe('Signup', () => {
  let component: Signup;
  let fixture: ComponentFixture<Signup>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Signup],
      providers: [provideRouter([])],
    })
    .compileComponents();

    fixture = TestBed.createComponent(Signup);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('is invalid until acceptedTerms is checked (submit blocked)', () => {
    component.signupForm.patchValue({
      name: 'Fulano',
      email: 'fulano@example.com',
      password: 'password123',
      passwordConfirm: 'password123',
      acceptedTerms: false,
    });
    expect(component.signupForm.valid).toBe(false);

    component.signupForm.patchValue({ acceptedTerms: true });
    expect(component.signupForm.valid).toBe(true);
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
});
