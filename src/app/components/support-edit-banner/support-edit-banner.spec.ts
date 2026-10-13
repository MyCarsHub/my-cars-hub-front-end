import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ImpersonationService } from '../../services/impersonation.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import { ImpersonationState } from '../../types/impersonation.types';
import { ImpersonationBanner } from '../impersonation-banner/impersonation-banner';
import { SupportEditBanner } from './support-edit-banner';

function state(overrides: Partial<ImpersonationState> = {}): ImpersonationState {
  return {
    sessionId: 's1',
    companyId: 'co-1',
    companyName: 'Locadora Alfa',
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    clockOffsetMs: 0,
    ...overrides,
  };
}

function setup(current: ImpersonationState | null) {
  const _state = signal(current);
  const service = {
    state: _state.asReadonly(),
    editMode: () => _state()?.mode === 'EDIT',
    readOnly: () => _state() !== null && _state()?.mode !== 'EDIT',
    remainingMs: (s: ImpersonationState) => Date.parse(s.expiresAt) - Date.now(),
    extendEdit: vi.fn(() => of(state())),
    end: vi.fn(() => of(void 0)),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: ImpersonationService, useValue: service },
      { provide: NotificationService, useValue: { success: vi.fn(), warning: vi.fn() } },
      { provide: ApiErrorService, useValue: { messageFor: vi.fn(() => 'erro') } },
    ],
  });
  return { service };
}

describe('banners de impersonação', () => {
  it('EDIÇÃO: mostra a barra vermelha com empresa, contagem e os dois botões', () => {
    setup(state({ mode: 'EDIT', absoluteExpiresAt: new Date(Date.now() + 3_600_000).toISOString() }));
    const fixture = TestBed.createComponent(SupportEditBanner);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('Modo edição');
    expect(root.textContent).toContain('Locadora Alfa');
    expect(root.textContent).toMatch(/expira em \d+ minutos/);
    expect(root.querySelector('[role="alert"]')?.className).toContain('bg-rose-700');
    const buttons = Array.from(root.querySelectorAll('button'));
    expect(buttons.map((b) => (b.textContent ?? '').trim().split(/\s+/)[0])).toEqual([
      'Extender',
      'Encerrar',
    ]);
    expect(buttons.every((b) => b.className.includes('min-h-11'))).toBe(true);
  });

  it('EDIÇÃO: Extender e Encerrar chamam o serviço', () => {
    const { service } = setup(state({ mode: 'EDIT' }));
    const fixture = TestBed.createComponent(SupportEditBanner);
    fixture.detectChanges();
    const [extend, stop] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );

    extend.click();
    stop.click();

    expect(service.extendEdit).toHaveBeenCalledTimes(1);
    expect(service.end).toHaveBeenCalledTimes(1);
  });

  it('EDIÇÃO: Extender fica desabilitado no teto absoluto', () => {
    const at = new Date(Date.now() + 10 * 60_000).toISOString();
    setup(state({ mode: 'EDIT', expiresAt: at, absoluteExpiresAt: at }));
    const fixture = TestBed.createComponent(SupportEditBanner);
    fixture.detectChanges();

    const [extend] = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    expect(extend.disabled).toBe(true);
  });

  it('LEITURA: a barra âmbar segue igual e a vermelha não aparece', () => {
    setup(state());
    const amber = TestBed.createComponent(ImpersonationBanner);
    amber.detectChanges();
    const red = TestBed.createComponent(SupportEditBanner);
    red.detectChanges();

    const amberText = (amber.nativeElement as HTMLElement).textContent ?? '';
    expect(amberText).toContain('Modo somente leitura');
    expect((amber.nativeElement as HTMLElement).querySelector('[role="alert"]')?.className).toContain(
      'bg-amber-300',
    );
    expect((red.nativeElement as HTMLElement).querySelector('[role="alert"]')).toBeNull();
  });
});
