import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { RentalProgressChecklist } from './rental-progress-checklist';
import { RentalService, RentalStateSnapshot } from '../rental.service';

/**
 * Helper: mock RentalService que expõe uma fatia mutável de snapshot por-rental
 * (fonte de verdade compartilhada; ver `rental.service.ts`).
 */
function makeSnapshot(partial: Partial<RentalStateSnapshot> = {}): RentalStateSnapshot {
  return {
    documents: [],
    checkinPhotos: [],
    checkoutPhotos: [],
    contractSignature: null,
    ...partial,
  };
}

describe('RentalProgressChecklist step derivation', () => {
  const state = signal<RentalStateSnapshot | null>(null);
  const rentalService = {
    rentalState: vi.fn(() => state),
    loadRentalState: vi.fn(),
    refreshRentalState: vi.fn(),
  };

  beforeEach(() => {
    state.set(makeSnapshot());
    rentalService.rentalState.mockClear();
    rentalService.loadRentalState.mockClear();
    rentalService.refreshRentalState.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: RentalService, useValue: rentalService },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      ],
    });
  });

  function makeComponent(status: 'RESERVED' | 'ACTIVE' | 'COMPLETED', autoCharge = false) {
    const fixture = TestBed.createComponent(RentalProgressChecklist);
    fixture.componentRef.setInput('rentalId', 'rid');
    fixture.componentRef.setInput('status', status);
    fixture.componentRef.setInput('automaticCharge', autoCharge);
    return fixture;
  }

  it('shows CONTRACT as pending when no CONTRACT doc exists', () => {
    state.set(makeSnapshot());
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const steps = (fixture.componentInstance as any).steps();
    const contract = steps.find((s: any) => s.key === 'CONTRACT');
    expect(contract.state).toBe('pending');
  });

  it('shows CONTRACT as progress when PDF present but signature not requested', () => {
    state.set(
      makeSnapshot({
        documents: [{ kind: 'CONTRACT' } as any],
        contractSignature: { status: 'NOT_REQUIRED' } as any,
      }),
    );
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const contract = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'CONTRACT');
    expect(contract.state).toBe('progress');
    expect(contract.description).toContain('Solicite a assinatura');
  });

  it('shows CONTRACT as progress with "Aguardando" description when signature PENDING', () => {
    state.set(
      makeSnapshot({
        documents: [{ kind: 'CONTRACT' } as any],
        contractSignature: { status: 'PENDING' } as any,
      }),
    );
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const contract = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'CONTRACT');
    expect(contract.state).toBe('progress');
    expect(contract.description).toContain('Aguardando');
  });

  it('shows CONTRACT as progress with refused hint when signature REFUSED', () => {
    state.set(
      makeSnapshot({
        documents: [{ kind: 'CONTRACT' } as any],
        contractSignature: { status: 'REFUSED' } as any,
      }),
    );
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const contract = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'CONTRACT');
    expect(contract.state).toBe('progress');
    expect(contract.description.toLowerCase()).toContain('recusad');
  });

  it('shows CONTRACT as done only when signature is SIGNED', () => {
    state.set(
      makeSnapshot({
        documents: [{ kind: 'CONTRACT' } as any],
        contractSignature: { status: 'SIGNED' } as any,
      }),
    );
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const contract = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'CONTRACT');
    expect(contract.state).toBe('done');
  });

  it('shows CHECKIN as progress when photos exist and no PDF', () => {
    state.set(
      makeSnapshot({
        checkinPhotos: [
          { angle: 'FRONT' } as any,
          { angle: 'BACK' } as any,
          { angle: 'LEFT' } as any,
        ],
      }),
    );
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const checkin = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'CHECKIN');
    expect(checkin.state).toBe('progress');
    expect(checkin.description).toContain('3 de 14');
  });

  it('shows CHECKIN as done when CHECKIN PDF present', () => {
    state.set(makeSnapshot({ documents: [{ kind: 'CHECKIN' } as any] }));
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const checkin = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'CHECKIN');
    expect(checkin.state).toBe('done');
  });

  it('marks ACTIVATE as blocked when automatic charge is on and status RESERVED', () => {
    const fixture = makeComponent('RESERVED', true);
    fixture.detectChanges();
    const activate = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'ACTIVATE');
    expect(activate.state).toBe('blocked');
    expect(activate.showActionButton).toBe(false);
  });

  it('marks ACTIVATE as pending when manual and RESERVED', () => {
    const fixture = makeComponent('RESERVED', false);
    fixture.detectChanges();
    const activate = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'ACTIVATE');
    expect(activate.state).toBe('pending');
    expect(activate.showActionButton).toBe(true);
  });

  it('marks ACTIVATE as done and CHECKOUT visible when status ACTIVE', () => {
    const fixture = makeComponent('ACTIVE');
    fixture.detectChanges();
    const steps = (fixture.componentInstance as any).steps();
    expect(steps.find((s: any) => s.key === 'ACTIVATE').state).toBe('done');
    expect(steps.find((s: any) => s.key === 'CHECKOUT').visible).toBe(true);
  });

  it('hides CHECKOUT when status RESERVED', () => {
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const checkout = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'CHECKOUT');
    expect(checkout.visible).toBe(false);
  });

  it('calls loadRentalState on init so the shared snapshot is populated', () => {
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    expect(rentalService.loadRentalState).toHaveBeenCalledWith('rid');
  });
});

