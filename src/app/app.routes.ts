import { Routes } from '@angular/router';
import { authGuard } from './services/auth-guard';
import { Login } from './pages/login/login';
import { Signup } from './pages/signup/signup';
import { ConstructorPage } from './pages/constructor-page/constructor-page';
import { AppShell } from './components/core/layouts/app-shell';
import { OauthSuccess } from './pages/oauth-success/oauth-success';


export const routes: Routes = [
    {
        path: 'login',
        component: Login
    },
    {
        path: 'signup',
        component: Signup,
    },
    {
        path: 'oauth-success',
        component: OauthSuccess
    },
    {
        path: '',
        component: AppShell,
        canActivate: [authGuard],
        children: [
            {
                path: 'dashboard',
                component: ConstructorPage,
                data: {
                    pageTitle: 'Dashboard'
                },
            },
            {
                path: 'veiculos',
                component: ConstructorPage,
                data: {
                    pageTitle: 'Veículos'
                },
            },
            {
                path: 'motoristas',
                component: ConstructorPage,
                data: {
                    pageTitle: 'Motoristas'
                },
            },
            {
                path: 'manutencoes',
                component: ConstructorPage,
                data: {
                    pageTitle: 'Manutenções'
                },
            },
            {
                path: 'relatorios',
                component: ConstructorPage,
                data: {
                    pageTitle: 'Relatórios'
                },
            },
            {
                path: 'configuracoes',
                component: ConstructorPage,
                data: {
                    pageTitle: 'Configurações'
                },
            },
            {
                path: 'account-steps',
                loadComponent: () =>
                    import('./pages/account-steps/account-steps').then((m) => m.AccountSteps),
                data: {
                    pageTitle: 'Passos da Conta'
                },
            },
            {
                path: '',
                redirectTo: 'dashboard',
                pathMatch: 'full'
            },
        ],
    },
    {
        path: '**',
        redirectTo: 'login'
    },
];
