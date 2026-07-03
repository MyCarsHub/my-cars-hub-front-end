import { Routes } from '@angular/router';
import { authGuard } from './services/auth-guard';
import { roleGuard } from './services/role.guard';
import { adminGuard } from './services/admin.guard';
import { Login } from './pages/login/login';
import { Signup } from './pages/signup/signup';
import { ConstructorPage } from './pages/constructor-page/constructor-page';
import { AppShell } from './components/core/layouts/app-shell';
import { OauthSuccess } from './pages/oauth-success/oauth-success';
import {
    onboardingGuard,
    onboardingCompleteGuard,
} from './pages/onboarding/onboarding.guard';
import { CompanySettings } from './pages/company-settings/company-settings';

export const routes: Routes = [
    {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
            import('./pages/landing/page/landing.component').then(
                (m) => m.LandingComponent
            ),
    },
    {
        path: 'login',
        component: Login,
    },
    {
        path: 'signup',
        component: Signup,
    },
    {
        path: 'oauth-success',
        component: OauthSuccess,
    },
    {
        path: '',
        component: AppShell,
        canActivate: [authGuard],
        children: [
            {
                path: 'onboarding',
                canActivate: [onboardingCompleteGuard],
                loadComponent: () =>
                    import('./pages/onboarding/onboarding-container').then(
                        (m) => m.OnboardingContainer
                    ),
            },
            {
                path: '',
                canActivateChild: [onboardingGuard],
                children: [
                    {
                        path: 'dashboard',
                        component: ConstructorPage,
                        data: { pageTitle: 'Dashboard' },
                    },
                    {
                        path: 'veiculos',
                        component: ConstructorPage,
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        data: { pageTitle: 'Veículos' },
                    },
                    {
                        path: 'motoristas',
                        component: ConstructorPage,
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        data: { pageTitle: 'Motoristas' },
                    },
                    {
                        path: 'manutencoes',
                        component: ConstructorPage,
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        data: { pageTitle: 'Manutenções' },
                    },
                    {
                        path: 'relatorios',
                        component: ConstructorPage,
                        canActivate: [roleGuard(['OWNER'])],
                        data: { pageTitle: 'Relatórios' },
                    },
                    {
                        path: 'configuracoes',
                        component: CompanySettings,
                        canActivate: [roleGuard(['OWNER'])],
                        data: { pageTitle: 'Configurações' },
                    },
                    {
                        path: 'billing',
                        canActivate: [roleGuard(['OWNER'])],
                        children: [
                            {
                                path: '',
                                pathMatch: 'full',
                                loadComponent: () =>
                                    import('./pages/billing/billing').then(
                                        (m) => m.Billing
                                    ),
                                data: { pageTitle: 'Assinatura' },
                            },
                            {
                                path: 'success',
                                loadComponent: () =>
                                    import(
                                        './pages/billing/billing-success/billing-success'
                                    ).then((m) => m.BillingSuccess),
                                data: { pageTitle: 'Confirmando pagamento' },
                            },
                        ],
                    },
                    {
                        path: 'perfil',
                        loadComponent: () =>
                            import('./pages/profile/profile').then(
                                (m) => m.Profile
                            ),
                        data: { pageTitle: 'Perfil' },
                    },
                    {
                        path: 'roadmap',
                        loadComponent: () =>
                            import('./pages/roadmap/roadmap').then(
                                (m) => m.Roadmap
                            ),
                        data: { pageTitle: 'Roadmap' },
                    },
                    {
                        path: 'admin',
                        canActivate: [adminGuard],
                        canActivateChild: [adminGuard],
                        children: [
                            {
                                path: '',
                                pathMatch: 'full',
                                loadComponent: () =>
                                    import('./pages/admin/admin-home').then(
                                        (m) => m.AdminHome
                                    ),
                                data: { pageTitle: 'Administração' },
                            },
                            {
                                path: 'feedback',
                                loadComponent: () =>
                                    import(
                                        './pages/admin/admin-feedback/admin-feedback'
                                    ).then((m) => m.AdminFeedback),
                                data: { pageTitle: 'Moderação de Feedback' },
                            },
                        ],
                    },
                    {
                        path: '',
                        redirectTo: 'dashboard',
                        pathMatch: 'full',
                    },
                ],
            },
        ],
    },
    {
        path: '**',
        redirectTo: 'login',
    },
];