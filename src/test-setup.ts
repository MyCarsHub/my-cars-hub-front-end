/**
 * Cada arquivo de spec comeca com o `sessionStorage` VAZIO.
 *
 * ## NAO REMOVA ISTO ACHANDO QUE O ISOLAMENTO DO VITEST COBRE — ELE NAO COBRE
 *
 * `isolate: true` (o padrao) isola o registro de modulos e o ambiente por
 * arquivo, mas **nao resseta o `sessionStorage` do JSDOM**. Medido, nao
 * suposto: com `isolate: true` EXPLICITO, um spec que termina escrevendo um
 * token continua derrubando um spec posterior no mesmo worker. Nenhuma
 * configuracao de isolamento do vitest protege desta classe — o nome promete
 * mais do que o escopo entrega.
 *
 * ## O defeito que originou a linha
 *
 * `company-contact.spec.ts` terminava deixando um token de papel `DRIVER`.
 * `rental-inspection-card.ts` deriva `isDriver` de
 * `getCompanyRoleFromToken()`, entao o cartao passava a renderizar a camera ao
 * vivo em vez dos dois `input[type=file]`, e o spec de vistoria morria em
 * `vi.spyOn(undefined)` — em CI, e so em CI, porque so la os dois arquivos
 * caiam no mesmo worker nessa ordem. Tres verdes locais nao viram nada.
 *
 * ## Por que o VALOR importa, e nao a sujeira
 *
 * Sujar com um token `OWNER` passava; sujar com `DRIVER` quebrava. O defeito e
 * o VALOR herdado, nao "estado residual" generico — por isso a correcao e
 * comecar vazio, e nao normalizar para algum papel.
 *
 * Limpa no inicio do ARQUIVO, de proposito, e nao a cada teste: um
 * `beforeEach` global apagaria o que specs legitimamente montam em `beforeAll`.
 *
 * ## O `localStorage` entra junto, e a assimetria de prova e deliberada
 *
 * O defeito medido foi no `sessionStorage`. O `localStorage` NAO tem defeito
 * observado — tem a mesma ESTRUTURA: tres specs escrevem nele e tres servicos
 * de producao leem (`rental-draft.service`, `consent.service`,
 * `plan-intent.service`), sob o MESMO mecanismo habilitante, porque `isolate`
 * tambem nao o resseta.
 *
 * Normalmente "existe" nao justifica mexer — existencia nao e comportamento.
 * A excecao aqui foi decidida, e o criterio e este: a estrutura ja esta
 * MEDIDA (nao suposta), o mecanismo e identico ao que acabou de custar um
 * ciclo de release, e a correcao e a mesma linha num arquivo que ja estava
 * sendo tocado. Esperar a mordida custaria um PR e um CI inteiros para
 * escrever a linha de baixo.
 */
if (typeof sessionStorage !== 'undefined') {
  sessionStorage.clear();
}

if (typeof localStorage !== 'undefined') {
  localStorage.clear();
}

/**
 * Global Vitest setup (registered in `angular.json` → `test.options.setupFiles`).
 *
 * JSDOM's `Blob` does not implement `arrayBuffer()`. Production code relies on
 * it (e.g. `pages/rentals/inspection-pdf.service.ts`), so we back-fill it with a
 * real `FileReader`-based read — the bytes returned are the Blob's actual bytes,
 * never a stub. Installed only when the runtime lacks its own implementation, so
 * a browser/Node environment that already provides one keeps it.
 */
/**
 * JSDOM não implementa `Element.prototype.scrollIntoView` (é layout, e JSDOM não
 * faz layout). Código de produção usa (`pages/rentals/rental-detail.ts` traz o
 * banner de erro de ativação pro campo de visão), então o stub mora AQUI — no
 * setup de teste — e não como um `typeof === 'function'` no componente. É no-op
 * de propósito: sem layout não há o que rolar; specs que precisam observar a
 * chamada usam `vi.spyOn(Element.prototype, 'scrollIntoView')`.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value(): void {
      /* no-op: JSDOM não faz layout */
    },
  });
}

if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value(this: Blob): Promise<ArrayBuffer> {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () =>
          reject(reader.error ?? new Error('Failed to read Blob as an ArrayBuffer.'));
        reader.readAsArrayBuffer(this);
      });
    },
  });
}
