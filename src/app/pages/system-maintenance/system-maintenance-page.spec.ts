import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformMaintenanceService } from '../../services/platform-maintenance.service';
import {
  MAINTENANCE_RETRY_MAX_MS,
  MAINTENANCE_RETRY_MS,
  MAINTENANCE_STILL_DOWN,
  SystemMaintenancePage,
} from './system-maintenance-page';

describe('SystemMaintenancePage', () => {
  let isBackUp: ReturnType<typeof vi.fn>;
  let leave: ReturnType<typeof vi.fn>;
  let router: Router;

  function render() {
    const fixture = TestBed.createComponent(SystemMaintenancePage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      button: () => el.querySelector<HTMLButtonElement>('[data-check]') as HTMLButtonElement,
      status: () => (el.querySelector('[data-status]')?.textContent ?? '').trim(),
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    isBackUp = vi.fn(() => of(false));
    leave = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PlatformMaintenanceService, useValue: { isBackUp, leave, enter: vi.fn() } },
      ],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => vi.useRealTimers());

  it('shows the title, the copy and NO return forecast', () => {
    const { el } = render();

    expect(el.querySelector('h1')?.textContent).toContain('Estamos em manutenção.');
    expect(el.textContent).toContain('Seus dados estão seguros');
    expect(el.textContent).not.toMatch(/previs[aã]o|às \d{1,2}h/i);
    expect(el.querySelector('picture img')?.getAttribute('alt')).toContain('cones, escada');
  });

  it('disables the button and says "Verificando…" while checking', () => {
    const pending = new Subject<boolean>();
    isBackUp.mockReturnValue(pending);
    const { fixture, button } = render();

    button().click();
    fixture.detectChanges();

    expect(button().disabled).toBe(true);
    expect(button().textContent).toContain('Verificando…');
    expect(isBackUp).toHaveBeenCalledTimes(1);
  });

  it('says it is still down, politely, and re-enables the button', () => {
    const { fixture, button, status } = render();

    button().click();
    fixture.detectChanges();

    expect(status()).toBe(MAINTENANCE_STILL_DOWN);
    expect(button().disabled).toBe(false);
    expect(button().textContent).toContain('Verificar novamente');
    expect(leave).not.toHaveBeenCalled();
  });

  it('leaves maintenance and goes to /dashboard when it is back, on its own route', () => {
    isBackUp.mockReturnValue(of(true));
    vi.spyOn(router, 'url', 'get').mockReturnValue('/manutencao');
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const { fixture, button } = render();

    button().click();
    fixture.detectChanges();

    expect(leave).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('as the global overlay it just leaves, keeping the user where they were', () => {
    isBackUp.mockReturnValue(of(true));
    vi.spyOn(router, 'url', 'get').mockReturnValue('/alugueis');
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const { fixture, button } = render();

    button().click();
    fixture.detectChanges();

    expect(leave).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('retries by itself after 60 s, then backs off, capped at 300 s', () => {
    render();
    expect(isBackUp).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MAINTENANCE_RETRY_MS);
    expect(isBackUp).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(MAINTENANCE_RETRY_MS * 2 - 1);
    expect(isBackUp).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(isBackUp).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(MAINTENANCE_RETRY_MS * 4);
    expect(isBackUp).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(MAINTENANCE_RETRY_MAX_MS);
    expect(isBackUp).toHaveBeenCalledTimes(4);
  });

  it('stops retrying once destroyed', () => {
    const { fixture } = render();

    fixture.destroy();
    vi.advanceTimersByTime(MAINTENANCE_RETRY_MAX_MS * 3);

    expect(isBackUp).not.toHaveBeenCalled();
  });

  it('is noindex and titled "Em manutenção · MyCarsHub"', () => {
    render();

    expect(document.title).toBe('Em manutenção · MyCarsHub');
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex',
    );
  });
});
