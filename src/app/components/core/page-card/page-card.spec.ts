import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { PageCard } from './page-card';

@Component({
  imports: [PageCard],
  template: `
    <app-page-card
      title="Test Card"
      [collapsible]="collapsible"
      [defaultOpen]="defaultOpen"
      [storageKey]="storageKey"
      [truncateTitle]="truncate"
      [reserveTitleLines]="reserve"
    >
      <p data-testid="content">Body</p>
    </app-page-card>
  `,
})
class HostComponent {
  collapsible = false;
  defaultOpen = true;
  storageKey: string | null = null;
  truncate = false;
  reserve = false;
}

describe('PageCard', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders content and no chevron by default (backward-compat)', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const chevron = fixture.debugElement.query(By.css('button[aria-expanded]'));
    expect(chevron).toBeNull();
    const content = fixture.debugElement.query(By.css('[data-testid="content"]'));
    expect(content).not.toBeNull();
  });

  it('renders a chevron toggle when collapsible=true and toggles content', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.collapsible = true;
    fixture.detectChanges();

    const chevron = fixture.debugElement.query(By.css('button[aria-expanded]'));
    expect(chevron).not.toBeNull();
    expect(chevron.nativeElement.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.debugElement.query(By.css('[data-testid="content"]'))).not.toBeNull();

    chevron.nativeElement.click();
    fixture.detectChanges();

    expect(chevron.nativeElement.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.debugElement.query(By.css('[data-testid="content"]'))).toBeNull();
  });

  it('respects defaultOpen=false', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.collapsible = true;
    fixture.componentInstance.defaultOpen = false;
    fixture.detectChanges();

    const chevron = fixture.debugElement.query(By.css('button[aria-expanded]'));
    expect(chevron.nativeElement.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.debugElement.query(By.css('[data-testid="content"]'))).toBeNull();
  });

  it('persists state to sessionStorage when storageKey is set', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.collapsible = true;
    fixture.componentInstance.storageKey = 'test-card:open';
    fixture.detectChanges();

    const chevron = fixture.debugElement.query(By.css('button[aria-expanded]'));
    chevron.nativeElement.click();
    fixture.detectChanges();

    expect(sessionStorage.getItem('test-card:open')).toBe('false');
  });

  it('reads initial state from sessionStorage over defaultOpen', () => {
    sessionStorage.setItem('test-card:open', 'false');
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.collapsible = true;
    fixture.componentInstance.defaultOpen = true;
    fixture.componentInstance.storageKey = 'test-card:open';
    fixture.detectChanges();

    const chevron = fixture.debugElement.query(By.css('button[aria-expanded]'));
    expect(chevron.nativeElement.getAttribute('aria-expanded')).toBe('false');
  });

  it('truncateTitle keeps the title on one line and puts the full text in the tooltip', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.truncate = true;
    fixture.detectChanges();
    const h2 = fixture.debugElement.query(By.css('h2')).nativeElement as HTMLElement;
    expect(h2.className).toContain('truncate');
    expect(h2.getAttribute('title')).toBe('Test Card');
    expect(h2.parentElement!.className).toContain('min-w-0');
  });

  it('by default the title is not truncated and has no tooltip', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const h2 = fixture.debugElement.query(By.css('h2')).nativeElement as HTMLElement;
    expect(h2.className).not.toContain('truncate');
    expect(h2.hasAttribute('title')).toBe(false);
  });

  it('reserveTitleLines keeps a two-line header slot and lets the title wrap (no ellipsis)', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.reserve = true;
    fixture.detectChanges();
    const h2 = fixture.debugElement.query(By.css('h2')).nativeElement as HTMLElement;
    expect(h2.className).toContain('md:min-h-12');
    expect(h2.className).not.toContain('truncate');
  });

  it('without reserveTitleLines the header height is the title own height', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const h2 = fixture.debugElement.query(By.css('h2')).nativeElement as HTMLElement;
    expect(h2.className).not.toContain('md:min-h-12');
  });
});
