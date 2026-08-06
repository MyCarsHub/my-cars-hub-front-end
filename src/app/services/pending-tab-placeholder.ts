/**
 * A tela de carregamento desenhada DENTRO da aba reservada por
 * `ExternalNavigationService.openPendingTab()`.
 *
 * POR QUE ISSO É HTML NA MÃO E NÃO UM COMPONENTE ANGULAR:
 * a aba nasce de `window.open('', '_blank')` — um documento `about:blank`
 * separado, sem bootstrap do Angular e sem o bundle de CSS do app. Nada de
 * `OauthSuccess` (`pages/oauth-success/`) roda ali, e nenhuma classe do
 * Tailwind resolve. O padrão visual dele é reproduzido aqui com CSS embutido
 * e os hex literais da rampa de `src/styles.css` (`--color-primary-*`), que é
 * a única forma de o documento estrangeiro se parecer com o app.
 * Se um dia esta tela precisar de mais estados, o caminho é uma rota real
 * navegável (`/redirecting`), não um componente injetado aqui.
 */

/** Textos da tela. Parametrizados porque a aba reservada não serve só ao checkout. */
export interface PendingTabPlaceholderCopy {
  /** Título da aba no browser. */
  readonly documentTitle: string;
  /** Título visível. */
  readonly title: string;
  /** Aviso de apoio — carrega o "não feche esta aba". */
  readonly note: string;
  /**
   * Apoio do estado de impasse (30s sem redirecionamento). Opcional: sem ele
   * vale o texto do checkout, que é quem fala em cobrança. Um caller que não
   * cobra nada PRECISA passar o seu — senão a tela promete algo que não houve.
   */
  readonly stalledNote?: string;
}

/** Cópia padrão: o checkout, único caller que exibia a mensagem antiga. */
export const PAYMENT_PLACEHOLDER_COPY: PendingTabPlaceholderCopy = {
  documentTitle: 'Redirecionando para o pagamento…',
  title: 'Abrindo o pagamento seguro',
  note: 'Não feche esta aba. Você será redirecionado em instantes.',
};

/**
 * Cópia da aba que abre um documento já emitido (apólice de seguro). Nada aqui
 * é checkout: a apólice não cobra, não redireciona para gateway nenhum, e o
 * texto padrão fazia o usuário ler "Abrindo o pagamento seguro" ao abrir um PDF.
 */
export const POLICY_DOCUMENT_PLACEHOLDER_COPY: PendingTabPlaceholderCopy = {
  documentTitle: 'Abrindo a apólice…',
  title: 'Abrindo a apólice',
  note: 'Não feche esta aba. O documento abre em instantes.',
  stalledNote:
    'Não foi possível abrir o documento. Feche esta aba e tente novamente na aba anterior.',
};

/**
 * Depois disso a tela para de prometer um redirecionamento que não veio.
 *
 * Folga deliberada sobre o teto de 20s que `billing.ts` impõe ao
 * `POST /billing/checkout` (`CHECKOUT_REQUEST_TIMEOUT_MS`): dentro daquela
 * janela quem manda é a aba de origem, que já navega ou FECHA esta aqui. Se aos
 * 30s ainda estamos vivos, foi a aba de origem que perdeu o controle (fechada,
 * suspensa pelo SO, JS morto) — e aí ninguém mais vai nos tirar do spinner.
 */
export const PLACEHOLDER_STALL_MS = 30_000;

/** Estado de impasse: sem spinner, com uma saída que o usuário consegue executar. */
const STALLED_COPY = {
  title: 'Está demorando mais que o esperado',
  note: 'Nada foi cobrado. Feche esta aba e tente novamente na aba anterior.',
} as const;

/**
 * CSS embutido. Espelha `pages/oauth-success/oauth-success.html`: mesmo
 * gradiente de fundo, mesmo anel de 64px com um arco `primary-500` girando,
 * mesma hierarquia de título/apoio. Mobile-first — as únicas subidas de
 * tamanho ficam no `min-width: 640px`, o mesmo ponto do `sm:` do Tailwind.
 */
