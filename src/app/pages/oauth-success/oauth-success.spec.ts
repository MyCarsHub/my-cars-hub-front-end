import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { OauthSuccess } from './oauth-success';
import { AuthService } from '../../services/auth.service';
import { SessionService } from '../../services/session.service';
import { MeResponse } from '../../types/me-response.type';

describe('OauthSuccess', () => {
  let component: OauthSuccess;
  let fixture: ComponentFixture<OauthSuccess>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OauthSuccess],
      providers: [
        provideRouter([
          { path: 'login', children: [] },
          { path: 'dashboard', children: [] },
          { path: 'onboarding', children: [] },
        ]),
        provideHttpClient(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OauthSuccess);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

describe('OauthSuccess routing (systemRole aware)', () => {
  function buildMe(overrides: Partial<MeResponse>): MeResponse {
    return {
      id: 'u-1',
      name: 'X',
      email: 'x@x.com',
      document: null,
      companies: [],
      onboardingCompleted: false,
      systemRole: 'USER',
      ...overrides,
    };
  }

  async function setup(me: MeResponse) {
    const navigate = vi.fn();
    const authService = { getMe: vi.fn().mockReturnValue(of(me)) };
    const sessionService = {
      clear: vi.fn(),
      setToken: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [OauthSuccess],
      providers: [
        provideHttpClient(),
        { provide: Router, useValue: { navigate } },
        { provide: AuthService, useValue: authService },
        { provide: SessionService, useValue: sessionService },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap({ token: 'legacy-jwt' }) },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OauthSuccess);
    fixture.detectChanges();
    await fixture.whenStable();
    return { navigate, authService, sessionService };
  }

  it('routes PLATFORM_ADMIN with companies=[] straight to /dashboard', async () => {
    const { navigate } = await setup(
      buildMe({ systemRole: 'PLATFORM_ADMIN', companies: [] }),
    );
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('routes USER with companies=[] to /onboarding (unchanged behavior)', async () => {
    const { navigate } = await setup(buildMe({ systemRole: 'USER', companies: [] }));
    expect(navigate).toHaveBeenCalledWith(['/onboarding']);
  });

  it('routes USER with companies to /dashboard', async () => {
    const { navigate } = await setup(
      buildMe({
        systemRole: 'USER',
        companies: [{ companyId: 'c-1', companyName: 'A', role: 'OWNER' }],
      }),
    );
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
