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
});
