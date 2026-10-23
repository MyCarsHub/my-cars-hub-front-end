import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';

/** O que a pessoa escolheu. `system` (Automático) segue o aparelho e é o padrão. */
export type ThemePreference = 'light' | 'dark' | 'system';
/** O que está pintado agora. */
export type ResolvedTheme = 'light' | 'dark';

/**
 * Chave da escolha no aparelho. `public/theme-init.js` lê a MESMA chave antes da primeira
 * pintura; mudar uma sem a outra faz a tela piscar no tema errado a cada carga.
 */
export const THEME_STORAGE_KEY = 'mch:theme';
export const THEME_DARK_CLASS = 'dark';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function isPreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * Tema do app: Claro, Escuro ou Automático.
 *
 * A escolha mora no APARELHO (`localStorage`), não na conta: o mesmo dono pode querer o
 * celular escuro e o computador do escritório claro. Toda leitura e escrita é protegida —
 * modo privado ou storage bloqueado lançam, e aí o app segue no Automático sem quebrar.
 *
 * O tema é a classe `dark` no `<html>` (mais `color-scheme`, que pinta barra de rolagem e
 * controles nativos). O script `theme-init.js` já a aplicou antes do Angular subir; este
 * serviço só a mantém em dia: troca manual e, no Automático, a troca do sistema.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly media: MediaQueryList | null = this.isBrowser
    ? (this.document.defaultView?.matchMedia?.(DARK_QUERY) ?? null)
    : null;

  private readonly _preference = signal<ThemePreference>(this.read());
  private readonly systemDark = signal<boolean>(this.media?.matches ?? false);

  readonly preference = this._preference.asReadonly();
  readonly resolved = computed<ResolvedTheme>(() => {
    const pref = this._preference();
    if (pref === 'system') return this.systemDark() ? 'dark' : 'light';
    return pref;
  });

  constructor() {
    if (!this.isBrowser) return;
    const onChange = (event: MediaQueryListEvent) => {
      this.systemDark.set(event.matches);
      this.apply();
    };
    this.media?.addEventListener?.('change', onChange);
    inject(DestroyRef).onDestroy(() => this.media?.removeEventListener?.('change', onChange));
    this.apply();
  }

  setPreference(preference: ThemePreference): void {
    this._preference.set(preference);
    this.write(preference);
    this.apply();
  }

  private apply(): void {
    if (!this.isBrowser) return;
    const root = this.document.documentElement;
    const dark = this.resolved() === 'dark';
    root.classList.toggle(THEME_DARK_CLASS, dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
  }

  private read(): ThemePreference {
    if (!this.isBrowser) return 'system';
    try {
      const stored = this.document.defaultView?.localStorage.getItem(THEME_STORAGE_KEY);
      return isPreference(stored) ? stored : 'system';
    } catch {
      return 'system';
    }
  }

  private write(preference: ThemePreference): void {
    try {
      const storage = this.document.defaultView?.localStorage;
      if (!storage) return;
      // Automático é o padrão: não guardar nada é guardar o Automático.
      if (preference === 'system') storage.removeItem(THEME_STORAGE_KEY);
      else storage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Sem storage a escolha vale até fechar a aba, e a próxima carga volta ao Automático.
    }
  }
}
