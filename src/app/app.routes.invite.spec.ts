import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { routes } from './app.routes';

/**
 * The invitation e-mail still links to `/invite/accept` (the back-end `InviteLinkBuilder`
 * emits it in query mode and in fragment mode). This pins the REAL route table: that
 * address must keep redirecting to `/convite` without dropping the token, whichever way it
 * travels. The invite page strips the token from the bar once it loads, so the assertion
 * reads the URL the redirect produced (`NavigationEnd.urlAfterRedirects`), not `router.url`.
 */
describe('legacy invite link in app.routes', () => {
  function configure(): Router {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
    return TestBed.inject(Router);
  }

  async function redirectedTo(link: string): Promise<string> {
    const router = configure();
    const finished: string[] = [];
    router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) finished.push(event.urlAfterRedirects);
    });
    await router.navigateByUrl(link);
    return finished[0];
  }

  it('declares invite/accept as a full-match redirect to convite', () => {
    const route = routes.find((r) => r.path === 'invite/accept');

    expect(route?.redirectTo).toBe('convite');
    expect(route?.pathMatch).toBe('full');
  });

  it('keeps the query token when /invite/accept?token= is opened', async () => {
    expect(await redirectedTo('/invite/accept?token=abc123')).toBe('/convite?token=abc123');
  });

  it('keeps the fragment token when /invite/accept#token= is opened', async () => {
    expect(await redirectedTo('/invite/accept#token=abc123')).toBe('/convite#token=abc123');
  });

  it('keeps query and fragment together', async () => {
    expect(await redirectedTo('/invite/accept?token=abc123&x=1#token=zzz')).toBe(
      '/convite?token=abc123&x=1#token=zzz',
    );
  });
});
