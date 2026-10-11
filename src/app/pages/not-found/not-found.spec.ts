import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { NotFound } from './not-found';

describe('NotFound', () => {
  let host: HTMLElement;
  let location: Location;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotFound],
      providers: [provideRouter([])],
    }).compileComponents();
    location = TestBed.inject(Location);
    router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(NotFound);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  it('says the page left the route, in a single h1', () => {
    const headings = host.querySelectorAll('h1');

    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toContain('Opa, essa página saiu da rota.');
    expect(host.textContent).toContain('Volte ao painel e siga de onde parou.');
  });

  it('has no logo, no landing nav and no shell: a clean full-screen page', () => {
    expect(host.querySelector('app-landing-nav')).toBeNull();
    expect(host.querySelector('app-sidebar')).toBeNull();
    expect(host.querySelector('header')).toBeNull();
    expect(host.querySelector('main img[alt*="MyCarsHub"]')).toBeNull();
  });

  it('shows the giant 404 behind the illustration, hidden from assistive tech', () => {
    const giant = Array.from(host.querySelectorAll('span[aria-hidden="true"]')).find(
      (s) => (s.textContent ?? '').trim() === '404',
    );
    const img = host.querySelector<HTMLImageElement>('picture img');

    expect(giant).toBeDefined();
    expect(img?.getAttribute('alt')).toContain('placa de sinalização');
    expect(img?.getAttribute('width')).toBe('1871');
    expect(img?.getAttribute('height')).toBe('768');
    expect(host.querySelector('picture source')?.getAttribute('type')).toBe('image/webp');
  });

  it('has ONE orange action, "Voltar ao painel", pointing at /dashboard', () => {
    const home = host.querySelector<HTMLAnchorElement>('[data-home]');

    expect(home?.textContent).toContain('Voltar ao painel');
    expect(home?.getAttribute('href')).toBe('/dashboard');
    const orange = Array.from(host.querySelectorAll('a, button')).filter((el) =>
      el.className.includes('bg-primary-500'),
    );
    expect(orange).toHaveLength(1);
  });

  it('goes back one page when there is history', () => {
    const back = vi.spyOn(location, 'back').mockImplementation(() => undefined);
    vi.spyOn(history, 'length', 'get').mockReturnValue(3);

    host.querySelector<HTMLButtonElement>('[data-back]')?.click();

    expect(back).toHaveBeenCalledOnce();
  });

  it('goes to the dashboard when there is no history to go back to', () => {
    const back = vi.spyOn(location, 'back').mockImplementation(() => undefined);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(history, 'length', 'get').mockReturnValue(1);

    host.querySelector<HTMLButtonElement>('[data-back]')?.click();

    expect(back).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('links the support WhatsApp in the footer', () => {
    const link = Array.from(host.querySelectorAll<HTMLAnchorElement>('main a')).find((a) =>
      (a.textContent ?? '').includes('Fale com o suporte'),
    );

    expect(link?.getAttribute('href')).toBe(`https://wa.me/${environment.supportWhatsapp}`);
    expect(link?.getAttribute('rel')).toContain('noopener');
  });
});
