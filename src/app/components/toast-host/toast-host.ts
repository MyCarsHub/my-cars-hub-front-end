import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import {
  NotificationKind,
  NotificationService,
} from '../../services/notification.service';

interface ToastStyle {
  container: string;
  icon: string;
  iconPath: string;
}

const KIND_STYLES: Record<NotificationKind, ToastStyle> = {
  info: {
    container: 'bg-blue-50 border-blue-200 text-blue-900',
    icon: 'text-blue-500',
    iconPath:
      'M12 9v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z',
  },
  success: {
    container: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    icon: 'text-emerald-500',
    iconPath: 'M5 13l4 4L19 7',
  },
  warning: {
    container: 'bg-amber-50 border-amber-200 text-amber-900',
    icon: 'text-amber-500',
    iconPath:
      'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  },
  error: {
    container: 'bg-red-50 border-red-200 text-red-900',
    icon: 'text-red-500',
    iconPath:
      'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M12 22a10 10 0 100-20 10 10 0 000 20z',
  },
};

@Component({
  selector: 'app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toast-host.html',
  animations: [
    trigger('toast', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(12px)' }),
        animate('180ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 1, transform: 'translateY(0)' })),
      ]),
      transition(':leave', [
        animate('160ms ease-in', style({ opacity: 0, transform: 'translateY(-8px)' })),
      ]),
    ]),
  ],
})
export class ToastHost {
  private readonly notificationService = inject(NotificationService);

  protected readonly toasts = computed(() =>
    this.notificationService.notifications().map((n) => ({
      ...n,
      styles: KIND_STYLES[n.kind],
    })),
  );

  protected dismiss(id: number): void {
    this.notificationService.dismiss(id);
  }

  protected ariaLive(kind: NotificationKind): 'assertive' | 'polite' {
    return kind === 'error' || kind === 'warning' ? 'assertive' : 'polite';
  }
}
