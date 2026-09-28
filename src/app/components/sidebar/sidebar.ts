import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { filter, map, startWith } from 'rxjs';
import { signal } from '@angular/core';
import { LayoutStore, Tenant } from '../core/layouts/layout.store';
import { SessionService } from '../../services/session.service';
import { TOUR_ANCHORS } from '../tour/tour.types';
import { companyRoleLabel } from '../../utils/role-labels';

export interface NavItem {
  route?: string;
  label: string;
  icon: string;
  roles?: string[];
  requiresPlatformAdmin?: boolean;
  pinBottom?: boolean;
  children?: NavItem[];
  exactMatch?: boolean;
  /**
   * Âncora do tour guiado, emitida como `data-tour` no template. Só os itens que
   * algum passo destaca precisam de uma — ver `components/tour/tour.types.ts`.
   * Deliberadamente um atributo próprio, e não `aria-label`: o rótulo é copy e
   * muda; a âncora é contrato.
   */
  tourKey?: string;
}

const ICON_ADMIN = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`;
const ICON_DASHBOARD = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
const ICON_ALERTS = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
const ICON_RENTALS = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`;
const ICON_VEHICLES = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>`;
const ICON_MAINT = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
/*
 * Câmera fotográfica, e o motivo é o que a tela FAZ: uma vistoria é uma
 * sessão de fotos — 14 ângulos obrigatórios. Até hoje Vistorias usava o
 * `ICON_MAINT`, literalmente a mesma constante de Manutenções, e o menu dizia
 * que as duas eram a mesma coisa.
 *
 * NÃO devolva o ícone de manutenção para agrupar "Frota" por área: o ícone
 * aqui descreve a ação, não a seção. O desenho é o MESMO já usado no botão de
 * capturar foto em `pages/rentals/documents/rental-inspection-card.ts` —
 * reusado de propósito, porque duas câmeras diferentes no mesmo produto são
 * piores que nenhuma.
 */
const ICON_INSPECTION = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
const ICON_FINES = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const ICON_INCIDENTS = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4.9 16.1 3.3-3.3"/><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="m18.5 3-1.7 3.4 2.7.6-2 3"/></svg>`;
const ICON_FINANCING = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
const ICON_INSURANCE = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`;
const ICON_DRIVERS = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const ICON_REPORTS = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
const ICON_ROADMAP = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>`;
const ICON_BILLING = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;
const ICON_COMPANY = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 9h.01"/><path d="M9 13h.01"/><path d="M9 17h.01"/><path d="M15 9h.01"/><path d="M15 13h.01"/><path d="M15 17h.01"/></svg>`;
const ICON_INTEGRATIONS = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
/*
 * FIX-0553 — o desenho e o MESMO `user-plus` que a propria tela de Convites usa
 * no cabecalho (`pages/invites/invites.html`), reusado verbatim: o item do menu e
 * a tela que ele abre mostram o mesmo glifo, e nao ha dois desenhos de convite no
 * produto.
 */
const ICON_INVITES = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`;
const ICON_SETTINGS = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const ICON_PROFILE = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const ICON_SUPPORT = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.52 3.48A11.9 11.9 0 0 0 12 0C5.37 0 0 5.37 0 12a11.9 11.9 0 0 0 1.72 6.19L0 24l5.99-1.68A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.19-1.24-6.19-3.48-8.52zM12 22a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.55.99.99-3.47-.24-.36A9.9 9.9 0 0 1 2 12C2 6.48 6.48 2 12 2s10 4.48 10 10-4.48 10-10 10zm5.42-7.47c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.66.15-.2.3-.76.96-.93 1.15-.17.2-.35.22-.65.07-.3-.15-1.24-.46-2.36-1.46-.87-.78-1.46-1.73-1.63-2.03-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.66-1.6-.9-2.19-.24-.57-.48-.5-.66-.51h-.56c-.2 0-.5.07-.76.37-.26.3-1 1-1 2.44 0 1.44 1.03 2.83 1.17 3.03.15.2 2.04 3.11 4.94 4.36 2.9 1.25 2.9.83 3.42.78.52-.05 1.75-.71 2-1.4.24-.7.24-1.28.17-1.4-.07-.13-.27-.2-.57-.35z"/></svg>`;

