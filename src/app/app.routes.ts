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
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        children: [
                            {
                                path: '',
                                pathMatch: 'full',
                                loadComponent: () =>
                                    import(
                                        './pages/vehicles/vehicles-list'
                                    ).then((m) => m.VehiclesList),
                                data: { pageTitle: 'Veículos' },
                            },
                            {
                                path: 'novo',
                                loadComponent: () =>
                                    import(
                                        './pages/vehicles/vehicle-form'
                                    ).then((m) => m.VehicleForm),
                                data: { pageTitle: 'Novo veículo' },
                            },
                            {
                                path: ':id',
                                loadComponent: () =>
                                    import(
                                        './pages/vehicles/vehicle-detail'
                                    ).then((m) => m.VehicleDetail),
                                data: { pageTitle: 'Detalhes do veículo' },
                            },
                            {
                                path: ':id/gerencia',
                                loadComponent: () =>
                                    import(
                                        './pages/vehicles/vehicle-gerencia/vehicle-gerencia-hub'
                                    ).then((m) => m.VehicleGerenciaHub),
                                data: { pageTitle: 'Gerência do veículo' },
                            },
                            {
                                path: ':id/gerencia/multas',
                                loadComponent: () =>
                                    import(
                                        './pages/vehicles/vehicle-gerencia/gerencia-fines'
                                    ).then((m) => m.GerenciaFines),
                                data: { pageTitle: 'Multas do veículo' },
                            },
                            {
                                path: ':id/gerencia/manutencoes',
                                loadComponent: () =>
                                    import(
                                        './pages/vehicles/vehicle-gerencia/gerencia-maintenances'
                                    ).then((m) => m.GerenciaMaintenances),
                                data: { pageTitle: 'Manutenções do veículo' },
                            },
                            {
                                path: ':id/gerencia/financiamentos',
                                loadComponent: () =>
                                    import(
                                        './pages/vehicles/vehicle-gerencia/gerencia-financings'
                                    ).then((m) => m.GerenciaFinancings),
                                data: { pageTitle: 'Financiamentos do veículo' },
                            },
                            {
                                path: ':id/editar',
                                loadComponent: () =>
                                    import(
                                        './pages/vehicles/vehicle-form'
                                    ).then((m) => m.VehicleForm),
                                data: { pageTitle: 'Editar veículo' },
                            },
                        ],
                    },
                    {
                        path: 'motoristas',
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        children: [
                            {
                                path: '',
                                pathMatch: 'full',
                                loadComponent: () =>
                                    import(
                                        './pages/drivers/drivers-list'
                                    ).then((m) => m.DriversList),
                                data: { pageTitle: 'Motoristas' },
                            },
                            {
                                path: 'novo',
                                loadComponent: () =>
                                    import(
                                        './pages/drivers/driver-form'
                                    ).then((m) => m.DriverForm),
                                data: { pageTitle: 'Novo motorista' },
                            },
                            {
                                path: ':id',
                                loadComponent: () =>
                                    import(
                                        './pages/drivers/driver-detail'
                                    ).then((m) => m.DriverDetail),
                                data: { pageTitle: 'Detalhes do motorista' },
                            },
                            {
                                path: ':id/editar',
                                loadComponent: () =>
                                    import(
                                        './pages/drivers/driver-form'
                                    ).then((m) => m.DriverForm),
                                data: { pageTitle: 'Editar motorista' },
                            },
                        ],
                    },
                    {
                        path: 'manutencoes',
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        children: [
                            {
                                path: '',
                                pathMatch: 'full',
                                loadComponent: () =>
                                    import(
                                        './pages/maintenances/maintenances-list'
                                    ).then((m) => m.MaintenancesList),
                                data: { pageTitle: 'Manutenções' },
                            },
                            {
                                path: 'novo',
                                loadComponent: () =>
                                    import(
                                        './pages/maintenances/maintenance-form'
                                    ).then((m) => m.MaintenanceForm),
                                data: { pageTitle: 'Nova manutenção' },
                            },
                            {
                                path: ':id',
                                loadComponent: () =>
                                    import(
                                        './pages/maintenances/maintenance-detail'
                                    ).then((m) => m.MaintenanceDetail),
                                data: { pageTitle: 'Detalhes da manutenção' },
                            },
                            {
                                path: ':id/editar',
                                loadComponent: () =>
                                    import(
                                        './pages/maintenances/maintenance-form'
                                    ).then((m) => m.MaintenanceForm),
                                data: { pageTitle: 'Editar manutenção' },
                            },
                        ],
                    },
                    {
                        path: 'multas',
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        children: [
                            {
                                path: '',
                                pathMatch: 'full',
                                loadComponent: () =>
                                    import('./pages/fines/fines-list').then(
                                        (m) => m.FinesList
                                    ),
                                data: { pageTitle: 'Multas' },
                            },
                            {
                                path: 'novo',
                                loadComponent: () =>
                                    import('./pages/fines/fine-form').then(
                                        (m) => m.FineForm
                                    ),
                                data: { pageTitle: 'Nova multa' },
                            },
                            {
                                path: ':id',
                                loadComponent: () =>
                                    import('./pages/fines/fine-detail').then(
                                        (m) => m.FineDetail
                                    ),
                                data: { pageTitle: 'Detalhes da multa' },
                            },
                            {
                                path: ':id/editar',
                                loadComponent: () =>
                                    import('./pages/fines/fine-form').then(
                                        (m) => m.FineForm
                                    ),
                                data: { pageTitle: 'Editar multa' },
                            },
                        ],
                    },
                    {
                        path: 'financiamentos',
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        children: [
                            {
                                path: '',
                                pathMatch: 'full',
                                loadComponent: () =>
                                    import(
                                        './pages/financings/financings-list'
                                    ).then((m) => m.FinancingsList),
                                data: { pageTitle: 'Financiamentos' },
                            },
                        ],
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