describe('RentalProgressChecklist accordion behavior', () => {
  const state = signal<RentalStateSnapshot | null>(null);
  const rentalService = {
    rentalState: vi.fn(() => state),
    loadRentalState: vi.fn(),
    refreshRentalState: vi.fn(),
  };
  let queryParam: string | null = null;

  beforeEach(() => {
    state.set(makeSnapshot());
    queryParam = null;
    rentalService.rentalState.mockClear();
    rentalService.loadRentalState.mockClear();
    rentalService.refreshRentalState.mockClear();
    TestBed.configureTestingModule({
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideRouter([]),
        { provide: RentalService, useValue: rentalService },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: { get: (k: string) => (k === 'step' ? queryParam : null) } },
          },
        },
      ],
    });
  });

  function makeComponent(status: 'RESERVED' | 'ACTIVE' | 'COMPLETED' = 'RESERVED', autoCharge = false) {
    const fixture = TestBed.createComponent(RentalProgressChecklist);
    fixture.componentRef.setInput('rentalId', 'rid');
    fixture.componentRef.setInput('status', status);
    fixture.componentRef.setInput('automaticCharge', autoCharge);
    return fixture;
  }

  function getStep(fixture: any, key: string) {
    return (fixture.componentInstance as any).steps().find((s: any) => s.key === key);
  }

  it('starts with expandedStep as null', () => {
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    expect((fixture.componentInstance as any).expandedStep()).toBeNull();
  });

  it('toggle(step) sets expandedStep when panel !== null', () => {
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const contract = getStep(fixture, 'CONTRACT');
    (fixture.componentInstance as any).toggle(contract);
    expect((fixture.componentInstance as any).expandedStep()).toBe('CONTRACT');
  });

  it('toggle(step) twice on the same step collapses back to null', () => {
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const checkin = getStep(fixture, 'CHECKIN');
    (fixture.componentInstance as any).toggle(checkin);
    (fixture.componentInstance as any).toggle(checkin);
    expect((fixture.componentInstance as any).expandedStep()).toBeNull();
  });

  it('toggle(stepB) while stepA expanded switches to stepB (single-open)', () => {
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const contract = getStep(fixture, 'CONTRACT');
    const checkin = getStep(fixture, 'CHECKIN');
    (fixture.componentInstance as any).toggle(contract);
    (fixture.componentInstance as any).toggle(checkin);
    expect((fixture.componentInstance as any).expandedStep()).toBe('CHECKIN');
  });

  it('toggle(step) is a no-op when panel === null (RESERVED)', () => {
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const reserved = getStep(fixture, 'RESERVED');
    expect(reserved.panel).toBeNull();
    (fixture.componentInstance as any).toggle(reserved);
    expect((fixture.componentInstance as any).expandedStep()).toBeNull();
  });

  it('applyDeepLink expands step from ?step=contract on init', () => {
    queryParam = 'contract';
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    expect((fixture.componentInstance as any).expandedStep()).toBe('CONTRACT');
  });

  it('leaves expandedStep null on init when no ?step query param', () => {
    queryParam = null;
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    expect((fixture.componentInstance as any).expandedStep()).toBeNull();
  });

  it('toggle(step) calls router.navigate with mapped step query and merge', () => {
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const spy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const checkin = getStep(fixture, 'CHECKIN');
    (fixture.componentInstance as any).toggle(checkin);
    expect(spy).toHaveBeenCalledTimes(1);
    const [commands, extras] = spy.mock.calls[0];
    expect(commands).toEqual([]);
    expect(extras).toMatchObject({
      queryParams: { step: 'checkin' },
      queryParamsHandling: 'merge',
    });
  });

  it('toggle(step) on collapse clears ?step= by navigating with step: null', () => {
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const spy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const checkin = getStep(fixture, 'CHECKIN');
    (fixture.componentInstance as any).toggle(checkin);
    (fixture.componentInstance as any).toggle(checkin);
    expect(spy).toHaveBeenCalledTimes(2);
    const [, extras] = spy.mock.calls[1];
    expect(extras).toMatchObject({
      queryParams: { step: null },
      queryParamsHandling: 'merge',
    });
  });

  it('CONTRACT badge is "aguardando assinatura" / amber when PDF present and no signature', () => {
    state.set(
      makeSnapshot({
        documents: [{ kind: 'CONTRACT' } as any],
        contractSignature: null,
      }),
    );
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const contract = getStep(fixture, 'CONTRACT');
    expect(contract.badge).toEqual({ label: 'aguardando assinatura', tone: 'amber' });
  });

  it('CHECKIN badge shows "7/14 fotos" / amber with 7 photos and no PDF', () => {
    state.set(
      makeSnapshot({
        checkinPhotos: Array.from({ length: 7 }, (_, i) => ({ angle: `A${i}` }) as any),
      }),
    );
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const checkin = getStep(fixture, 'CHECKIN');
    expect(checkin.badge).toEqual({ label: '7/14 fotos', tone: 'amber' });
  });

  it('ACTIVATE badge is "pronto" / amber when RESERVED + manual charge', () => {
    const fixture = makeComponent('RESERVED', false);
    fixture.detectChanges();
    const activate = getStep(fixture, 'ACTIVATE');
    expect(activate.badge).toEqual({ label: 'pronto', tone: 'amber' });
  });
});
