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
 *
 * Fora do app autenticado (landing, blog, legais, login, convite publico...) o tema e
 * SEMPRE claro: a lista de caminhos publicos abaixo repete `services/theme-scope.ts`
 * (`theme-init.spec.ts` as compara). Caminho publico nunca recebe `dark` e a escolha
 * salva NAO e tocada; o `AppShell` aplica a escolha quando a pessoa entra no app.
 */
(function () {
  var root = document.documentElement;
  try {
    var path = window.location.pathname || '/';
    var publicPaths = [
      '/login',
      '/signup',
      '/oauth-success',
      '/invite',
      '/convite',
      '/blog',
      '/politica-de-privacidade',
      '/termos-de-uso',
      '/manutencao',
      '/status',
    ];
    var isPublic = path === '/' || path === '';
    for (var i = 0; i < publicPaths.length && !isPublic; i++) {
      var p = publicPaths[i];
      if (path === p || path.indexOf(p + '/') === 0) isPublic = true;
    }
    if (isPublic) {
      root.style.colorScheme = 'light';
      return;
    }
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
