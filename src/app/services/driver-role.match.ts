import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { SessionService } from './session.service';

/**
 * `canMatch` that is true only for a DRIVER — the route that carries it is not "protected",
 * it is ONE OF TWO components for the same URL, and the router picks by role.
 *
 * `/perfil` is shared: the company's profile (plan, billing, companies) and the driver's own
 * (his record, phone, address, rental). Two routes, same path, this match first, so a driver
 * never instantiates the page whose `ngOnInit` reads `/v1/billing/**` — a 403 for him — and
 * an owner never lands on the driver's.
 *
 * The role comes from the TOKEN, the same source as `roleGuard` and the sidebar. A token that
 * is absent, expired or role-less is NOT a driver: it falls through to the generic page, whose
 * parent guards (`authGuard`) already handle that session.
 */
export const driverRoleMatch: CanMatchFn = () =>
  inject(SessionService).getCompanyRoleFromToken() === 'DRIVER';
