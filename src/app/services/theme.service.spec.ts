import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY, ThemeService } from './theme.service';

/**
 * `ThemeService` — Claro, Escuro e Automático.
 *
 * O que fica preso aqui: o padrão é o Automático; a escolha sobrevive à recarga (fica no
 * `localStorage` deste aparelho); a classe `dark` e o `color-scheme` do `<html>` seguem o
 * tema resolvido; no Automático a troca do sistema repinta sem recarga; e storage
 * indisponível (modo privado, bloqueado) não quebra nada.
 */

type Listener = (event: MediaQueryListEvent) => void;

/** `matchMedia` falso: o JSDOM não tem um, e o teste precisa ditar o tema do sistema. */
function fakeSystem(dark: boolean) {
  const listeners = new Set<Listener>();
  const mql = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => mql) });
  return {
    flip(next: boolean) {
      mql.matches = next;
      listeners.forEach((l) => l({ matches: next } as MediaQueryListEvent));
    },
  };
}

function create(): ThemeService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  const service = TestBed.inject(ThemeService);
  // O tema do usuário só vale dentro do app autenticado (AppShell).
  service.enterApp();
  return service;
}

const html = () => document.documentElement;

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    html().classList.remove('dark');
    html().style.colorScheme = '';
    history.replaceState(null, '', '/dashboard');
  });

  afterEach(() => {
    history.replaceState(null, '', '/');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  describe('padrão Automático', () => {
    it('sem nada guardado, a preferência é "system"', () => {
      fakeSystem(false);
      expect(create().preference()).toBe('system');
    });

    it('no Automático com o sistema claro, o <html> fica claro', () => {
      fakeSystem(false);
      const theme = create();
      expect(theme.resolved()).toBe('light');
      expect(html().classList.contains('dark')).toBe(false);
      expect(html().style.colorScheme).toBe('light');
    });

    it('no Automático com o sistema escuro, o <html> ganha a classe dark', () => {
      fakeSystem(true);
      const theme = create();
      expect(theme.resolved()).toBe('dark');
      expect(html().classList.contains('dark')).toBe(true);
      expect(html().style.colorScheme).toBe('dark');
    });

    it('no Automático, a troca do sistema repinta sem recarregar', () => {
      const system = fakeSystem(false);
      const theme = create();
      system.flip(true);
      expect(theme.resolved()).toBe('dark');
      expect(html().classList.contains('dark')).toBe(true);
      system.flip(false);
      expect(html().classList.contains('dark')).toBe(false);
    });

    it('valor inválido guardado conta como Automático', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
      fakeSystem(true);
      expect(create().preference()).toBe('system');
    });

    it('sem matchMedia (navegador antigo) o Automático cai no claro', () => {
      const theme = create();
      expect(theme.preference()).toBe('system');
      expect(theme.resolved()).toBe('light');
    });
  });

  describe('escolha manual', () => {
    it('Escuro vence o sistema claro e é aplicado no <html>', () => {
      fakeSystem(false);
      const theme = create();
      theme.setPreference('dark');
      expect(html().classList.contains('dark')).toBe(true);
      expect(html().style.colorScheme).toBe('dark');
    });

    it('Claro vence o sistema escuro', () => {
      fakeSystem(true);
      const theme = create();
      theme.setPreference('light');
      expect(theme.resolved()).toBe('light');
      expect(html().classList.contains('dark')).toBe(false);
    });

    it('com escolha manual, a troca do sistema NÃO muda o tema', () => {
      const system = fakeSystem(false);
      const theme = create();
      theme.setPreference('light');
      system.flip(true);
      expect(html().classList.contains('dark')).toBe(false);
    });
  });

  describe('persistência no aparelho', () => {
    it('grava a escolha e uma nova instância (recarga) a lê de volta', () => {
      fakeSystem(false);
      create().setPreference('dark');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
      html().classList.remove('dark');
      const reloaded = create();
      expect(reloaded.preference()).toBe('dark');
      expect(html().classList.contains('dark')).toBe(true);
    });

    it('voltar ao Automático apaga a chave (nada guardado = padrão)', () => {
      fakeSystem(false);
      const theme = create();
      theme.setPreference('light');
      theme.setPreference('system');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });
  });

  describe('localStorage indisponível', () => {
    it('leitura que lança: segue no Automático, sem erro', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
      fakeSystem(true);
      const theme = create();
      expect(theme.preference()).toBe('system');
      expect(html().classList.contains('dark')).toBe(true);
    });

    it('escrita que lança: a troca vale na sessão e não quebra a tela', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
      fakeSystem(false);
      const theme = create();
      expect(() => theme.setPreference('dark')).not.toThrow();
      expect(theme.preference()).toBe('dark');
      expect(html().classList.contains('dark')).toBe(true);
    });
  });

  describe('páginas públicas são sempre claras', () => {
    it('preferência "dark" fora do shell fica clara e a preferência é mantida', () => {
      fakeSystem(true);
      localStorage.setItem('mch:theme', 'dark');
      history.replaceState(null, '', '/');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const service = TestBed.inject(ThemeService);
      expect(service.resolved()).toBe('light');
      expect(html().classList.contains('dark')).toBe(false);
      expect(service.preference()).toBe('dark');
      expect(localStorage.getItem('mch:theme')).toBe('dark');
    });

    it('entrar no shell aplica a escolha; sair volta ao claro sem apagá-la', () => {
      fakeSystem(false);
      localStorage.setItem('mch:theme', 'dark');
      history.replaceState(null, '', '/');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const service = TestBed.inject(ThemeService);
      service.enterApp();
      expect(html().classList.contains('dark')).toBe(true);
      service.leaveApp();
      expect(html().classList.contains('dark')).toBe(false);
      expect(html().style.colorScheme).toBe('light');
      expect(localStorage.getItem('mch:theme')).toBe('dark');
      service.enterApp();
      expect(html().classList.contains('dark')).toBe(true);
    });

    it('rota do app no boot começa escura (sem piscar) com preferência "dark"', () => {
      fakeSystem(false);
      localStorage.setItem('mch:theme', 'dark');
      history.replaceState(null, '', '/dashboard');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      TestBed.inject(ThemeService);
      expect(html().classList.contains('dark')).toBe(true);
    });
  });
});
