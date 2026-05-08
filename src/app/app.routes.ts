import { Routes } from '@angular/router';
import { authGuard } from './services/auth-guard';
import { roleGuard } from './services/role.guard';
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