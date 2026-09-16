import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { LayoutStore, Tenant } from '../core/layouts/layout.store';
import { Sidebar } from './sidebar';

const tenant = (role: string, name = 'MyCarsHub'): Tenant => ({
  id: `t-${role || 'none'}`,
  name,
  role,
  initial: name.charAt(0),
});

describe('Sidebar', () => {
  let component: Sidebar;
  let fixture: ComponentFixture<Sidebar>;
  let layout: LayoutStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [provideRouter([]), provideNoopAnimations()],
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
});
