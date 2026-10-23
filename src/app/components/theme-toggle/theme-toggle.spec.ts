import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from './theme-toggle';
import {
  THEME_STORAGE_KEY,
  THEME_TRANSITION_CLASS,
  THEME_TRANSITION_MS,
  ThemeService,
} from '../../services/theme.service';

/**
 * O botão de tema ao lado do sino: um toque troca claro ↔ escuro, a escolha fica no
 * aparelho, o rótulo diz o tema atual, e a transição de cores só roda sem
 * `prefers-reduced-motion`.
 */

/** `matchMedia` que responde por consulta: tema do sistema e redução de movimento. */
function fakeMedia(opts: { dark: boolean; reduce: boolean }) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query.includes('reduced-motion') ? opts.reduce : opts.dark,
      media: query,
      addEventListener: () => void 0,
      removeEventListener: () => void 0,
    })),
  });
}

function render() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [ThemeToggle] });
  const fixture = TestBed.createComponent(ThemeToggle);
  fixture.detectChanges();
  const button = () =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-theme-toggle]')!;
  return { fixture, button };
}

const html = () => document.documentElement;

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    html().classList.remove('dark', THEME_TRANSITION_CLASS);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('é um botão de 44px com rótulo que diz o tema atual', () => {
    fakeMedia({ dark: false, reduce: true });
    const { button } = render();
    expect(button().className).toContain('w-11');
    expect(button().className).toContain('h-11');
    expect(button().getAttribute('aria-label')).toBe('Tema claro ativo. Mudar para o tema escuro');
    expect(button().className).toContain('focus-visible:ring-2');
  });

  it('um toque troca claro → escuro → claro, e o rótulo acompanha', () => {
    fakeMedia({ dark: false, reduce: true });
    const { fixture, button } = render();
    button().click();
    fixture.detectChanges();
    expect(html().classList.contains('dark')).toBe(true);
    expect(button().getAttribute('data-theme')).toBe('dark');
    expect(button().getAttribute('aria-label')).toBe('Tema escuro ativo. Mudar para o tema claro');
    button().click();
    fixture.detectChanges();
    expect(html().classList.contains('dark')).toBe(false);
    expect(button().getAttribute('data-theme')).toBe('light');
  });

  it('no Automático com o sistema escuro, o toque vai para o CLARO (sempre muda o que se vê)', () => {
    fakeMedia({ dark: true, reduce: true });
    const { fixture, button } = render();
    expect(TestBed.inject(ThemeService).preference()).toBe('system');
    button().click();
    fixture.detectChanges();
    expect(html().classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('persiste a escolha no aparelho e a recarga a mantém', () => {
    fakeMedia({ dark: false, reduce: true });
    render().button().click();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    html().classList.remove('dark');
    const reloaded = render();
    expect(html().classList.contains('dark')).toBe(true);
    expect(reloaded.button().getAttribute('data-theme')).toBe('dark');
  });

  it('sem redução de movimento: liga a transição de cores e a desliga depois', () => {
    vi.useFakeTimers();
    fakeMedia({ dark: false, reduce: false });
    const { button } = render();
    button().click();
    expect(html().classList.contains(THEME_TRANSITION_CLASS)).toBe(true);
    vi.advanceTimersByTime(THEME_TRANSITION_MS + 1);
    expect(html().classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
  });

  it('com prefers-reduced-motion: troca o tema sem transição nenhuma', () => {
    fakeMedia({ dark: false, reduce: true });
    const { button } = render();
    button().click();
    expect(html().classList.contains('dark')).toBe(true);
    expect(html().classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
  });

  it('o carregamento não liga a transição (só a troca feita pela pessoa)', () => {
    fakeMedia({ dark: true, reduce: false });
    render();
    expect(html().classList.contains('dark')).toBe(true);
    expect(html().classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
  });
});
