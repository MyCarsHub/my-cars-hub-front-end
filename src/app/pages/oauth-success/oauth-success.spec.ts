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

  it('renders the shared full-page loader with its own wording', () => {
    fixture.detectChanges();
    const loader = (fixture.nativeElement as HTMLElement).querySelector('app-page-loader');
    expect(loader?.querySelector('h1')?.textContent).toContain('Processando autenticação');
    expect(loader?.querySelector('p')?.textContent).toContain('Aguarde enquanto finalizamos o login.');
    expect(loader?.querySelector('.animate-spin')).not.toBeNull();
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

  async function setup(
    me: MeResponse,
    stored: Record<string, string> = {},
    companyRole: string | null = null,
  ) {
    const navigate = vi.fn();
    const navigateByUrl = vi.fn();
    const authService = { getMe: vi.fn().mockReturnValue(of(me)) };
    const store = { ...stored };
    const sessionService = {
      clear: vi.fn(() => {
        for (const key of Object.keys(store)) delete store[key];
      }),
      setToken: vi.fn(),
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      // O papel da empresa vem do TOKEN; o teste decide qual token a sessao tem.
      getCompanyRoleFromToken: vi.fn(() => companyRole),
      // O `/auth/me` grava o id do usuário; aqui, o do `me`.
      getUserId: vi.fn(() => store['id'] ?? me.id),
      // Mesmo contrato do `SessionService`: guarda rascunhos e o "voltar para" e os recoloca.
      preserveAcrossRelogin: vi.fn(() => {
        const kept = Object.entries(store).filter(
          ([key]) => key.startsWith('rentalCreateDraft:') || key === 'returnAfterLogin',
        );
        return () => kept.forEach(([key, value]) => (store[key] = value));
      }),
      takeReturnUrl: vi.fn((userId: string | null) => {
        const raw = store['returnAfterLogin'];
        delete store['returnAfterLogin'];
        if (!raw) return null;
        const saved = JSON.parse(raw) as { userId: string; url: string };
        return saved.userId === userId ? saved.url : null;
      }),
    };

    await TestBed.configureTestingModule({
      imports: [OauthSuccess],
      providers: [
        provideHttpClient(),
        { provide: Router, useValue: { navigate, navigateByUrl } },
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
    return { navigate, navigateByUrl, authService, sessionService, store };
  }

  /**
   * Convite: o login existe só para aceitar o convite, então `/auth/me` é pulado — o
   * convidado ainda não tem empresa e cairia em /onboarding. O token bruto é reposto
   * DEPOIS do `clear()`, que derruba o sessionStorage inteiro.
   */
  it('volta para a página do convite quando há token de convite pendente', async () => {
    const { navigate, authService, sessionService } = await setup(
      buildMe({ systemRole: 'USER', companies: [] }),
      { pendingInviteToken: 'raw-token' },
    );

    expect(authService.getMe).not.toHaveBeenCalled();
    expect(sessionService.setItem).toHaveBeenCalledWith('pendingInviteToken', 'raw-token');
    expect(navigate).toHaveBeenCalledWith(['/convite'], {
      replaceUrl: true,
      state: { inviteResume: true },
    });
  });

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

  it('sends a DRIVER to his own panel, not to a /dashboard that would bounce him with a notice', async () => {
    const { navigate } = await setup(
      buildMe({
        systemRole: 'USER',
        companies: [{ companyId: 'c-1', companyName: 'A', role: 'DRIVER' }],
        hasCompletedOnboarding: true,
      }),
      {},
      'DRIVER',
    );
    expect(navigate).toHaveBeenCalledWith(['/meu-painel']);
  });

  it('routes to /dashboard when hasCompletedOnboarding=true even if companies=[]', async () => {
    const { navigate } = await setup(
      buildMe({
        systemRole: 'USER',
        companies: [],
        hasCompletedOnboarding: true,
      }),
    );
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('routes to /onboarding when hasCompletedOnboarding=false even if companies has entries', async () => {
    const { navigate } = await setup(
      buildMe({
        systemRole: 'USER',
        companies: [{ companyId: 'c-1', companyName: 'A', role: 'OWNER' }],
        hasCompletedOnboarding: false,
      }),
    );
    expect(navigate).toHaveBeenCalledWith(['/onboarding']);
  });

  it('falls back to companies-length derivation when hasCompletedOnboarding is missing (deploy skew)', async () => {
    const { navigate } = await setup(
      buildMe({
        systemRole: 'USER',
        companies: [{ companyId: 'c-1', companyName: 'A', role: 'OWNER' }],
      }),
    );
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('sessão que caiu: o rascunho atravessa o login de novo e o MESMO usuário volta à tela', async () => {
    const draft = JSON.stringify({ v: 1, form: { driverId: 'drv-2' } });
    const { navigate, navigateByUrl, store } = await setup(
      buildMe({ id: 'u-1', systemRole: 'USER', companies: [{ companyId: 'c-1', companyName: 'A', role: 'OWNER' }] }),
      {
        'rentalCreateDraft:u-1:c-1': draft,
        returnAfterLogin: JSON.stringify({ userId: 'u-1', url: '/alugueis/novo' }),
        token: 'old',
      },
    );
    expect(store['rentalCreateDraft:u-1:c-1']).toBe(draft);
    expect(store['token']).toBeUndefined();
    expect(navigateByUrl).toHaveBeenCalledWith('/alugueis/novo');
    expect(navigate).not.toHaveBeenCalled();
    expect(store['returnAfterLogin']).toBeUndefined();
  });

  it('PLATFORM_ADMIN com a sessão caída também volta à tela (antes caía no /dashboard)', async () => {
    const { navigate, navigateByUrl, store } = await setup(
      buildMe({ id: 'u-1', systemRole: 'PLATFORM_ADMIN', companies: [{ companyId: 'c-1', companyName: 'A', role: 'OWNER' }] }),
      { returnAfterLogin: JSON.stringify({ userId: 'u-1', url: '/alugueis/novo' }) },
    );
    expect(navigateByUrl).toHaveBeenCalledWith('/alugueis/novo');
    expect(navigate).not.toHaveBeenCalled();
    expect(store['returnAfterLogin']).toBeUndefined();
  });

  it('outro usuário entrando: não volta à tela do anterior', async () => {
    const { navigate, navigateByUrl } = await setup(
      buildMe({ id: 'u-2', systemRole: 'USER', companies: [{ companyId: 'c-1', companyName: 'A', role: 'OWNER' }] }),
      { returnAfterLogin: JSON.stringify({ userId: 'u-1', url: '/alugueis/novo' }) },
    );
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
