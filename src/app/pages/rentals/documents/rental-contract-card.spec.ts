import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { RentalContractCard } from './rental-contract-card';
import { RentalService, RentalStateSnapshot } from '../rental.service';
import { NotificationService } from '../../../services/notification.service';
import { ExternalNavigationService } from '../../../services/external-navigation.service';

/**
 * Regression: toast on Autentique signature polling. Ensures the transition
 * SIGNED/REFUSED/EXPIRED fires the correct toast when the shared signal
 * flips (decoupled from the poll tick — see effect() in the component).
 */
describe('RentalContractCard signature transition toasts', () => {
  const RID = 'rid';
  const state = signal<RentalStateSnapshot | null>(null);
  const rentalService = {
    rentalState: vi.fn(() => state),
    loadRentalState: vi.fn(),
    refreshRentalState: vi.fn(),
    refreshContractSignature: vi.fn(),
  };
  const notifications = { push: vi.fn() };
  const externalNav = { openExternal: vi.fn() };

  function makeSnapshot(
    signatureStatus: 'PENDING' | 'SIGNED' | 'REFUSED' | 'EXPIRED' | 'NOT_REQUIRED',
  ): RentalStateSnapshot {
    return {
      documents: [{ kind: 'CONTRACT', id: 'd1' } as any],
      checkinPhotos: [],
      checkoutPhotos: [],
      contractSignature: { status: signatureStatus } as any,
    };
  }

  beforeEach(() => {
    notifications.push.mockClear();
    rentalService.loadRentalState.mockClear();
    rentalService.refreshContractSignature.mockClear();
    state.set(makeSnapshot('PENDING'));
    TestBed.configureTestingModule({
      providers: [
        { provide: RentalService, useValue: rentalService },
        { provide: NotificationService, useValue: notifications },
        { provide: ExternalNavigationService, useValue: externalNav },
      ],
    });
  });

  function makeFixture() {
    const fixture = TestBed.createComponent(RentalContractCard);
    fixture.componentRef.setInput('rentalId', RID);
    fixture.detectChanges();
    return fixture;
  }

  it('fires success toast when signature transitions PENDING → SIGNED via signal update', () => {
    const fixture = makeFixture();
    // Initial run must NOT fire a toast (skip first emission).
    expect(notifications.push).not.toHaveBeenCalled();

    state.set(makeSnapshot('SIGNED'));
    fixture.detectChanges();

    expect(notifications.push).toHaveBeenCalledWith('success', 'Contrato assinado por todos.');
  });

  it('fires warning toast when signature transitions to REFUSED', () => {
    const fixture = makeFixture();
    state.set(makeSnapshot('REFUSED'));
    fixture.detectChanges();
    expect(notifications.push).toHaveBeenCalledWith(
      'warning',
      'Assinatura recusada por um signatário.',
    );
  });

  it('fires warning toast when signature transitions to EXPIRED', () => {
    const fixture = makeFixture();
    state.set(makeSnapshot('EXPIRED'));
    fixture.detectChanges();
    expect(notifications.push).toHaveBeenCalledWith('warning', 'Link de assinatura expirou.');
  });

  it('does NOT fire toast on transitions into PENDING or NOT_REQUIRED', () => {
    state.set(makeSnapshot('SIGNED'));
    const fixture = makeFixture();
    notifications.push.mockClear();

    state.set(makeSnapshot('PENDING'));
    fixture.detectChanges();
    state.set(makeSnapshot('NOT_REQUIRED'));
    fixture.detectChanges();

    expect(notifications.push).not.toHaveBeenCalled();
  });
});