const PLACEHOLDER_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #FFFFFF;
}
.mch-stage {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  background: linear-gradient(to bottom right, #FAFAFA 0%, #FFFFFF 55%, #FFF0EA 100%);
}
.mch-panel { max-width: 24rem; }
.mch-spinner {
  position: relative;
  width: 64px;
  height: 64px;
  margin: 0 auto 32px;
}
.mch-spinner__track,
.mch-spinner__arc {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  border: 4px solid transparent;
}
/* primary-100 — o anel de base, sem contar como informação. */
.mch-spinner__track { border-color: #FFD9C9; }
/* primary-500 (Signal Orange) — o arco que gira. */
.mch-spinner__arc {
  border-top-color: #F63B04;
  animation: mch-spin 900ms linear infinite;
}
@keyframes mch-spin { to { transform: rotate(360deg); } }
.mch-title {
  margin: 0;
  font-size: 1.25rem;
  line-height: 1.3;
  font-weight: 600;
  letter-spacing: -0.01em;
  /* neutral-900 */
  color: #171717;
}
.mch-note {
  margin: 12px 0 0;
  font-size: 0.875rem;
  line-height: 1.6;
  /* neutral-500 — 4,83:1 sobre branco, passa AA em texto normal. */
  color: #737373;
}
@media (min-width: 640px) {
  .mch-title { font-size: 1.5rem; }
  .mch-note { font-size: 1rem; }
}
/* O estado é anunciado pelo texto sob aria-live; a rotação é enfeite e sai. */
@media (prefers-reduced-motion: reduce) {
  .mch-spinner__arc { animation: none; }
}
`;

/**
 * Desenha a tela de carregamento em `doc`. Best-effort por natureza — é uma
 * cortesia visual e NUNCA pode derrubar o fluxo que abriu a aba.
 */
export function renderPendingTabPlaceholder(
  doc: Document,
  copy: PendingTabPlaceholderCopy = PAYMENT_PLACEHOLDER_COPY,
): void {
  try {
    doc.title = copy.documentTitle;

    const style = doc.createElement('style');
    style.textContent = PLACEHOLDER_CSS;
    // `head` pode não ter sido parseado num about:blank recém-aberto.
    (doc.head ?? doc.documentElement)?.appendChild(style);

    // `role="status"` + `aria-live` fazem o leitor de tela anunciar tanto a
    // espera quanto a troca para o estado de impasse — o spinner é decorativo.
    const stage = doc.createElement('main');
    stage.className = 'mch-stage';
    stage.setAttribute('role', 'status');
    stage.setAttribute('aria-live', 'polite');

    const panel = doc.createElement('div');
    panel.className = 'mch-panel';

    const spinner = doc.createElement('div');
    spinner.className = 'mch-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const track = doc.createElement('span');
    track.className = 'mch-spinner__track';
    const arc = doc.createElement('span');
    arc.className = 'mch-spinner__arc';
    spinner.append(track, arc);

    const title = doc.createElement('h1');
    title.className = 'mch-title';
    title.textContent = copy.title;

    const note = doc.createElement('p');
    note.className = 'mch-note';
    note.textContent = copy.note;

    panel.append(spinner, title, note);
    stage.appendChild(panel);
    // Mesmo motivo do `head`: o `body` pode ainda não existir.
    const host = doc.body ?? doc.documentElement;
    host?.appendChild(stage);

    scheduleStalledState(doc, { spinner, title, note }, copy);
  } catch {
    // Um placeholder é um agrado; jamais deixe ele quebrar o checkout.
  }
}

/**
 * Rede de segurança contra a tela de carregamento eterna.
 *
 * O timer vive no `defaultView` da aba nova para morrer junto com ela: quando
 * `navigate()` faz `location.replace`, o documento é destruído e este callback
 * nunca roda. Ele só dispara no caso em que ninguém mais vai nos salvar.
 */
function scheduleStalledState(
  doc: Document,
  parts: { spinner: HTMLElement; title: HTMLElement; note: HTMLElement },
  copy: PendingTabPlaceholderCopy,
): void {
  const view: { setTimeout: typeof setTimeout } = doc.defaultView ?? globalThis;
  view.setTimeout(() => {
    try {
      // Um `replace()` em voo pode ter trocado o documento por baixo de nós.
      if (!parts.title.isConnected) return;
      parts.spinner.remove();
      parts.title.textContent = STALLED_COPY.title;
      parts.note.textContent = copy.stalledNote ?? STALLED_COPY.note;
    } catch {
      // idem: nunca escale um erro de cortesia.
    }
  }, PLACEHOLDER_STALL_MS);
}
