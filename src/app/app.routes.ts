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
        // SEO: `data.seo` marks a route as PUBLIC and indexable. Routes without it get
        // `noindex, nofollow` and no canonical from `PageTitleStrategy` — fail-closed, so
        // the authenticated tree can never leak into Google by someone forgetting a flag.
        // Prerendered at build time; see `app.routes.server.ts`.
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
            import('./pages/landing/page/landing.component').then(
                (m) => m.LandingComponent
            ),
        data: {
            pageTitle: 'Gestão inteligente para locadoras',
            seo: {
                description:
                    'Sistema de gestão para locadoras de veículos: frota, motoristas, ' +
                    'aluguéis, contratos, cobranças automáticas e relatórios em uma plataforma só. ' +
                    'Teste 14 dias grátis, sem cartão.',
                canonicalPath: '/',
            },
        },
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
        // PUBLIC on purpose: this is the link the invitation e-mail carries,
        // `{frontendUrl}/invite/accept?token={rawToken}`. The path and the query-param
        // name are the backend's contract — changing either 404s every invite already
        // sent. It must also stay OUTSIDE the AppShell/authGuard tree: the invitee opens
        // it logged out and only authenticates halfway through the flow.
        path: 'invite/accept',
        loadComponent: () =>
            import('./pages/invites/invite-accept').then((m) => m.InviteAccept),
        data: { pageTitle: 'Convite' },
    },
    {
        path: 'blog',
        loadComponent: () =>
            import('./pages/blog/blog-list').then((m) => m.BlogList),
        data: {
            pageTitle: 'Blog',
            seo: {
                description:
                    'Conteúdo prático sobre gestão de locadoras de veículos: contratos, ' +
                    'cobrança, manutenção de frota e controle de motoristas.',
            },
        },
    },
    {
        // NOT prerendered: the post comes from an API call at runtime. The canonical is
        // still per-slug because it is derived from the resolved URL, not from `data`.
        //
        // The description below is only the FALLBACK used until the post lands — it is
        // identical for every slug, so `BlogDetail` overwrites it with the post's own
        // `metaDescription` (see `SeoService.setDescription`). Without that override the
        // whole blog would ship duplicate meta descriptions.
        path: 'blog/:slug',
        loadComponent: () =>
            import('./pages/blog/blog-detail').then((m) => m.BlogDetail),
        data: {
            pageTitle: 'Blog',
            seo: {
                description:
                    'Artigo do blog MyCarsHub sobre gestão de locadoras de veículos.',
            },
        },
    },
    {
        path: 'politica-de-privacidade',
        loadComponent: () =>
            import('./pages/legal/privacy-policy/privacy-policy.component').then(
                (m) => m.PrivacyPolicyComponent
            ),
        data: {
            pageTitle: 'Política de Privacidade',
            seo: {
                description:
                    'Como o MyCarsHub coleta, usa, armazena e protege os dados pessoais ' +
                    'de locadoras e motoristas, em conformidade com a LGPD.',
                // PT is the canonical version; `?lang=en` must not create a duplicate URL.
                canonicalPath: '/politica-de-privacidade',
            },
        },
    },
    {
        path: 'termos-de-uso',
        loadComponent: () =>
            import('./pages/legal/terms-of-use/terms-of-use.component').then(
                (m) => m.TermsOfUseComponent
            ),
        data: {
            pageTitle: 'Termos de Uso',
            seo: {
                description:
                    'Condições de uso da plataforma MyCarsHub: contratação, planos, ' +
                    'responsabilidades das partes e regras de cancelamento.',
                canonicalPath: '/termos-de-uso',
            },
        },
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
                        // Sem roleGuard: todo membro autenticado vê os próprios
                        // vencimentos.
                        path: 'alertas',
                        loadComponent: () =>
                            import('./pages/alertas/alerts-page').then(
                                (m) => m.AlertsPage
                            ),
                        data: { pageTitle: 'Alertas' },
                    },
                    {
                        // Visões AGREGADAS da frota — não pendem de um veículo
                        // e por isso ficam fora de `/veiculos/:id`.
                        path: 'frota',
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        children: [
                            {
                                path: 'calendario',
                                loadComponent: () =>
                                    import(
                                        './pages/vehicles/fleet-calendar/fleet-calendar-page'
                                    ).then((m) => m.FleetCalendarPage),
                                data: { pageTitle: 'Calendário da frota' },
                            },
                        ],
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
                                path: ':id/gerencia/seguros',
                                loadComponent: () =>
                                    import(
                                        './pages/vehicles/vehicle-gerencia/gerencia-insurances'
                                    ).then((m) => m.GerenciaInsurances),
                                data: { pageTitle: 'Seguros do veículo' },
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
                        // Sinistro NÃO é multa: multa tem órgão emissor e
                        // pontuação na CNH; sinistro tem seguradora, franquia e
                        // um veículo potencialmente parado. Rota própria.
                        path: 'sinistros',
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        children: [
                            {
                                path: '',
                                pathMatch: 'full',
                                loadComponent: () =>
                                    import('./pages/incidents/incidents-list').then(
                                        (m) => m.IncidentsList
                                    ),
                                data: { pageTitle: 'Sinistros' },
                            },
                            {
                                path: 'novo',
                                loadComponent: () =>
                                    import('./pages/incidents/incident-form').then(
                                        (m) => m.IncidentForm
                                    ),
                                data: { pageTitle: 'Registrar sinistro' },
                            },
                            {
                                path: ':id',
                                loadComponent: () =>
                                    import('./pages/incidents/incident-detail').then(
                                        (m) => m.IncidentDetail
                                    ),
                                data: { pageTitle: 'Detalhes do sinistro' },
                            },
                            {
                                path: ':id/editar',
                                loadComponent: () =>
                                    import('./pages/incidents/incident-form').then(
                                        (m) => m.IncidentForm
                                    ),
                                data: { pageTitle: 'Editar sinistro' },
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
                        path: 'seguros',
                        canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                        children: [
                            {
                                path: '',
                                pathMatch: 'full',
                                loadComponent: () =>
                                    import(
                                        './pages/insurances/insurances-list'
                                    ).then((m) => m.InsurancesList),
                                data: { pageTitle: 'Seguros' },
                            },
                            {
                                path: ':id/editar',
                                loadComponent: () =>
                                    import(
                                        './pages/insurances/insurance-form'
                                    ).then((m) => m.InsuranceForm),
                                data: { pageTitle: 'Editar apólice' },
                            },
                            {
                                path: ':id',
                                loadComponent: () =>
                                    import(
                                        './pages/insurances/insurance-detail'
                                    ).then((m) => m.InsuranceDetail),
                                data: { pageTitle: 'Detalhes da apólice' },
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
                                        './pages/company-settings/integrations/integrations-hub'
                                    ).then((m) => m.IntegrationsHub),
                                data: { pageTitle: 'Integração' },
                            },
                            {
                                path: 'integracoes/asaas',
                                canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                                loadComponent: () =>
                                    import(
                                        './pages/company-settings/integrations/asaas-integration'
                                    ).then((m) => m.AsaasIntegration),
                                data: { pageTitle: 'Integração Asaas' },
                            },
                            {
                                // Janelas de aviso da empresa. Só OWNER/MANAGER
                                // edita; membro comum vê o estado (leitura) na
                                // própria página `/alertas`.
                                path: 'alertas',
                                canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                                loadComponent: () =>
                                    import(
                                        './pages/company-settings/alert-windows/alert-windows'
                                    ).then((m) => m.AlertWindows),
                                data: { pageTitle: 'Avisos de vencimento' },
                            },
                            {
                                // Regra de multa por devolução em atraso.
                                // Subdiretório + serviço próprios, fora da tela
                                // de Configurações: o PUT toca só multiplicador
                                // + tolerância e não pode herdar a corrida de
                                // carregamento daquela. Só OWNER/MANAGER edita;
                                // membro comum lê a regra em vigor no popup de
                                // conclusão do aluguel, junto da conta da multa.
                                path: 'atraso',
                                canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                                loadComponent: () =>
                                    import(
                                        './pages/company-settings/overdue-fee/overdue-fee'
                                    ).then((m) => m.OverdueFee),
                                data: { pageTitle: 'Devolução com atraso' },
                            },
                            {
                                // Dados de contato da empresa que alimentam o
                                // contrato. Rota própria, fora da tela de
                                // Configurações: o PUT substitui o bloco de
                                // contato INTEIRO, então esta tela não pode
                                // herdar a corrida de carregamento daquela.
                                // OWNER-only para casar com o backend, que exige
                                // OWNER em PUT /v1/companies/me.
                                path: 'contato',
                                canActivate: [roleGuard(['OWNER'])],
                                loadComponent: () =>
                                    import(
                                        './pages/company-settings/company-contact/company-contact'
                                    ).then((m) => m.CompanyContact),
                                data: { pageTitle: 'Dados de contato' },
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
                            {
                                path: 'convites',
                                canActivate: [roleGuard(['OWNER', 'MANAGER'])],
                                loadComponent: () =>
                                    import('./pages/invites/invites').then(
                                        (m) => m.Invites
                                    ),
                                data: { pageTitle: 'Convites' },
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
                            {
                                path: 'auditoria',
                                loadComponent: () =>
                                    import('./pages/admin/audit/admin-audit').then(
                                        (m) => m.AdminAudit,
                                    ),
                                data: { pageTitle: 'Auditoria' },
                            },
                            {
                                path: 'billing',
                                loadComponent: () =>
                                    import('./pages/admin/billing/admin-billing').then(
                                        (m) => m.AdminBilling,
                                    ),
                                data: { pageTitle: 'Billing' },
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
