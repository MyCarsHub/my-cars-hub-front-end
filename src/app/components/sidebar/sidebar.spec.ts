import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { LayoutStore, Tenant } from '../core/layouts/layout.store';
import { NavItem, Sidebar } from './sidebar';
import { DRIVER_NAV_KEYS, DRIVER_NAV_ROUTES, DriverNavRoutes } from './driver-nav';

const tenant = (role: string, name = 'MyCarsHub'): Tenant => ({
  id: `t-${role || 'none'}`,
  name,
  role,
  initial: name.charAt(0),
});

/**
 * FIX-0456 — o menu passou a decidir pelo papel do TOKEN, a mesma fonte do
 * `roleGuard`. Um tenant no espelho não abre mais item nenhum, então todo
 * caso que precisa de um papel precisa de uma SESSÃO, não só de um tenant.
 * Ver `sidebar-role-source.spec.ts` para o porquê da troca de fonte.
 */
function signInAs(role: string): void {
  const payload = { role, exp: Math.floor(Date.now() / 1000) + 3600 };
  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  sessionStorage.setItem('token', `header.${b64}.signature`);
}

/**
 * Rotas de mentira: o realce de grupo depende de NAVEGAÇÃO de verdade
 * (`router.url` + `routerLinkActive`), então `provideRouter([])` não serve —
 * sem rota registrada o `navigateByUrl` não chega a lugar nenhum e o teste
 * passaria por ausência de sinal. Só precisam existir os caminhos que a
 * sidebar aponta.
 */
@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class StubPage {}

const TEST_ROUTES: Routes = [
  { path: 'dashboard', component: StubPage },
  { path: 'veiculos', component: StubPage },
  { path: 'manutencoes', component: StubPage },
  // FEAT-0142 — sem a rota registrada o `navigateByUrl('/vistorias')` não chega
  // a lugar nenhum, o grupo não expande e o caso passaria por AUSÊNCIA de sinal.
  { path: 'vistorias', component: StubPage },
  { path: 'configuracoes', component: StubPage },
  { path: 'configuracoes/integracoes', component: StubPage },
  // FIX-0553 — mesma razão do `vistorias` acima: sem a rota registrada o caso
  // passaria por AUSÊNCIA de sinal em vez de por presença do item.
  { path: 'configuracoes/convites', component: StubPage },
  { path: 'configuracoes/membros', component: StubPage },
];

