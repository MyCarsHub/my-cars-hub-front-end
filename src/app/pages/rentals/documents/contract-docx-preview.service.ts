import { Injectable } from '@angular/core';

/**
 * Fronteira de carregamento do renderizador de `.docx` (docx-preview).
 *
 * Existe por dois motivos, nesta ordem:
 *
 * 1. **Bundle.** docx-preview (~150KB) só é necessário quando o usuário abre um
 *    contrato AUTO; ficar no grafo estático do card o colocaria no bundle
 *    inicial. Mesmo padrão do `ContractTemplate`, que já lazy-importa a lib, e
 *    do `InspectionPdfService`, que lazy-importa `pdf-lib`.
 * 2. **Testabilidade.** Um `import()` dinâmico dentro do componente é intestável
 *    no runner do Angular + Vitest: a promise simplesmente nunca resolve, e
 *    mockar o módulo (`vi.mock`) não muda isso. Com o import atrás de um serviço
 *    injetável, o teste do card troca a implementação por DI — sem mexer no
 *    grafo de módulos e sem alargar a superfície do componente.
 *
 * Não achatar isto de volta pra dentro do card: some o lazy-load OU some a
 * cobertura do caminho de renderização.
 */
@Injectable({ providedIn: 'root' })
export class ContractDocxPreviewService {
  /**
   * Renderiza os bytes de um `.docx` DENTRO de `container` (que vive na aba
   * nova). docx-preview reproduz a paginação, fontes e tabelas do Word —
   * diferente de uma conversão, o que aparece na tela é o layout do arquivo.
   *
   * Rejeita quando o arquivo não é um DOCX legível; quem chama deve cair no
   * fallback que oferece o arquivo original.
   */
  async render(source: ArrayBuffer, container: HTMLElement): Promise<void> {
    const { renderAsync } = await import('docx-preview');
    await renderAsync(source, container, undefined, {
      className: 'docx',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
    });
  }
}
