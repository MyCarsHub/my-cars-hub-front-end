import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExternalNavigationService } from './external-navigation.service';
import { NotificationService } from './notification.service';

describe('ExternalNavigationService', () => {
  let service: ExternalNavigationService;
  let notifications: NotificationService;
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ExternalNavigationService);
    notifications = TestBed.inject(NotificationService);
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the URL in a new tab with noopener and noreferrer', () => {
    openSpy.mockReturnValue({} as Window);
    service.openExternal('https://example.com/checkout');
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/checkout',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('warns via NotificationService when the popup is blocked', () => {
    openSpy.mockReturnValue(null);
    const warnSpy = vi.spyOn(notifications, 'warning');
    service.openExternal('https://example.com/checkout');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('does nothing when URL is empty', () => {
    service.openExternal('');
    expect(openSpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // openPendingTab — the gesture-safe path used by the checkout
  // ---------------------------------------------------------------------------

  const fakeWindow = () => {
    const doc = document.implementation.createHTMLDocument('');
    return {
      closed: false,
      opener: {} as unknown,
      document: doc,
      location: { replace: vi.fn() },
      close: vi.fn(),
    };
  };

  it('reserves a blank tab synchronously, with no URL to wait for', () => {
    const win = fakeWindow();
    openSpy.mockReturnValue(win as unknown as Window);

    const tab = service.openPendingTab();

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(tab.blocked).toBe(false);
    // No `noopener` (it would return null), so the handle is severed by hand.
    expect(win.opener).toBeNull();
  });

  it('navigates the already-open tab once the URL arrives', () => {
    const win = fakeWindow();
    openSpy.mockReturnValue(win as unknown as Window);

    const tab = service.openPendingTab();
    tab.navigate('https://pay.example/x');

    expect(win.location.replace).toHaveBeenCalledWith('https://pay.example/x');
    // The second window.open would be the one the popup blocker kills.
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('does not navigate a closed tab or an empty URL', () => {
    const win = fakeWindow();
    openSpy.mockReturnValue(win as unknown as Window);

    const tab = service.openPendingTab();
    tab.navigate('');
    win.closed = true;
    tab.navigate('https://pay.example/x');

    expect(win.location.replace).not.toHaveBeenCalled();
  });

  it('closes the reserved tab on demand', () => {
    const win = fakeWindow();
    openSpy.mockReturnValue(win as unknown as Window);

    service.openPendingTab().close();

    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it('throws the tab away when the opener cannot be disowned', () => {
    const win = fakeWindow();
    // An engine that refuses the disowning would leave the NEXT page the user
    // browses to in that tab holding a live handle on ours.
    Object.defineProperty(win, 'opener', { get: () => ({}), set: () => void 0 });
    openSpy.mockReturnValue(win as unknown as Window);

    const tab = service.openPendingTab();

    expect(win.close).toHaveBeenCalledTimes(1);
    expect(tab.blocked).toBe(true);
    tab.navigate('https://pay.example/x');
    expect(win.location.replace).not.toHaveBeenCalled();
  });

  it('reports blocked (and stays harmless) when the popup is refused', () => {
    openSpy.mockReturnValue(null);

    const tab = service.openPendingTab();

    expect(tab.blocked).toBe(true);
    expect(() => {
      tab.navigate('https://pay.example/x');
      tab.close();
    }).not.toThrow();
  });
});