describe('Sidebar', () => {
  let component: Sidebar;
  let fixture: ComponentFixture<Sidebar>;
  let layout: LayoutStore;

  /**
   * O papel do menu vem do TOKEN desde o FIX-0363: setar so o tenant deixa o
   * papel vazio e esconde todo item com `roles`. Helper unico para os dois
   * lugares que precisam de um papel, para nao divergirem de novo.
   */
  function signInAs(role: string): void {
    const payload = { role, exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    sessionStorage.setItem('token', `header.${b64}.signature`);
  }

  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [provideRouter(TEST_ROUTES), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(Sidebar);
    component = fixture.componentInstance;
    layout = TestBed.inject(LayoutStore);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * Contrato com o tour guiado. As âncoras são `data-tour`, e não `aria-label`,
   * justamente para sobreviverem a mudanças de copy — mas isso só vale se
   * alguém verificar que elas continuam sendo emitidas.
   *
   * FEAT-0108 — este teste rodava SEM papel selecionado, quando "dashboard" e
   * "alerts" eram itens abertos a todos. Não são mais: ambos viraram
   * OWNER/MANAGER porque o FIX-0360 os fechou para o motorista. O tour é do
   * dono da frota, então a âncora passa a ser verificada com um OWNER —
   * a intenção do teste (as âncoras continuam no DOM) é a mesma.
   */
  it('emite as âncoras data-tour que o tour guiado procura', () => {
    signInAs('OWNER');
    layout.tenants.set([tenant('OWNER')]);
    layout.selectedTenant.set(tenant('OWNER'));
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-tour="dashboard"]')).not.toBeNull();
    expect(host.querySelector('[data-tour="alerts"]')).not.toBeNull();
    expect(host.querySelector('[data-tour="roadmap"]')).not.toBeNull();
  });

  /**
   * A sidebar fixa é da altura do shell, que termina acima do banner de cookies: em
   * `h-dvh` o rodapé dela (Suporte, Perfil, Recolher) ficava por baixo do banner.
   */
  it('desktop e drawer terminam acima do banner de cookies', () => {
    signInAs('DRIVER');
    const banner = 'h-[calc(100dvh-var(--consent-banner-h,0px))]';
    layout.setMobile(false);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('aside')!.classList.contains(banner)).toBe(true);
    layout.setMobile(true);
    layout.openMobile();
    fixture.detectChanges();
    expect(host.querySelector('aside')!.classList.contains(banner)).toBe(true);
    expect(host.querySelector('aside')!.classList.contains('h-dvh')).toBe(false);
  });

  /**
   * O menu do MOTORISTA — o do protótipo do dono (`driver-nav.ts`), não mais um recorte de
   * `NAV_ITEMS`. Continua valendo o que o FEAT-0108 fixou: nada de tela que é 403 para ele
   * (Dashboard da frota, Alertas, Multas da frota) e a área do aluguel à vista.
   */
  describe('menu do DRIVER (protótipo do dono)', () => {
    function signInDriver(): HTMLElement {
      signInAs('DRIVER');
      layout.tenants.set([tenant('DRIVER')]);
      layout.selectedTenant.set(tenant('DRIVER'));
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    function topLabels(): string[] {
      return (component as unknown as { navItems: () => NavItem[] })
        .navItems()
        .map((item) => item.label);
    }

    function bottomLabels(): string[] {
      return (component as unknown as { bottomNavItems: () => NavItem[] })
        .bottomNavItems()
        .map((item) => item.label);
    }

    /** Rótulos renderizados no rodapé fixo (o bloco acima de "Recolher"), na ordem do DOM. */
    function footerLinks(host: HTMLElement): string[] {
      return Array.from(host.querySelectorAll('[data-nav-bottom] a.nav-link')).map(
        (a) => a.getAttribute('aria-label') ?? '',
      );
    }

    function links(host: HTMLElement): Map<string, string | null> {
      return new Map(
        Array.from(host.querySelectorAll('a.nav-link')).map((a) => [
          a.getAttribute('aria-label') ?? '',
          a.getAttribute('href'),
        ]),
      );
    }

    it('na ordem do protótipo, só com o que tem rota para ele', () => {
      signInDriver();
      // Multas e Alertas são da frota; Configurações espera o endpoint de preferências.
      expect(topLabels()).toEqual(['Dashboard', 'Financeiro', 'Veículo', 'Roadmap']);
      expect(bottomLabels()).toEqual(['Suporte', 'Perfil']);
    });

    it('Financeiro leva a Ganhos, Custos e Metas dentro de /meu-painel', () => {
      const host = signInDriver();
      const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="Financeiro"]');
      if (toggle && !links(host).has('Ganhos')) {
        toggle.click();
        fixture.detectChanges();
      }
      const map = links(host);
      expect(map.get('Ganhos')).toBe('/meu-painel/ganhos');
      expect(map.get('Custos')).toBe('/meu-painel/custos');
      expect(map.get('Metas')).toBe('/meu-painel/metas');
    });

    it('Dashboard é o painel dele (/meu-painel), não o da frota', () => {
      const host = signInDriver();
      expect(links(host).get('Dashboard')).toBe('/meu-painel');
      expect(host.querySelector('a.nav-link[aria-label="Dashboard"]')?.hasAttribute('data-tour')).toBe(
        false,
      );
    });

    it('Veículo agrupa Meu aluguel e Vistorias, sem Multas', () => {
      const host = signInDriver();
      host.querySelector<HTMLButtonElement>('button[aria-label="Veículo"]')!.click();
      fixture.detectChanges();
      const map = links(host);
      expect(map.get('Meu aluguel')).toBe('/alugueis');
      expect(map.get('Vistorias')).toBe('/vistorias');
      expect(map.has('Multas')).toBe(false);
    });

    it('não oferece nenhuma área de frota nem tela 403', () => {
      const host = signInDriver();
      host.querySelector<HTMLButtonElement>('button[aria-label="Veículo"]')!.click();
      fixture.detectChanges();
      const labels = [...links(host).keys()].join(' | ');
      for (const area of ['Veículos', 'Motoristas', 'Relatórios', 'Assinatura', 'Multas', 'Alertas']) {
        expect(labels).not.toContain(area);
      }
      expect(links(host).get('Dashboard')).not.toBe('/dashboard');
    });

    /*
     * Pedido do dono em produção: "suporte e perfil devem ficar em baixo, igual de
     * dono/gerenciador". Antes ficavam no MEIO da lista rolável, depois de um <hr>.
     */
    it('Suporte e Perfil ficam no rodapé fixo, fora da lista rolável (desktop)', () => {
      const host = signInDriver();
      expect(footerLinks(host)).toEqual(['Suporte', 'Perfil']);
      const nav = host.querySelector('nav')!;
      expect(nav.querySelector('a[aria-label="Suporte"]')).toBeNull();
      expect(nav.querySelector('a[aria-label="Perfil"]')).toBeNull();
      expect(nav.querySelector('hr')).toBeNull();
      // O rodapé vem DEPOIS da lista e ANTES do "Recolher", como no menu do dono.
      const footer = host.querySelector('[data-nav-bottom]')!;
      const collapse = host.querySelector('button[aria-label="Recolher sidebar"]')!;
      expect(nav.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(footer.compareDocumentPosition(collapse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('no drawer do celular, Suporte e Perfil também ficam no rodapé', () => {
      const host = signInDriver();
      layout.setMobile(true);
      layout.openMobile();
      fixture.detectChanges();
      expect(footerLinks(host)).toEqual(['Suporte', 'Perfil']);
      expect(host.querySelector('nav a[aria-label="Suporte"]')).toBeNull();
      expect(links(host).get('Suporte')).toBe('/suporte');
      expect(links(host).get('Perfil')).toBe('/perfil');
    });

    it('todo item do motorista tem alvo de 44px, inclusive os do rodapé', () => {
      const host = signInDriver();
      const all = Array.from(host.querySelectorAll('.nav-link'));
      expect(all.length).toBeGreaterThan(footerLinks(host).length);
      for (const el of all) {
        expect(el.classList.contains('min-h-11'), el.getAttribute('aria-label') ?? '').toBe(true);
      }
    });

    it('no celular o motorista não tem o ☰ flutuante (o dele mora na barra de topo)', () => {
      const host = signInDriver();
      layout.setMobile(true);
      fixture.detectChanges();
      expect(host.querySelector('button[aria-label="Abrir menu"]')).toBeNull();
      expect(layout.mobileTopBar()).toBe(true);
    });

    it('no drawer, o Fechar do motorista tem 44px e cabe no cabeçalho do logo', () => {
      const host = signInDriver();
      layout.setMobile(true);
      layout.openMobile();
      fixture.detectChanges();
      const close = host.querySelector<HTMLButtonElement>('[data-drawer-close]')!;
      for (const cls of ['w-11', 'h-11', 'right-2']) {
        expect(close.classList.contains(cls), cls).toBe(true);
      }
      // 10px + 44px + 10px = os 64px (h-16) do cabeçalho do logo.
      expect(close.style.top).toBe('0.625rem');
      // Uma só regra de `top` e de tamanho — duas decidiriam pela ordem do CSS gerado.
      for (const cls of ['top-4', 'right-3', 'w-8', 'h-8']) {
        expect(close.classList.contains(cls), cls).toBe(false);
      }
    });

    it('no drawer, o Fechar do dono fica como era (32px em top-4)', () => {
      signInAs('OWNER');
      layout.tenants.set([tenant('OWNER')]);
      layout.selectedTenant.set(tenant('OWNER'));
      layout.setMobile(true);
      layout.openMobile();
      fixture.detectChanges();
      const close = (fixture.nativeElement as HTMLElement).querySelector('[data-drawer-close]')!;
      for (const cls of ['top-4', 'right-3', 'w-8', 'h-8']) {
        expect(close.classList.contains(cls), cls).toBe(true);
      }
      for (const cls of ['w-11', 'h-11', 'right-2']) {
        expect(close.classList.contains(cls), cls).toBe(false);
      }
      expect((close as HTMLElement).style.top).toBe('');
    });

    it('no celular o dono também não tem ☰ flutuante: o dele mora na barra de topo no fluxo', () => {
      signInAs('OWNER');
      layout.tenants.set([tenant('OWNER')]);
      layout.selectedTenant.set(tenant('OWNER'));
      layout.setMobile(true);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('button[aria-label="Abrir menu"]')).toBeNull();
      expect(host.querySelector('button.fixed')).toBeNull();
      expect(layout.mobileTopBar()).toBe(true);
    });

    it('não mexe no menu do dono nem no do gerente', () => {
      for (const role of ['OWNER', 'MANAGER']) {
        signInAs(role);
        layout.tenants.set([tenant(role)]);
        layout.selectedTenant.set(tenant(role));
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;
        expect(topLabels()).toContain('Frota');
        expect(topLabels()).not.toContain('Suporte');
        expect(topLabels()).not.toContain('Perfil');
        expect(links(host).get('Dashboard')).toBe('/dashboard');
        expect(host.querySelector('hr')).toBeNull();
        expect(host.querySelector('.nav-link.min-h-11')).toBeNull();
        // O rodapé do dono/gerente é o de sempre: Suporte e Perfil, no mesmo bloco.
        expect(bottomLabels()).toEqual(['Suporte', 'Perfil']);
        expect(footerLinks(host)).toEqual(['Suporte', 'Perfil']);
      }
    });
  });

  /**
   * O grupo com `defaultOpen` nasce aberto e fecha no toque — e o mapa de URLs vem do token,
   * que é o que a demo e as próximas rotas (Ganhos, Custos, Metas) trocam.
   */
  describe('menu do DRIVER com todas as rotas (DRIVER_NAV_ROUTES)', () => {
    it('Financeiro nasce aberto com Ganhos, Custos e Metas, e fecha no toque', async () => {
      TestBed.resetTestingModule();
      const routes = Object.fromEntries(
        DRIVER_NAV_KEYS.map((key) => [key, `/x/${key}`]),
      ) as DriverNavRoutes;
      await TestBed.configureTestingModule({
        imports: [Sidebar],
        providers: [
          provideRouter([]),
          provideNoopAnimations(),
          { provide: DRIVER_NAV_ROUTES, useValue: routes },
        ],
      }).compileComponents();
      signInAs('DRIVER');
      const f = TestBed.createComponent(Sidebar);
      f.detectChanges();
      const host = f.nativeElement as HTMLElement;

      const labels = (f.componentInstance as unknown as { navItems: () => NavItem[] })
        .navItems()
        .map((item) => item.label);
      expect(labels).toEqual([
        'Dashboard',
        'Financeiro',
        'Veículo',
        'Alertas',
        'Roadmap',
        'Configurações',
      ]);
      const bottom = (f.componentInstance as unknown as { bottomNavItems: () => NavItem[] })
        .bottomNavItems()
        .map((item) => item.label);
      expect(bottom).toEqual(['Suporte', 'Perfil']);

      const finance = host.querySelector<HTMLButtonElement>('button[aria-label="Financeiro"]')!;
      expect(finance.getAttribute('aria-expanded')).toBe('true');
      expect(host.querySelector('a[aria-label="Ganhos"]')?.getAttribute('href')).toBe('/x/ganhos');
      expect(host.querySelector('a[aria-label="Metas"]')).not.toBeNull();
      expect(host.querySelector<HTMLButtonElement>('button[aria-label="Veículo"]')!
        .getAttribute('aria-expanded')).toBe('false');

      finance.click();
      f.detectChanges();
      await f.whenStable();
      f.detectChanges();
      expect(finance.getAttribute('aria-expanded')).toBe('false');
      expect(host.querySelector('a[aria-label="Ganhos"]')).toBeNull();
    });
  });

  /**
   * O switcher é a única superfície que mostra o papel do usuário. O enum
   * permanece em inglês (`types/user-companies.ts`) — só o texto na tela é
   * traduzido, então o teste afirma as duas coisas: o rótulo aparece E o valor
   * cru do enum não vaza para o usuário.
   */
  describe('rótulo do papel no switcher de empresa', () => {
    const cases: ReadonlyArray<[string, string]> = [
      ['OWNER', 'Dono'],
      ['MANAGER', 'Gerenciador'],
      ['DRIVER', 'Motorista'],
    ];

    for (const [role, label] of cases) {
      it(`exibe nome da empresa e "${label}" para ${role}`, () => {
        layout.tenants.set([tenant(role)]);
        layout.selectedTenant.set(tenant(role));
        fixture.detectChanges();

        const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
        expect(text).toContain('MyCarsHub');
        expect(text).toContain(label);
        expect(text).not.toContain(role);
      });

      it(`traduz ${role} também na lista do dropdown`, () => {
        // O switcher so existe com mais de uma empresa: a atual + a que o teste inspeciona.
        layout.tenants.set([tenant('OWNER', 'Frota Atual'), tenant(role, 'Outra Frota')]);
        layout.selectedTenant.set(tenant('OWNER'));
        layout.isTenantOpen.set(true);
        fixture.detectChanges();

        const options = (fixture.nativeElement as HTMLElement).querySelectorAll('[role="option"]');
        expect(options[1]?.textContent ?? '').toContain(label);
      });
    }

    it('não renderiza linha de papel quando o tenant não tem papel', () => {
      layout.tenants.set([]);
      layout.selectedTenant.set(tenant('', 'Sem Empresa'));
      fixture.detectChanges();

      expect(component['roleLabel']('')).toBe('');
    });

    it('cai no valor bruto para um papel desconhecido do backend', () => {
      expect(component['roleLabel']('AUDITOR')).toBe('AUDITOR');
    });

    /**
     * O tour guiado é vizinho de porta deste switcher: as duas coisas moram no
     * mesmo template. Repetir a checagem das âncoras COM um papel selecionado
     * garante que o filtro por papel não derruba as âncoras junto.
     */
    it('mantém as âncoras data-tour com um papel selecionado', () => {
      signInAs('OWNER');
      layout.tenants.set([tenant('OWNER')]);
      layout.selectedTenant.set(tenant('OWNER'));
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;
      expect(host.querySelector('[data-tour="dashboard"]')).not.toBeNull();
      expect(host.querySelector('[data-tour="rentals"]')).not.toBeNull();
      expect(host.querySelector('[data-tour="drivers"]')).not.toBeNull();
      expect(host.querySelector('[data-tour="reports"]')).not.toBeNull();
    });
  });

    /**
     * Contrato de LAYOUT do item do dropdown, nao de estilo: a coluna de texto
     * precisa de `flex-1 min-w-0` para o nome comprido TRUNCAR em vez de
     * espremer a linha (o avatar e `shrink-0`, entao nao ha outra coisa para
     * ceder espaco). Sem `flex-1` a coluna dimensiona pelo conteudo, e foi esse
     * o defeito. O nome carrega `truncate`, que so funciona dentro de uma caixa
     * de largura limitada — as duas classes andam juntas.
     */
    it('a coluna de texto do item trunca em vez de espremer a linha', () => {
      const longo = 'Transportadora Silva, Filhos e Associados do Vale do Paraiba LTDA ME';
      layout.tenants.set([tenant('OWNER', 'Frota Atual'), tenant('MANAGER', longo)]);
      layout.selectedTenant.set(tenant('OWNER'));
      layout.isTenantOpen.set(true);
      fixture.detectChanges();

      const option = (fixture.nativeElement as HTMLElement).querySelectorAll('[role="option"]')[1];
      const column = option?.querySelector('span.min-w-0');
      expect(column).not.toBeNull();
      expect(column?.className).toContain('flex-1');

      const nome = column?.querySelector('span');
      expect(nome?.textContent).toContain(longo);
      expect(nome?.className).toContain('truncate');
    });

  /**
   * Realce e expansão automática de grupo. Este bloco cobre um buraco que era
   * maior do que parecia: até aqui NENHUM teste da sidebar exercitava
   * `isExpanded()` nem a URL corrente, ou seja, o grupo "Frota" e o grupo
   * "Configurações" podiam parar de abrir sozinhos sem nada ficar vermelho.
   *
   * Os testes afirmam pelo DOM (`aria-expanded` do botão do grupo e a classe
   * `active-link` do filho), não chamando o método protegido: o que quebra na
   * tela é o DOM, e afirmar pelo método deixaria passar uma regressão no
   * template.
   *
   * O caso NEGATIVO é o que dá valor ao bloco. Sem ele, um `isExpanded()` que
   * devolvesse `true` para tudo passaria em todos os casos positivos.
   */
  describe('expansão do grupo pela rota ativa', () => {
    let router: Router;

    beforeEach(() => {
      router = TestBed.inject(Router);
      signInAs('OWNER');
      layout.tenants.set([tenant('OWNER')]);
      layout.selectedTenant.set(tenant('OWNER'));
      fixture.detectChanges();
    });

    const goTo = async (url: string) => {
      await router.navigateByUrl(url);
      await fixture.whenStable();
      fixture.detectChanges();
    };

    const group = (label: string) =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`,
      );

    const childLink = (label: string) =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
        `a[aria-label="${label}"]`,
      );

    it('abre "Frota" ao navegar para a rota de um filho', async () => {
      await goTo('/veiculos');

      expect(group('Frota')?.getAttribute('aria-expanded')).toBe('true');
      expect(childLink('Veículos')).not.toBeNull();
    });

    it('abre "Configurações" ao navegar para a rota de um filho', async () => {
      await goTo('/configuracoes/integracoes');

      expect(group('Configurações')?.getAttribute('aria-expanded')).toBe('true');
      expect(childLink('Integrações')).not.toBeNull();
    });

    it('marca o filho correspondente como ativo', async () => {
      await goTo('/veiculos');

      expect(childLink('Veículos')?.className).toContain('active-link');
      expect(childLink('Manutenções')?.className).not.toContain('active-link');
    });

    /**
     * O negativo: o grupo IRMÃO continua fechado. É este caso que pega
     * "expandiu tudo" — um defeito que os positivos aprovariam sorrindo.
     */
    it('não abre o grupo irmão', async () => {
      await goTo('/veiculos');

      expect(group('Configurações')?.getAttribute('aria-expanded')).toBe('false');
      expect(childLink('Integrações')).toBeNull();

      await goTo('/configuracoes/integracoes');

      expect(group('Frota')?.getAttribute('aria-expanded')).toBe('false');
      expect(childLink('Veículos')).toBeNull();
    });

    it('não abre grupo nenhum numa rota que não pertence a grupo', async () => {
      await goTo('/dashboard');

      expect(group('Frota')?.getAttribute('aria-expanded')).toBe('false');
      expect(group('Configurações')?.getAttribute('aria-expanded')).toBe('false');
    });

    /**
     * FEAT-0142 — "Frota → Vistorias", pedido do dono.
     *
     * O caso NOMEIA o item, que é o que faltava: a suíte já provava o MECANISMO
     * de realce de grupo, mas nenhum caso dizia "Vistorias", então o item podia
     * sumir do `NAV_ITEMS` sem nada ficar vermelho.
     *
     * Afirma as duas metades do pedido: que o item EXISTE e que ele é FILHO de
     * Frota — não item de primeiro nível. As duas asserções são de PRESENÇA, e
     * é de propósito: uma asserção de ausência aqui passaria contra um menu
     * vazio, que é o modo de falhar que este projeto já pagou quatro vezes.
     */
    it('"Vistorias" é filha de Frota, e não item de primeiro nível', async () => {
      await goTo('/vistorias');

      // Filha: o grupo pai abriu sozinho e o link do filho está no DOM.
      expect(group('Frota')?.getAttribute('aria-expanded')).toBe('true');
      expect(childLink('Vistorias')).not.toBeNull();
      expect(childLink('Vistorias')?.getAttribute('href')).toBe('/vistorias');

      // E não de primeiro nível: nenhum item raiz do menu aponta para lá.
      const topLevel = (component as unknown as { navItems: () => { route?: string }[] })
        .navItems()
        .map((item) => item.route);
      expect(topLevel).not.toContain('/vistorias');
    });

    /**
     * FEAT-0267 — este caso ERA sobre "Configurações → Convites" (FIX-0553), e existia para
     * que aquele item nao pudesse sumir do menu em silencio, porque foi assim que ele sumiu
     * a primeira vez. O item SAIU de proposito: Convites e Membros eram duas telas para a
     * mesma pergunta, e dois itens apontando para a mesma lista fariam a pessoa desconfiar
     * da tela.
     *
     * A GARANTIA NAO FOI EMBORA, MUDOU DE LUGAR: o que nao pode sumir em silencio agora e o
     * PONTO DE ENTRADA do convite, que passou a ser o botao "Convidar pessoa" dentro de
     * Membros — e e `members.spec.ts` quem o nomeia, apontando para a mesma rota.
     *
     * Aqui o caso vira o equivalente para Membros, na mesma forma: asserção de PRESENÇA,
     * porque uma de ausência passaria contra um menu vazio.
     */
    it('"Membros" é filha de Configurações, e Convites não tem mais item próprio', async () => {
      await goTo('/configuracoes/membros');

      expect(group('Configurações')?.getAttribute('aria-expanded')).toBe('true');
      expect(childLink('Membros')).not.toBeNull();
      expect(childLink('Membros')?.getAttribute('href')).toBe('/configuracoes/membros');

      // Convites deixou de ter item: a tela segue existindo, alcancada de dentro de Membros.
      expect(childLink('Convites')).toBeNull();

      const topLevel = (component as unknown as { navItems: () => { route?: string }[] })
        .navItems()
        .map((item) => item.route);
      expect(topLevel).not.toContain('/configuracoes/membros');
    });

    /**
     * A ARMADILHA DO PREFIXO. `isExpanded()` casa por `url.startsWith(rota do
     * filho)`, sem fronteira de segmento: `/veiculos` casaria com
     * `/veiculos-usados` se tal rota existisse. Hoje ela NÃO existe — nenhum
     * filho de grupo é prefixo de uma rota de OUTRO grupo (conferido em
     * `app.routes.ts`), então não há defeito para expor, só uma mina para o
     * futuro: uma rota nova que comece com o caminho de um filho abre o grupo
     * dele por engano.
     *
     * O único par prefixo-de-outro que existe hoje é INTERNO ao grupo
     * Configurações (`/configuracoes` ⊂ `/configuracoes/integracoes`). Para a
     * expansão ele é inócuo — os dois abrem o mesmo grupo — mas para o realce
     * seria um falso positivo, e é exatamente por isso que "Empresa" carrega
     * `exactMatch`. Este teste guarda esse `exactMatch`: sem ele, "Empresa"
     * acenderia junto com "Integrações".
     */
    it('não acende "Empresa" numa sub-rota de /configuracoes', async () => {
      await goTo('/configuracoes/integracoes');

      expect(childLink('Integrações')?.className).toContain('active-link');
      expect(childLink('Empresa')?.className).not.toContain('active-link');
    });
  });
});
