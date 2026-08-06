import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImpersonationBanner } from './impersonation-banner';
import { ImpersonationService } from '../../services/impersonation.service';
import { ImpersonationState } from '../../types/impersonation.types';

const SESSION: ImpersonationState = {
  sessionId: 'sess-1',
  companyId: 'co-1',
  companyName: 'Locadora Alfa',
  startedAt: '2026-01-01T12:00:00Z',
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  clockOffsetMs: 0,
};

describe('ImpersonationBanner', () => {
  let state: ReturnType<typeof signal<ImpersonationState | null>>;
  let end: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    state = signal<ImpersonationState | null>(SESSION);
    end = vi.fn(() => of(void 0));

    TestBed.configureTestingModule({
      imports: [ImpersonationBanner],
      providers: [
        {
          provide: ImpersonationService,
          useValue: {
            state,
            end,
            // Mesma conta do serviço real, incluindo o offset de relógio: é
            // dele que a contagem regressiva passa a sair.
            remainingMs: (session: ImpersonationState | null = state()) =>
              session
                ? Math.max(0, Date.parse(session.expiresAt) - (Date.now() + session.clockOffsetMs))
                : 0,
          },
        },
      ],
    });
  });

  it('nomeia a empresa e avisa que é somente leitura', () => {
    const fixture = TestBed.createComponent(ImpersonationBanner);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Locadora Alfa');
    expect(text.toLowerCase()).toContain('somente leitura');
    expect(text).toContain('expira em');
  });

  it('anuncia como alerta e NÃO oferece forma de dispensar o aviso', () => {
    const fixture = TestBed.createComponent(ImpersonationBanner);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    // O único botão da barra é o de encerrar a sessão.
    const buttons = Array.from(host.querySelectorAll('button'));
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain('Encerrar');
  });

  it('encerra a sessão em um clique', () => {
    const fixture = TestBed.createComponent(ImpersonationBanner);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();

    expect(end).toHaveBeenCalledTimes(1);
  });

  it('não renderiza nada fora de uma sessão de impersonação', () => {
    state.set(null);
    const fixture = TestBed.createComponent(ImpersonationBanner);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent?.trim()).toBe('');
  });
});
