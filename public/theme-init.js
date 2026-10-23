/*
 * Tema antes da primeira pintura (modo escuro sem piscar).
 *
 * Arquivo de mesma origem, e NAO script inline, pelo mesmo motivo de `gtag-init.js`:
 * a CSP de producao (`vercel.json`) tem `script-src 'self'` sem `'unsafe-inline'`, e um
 * bloco inline aqui seria ignorado em silencio.
 *
 * Le a escolha de `localStorage['mch:theme']` (a mesma chave de `ThemeService`):
 * `dark` / `light` valem como estao; ausente ou invalido = Automatico, que segue
 * `prefers-color-scheme`. Qualquer erro (storage bloqueado, navegador antigo) cai no
 * tema claro, que e o estado do HTML prerenderizado.
 */
(function () {
  var root = document.documentElement;
  try {
    var pref = null;
    try {
      pref = window.localStorage.getItem('mch:theme');
    } catch (e) {
      pref = null;
    }
    var dark =
      pref === 'dark' ||
      (pref !== 'light' &&
        !!window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) root.classList.add('dark');
    root.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {
    /* tema claro */
  }
})();
