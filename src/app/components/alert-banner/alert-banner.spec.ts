import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { AlertBanner } from './alert-banner';

describe('AlertBanner', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<AlertBanner>>;

  function banner(): HTMLElement {
    return fixture.nativeElement.querySelector('div') as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AlertBanner] }).compileComponents();
    fixture = TestBed.createComponent(AlertBanner);
  });

  it('renders an assertive alert for errors by default', () => {
    fixture.componentRef.setInput('message', 'Placa já cadastrada.');
    fixture.detectChanges();

    expect(banner().getAttribute('role')).toBe('alert');
    expect(banner().textContent?.trim()).toBe('Placa já cadastrada.');
  });

  it('uses the rose palette for errors', () => {
    fixture.componentRef.setInput('message', 'x');
    fixture.detectChanges();
    expect(banner().classList.contains('bg-rose-50')).toBe(true);
    expect(banner().classList.contains('text-rose-800')).toBe(true);
    expect(banner().classList.contains('rounded-xl')).toBe(true);
  });

  it('keeps role=alert for warnings', () => {
    fixture.componentRef.setInput('variant', 'warning');
    fixture.componentRef.setInput('message', 'x');
    fixture.detectChanges();
    expect(banner().getAttribute('role')).toBe('alert');
    expect(banner().classList.contains('bg-amber-50')).toBe(true);
  });

  it('uses the polite role=status for success and info', () => {
    fixture.componentRef.setInput('variant', 'success');
    fixture.componentRef.setInput('message', 'x');
    fixture.detectChanges();
    expect(banner().getAttribute('role')).toBe('status');

    fixture.componentRef.setInput('variant', 'info');
    fixture.detectChanges();
    expect(banner().getAttribute('role')).toBe('status');
  });
});
