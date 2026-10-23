import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from './services/theme.service';
import { PUBLIC_PATH_PREFIXES } from './services/theme-scope';

/**
 * `public/theme-init.js` — o tema ANTES da primeira pintura.
 *
 * Asset estático (a CSP não aceita script inline), então nenhum import o alcança: este spec
 * lê o arquivo REAL e o executa, mesma técnica de `gtag-init.spec.ts`. O que fica preso:
 * a mesma chave e a mesma regra de `ThemeService` (senão a tela pisca no tema errado entre
 * o primeiro quadro e o boot do Angular), e storage bloqueado não derruba o script.
 */
describe('public/theme-init.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'public/theme-init.js'), 'utf8');
  const run = () => new Function(source)();
  const html = () => document.documentElement;

  function system(dark: boolean | null) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: dark === null ? undefined : vi.fn(() => ({ matches: dark })),
    });
  }

  beforeEach(() => {
    localStorage.clear();
    html().classList.remove('dark');
    html().style.colorScheme = '';
    history.replaceState(null, '', '/dashboard');
  });

  afterEach(() => {
    history.replaceState(null, '', '/');
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('é carregado no <head> do index.html, antes do app', () => {
    const index = readFileSync(resolve(process.cwd(), 'src/index.html'), 'utf8');
    const head = index.slice(0, index.indexOf('</head>'));
    expect(head).toContain('<script src="/theme-init.js"></script>');
    expect(head.indexOf('/theme-init.js')).toBeLessThan(head.indexOf('stylesheet'));
  });

  it('usa a mesma chave de ThemeService', () => {
    expect(source).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it('sem escolha e sistema escuro: aplica dark (Automático é o padrão)', () => {
    system(true);
    run();
    expect(html().classList.contains('dark')).toBe(true);
    expect(html().style.colorScheme).toBe('dark');
  });

  it('sem escolha e sistema claro: fica claro', () => {
    system(false);
    run();
    expect(html().classList.contains('dark')).toBe(false);
    expect(html().style.colorScheme).toBe('light');
  });

  it('escolha "light" vence o sistema escuro', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    system(true);
    run();
    expect(html().classList.contains('dark')).toBe(false);
  });

  it('escolha "dark" vale mesmo sem matchMedia', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    system(null);
    run();
    expect(html().classList.contains('dark')).toBe(true);
  });

  it('localStorage que lança: não quebra e segue o sistema', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    system(true);
    expect(run).not.toThrow();
    expect(html().classList.contains('dark')).toBe(true);
  });

  describe('caminho público: sempre claro', () => {
    const publicPaths = ['/', ...PUBLIC_PATH_PREFIXES, '/blog/um-post', '/convite/cadastro'];

    for (const path of publicPaths) {
      it(`${path} com preferência "dark" e sistema escuro NÃO recebe dark`, () => {
        history.replaceState(null, '', path);
        localStorage.setItem(THEME_STORAGE_KEY, 'dark');
        system(true);
        run();
        expect(html().classList.contains('dark')).toBe(false);
        expect(html().style.colorScheme).toBe('light');
        // A preferência salva sobrevive à visita.
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
      });
    }

    it('caminho do app com preferência "dark" aplica dark', () => {
      history.replaceState(null, '', '/dashboard');
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      system(false);
      run();
      expect(html().classList.contains('dark')).toBe(true);
    });

    it('a lista do script é a mesma de theme-scope.ts', () => {
      for (const p of PUBLIC_PATH_PREFIXES) expect(source).toContain(`'${p}'`);
    });
  });
});
