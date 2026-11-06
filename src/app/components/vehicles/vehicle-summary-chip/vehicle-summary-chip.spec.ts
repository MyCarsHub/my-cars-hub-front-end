import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { VehicleSummaryChip } from './vehicle-summary-chip';

describe('VehicleSummaryChip display formatting (FEAT-0556)', () => {
  function render(vehicle: Record<string, unknown>, linkTo: 'detail' | 'none' = 'detail'): string {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(VehicleSummaryChip);
    fixture.componentRef.setInput('vehicle', vehicle);
    fixture.componentRef.setInput('linkTo', linkTo);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  const base = { id: 'v1', type: 'CAR', status: 'AVAILABLE', hodometer: null };

  it('hyphenates the plate and title-cases an all-caps brand and model', () => {
    const text = render({ ...base, plate: 'abc1d23', brand: 'VOLKSWAGEN', model: 'T-CROSS' });
    expect(text).toContain('ABC-1D23');
    expect(text).toContain('Volkswagen T-Cross');
  });

  it('keeps acronyms and mixed-case text as stored', () => {
    expect(render({ ...base, plate: 'ABC1D23', brand: 'byd', model: 'Dolphin Mini' })).toContain('BYD Dolphin Mini');
  });

  it('shows a dash for a missing plate', () => {
    expect(render({ ...base, plate: '', brand: 'Fiat', model: 'Uno' }, 'none')).toContain('—');
  });
});
