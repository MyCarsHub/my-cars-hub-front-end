import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicStatus, StatusComponent, StatusComponentKey, StatusLevel } from '../../types/status.types';
import { isPublicPath } from '../../services/theme-scope';
import { StatusPage, STATUS_REFRESH_MS } from './status-page';
import { StatusService } from './status.service';
import { incidentView, joinNames, summaryOf, uptimeOf, whenLabel } from './status.copy';

const KEYS: StatusComponentKey[] = ['AUTH', 'RENTALS', 'PAYMENTS', 'EMAIL', 'SIGNATURE', 'DRIVER_APP'];

function days(n: number, level: StatusLevel = 'OPERATIONAL'): StatusComponent['days'] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`,
    status: level,
    uptime: level === 'UNKNOWN' ? null : 100,
  }));
}

function status(overrides: Partial<PublicStatus> = {}, level: Partial<Record<StatusComponentKey, StatusLevel>> = {}): PublicStatus {
  return {
    generatedAt: '2026-10-25T15:00:00Z',
    overall: 'OPERATIONAL',
    since: null,
    components: KEYS.map((key) => ({ key, status: level[key] ?? 'OPERATIONAL', since: null, days: days(90) })),
    incidents: [],
    ...overrides,
  };
}

describe('status copy', () => {
  const now = new Date('2026-10-25T18:00:00Z');

  it('says everything works when it does', () => {
    expect(summaryOf(status()).title).toBe('Tudo funcionando');
    expect(summaryOf(status()).tone).toBe('ok');
  });

  it('names the slow parts in plain words', () => {
    const s = status({ overall: 'DEGRADED' }, { PAYMENTS: 'SLOW', EMAIL: 'SLOW' });
    expect(summaryOf(s).title).toBe('Lentidão em Cobranças e Pix (Asaas) e Avisos por e-mail');
    expect(summaryOf(s).tone).toBe('slow');
  });

  it('says since when it is down, in Brasilia time', () => {
    const s = status({ overall: 'OUTAGE', since: '2026-10-25T17:02:00Z' }, { AUTH: 'DOWN' });
    // 17:02Z = 14:02 em Brasília, e «hoje» também é 25/10 em Brasília.
    expect(summaryOf(s, now).title).toBe('Fora do ar desde hoje às 14:02');
    expect(summaryOf(s, now).body).toContain('Entrar no sistema');
    expect(summaryOf(s, now).tone).toBe('down');
  });

  it('uses the date for an older start', () => {
    expect(whenLabel('2026-10-23T17:02:00Z', now)).toBe('23/10 às 14:02');
  });

  it('never claims everything is fine when the API did not answer', () => {
    const s = summaryOf(null);
    expect(s.title).toBe('Não conseguimos verificar agora');
    expect(s.tone).toBe('unknown');
  });

  it('says it is still checking when there is no measurement yet', () => {
    expect(summaryOf(status({ overall: 'UNKNOWN' })).title).toBe('Verificando…');
  });

  it('joins names like a person would', () => {
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B e C');
  });

  it('writes incidents for a layperson, with no jargon', () => {
    const resolved = incidentView(
      { components: ['AUTH', 'RENTALS'], kind: 'DOWN', startedAt: '2026-10-25T14:00:00Z', resolvedAt: '2026-10-25T14:12:00Z' },
      now,
    );
    expect(resolved.title).toBe('Entrar no sistema e Aluguéis e contratos: ficou fora do ar');
    expect(resolved.detail).toContain('durou 12 min');
    expect(resolved.ongoing).toBe(false);

    const open = incidentView(
      { components: ['PAYMENTS'], kind: 'SLOW', startedAt: '2026-10-25T14:00:00Z', resolvedAt: null },
      now,
    );
    expect(open.detail).toContain('ainda estamos resolvendo');
    expect(open.ongoing).toBe(true);
    for (const text of [resolved.title, resolved.detail, open.title, open.detail]) {
      expect(text).not.toMatch(/api|banco de dados|job|timeout|5\d\d|http/i);
    }
  });

  it('computes the availability over the chosen window, ignoring days without data', () => {
    const c: StatusComponent = {
      key: 'AUTH',
      status: 'OPERATIONAL',
      since: null,
      days: [
        { date: '2026-10-23', status: 'UNKNOWN', uptime: null },
        { date: '2026-10-24', status: 'OPERATIONAL', uptime: 100 },
        { date: '2026-10-25', status: 'DOWN', uptime: 98 },
      ],
    };
    expect(uptimeOf(c, 30)).toBe('99,0%');
    expect(uptimeOf({ ...c, days: [] }, 30)).toBeNull();
  });
});

describe('StatusPage', () => {
  let get: ReturnType<typeof vi.fn<() => Observable<PublicStatus>>>;

  function render() {
    const fixture = TestBed.createComponent(StatusPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el };
  }

  beforeEach(() => {
    get = vi.fn(() => of(status()));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: StatusService, useValue: { get } }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the big summary and the six components with plain names', () => {
    const { el } = render();

    expect(el.querySelector('[data-summary-title]')?.textContent?.trim()).toBe('Tudo funcionando');
    const names = Array.from(el.querySelectorAll('[data-component] [data-name]')).map((n) => n.textContent?.trim());
    expect(names).toEqual([
      'Entrar no sistema',
      'Aluguéis e contratos',
      'Cobranças e Pix (Asaas)',
      'Avisos por e-mail',
      'Assinatura de contratos (Autentique)',
      'App do motorista',
    ]);
    expect(el.querySelector('[data-no-incidents]')).not.toBeNull();
  });

  it('draws 30 bars per component by default and 90 after switching', () => {
    const { fixture, el } = render();
    const first = () => el.querySelector('[data-component]')!.querySelectorAll('[data-day]').length;

    expect(first()).toBe(30);

    (el.querySelector('[data-range="90"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(first()).toBe(90);
    expect((el.querySelector('[data-range="90"]') as HTMLElement).getAttribute('aria-pressed')).toBe('true');
  });

  it('describes a tapped day in words', () => {
    const { fixture, el } = render();

    (el.querySelector('[data-day]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('[data-selected-day]')?.textContent).toContain('funcionou normalmente');
  });

  it('shows «Não conseguimos verificar agora» and a retry button when the API fails', () => {
    get.mockReturnValue(throwError(() => new Error('down')));

    const { fixture, el } = render();

    expect(el.querySelector('[data-summary-title]')?.textContent?.trim()).toBe('Não conseguimos verificar agora');
    expect(el.querySelector('[data-component]')).toBeNull();
    expect(el.textContent).not.toContain('Tudo funcionando');

    get.mockReturnValue(of(status()));
    (el.querySelector('[data-retry]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('[data-summary-title]')?.textContent?.trim()).toBe('Tudo funcionando');
  });

  it('drops a stale good answer when a later refresh fails', () => {
    vi.useFakeTimers();
    const { fixture, el } = render();
    expect(el.textContent).toContain('Tudo funcionando');

    get.mockReturnValue(throwError(() => new Error('down')));
    vi.advanceTimersByTime(STATUS_REFRESH_MS);
    fixture.detectChanges();

    expect(el.textContent).toContain('Não conseguimos verificar agora');
    expect(el.textContent).not.toContain('Tudo funcionando');
  });

  it('refreshes by itself once a minute and stops when destroyed', () => {
    vi.useFakeTimers();
    const { fixture } = render();
    expect(get).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(STATUS_REFRESH_MS * 2);
    expect(get).toHaveBeenCalledTimes(3);

    fixture.destroy();
    vi.advanceTimersByTime(STATUS_REFRESH_MS * 3);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('lists recent incidents in plain words', () => {
    get.mockReturnValue(
      of(
        status({
          incidents: [
            { components: ['SIGNATURE'], kind: 'DOWN', startedAt: '2026-10-24T14:00:00Z', resolvedAt: '2026-10-24T14:30:00Z' },
          ],
        }),
      ),
    );

    const { el } = render();

    expect(el.querySelector('[data-incident]')?.textContent).toContain(
      'Assinatura de contratos (Autentique): ficou fora do ar',
    );
    expect(el.querySelector('[data-no-incidents]')).toBeNull();
  });

  it('is a public, always-light route', () => {
    expect(isPublicPath('/status')).toBe(true);
  });
});
