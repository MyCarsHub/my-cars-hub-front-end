import { signal, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { EMPTY, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App, EDIT_BANNER_LOADER } from './app';
import { SupportEditBanner } from './components/support-edit-banner/support-edit-banner';
import { ImpersonationService } from './services/impersonation.service';

function setup(loader: () => Promise<Type<unknown>>) {
  const editMode = signal(true);
  const end = vi.fn(() => of(void 0));
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: SwUpdate,
        useValue: {
          isEnabled: false,
          versionUpdates: EMPTY,
          unrecoverable: EMPTY,
          activateUpdate: () => Promise.resolve(false),
        },
      },
      {
        provide: ImpersonationService,
        useValue: {
          editMode,
          companyName: signal('Locadora Alfa'),
          state: signal(null),
          active: () => true,
          remainingMs: () => 0,
          readOnly: () => false,
          end,
        },
      },
      { provide: EDIT_BANNER_LOADER, useValue: loader },
    ],
  });
  const fixture = TestBed.createComponent(App);
  return { fixture, end };
}

async function flush(fixture: ReturnType<typeof setup>['fixture']): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
  }
}

describe('App — barra do modo edição', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('chunk que falha: barra mínima de reserva visível, com Encerrar, e tenta 3 vezes', async () => {
    const loader = vi.fn(() => Promise.reject(new Error('ChunkLoadError')));
    const { fixture, end } = setup(loader);
    fixture.detectChanges();
    await flush(fixture);
    await vi.advanceTimersByTimeAsync(5_000);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const fallback = root.querySelector('[data-testid="edit-banner-fallback"]');
    expect(loader).toHaveBeenCalledTimes(3);
    expect(fallback?.textContent).toContain('Modo edição ativo');
    expect(fallback?.textContent).toContain('Locadora Alfa');
    // a barra âmbar não é a única coisa na tela
    expect(root.querySelector('app-impersonation-banner')).toBeNull();
    const button = fallback?.querySelector('button') as HTMLButtonElement;
    expect(button.className).toContain('min-h-11');
    button.click();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('retenta e, ao carregar, o banner lazy substitui a reserva', async () => {
    const loader = vi
      .fn<() => Promise<Type<unknown>>>()
      .mockRejectedValueOnce(new Error('ChunkLoadError'))
      .mockResolvedValue(SupportEditBanner);
    const { fixture } = setup(loader);
    fixture.detectChanges();
    await flush(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="edit-banner-fallback"]'),
    ).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1_500);
    await flush(fixture);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="edit-banner-fallback"]')).toBeNull();
    expect(root.querySelector('app-support-edit-banner')).not.toBeNull();
  });
});
