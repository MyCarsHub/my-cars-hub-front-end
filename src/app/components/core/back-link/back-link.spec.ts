import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { BackLink, BackLinkPlacement } from './back-link';

@Component({
  imports: [BackLink],
  template: `<app-back-link [link]="link" [label]="label" [placement]="placement" />`,
})
class HostComponent {
  link: string | readonly unknown[] = '/admin';
  label = 'Voltar para o painel admin';
  placement: BackLinkPlacement = 'bottom';
}

function createHost(overrides: Partial<HostComponent> = {}) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(HostComponent);
  Object.assign(fixture.componentInstance, overrides);
  fixture.detectChanges();
  return fixture;
}

describe('BackLink', () => {
  it('renders the label after a decorative arrow', () => {
    const fixture = createHost();
    const anchor = fixture.debugElement.query(By.css('a'));

    expect(anchor.nativeElement.textContent.trim()).toContain('Voltar para o painel admin');
    expect(anchor.query(By.css('span')).nativeElement.getAttribute('aria-hidden')).toBe('true');
  });

  it('resolves a string destination', () => {
    const fixture = createHost();
    const anchor = fixture.debugElement.query(By.css('a'));

    expect(anchor.nativeElement.getAttribute('href')).toBe('/admin');
  });

  it('resolves an array destination', () => {
    const fixture = createHost({ link: ['/veiculos', 42] });

    expect(fixture.debugElement.query(By.css('a')).nativeElement.getAttribute('href')).toBe(
      '/veiculos/42',
    );
  });

  it('carries the 44px touch target and a visible focus ring', () => {
    const fixture = createHost();
    const classes = fixture.debugElement.query(By.css('a')).nativeElement.className;

    expect(classes).toContain('min-h-[44px]');
    expect(classes).toContain('focus-visible:ring-2');
    expect(classes).toContain('focus-visible:ring-offset-2');
  });

  it('applies mt-6 on the host when bottom-placed', () => {
    const fixture = createHost();
    const host = fixture.debugElement.query(By.css('app-back-link')).nativeElement;

    expect(host.classList.contains('mt-6')).toBe(true);
    expect(host.classList.contains('mb-2')).toBe(false);
  });

  it('applies mb-2 on the host when top-placed', () => {
    const fixture = createHost({ placement: 'top' });
    const host = fixture.debugElement.query(By.css('app-back-link')).nativeElement;

    expect(host.classList.contains('mb-2')).toBe(true);
    expect(host.classList.contains('mt-6')).toBe(false);
  });

  it('applies no vertical margin when placement is none', () => {
    const fixture = createHost({ placement: 'none' });
    const host = fixture.debugElement.query(By.css('app-back-link')).nativeElement;

    expect(host.classList.contains('mb-2')).toBe(false);
    expect(host.classList.contains('mt-6')).toBe(false);
  });
});
