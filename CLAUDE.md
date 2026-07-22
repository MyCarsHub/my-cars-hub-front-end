# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Route through the `frontend-angular` subagent** for any code change here — see root `../CLAUDE.md` §2. Do not edit `src/**` directly from the orchestrator.

Angular/TypeScript conventions for this repo live in [.claude/CLAUDE.md](.claude/CLAUDE.md) — read it first.

## Commands

- `npm start` — dev server at http://localhost:4200
- `npm run build` — production build into `dist/`
- `npm run watch` — dev build with rebuild on change
- `npm test` — Vitest via `ng test`
- `ng generate component <name>` — scaffold a component

Backend API base URL is configured in [src/environments/environment.ts](src/environments/environment.ts) (defaults to `http://localhost:8085/v1`).

## Architecture

Angular 21 standalone-component SPA. App bootstraps from [src/app/app.config.ts](src/app/app.config.ts) with the router, fetch-based HttpClient, the `authInterceptor`, and animations.

### Routing & shell

[src/app/app.routes.ts](src/app/app.routes.ts) defines the route tree:

- Public: `/landing`, `/login`, `/signup`, `/oauth-success`
- Authenticated tree: protected by `authGuard`, wrapped in `AppShell` (sidebar + `<router-outlet>`)
  - `/onboarding` — gated by `onboardingCompleteGuard` (redirects to `/dashboard` if already done)
  - All other authenticated children share `onboardingGuard` as `canActivateChild` (forces incomplete users back to `/onboarding`)
  - Role-restricted pages use `roleGuard(['OWNER', 'MANAGER'])` etc. — role comes from `selectedRole` in sessionStorage

`ConstructorPage` is a placeholder rendered for several routes still under construction; the `data.pageTitle` on each route is what's shown.

### Auth & session

- [services/session.service.ts](src/app/services/session.service.ts) — thin SSR-safe `sessionStorage` wrapper. All auth state (token, user info, selected company/role, onboarding flag) is keyed here.
- [services/auth.interceptor.ts](src/app/services/auth.interceptor.ts) — attaches `Authorization: Bearer <token>` only to requests whose URL includes `environment.apiUrl`.
- [services/auth.service.ts](src/app/services/auth.service.ts) — `getMe()` hydrates session state from `/auth/me`, picks a default company (preferring `OWNER`), and sets the onboarding-completed flag based on `companies.length > 0`.
- [services/auth-guard.ts](src/app/services/auth-guard.ts), [services/role.guard.ts](src/app/services/role.guard.ts), [pages/onboarding/onboarding.guard.ts](src/app/pages/onboarding/onboarding.guard.ts) — route guards.

### Multi-tenant model

A user can belong to multiple companies with a role (`OWNER` / `MANAGER` / others). The "active" company is stored in sessionStorage as `selectedCompanyId` / `selectedCompanyName` / `selectedRole`, and `roleGuard` is the access-control mechanism on the route tree. There's no global tenant store — components read from `SessionService` directly.

### Onboarding flow

[pages/onboarding/onboarding.service.ts](src/app/pages/onboarding/onboarding.service.ts) holds a signal-based local cache; **backend is the source of truth**. Pattern: `loadState()` on entry and on Back, `saveStep(step, partial)` on Next (merges into full data before POST), `finish()` on the last step (treats HTTP 409 / "já finalizado" as success). Total steps: 4.

The onboarding-completed flag lives in two places — `SessionService.isOnboardingCompleted()` (sessionStorage) and `OnboardingService.isCompleted()` (signal). Guards check session first to avoid a round-trip, then fall back to `loadState()`.

### Layout

[components/core/layouts/app-shell.ts](src/app/components/core/layouts/app-shell.ts) drives a sidebar + main layout via `LayoutStore` (signals). Mobile breakpoint is `< 1024px` and is detected with a `window.resize` listener registered in `ngOnInit`.

## Styling

Tailwind CSS v4 via `@tailwindcss/postcss`. Prettier config (in `package.json`) uses `printWidth: 100`, `singleQuote: true`, Angular parser for HTML.
