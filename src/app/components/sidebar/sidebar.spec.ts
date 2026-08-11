import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Sidebar } from './sidebar';

describe('Sidebar', () => {
  let component: Sidebar;
  let fixture: ComponentFixture<Sidebar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [provideRouter([]), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(Sidebar);
    component = fixture.componentInstance;
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
});
