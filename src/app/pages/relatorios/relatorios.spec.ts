import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Relatorios } from './relatorios';
import { ReportsService } from '../../services/reports.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { ReportsOverviewResponse } from '../../types/reports.types';

/**
 * Feedback standard (phase 3): a validação do intervalo de datas é INLINE
 * (nunca toast) e a falha de carregamento tem UMA superfície — o banner —
 * sem toast duplicado nem safety net do interceptor.
 */
describe('Relatorios — feedback inline', () => {
  const overview = signal<ReportsOverviewResponse | null>(null);
  const loading = signal(false);
  const serviceError = signal<string | null>(null);
  let loadOverview: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let notifyWarning: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<Relatorios>>;

  /** Public surface exercised by the specs (protected members of the component). */
  interface RelatoriosInternals {
    from: { set: (v: string) => void };
    to: { set: (v: string) => void };
    load: () => void;
  }

  function internals(): RelatoriosInternals {
    return fixture.componentInstance as unknown as RelatoriosInternals;
  }

  function rangeError(): HTMLElement | null {
    return fixture.nativeElement.querySelector('#relatorios-periodo-error');
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    overview.set(null);
    loading.set(false);
    serviceError.set(null);
    loadOverview = vi.fn().mockReturnValue(of(null));
    notifyError = vi.fn();
    notifyWarning = vi.fn();

    await TestBed.configureTestingModule({
      imports: [Relatorios],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: ReportsService,
          useValue: { overview, loading, error: serviceError, loadOverview },
        },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            warning: notifyWarning,
            info: vi.fn(),
            success: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Relatorios);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra a validação de intervalo inline nos campos de data, sem toast', () => {
    expect(rangeError()).toBeNull();

    internals().from.set('2026-03-31');
    internals().to.set('2026-03-01');
    loadOverview.mockClear();
    internals().load();
    fixture.detectChanges();

    const inline = rangeError();
    expect(inline).not.toBeNull();
    expect(inline?.textContent?.trim()).toBe('A data inicial não pode ser maior que a final.');
    expect(inline?.getAttribute('role')).toBe('alert');

    const from = fixture.nativeElement.querySelector('#relatorios-de') as HTMLInputElement;
    const to = fixture.nativeElement.querySelector('#relatorios-ate') as HTMLInputElement;
    expect(from.getAttribute('aria-invalid')).toBe('true');
    expect(from.getAttribute('aria-describedby')).toBe('relatorios-periodo-error');
    expect(to.getAttribute('aria-invalid')).toBe('true');

    // nem warning nem error: validação de campo nunca vira toast
    expect(notifyWarning).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
    // e o request nem sai
    expect(loadOverview).not.toHaveBeenCalled();
  });

  it('limpa a validação inline quando o intervalo volta a ser válido', () => {
    internals().from.set('2026-03-31');
    internals().to.set('2026-03-01');
    internals().load();
    fixture.detectChanges();
    expect(rangeError()).not.toBeNull();

    internals().to.set('2026-04-30');
    internals().load();
    fixture.detectChanges();

    expect(rangeError()).toBeNull();
    expect(loadOverview).toHaveBeenCalled();
  });

  it('mostra a falha de carregamento em UM banner inline, sem toast', () => {
    const error = new HttpErrorResponse({
      status: 422,
      error: { message: 'Período máximo de 12 meses.' },
    });
    loadOverview.mockReturnValue(throwError(() => error));

    internals().from.set('2020-01-01');
    internals().to.set('2026-01-01');
    internals().load();
    fixture.detectChanges();

    const banners = fixture.nativeElement.querySelectorAll('app-alert-banner');
    expect(banners.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Período máximo de 12 meses.');

    // nunca toast — a rede de segurança do interceptor fica quieta
    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
