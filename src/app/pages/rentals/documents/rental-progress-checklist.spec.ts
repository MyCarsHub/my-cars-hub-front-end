import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';

import { RentalProgressChecklist } from './rental-progress-checklist';
import { RentalService } from '../rental.service';

describe('RentalProgressChecklist step derivation', () => {
  const rentalService = {
    listDocuments: vi.fn<(id: string) => Observable<any[]>>(() => of([])),
    listPhotos: vi.fn<(id: string, kind: string) => Observable<any[]>>(() => of([])),
  };

  beforeEach(() => {
    rentalService.listDocuments.mockClear();
    rentalService.listPhotos.mockClear();
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
    rentalService.listDocuments.mockReturnValue(of([]));
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const steps = (fixture.componentInstance as any).steps();
    const contract = steps.find((s: any) => s.key === 'CONTRACT');
    expect(contract.state).toBe('pending');
  });

  it('shows CONTRACT as done when CONTRACT doc present', () => {
    rentalService.listDocuments.mockReturnValue(of([{ kind: 'CONTRACT' }]));
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const contract = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'CONTRACT');
    expect(contract.state).toBe('done');
  });

  it('shows CHECKIN as progress when photos exist and no PDF', () => {
    rentalService.listDocuments.mockReturnValue(of([]));
    rentalService.listPhotos.mockImplementation((_id: string, kind: string) =>
      of(kind === 'CHECKIN' ? [{ angle: 'FRONT' }, { angle: 'BACK' }, { angle: 'LEFT' }] : []),
    );
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const checkin = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'CHECKIN');
    expect(checkin.state).toBe('progress');
    expect(checkin.actionLabel).toBe('Continuar');
    expect(checkin.description).toContain('3 de 6');
  });

  it('shows CHECKIN as done when CHECKIN PDF present', () => {
    rentalService.listDocuments.mockReturnValue(of([{ kind: 'CHECKIN' }]));
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const checkin = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'CHECKIN');
    expect(checkin.state).toBe('done');
  });

  it('marks ACTIVATE as blocked when automatic charge is on and status RESERVED', () => {
    rentalService.listDocuments.mockReturnValue(of([]));
    const fixture = makeComponent('RESERVED', true);
    fixture.detectChanges();
    const activate = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'ACTIVATE');
    expect(activate.state).toBe('blocked');
    expect(activate.showActionButton).toBe(false);
  });

  it('marks ACTIVATE as pending when manual and RESERVED', () => {
    rentalService.listDocuments.mockReturnValue(of([]));
    const fixture = makeComponent('RESERVED', false);
    fixture.detectChanges();
    const activate = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'ACTIVATE');
    expect(activate.state).toBe('pending');
    expect(activate.showActionButton).toBe(true);
  });

  it('marks ACTIVATE as done and CHECKOUT visible when status ACTIVE', () => {
    rentalService.listDocuments.mockReturnValue(of([]));
    const fixture = makeComponent('ACTIVE');
    fixture.detectChanges();
    const steps = (fixture.componentInstance as any).steps();
    expect(steps.find((s: any) => s.key === 'ACTIVATE').state).toBe('done');
    expect(steps.find((s: any) => s.key === 'CHECKOUT').visible).toBe(true);
  });

  it('hides CHECKOUT when status RESERVED', () => {
    rentalService.listDocuments.mockReturnValue(of([]));
    const fixture = makeComponent('RESERVED');
    fixture.detectChanges();
    const checkout = (fixture.componentInstance as any).steps().find((s: any) => s.key === 'CHECKOUT');
    expect(checkout.visible).toBe(false);
  });
});