/*
 * FEAT-0108 — `isAdmin` NÃO isenta do filtro de `roles`: os dois predicados são
 * independentes em `allowedItems`. Consequência, e ela é mudança de
 * comportamento numa população que JÁ está em produção: um PLATFORM_ADMIN SEM
 * papel de empresa perde Painel e Alertas do menu, porque ambos passaram a
 * exigir OWNER|MANAGER. É defensável — as duas telas são escopadas por empresa e
 * um admin sem empresa não tem o que ler nelas —, mas não estava escrito em
 * lugar nenhum, então fica escrito aqui. O item `/admin` acima não depende de
 * papel de empresa e continua aparecendo.
 */
export const NAV_ITEMS: NavItem[] = [
  { route: '/admin', label: 'Administração', icon: ICON_ADMIN, requiresPlatformAdmin: true },
  // FEAT-0108 — `/v1/dashboard/**` não está na lista de permitidos do FIX-0360:
  // para um DRIVER esta tela é 403 inteira, medido no backend por
  // `DriverScopeFilterOrderSecurityConfigTest` (GET /v1/dashboard/summary
  // responde 403 a um token de motorista). Sem `roles` ela era o primeiro item
  // do menu dele e a landing pós-login.
  {
    route: '/dashboard',
    label: 'Dashboard',
    icon: ICON_DASHBOARD,
    roles: ['OWNER', 'MANAGER'],
    tourKey: TOUR_ANCHORS.dashboard,
  },
  {
    // FEAT-0108 — DRIVER entra aqui: `/v1/rentals` e os sub-recursos do próprio
    // aluguel são EXATAMENTE o que o FIX-0360 libera para ele. Era o único item
    // do menu que servia ao motorista e o único que estava escondido dele.
    route: '/alugueis',
    label: 'Aluguéis',
    icon: ICON_RENTALS,
    roles: ['OWNER', 'MANAGER', 'DRIVER'],
    tourKey: TOUR_ANCHORS.rentals,
  },
  {
    label: 'Frota',
    icon: ICON_VEHICLES,
    tourKey: TOUR_ANCHORS.fleetGroup,
    children: [
      {
        route: '/veiculos',
        label: 'Veículos',
        icon: ICON_VEHICLES,
        roles: ['OWNER', 'MANAGER'],
        tourKey: TOUR_ANCHORS.vehicles,
      },
      {
        route: '/manutencoes',
        label: 'Manutenções',
        icon: ICON_MAINT,
        roles: ['OWNER', 'MANAGER'],
      },
      // FEAT-0142 — "Frota → Vistorias", pedido do dono, e FILHA de Frota:
      // entre Manutenções e Multas, nunca item de primeiro nível. `roles` casa
      // com o `roleGuard(['OWNER', 'MANAGER'])` da rota `/vistorias` em
      // `app.routes.ts` — os dois conjuntos são iguais, então o item nunca
      // oferece porta que o guard bata na cara.
      {
        route: '/vistorias',
        label: 'Vistorias',
        icon: ICON_INSPECTION,
        roles: ['OWNER', 'MANAGER'],
      },
      { route: '/multas', label: 'Multas', icon: ICON_FINES, roles: ['OWNER', 'MANAGER'] },
      {
        route: '/sinistros',
        label: 'Sinistros',
        icon: ICON_INCIDENTS,
        roles: ['OWNER', 'MANAGER'],
      },
      {
        route: '/financiamentos',
        label: 'Financiamentos',
        icon: ICON_FINANCING,
        roles: ['OWNER', 'MANAGER'],
      },
      { route: '/seguros', label: 'Seguros', icon: ICON_INSURANCE, roles: ['OWNER', 'MANAGER'] },
    ],
  },
  {
    route: '/motoristas',
    label: 'Motoristas',
    icon: ICON_DRIVERS,
    roles: ['OWNER', 'MANAGER'],
    tourKey: TOUR_ANCHORS.drivers,
  },
  {
    /*
     * FIX-0607 — estava `roles: ['OWNER']` enquanto a rota rodava
     * `roleGuard(['OWNER', 'MANAGER'])` (`app.routes.ts`, rota `relatorios`).
     * O gerente TINHA a permissão e não via o item: chegava só digitando a URL.
     * Não dava erro nenhum, e por isso ninguém reportou — a tela simplesmente
     * não existia para ele.
     *
     * A paridade que este item quebrava agora é teste:
     * `sidebar-guard-parity.spec.ts` varre NAV_ITEMS contra os guards reais e
     * falha nos DOIS sentidos.
     */
    route: '/relatorios',
    label: 'Relatórios',
    icon: ICON_REPORTS,
    roles: ['OWNER', 'MANAGER'],
    tourKey: TOUR_ANCHORS.reports,
  },
  // Transversal (CNH, CRLV, seguro, financiamento) — fica fora do grupo "Frota".
  // FEAT-0108: deixou de ser sem restrição. `/v1/alerts` não está na lista de
  // permitidos do FIX-0360, então para um DRIVER a tela é 403 — os vencimentos
  // aqui são os da FROTA, não os dele.
  {
    route: '/alertas',
    label: 'Alertas',
    icon: ICON_ALERTS,
    roles: ['OWNER', 'MANAGER'],
    tourKey: TOUR_ANCHORS.alerts,
  },
  { route: '/roadmap', label: 'Roadmap', icon: ICON_ROADMAP, tourKey: TOUR_ANCHORS.roadmap },
  { route: '/billing', label: 'Assinatura', icon: ICON_BILLING, roles: ['OWNER'] },
  {
    label: 'Configurações',
    icon: ICON_SETTINGS,
    tourKey: TOUR_ANCHORS.settingsGroup,
    children: [
      // FEAT-0228 — esta área VOLTOU para o MANAGER: a regra do produto agora é
      // uma só, **gerente é dono MENOS billing**. Decisão do dono.
      //
      // O texto anterior ("a área toda é OWNER-only", porque a regra de multa
      // por atraso perdeu a tela e sobrava só leitura) era verdade e deixou de
      // ser. Substituído, não complementado: um comentário que afirma o
      // contrário do código abaixo dele é pior que comentário nenhum.
      //
      // O que continua OWNER-only é `/billing` (Assinatura), acima — plano e
      // cobrança, só ele. Não reintroduza `roles: ['OWNER']` nestes filhos
      // achando que restaura o fix antigo: `sidebar-guard-parity.spec.ts`
      // reprova, e os `roleGuard` de `app.routes.ts` mudaram junto.
      {
        route: '/configuracoes',
        label: 'Empresa',
        icon: ICON_COMPANY,
        roles: ['OWNER', 'MANAGER'],
        exactMatch: true,
      },
      {
        route: '/configuracoes/integracoes',
        label: 'Integrações',
        icon: ICON_INTEGRATIONS,
        roles: ['OWNER', 'MANAGER'],
        tourKey: TOUR_ANCHORS.integrations,
      },
      {
        route: '/configuracoes/contratos',
        label: 'Contratos',
        icon: ICON_COMPANY,
        roles: ['OWNER', 'MANAGER'],
        tourKey: TOUR_ANCHORS.contractTemplate,
      },
      /*
       * FIX-0553 — Convites nao tinha ponto de entrada NENHUM: a rota
       * (`configuracoes/convites`), a tela e o verbete do `role.guard` existiam, e
       * so se chegava digitando o endereco. O atalho tinha sido removido de
       * proposito enquanto o fluxo de convite era refeito (ver o cabecalho de
       * `company-settings.ts`) — o fluxo foi refeito, e a tela acabou de ganhar os
       * quatro campos que fazem o convite de GERENTE funcionar. A razao da remocao
       * venceu; o atalho volta.
       *
       * FEAT-0228 atualizou o papel: `roles: ['OWNER', 'MANAGER']` casa com o
       * `roleGuard(['OWNER', 'MANAGER'])` da rota e com o do pai
       * `/configuracoes` — nem mais, nem menos, entao o item nunca oferece
       * porta que o guard bata na cara. Quem prova a igualdade agora e
       * `sidebar-guard-parity.spec.ts`, nao este paragrafo.
       *
       * Sem `tourKey` de proposito: as irmas tem porque estao no tour guiado, e
       * acrescentar um passo exigiria mexer em `TOUR_ANCHORS` e no servico do tour,
       * que e outro no. A ausencia nao afeta a navegacao.
       */
      {
        route: '/configuracoes/convites',
        label: 'Convites',
        icon: ICON_INVITES,
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },
  { route: '/suporte', label: 'Suporte', icon: ICON_SUPPORT, pinBottom: true },
  { route: '/perfil', label: 'Perfil', icon: ICON_PROFILE, pinBottom: true },
];

@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
  animations: [
    trigger('sidebarWidth', [
      state('expanded', style({ width: '260px' })),
      state('collapsed', style({ width: '72px' })),
      transition('expanded <=> collapsed', animate('300ms cubic-bezier(0.4, 0, 0.2, 1)')),
    ]),
    trigger('fadeLabel', [
      transition(':enter', [
        style({ opacity: 0, width: 0, overflow: 'hidden' }),
        animate('200ms 100ms ease-out', style({ opacity: 1, width: '*' })),
      ]),
      transition(':leave', [
        style({ opacity: 1, overflow: 'hidden' }),
        animate('150ms ease-in', style({ opacity: 0, width: 0 })),
      ]),
    ]),
    trigger('dropdownSlide', [
      transition(':enter', [
        style({ height: 0, opacity: 0, overflow: 'hidden' }),
        animate('250ms cubic-bezier(0.4, 0, 0.2, 1)', style({ height: '*', opacity: 1 })),
      ]),
      transition(':leave', [
        style({ overflow: 'hidden' }),
        animate('200ms cubic-bezier(0.4, 0, 0.2, 1)', style({ height: 0, opacity: 0 })),
      ]),
    ]),
    trigger('overlayFade', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('200ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [animate('200ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('mobileSlide', [
      transition(':enter', [
        style({ transform: 'translateX(-100%)' }),
        animate('300ms cubic-bezier(0.4, 0, 0.2, 1)', style({ transform: 'translateX(0)' })),
      ]),
      transition(':leave', [
        animate('250ms cubic-bezier(0.4, 0, 0.2, 1)', style({ transform: 'translateX(-100%)' })),
      ]),
    ]),
    trigger('rotateChevron', [
      state('expanded', style({ transform: 'rotate(0deg)' })),
      state('collapsed', style({ transform: 'rotate(180deg)' })),
      transition('expanded <=> collapsed', animate('300ms cubic-bezier(0.4, 0, 0.2, 1)')),
    ]),
    trigger('rotateTenantChevron', [
      state('closed', style({ transform: 'rotate(0deg)' })),
      state('open', style({ transform: 'rotate(180deg)' })),
      transition('closed <=> open', animate('250ms cubic-bezier(0.4, 0, 0.2, 1)')),
    ]),
    trigger('rotateGroupChevron', [
      state('collapsed', style({ transform: 'rotate(0deg)' })),
      state('expanded', style({ transform: 'rotate(90deg)' })),
      transition('collapsed <=> expanded', animate('200ms cubic-bezier(0.4, 0, 0.2, 1)')),
    ]),
  ],
})
export class Sidebar {
  protected readonly layout = inject(LayoutStore);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  private readonly userState = signal<ReadonlyMap<string, 'open' | 'closed'>>(new Map());

  /**
   * Papel que DECIDE o que o menu oferece.
   *
   * FIX-0456 — vem do TOKEN, a MESMA fonte que o `roleGuard` consulta
   * (`services/role.guard.ts`). Antes vinha de `layout.selectedTenant().role`,
   * que é o espelho em `sessionStorage`: duas fontes para o mesmo fato,
   * concordando por sorte. Quando divergissem, o menu ofereceria o que o guard
   * recusa — e o `roleGuard` REDIRECIONA para `/dashboard` em vez de mostrar
   * um erro, então a pessoa tocaria, a tela trocaria e nada explicaria por quê.
   * Num app multi-empresa a divergência é rotina: trocar de empresa deixa o
   * espelho com o papel da ANTERIOR até o commit.
   *
   * O sinal do tenant é lido aqui como GATILHO de reexecução, não como valor:
   * a troca grava o tenant DEPOIS de o token novo chegar
   * (`layout.store.ts` `selectTenant` → `commitTenant`), então ele é o
   * momento certo para reavaliar — e o valor já é o do token novo.
   */
  private readonly menuRole = computed<string | null>(() => {
    this.layout.selectedTenant();
    return this.session.getCompanyRoleFromToken();
  });

  private readonly allowedItems = computed<NavItem[]>(() => {
    const role = this.menuRole();
    const isAdmin = this.session.isPlatformAdmin();
    const passes = (item: NavItem) => {
      if (item.requiresPlatformAdmin && !isAdmin) return false;
      if (item.roles && !(role && item.roles.includes(role))) return false;
      return true;
    };
    return NAV_ITEMS.reduce<NavItem[]>((acc, item) => {
      if (!passes(item)) return acc;
      if (item.children) {
        const visibleChildren = item.children.filter(passes);
        if (visibleChildren.length === 0) return acc;
        acc.push({ ...item, children: visibleChildren });
      } else {
        acc.push(item);
      }
      return acc;
    }, []);
  });

  protected readonly navItems = computed(() =>
    this.allowedItems().filter((item) => !item.pinBottom),
  );

  protected readonly bottomNavItems = computed(() =>
    this.allowedItems().filter((item) => item.pinBottom),
  );

  protected isExpanded(item: NavItem): boolean {
    const state = this.userState().get(item.label);
    if (state) return state === 'open';
    const url = this.currentUrl();
    return item.children?.some((c) => !!c.route && url.startsWith(c.route)) ?? false;
  }

  protected safeIcon(icon: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(icon);
  }

  protected onMobileOverlayClick(): void {
    this.layout.closeMobile();
  }

  protected onNavClick(): void {
    if (this.layout.isMobile()) {
      this.layout.closeMobile();
    }
  }

  protected onParentClick(item: NavItem): void {
    if (this.layout.isCollapsed() && !this.layout.isMobile()) {
      this.layout.isCollapsed.set(false);
    }
    const currentlyOpen = this.isExpanded(item);
    this.userState.update((prev) => {
      const next = new Map(prev);
      next.set(item.label, currentlyOpen ? 'closed' : 'open');
      return next;
    });
  }

  /** Papel traduzido para exibição; string vazia quando não há papel. */
  protected roleLabel(role: string | undefined): string {
    if (!role) return '';
    return companyRoleLabel(role);
  }

  /** Tooltip do switcher quando a sidebar está colapsada no desktop: "Empresa · Papel". */
  protected tenantTitle(tenant: Tenant): string {
    const role = this.roleLabel(tenant.role);
    return role ? `${tenant.name} · ${role}` : tenant.name;
  }

  protected onSelectTenant(tenant: Tenant): void {
    this.layout.selectTenant(tenant);
  }

  protected trackByKey(_index: number, item: NavItem): string {
    return item.route ?? item.label;
  }

  protected trackByTenantId(_index: number, item: Tenant): string {
    return item.id;
  }
}
