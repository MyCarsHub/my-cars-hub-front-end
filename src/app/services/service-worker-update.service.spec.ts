import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ServiceWorkerUpdateService } from './service-worker-update.service';
import { NotificationService } from './notification.service';

describe('ServiceWorkerUpdateService', () => {
  let versionUpdates: Subject<VersionReadyEvent | { type: string }>;
  let unrecoverable: Subject<unknown>;
  let activateUpdate: ReturnType<typeof vi.fn>;
  let reload: ReturnType<typeof vi.fn>;
  let notifyInfo: ReturnType<typeof vi.fn>;
  let notifyWarn: ReturnType<typeof vi.fn>;

  function setup(isEnabled: boolean, activateResult: boolean | Error = true) {
    versionUpdates = new Subject();
    unrecoverable = new Subject();
    activateUpdate = vi.fn().mockImplementation(() =>
      activateResult instanceof Error ? Promise.reject(activateResult) : Promise.resolve(activateResult),
    );
    reload = vi.fn();
    notifyInfo = vi.fn();
    notifyWarn = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        ServiceWorkerUpdateService,
        {
          provide: SwUpdate,
          useValue: {
            isEnabled,
            versionUpdates: versionUpdates.asObservable(),
            unrecoverable: unrecoverable.asObservable(),
            activateUpdate,
          },
        },
        {
          provide: NotificationService,
          useValue: { info: notifyInfo, warning: notifyWarn },
        },
        {
          provide: DOCUMENT,
          useValue: {
            defaultView: {
              location: { reload },
              setTimeout: (fn: () => void) => {
                fn();
                return 0;
              },
            },
          },
        },
      ],
    });

    return TestBed.inject(ServiceWorkerUpdateService);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('does nothing when SwUpdate is disabled', () => {
    const svc = setup(false);
    svc.init();
    versionUpdates.next({ type: 'VERSION_READY' } as VersionReadyEvent);
    expect(activateUpdate).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('activates update and reloads on VERSION_READY', async () => {
    const svc = setup(true, true);
    svc.init();
    versionUpdates.next({ type: 'VERSION_READY' } as VersionReadyEvent);
    await Promise.resolve();
    await Promise.resolve();
    expect(activateUpdate).toHaveBeenCalledTimes(1);
    expect(notifyInfo).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores non-VERSION_READY events', () => {
    const svc = setup(true);
    svc.init();
    versionUpdates.next({ type: 'VERSION_DETECTED' });
    expect(activateUpdate).not.toHaveBeenCalled();
  });

  it('reloads on unrecoverable errors', () => {
    const svc = setup(true);
    svc.init();
    unrecoverable.next({ reason: 'boom' });
    expect(notifyWarn).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — init() twice registers listeners once', async () => {
    const svc = setup(true, true);
    svc.init();
    svc.init();
    versionUpdates.next({ type: 'VERSION_READY' } as VersionReadyEvent);
    await Promise.resolve();
    await Promise.resolve();
    expect(activateUpdate).toHaveBeenCalledTimes(1);
  });
});
