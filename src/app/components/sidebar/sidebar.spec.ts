import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { LayoutStore, Tenant } from '../core/layouts/layout.store';
import { Sidebar } from './sidebar';

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
  { path: 'configuracoes', component: StubPage },
  { path: 'configuracoes/integracoes', component: StubPage },
];

describe('Sidebar', () => {
  let component: Sidebar;
  let fixture: ComponentFixture<Sidebar>;
  let layout: LayoutStore;

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
   * alguém verificar que elas continuam sendo emitidas. Sem papel selecionado,
   * os itens abertos a todos são os que devem estar no DOM.
   */
  it('emite as âncoras data-tour que o tour guiado procura', () => {
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-tour="dashboard"]')).not.toBeNull();
    expect(host.querySelector('[data-tour="alerts"]')).not.toBeNull();
    expect(host.querySelector('[data-tour="roadmap"]')).not.toBeNull();
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
        layout.tenants.set([tenant(role, 'Outra Frota')]);
        layout.selectedTenant.set(tenant('OWNER'));
        layout.isTenantOpen.set(true);
        fixture.detectChanges();

        const option = (fixture.nativeElement as HTMLElement).querySelector('[role="option"]');
        expect(option?.textContent ?? '').toContain(label);
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
      layout.tenants.set([tenant('MANAGER', longo)]);
      layout.selectedTenant.set(tenant('OWNER'));
      layout.isTenantOpen.set(true);
      fixture.detectChanges();

      const option = (fixture.nativeElement as HTMLElement).querySelector('[role="option"]');
      const column = option?.querySelector('div.min-w-0');
      expect(column).not.toBeNull();
      expect(column?.className).toContain('flex-1');

      const nome = column?.querySelector('p');
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
