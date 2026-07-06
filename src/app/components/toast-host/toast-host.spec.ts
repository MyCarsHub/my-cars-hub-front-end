import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect, beforeEach } from 'vitest';

import { ToastHost } from './toast-host';
import { NotificationService } from '../../services/notification.service';

describe('ToastHost', () => {
  let fixture: ComponentFixture<ToastHost>;
  let notifications: NotificationService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToastHost],
      providers: [provideAnimations()],
    }).compileComponents();

    notifications = TestBed.inject(NotificationService);
    fixture = TestBed.createComponent(ToastHost);
    fixture.detectChanges();
  });

  function renderedToasts(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[role="status"]'));
  }

  it('renders each pushed variant', () => {
    notifications.push('info', 'Info msg', 0);
    notifications.push('success', 'Success msg', 0);
    notifications.push('warning', 'Warning msg', 0);
    notifications.push('error', 'Error msg', 0);
    fixture.detectChanges();

    const toasts = renderedToasts();
    expect(toasts.length).toBe(4);

    const text = toasts.map((el) => el.textContent ?? '');
    expect(text.some((t) => t.includes('Info msg'))).toBe(true);
    expect(text.some((t) => t.includes('Success msg'))).toBe(true);
    expect(text.some((t) => t.includes('Warning msg'))).toBe(true);
    expect(text.some((t) => t.includes('Error msg'))).toBe(true);

    // Variant classes are applied via the container class binding.
    expect(toasts[0].className).toContain('bg-blue-50');
    expect(toasts[1].className).toContain('bg-emerald-50');
    expect(toasts[2].className).toContain('bg-amber-50');
    expect(toasts[3].className).toContain('bg-red-50');
  });

  it('dismisses a toast when the close button is clicked', () => {
    notifications.push('info', 'Dismiss me', 0);
    fixture.detectChanges();

    expect(renderedToasts().length).toBe(1);

    const closeButton = fixture.nativeElement.querySelector(
      'button[aria-label^="Fechar notificação"]',
    ) as HTMLButtonElement;
    expect(closeButton).toBeTruthy();

    closeButton.click();
    fixture.detectChanges();

    expect(notifications.notifications().length).toBe(0);
  });

  it('renders nothing when there are no notifications', () => {
    expect(renderedToasts().length).toBe(0);
  });
});
