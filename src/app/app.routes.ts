import { Routes } from '@angular/router';
import { authGuard } from './services/auth-guard';
import { roleGuard } from './services/role.guard';
import { adminGuard } from './services/admin.guard';
import { billingAccessGuard } from './services/billing-access.guard';
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
        loadComponent: () =>
            import('./pages/google-login/google-login').then(
                (m) => m.GoogleLogin
            ),
    },
    {
        path: 'signup',
        redirectTo: 'login',
        pathMatch: 'full',
    },
    {
        path: 'oauth-success',
        component: OauthSuccess,
    },
    {
        path: 'blog',
        loadComponent: () =>
            import('./pages/blog/blog-list').then((m) => m.BlogList),
    },
    {
        path: 'blog/:slug',
        loadComponent: () =>
            import('./pages/blog/blog-detail').then((m) => m.BlogDetail),
    },
    {
        path: 'politica-de-privacidade',
        loadComponent: () =>
            import('./pages/legal/privacy-policy/privacy-policy.component').then(
                (m) => m.PrivacyPolicyComponent
            ),
        data: { pageTitle: 'Política de Privacidade — MyCarsHub' },
    },
    {
        path: 'termos-de-uso',
        loadComponent: () =>
            import('./pages/legal/terms-of-use/terms-of-use.component').then(
                (m) => m.TermsOfUseComponent
            ),
        data: { pageTitle: 'Termos de Uso — MyCarsHub' },
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
                canActivateChild: [onboardingGuard, billingAccessGuard],
                children: [
                    {
                        path: 'dashboard',
                        loadComponent: () =>
                            import('./pages/dashboard/dashboard-home').then(
                                (m) => m.DashboardHome
                            ),
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
                        path: 'alugueis',
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        children: [
                            {
                                path: '',
                                pathMatch: 'full',
                                loadComponent: () =>
                                    import(
                                        './pages/rentals/rentals-list'
                                    ).then((m) => m.RentalsList),
                                data: { pageTitle: 'Aluguéis' },
                            },
                            {
                                path: 'novo',
                                loadComponent: () =>
                                    import(
                                        './pages/rentals/rental-form'
                                    ).then((m) => m.RentalForm),
                                data: { pageTitle: 'Novo aluguel' },
                            },
                            {
                                path: ':id',
                                loadComponent: () =>
                                    import(
                                        './pages/rentals/rental-detail'
                                    ).then((m) => m.RentalDetail),
                                data: { pageTitle: 'Detalhes do aluguel' },
                            },
                            {
                                path: ':id/editar',
                                loadComponent: () =>
                                    import(
                                        './pages/rentals/rental-form'
                                    ).then((m) => m.RentalForm),
                                data: { pageTitle: 'Editar aluguel' },
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
                            {
                                path: ':id',
                                loadComponent: () =>
                                    import(
                                        './pages/financings/financing-detail'
                                    ).then((m) => m.FinancingDetail),
                                data: { pageTitle: 'Detalhes do financiamento' },
                            },
                        ],
                    },
                    {
                        path: 'relatorios',
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        loadComponent: () =>
                            import('./pages/relatorios/relatorios').then(
                                (m) => m.Relatorios
                            ),
                        data: { pageTitle: 'Relatórios' },
                    },
                    {
                        path: 'configuracoes',
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        children: [
                            {
                                path: '',
                                pathMatch: 'full',
                                component: CompanySettings,
                                canActivate: [roleGuard(['OWNER'])],
                                data: { pageTitle: 'Configurações' },
                            },
                            {
                                path: 'integracoes',
                                canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                                loadComponent: () =>
                                    import(
                                        './pages/company-settings/integrations/charge-integration'
                                    ).then((m) => m.ChargeIntegration),
                                data: { pageTitle: 'Integração de cobranças' },
                            },
                            {
                                path: 'integracoes/asaas',
                                canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                                loadComponent: () =>
                                    import(
                                        './pages/company-settings/integrations/asaas-integration'
                                    ).then((m) => m.AsaasIntegration),
                                data: { pageTitle: 'Integração Asaas (legado)' },
                            },
                            {
                                path: 'contratos',
                                canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                                loadComponent: () =>
                                    import(
                                        './pages/company-settings/contract-template/contract-template'
                                    ).then((m) => m.ContractTemplate),
                                data: { pageTitle: 'Template de contrato' },
                            },
                        ],
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
                        path: 'suporte',
                        loadComponent: () =>
                            import('./pages/support/support').then(
                                (m) => m.SupportPage,
                            ),
                        data: { pageTitle: 'Suporte' },
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
                            {
                                path: 'users',
                                loadComponent: () =>
                                    import(
                                        './pages/admin/users/admin-users'
                                    ).then((m) => m.AdminUsers),
                                data: { pageTitle: 'Usuários' },
                            },
                            {
                                path: 'users/:id',
                                loadComponent: () =>
                                    import(
                                        './pages/admin/users/admin-user-detail'
                                    ).then((m) => m.AdminUserDetail),
                                data: { pageTitle: 'Detalhes do usuário' },
                            },
                            {
                                path: 'companies',
                                loadComponent: () =>
                                    import(
                                        './pages/admin/companies/admin-companies'
                                    ).then((m) => m.AdminCompanies),
                                data: { pageTitle: 'Empresas' },
                            },
                            {
                                path: 'companies/:id',
                                loadComponent: () =>
                                    import(
                                        './pages/admin/companies/admin-company-detail'
                                    ).then((m) => m.AdminCompanyDetail),
                                data: { pageTitle: 'Detalhes da empresa' },
                            },
                            {
                                path: 'blog',
                                loadComponent: () =>
                                    import('./pages/admin/blog/admin-blog-list').then(
                                        (m) => m.AdminBlogList,
                                    ),
                                data: { pageTitle: 'Blog' },
                            },
                            {
                                path: 'blog/novo',
                                loadComponent: () =>
                                    import('./pages/admin/blog/admin-blog-form').then(
                                        (m) => m.AdminBlogForm,
                                    ),
                                data: { pageTitle: 'Novo post' },
                            },
                            {
                                path: 'blog/:id/editar',
                                loadComponent: () =>
                                    import('./pages/admin/blog/admin-blog-form').then(
                                        (m) => m.AdminBlogForm,
                                    ),
                                data: { pageTitle: 'Editar post' },
                            },
                            {
                                path: 'suporte',
                                loadComponent: () =>
                                    import('./pages/admin/support/admin-support-list').then(
                                        (m) => m.AdminSupportList,
                                    ),
                                data: { pageTitle: 'Suporte' },
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
