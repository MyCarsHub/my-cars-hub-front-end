import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { RentalContractCard } from './rental-contract-card';
import { RentalService, RentalStateSnapshot } from '../rental.service';
import { DriverService } from '../../../services/driver.service';
import { NotificationService } from '../../../services/notification.service';
import { SessionService } from '../../../services/session.service';

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
    getById: vi.fn(() => of({ driverId: 'drv1' } as any)),
    documentSignedUrl: vi.fn(() => of({ url: 'https://signed.example/x' } as any)),
  };
  const driverService = {
    getOne: vi.fn(() =>
      of({ name: 'Alice Driver', contact: { email: 'alice@example.com' } } as any),
    ),
  };
  const sessionValues = new Map<string, string>();
  const session = {
    getItem: vi.fn((k: string) => sessionValues.get(k) ?? null),
  };
  const notifications = { push: vi.fn() };

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
        { provide: DriverService, useValue: driverService },
        { provide: SessionService, useValue: session },
        { provide: NotificationService, useValue: notifications },
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

  describe('signature modal prefill', () => {
    beforeEach(() => {
      sessionValues.clear();
      rentalService.getById.mockReset();
      driverService.getOne.mockReset();
      rentalService.getById.mockReturnValue(of({ driverId: 'drv1' } as any));
      driverService.getOne.mockReturnValue(
        of({ name: 'Alice Driver', contact: { email: 'alice@example.com' } } as any),
      );
    });

    it('prefills driver + owner signers when modal opens', () => {
      sessionValues.set('name', 'Bob Owner');
      sessionValues.set('email', 'bob@example.com');
      const fixture = makeFixture();
      const cmp = fixture.componentInstance as unknown as {
        openSignatureModal: () => void;
        signers: () => Array<{ name: string; email: string }>;
      };

      cmp.openSignatureModal();
      const signers = cmp.signers();
      expect(signers).toHaveLength(2);
      expect(signers[0]).toEqual({ name: 'Alice Driver', email: 'alice@example.com' });
      expect(signers[1]).toEqual({ name: 'Bob Owner', email: 'bob@example.com' });
    });

    it('leaves signer 1 empty and marks it invalid when driver has no email', () => {
      sessionValues.set('name', 'Bob Owner');
      sessionValues.set('email', 'bob@example.com');
      driverService.getOne.mockReturnValue(
        of({ name: 'No Email Driver', contact: { email: null } } as any),
      );
      const fixture = makeFixture();
      const cmp = fixture.componentInstance as unknown as {
        openSignatureModal: () => void;
        signers: () => Array<{ name: string; email: string }>;
        isEmailInvalid: (e: string) => boolean;
      };

      cmp.openSignatureModal();
      const signers = cmp.signers();
      expect(signers[0].email).toBe('');
      expect(cmp.isEmailInvalid(signers[0].email)).toBe(true);
    });

    it('omits owner signer when session has no email', () => {
      // no session values set
      const fixture = makeFixture();
      const cmp = fixture.componentInstance as unknown as {
        openSignatureModal: () => void;
        signers: () => Array<{ name: string; email: string }>;
      };

      cmp.openSignatureModal();
      expect(cmp.signers()).toHaveLength(1);
      expect(cmp.signers()[0].email).toBe('alice@example.com');
    });

    it('keeps owner-only seed when rental fetch fails', () => {
      sessionValues.set('name', 'Bob Owner');
      sessionValues.set('email', 'bob@example.com');
      rentalService.getById.mockReturnValue(throwError(() => new Error('boom')));
      const fixture = makeFixture();
      const cmp = fixture.componentInstance as unknown as {
        openSignatureModal: () => void;
        signers: () => Array<{ name: string; email: string }>;
      };

      cmp.openSignatureModal();
      const signers = cmp.signers();
      expect(signers).toHaveLength(2);
      expect(signers[0]).toEqual({ name: '', email: '' });
      expect(signers[1].email).toBe('bob@example.com');
      expect(driverService.getOne).not.toHaveBeenCalled();
    });
  });
});

/**
 * Cobre os fluxos de download PDF (fetch → blob → anchor) e abertura
 * do PDF em nova aba (window.open + navigation pra signed URL).
 * Backend armazena PDF real; docx-preview foi removido deste caminho.
 * Stub no HTTP boundary (RentalService.documentSignedUrl) + no DOM.
 */
