# Frontend Map

Living index of the front-end. Add entries when creating/modifying pages, services, and shared components.

## Pages

- `pages/landing` — public marketing page.
- `pages/login`, `pages/signup`, `pages/oauth-success` — auth flow.
- `pages/onboarding` — multi-step onboarding container, uses `onboarding.service.ts` signal cache with backend as source of truth.
- `pages/dashboard`, `pages/veiculos`, `pages/motoristas`, `pages/manutencoes`, `pages/relatorios` — currently rendered by `ConstructorPage`.
- `pages/company-settings` — org info + security. Reference visual pattern for cards.
- `pages/billing` — plans, subscription, checkout, cancel. Reference for signal-based service consumption.
- `pages/profile` — user profile.
- `pages/roadmap` — Jira-style feedback board (Backlog / Planejado / Em Desenvolvimento / Concluído + collapsed Rejected). Users create sugestões and give "combustível" (upvote). Author-only edit/delete in BACKLOG (delete only when fuelCount <= 1). Admin-only status dropdown + reject dialog + hard delete when `systemRole === 'PLATFORM_ADMIN'`. Sort chips fuel/new. Uses `app-default-page-layout`, `app-page-card`, `app-confirm-dialog`. Inline modal (reactive form) for create/edit; inline modal for reject note.

## Services

- `services/auth.service.ts` — `getMe()` hydrates session: id, name, email, systemRole ('USER' | 'PLATFORM_ADMIN'), companies, onboarding flag, selected company.
- `services/session.service.ts` — thin sessionStorage wrapper. Convenience getters: `getUserId()`, `getSystemRole()`, `isPlatformAdmin()`.
- `services/auth.interceptor.ts` — Bearer token attach for `environment.apiUrl` requests.
- `services/auth-guard.ts`, `services/role.guard.ts` — route guards. Roadmap has no guard beyond `authGuard`.
- `services/billing.service.ts` — reference signal-based service pattern (private writable signals + readonly exposures + tap/catchError/finalize).
- `services/company.service.ts`, `services/loginService.ts` — misc.
- `services/feedback.service.ts` — CRUD for `/feedback/tasks`, admin endpoints under `/admin/feedback/tasks`. Signals: `tasks`, `loading`, `error`, `page`, `total`. Optimistic `fuel()` / `unfuel()` with rollback on error. `create()` prepends to the tasks signal.

## Types

- `types/me-response.type.ts` — includes `systemRole: 'USER' | 'PLATFORM_ADMIN'`.
- `types/feedback.types.ts` — `FeedbackStatus`, `FeedbackTaskResponse`, `PagedResponse<T>`, `CreateFeedbackTaskRequest`, `UpdateFeedbackTaskRequest`, `UpdateStatusRequest`, `FeedbackSort`.
- `types/billing.types.ts`, `types/company-*.ts`, `types/user-companies.ts`, `types/login-response.type.ts`, `types/oauth-login-response.ts` — misc contracts.

## Routing

- Everything protected sits under `AppShell` -> `authGuard` -> `onboardingGuard`.
- `/roadmap` — authenticated only, no role guard. `data.pageTitle: 'Roadmap'`.

## Shared components

- `components/layout/default-page-layout` — page header with title/description + `<ng-content>`.
- `components/core/page-card` — bg-white rounded-2xl card with title slot, `[cardIcon]`, `[cardActions]` content projections.
- `components/core/confirm-dialog` — reusable confirmation modal with `variant: 'info' | 'warning' | 'danger'`.
- `components/sidebar` — nav items with optional `roles` filter (company role). Roadmap entry has no role filter.

## Session keys

`token`, `id`, `name`, `email`, `systemRole`, `userCompanies`, `selectedCompanyId`, `selectedCompanyName`, `selectedRole`, `onboardingCompleted`.