describe('RentalContractCard — download & open PDF', () => {
  const RID = 'rid';
  const state = signal<RentalStateSnapshot | null>(null);
  const rentalService = {
    rentalState: vi.fn(() => state),
    loadRentalState: vi.fn(),
    refreshRentalState: vi.fn(),
    refreshContractSignature: vi.fn(),
    getById: vi.fn(() => of({ driverId: null } as any)),
    documentSignedUrl: vi.fn(),
  };
  const driverService = { getOne: vi.fn() };
  const session = { getItem: vi.fn(() => null) };
  const notifications = { push: vi.fn() };

  function snapshot(): RentalStateSnapshot {
    return {
      documents: [{ kind: 'CONTRACT', id: 'd1' } as any],
      checkinPhotos: [],
      checkoutPhotos: [],
      contractSignature: { status: 'NOT_REQUIRED' } as any,
    };
  }

  beforeEach(() => {
    notifications.push.mockClear();
    rentalService.documentSignedUrl.mockReset();
    state.set(snapshot());
    TestBed.configureTestingModule({
      providers: [
        { provide: RentalService, useValue: rentalService },
        { provide: DriverService, useValue: driverService },
        { provide: SessionService, useValue: session },
        { provide: NotificationService, useValue: notifications },
      ],
    });
  });

  function makeFixture() {
    const fixture = TestBed.createComponent(RentalContractCard);
    fixture.componentRef.setInput('rentalId', RID);
    fixture.detectChanges();
    return fixture;
  }

  it('downloadContract: fetch signed URL → anchor click → revoga blob URL', async () => {
    rentalService.documentSignedUrl.mockReturnValue(of({ url: 'https://signed/x' } as any));
    const blob = new Blob(['docx'], { type: 'application/vnd.openxmlformats' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as any)
      .mockResolvedValue({ ok: true, blob: async () => blob } as any);
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.fn();
    const originalCreate = document.createElement.bind(document);
    const createEl = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') el.click = clickSpy;
      return el;
    });
    vi.useFakeTimers();

    const fixture = makeFixture();
    (fixture.componentInstance as any).downloadContract();
    // Aguarda microtasks do fetch/.blob()/finally.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(rentalService.documentSignedUrl).toHaveBeenCalledWith(RID, 'd1');
    expect(fetchSpy).toHaveBeenCalledWith('https://signed/x');
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1500);
    expect(revokeUrl).toHaveBeenCalledWith('blob:mock');

    vi.useRealTimers();
    fetchSpy.mockRestore();
    createUrl.mockRestore();
    revokeUrl.mockRestore();
    createEl.mockRestore();
  });

  it('downloadContract: erro do signed URL dispara toast e reseta loading', () => {
    rentalService.documentSignedUrl.mockReturnValue(
      throwError(() => ({ error: { message: 'boom' } })),
    );
    const fixture = makeFixture();
    (fixture.componentInstance as any).downloadContract();

    expect(notifications.push).toHaveBeenCalledWith('error', 'boom');
    expect((fixture.componentInstance as any).downloading()).toBe(false);
  });

  it('openContractAsPdf: sucesso → navega a aba pra signed URL do PDF', () => {
    rentalService.documentSignedUrl.mockReturnValue(
      of({ url: 'https://signed/contract.pdf' } as any),
    );
    const location = { href: '' } as { href: string };
    const fakeWin = { location, close: vi.fn() };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContractAsPdf();

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(rentalService.documentSignedUrl).toHaveBeenCalledWith(RID, 'd1');
    expect(location.href).toBe('https://signed/contract.pdf');
    expect((fixture.componentInstance as any).openingPdf()).toBe(false);

    openSpy.mockRestore();
  });

  it('openContractAsPdf: erro do signed URL fecha aba e dispara toast', () => {
    rentalService.documentSignedUrl.mockReturnValue(
      throwError(() => ({ error: { message: 'fetch failed' } })),
    );
    const fakeWin = { location: { href: '' }, close: vi.fn() };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContractAsPdf();

    expect(rentalService.documentSignedUrl).toHaveBeenCalledWith(RID, 'd1');
    expect(fakeWin.close).toHaveBeenCalled();
    expect(notifications.push).toHaveBeenCalledWith('error', 'fetch failed');
    expect((fixture.componentInstance as any).openingPdf()).toBe(false);

    openSpy.mockRestore();
  });

  it('openContractAsPdf: pop-up bloqueado → toast e sem chamar service', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContractAsPdf();

    expect(rentalService.documentSignedUrl).not.toHaveBeenCalled();
    expect(notifications.push).toHaveBeenCalledWith(
      'error',
      'Permita pop-ups pra abrir o contrato.',
    );
    expect((fixture.componentInstance as any).openingPdf()).toBe(false);

    openSpy.mockRestore();
  });
});
