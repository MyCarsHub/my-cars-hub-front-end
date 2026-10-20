import type { Observable } from 'rxjs';

/**
 * O que já identifica os bytes do arquivo:
 * - `string`: URL buscada com `fetch` SEM credenciais (a signed URL do storage, ou um
 *   asset do próprio app). Nunca coloque o token do app numa URL para caber aqui.
 * - `Blob` / `ArrayBuffer` / `Uint8Array`: bytes já na mão (gerados no cliente ou
 *   baixados por um request autenticado do `HttpClient`).
 * - `{ url }`: a resposta crua dos endpoints `.../signed-url` do backend.
 */
export type DocumentPreviewResolved = string | Blob | ArrayBuffer | Uint8Array | { url: string };

/**
 * A origem do arquivo. Além das formas resolvidas, aceita um CARREGADOR: o modal abre
 * NA HORA do toque (com o esqueleto) e só então pede a signed URL ou os bytes. É isso que
 * substitui a aba reservada de `ExternalNavigationService.openPendingTab()` — sem aba,
 * não existe pop-up blocker para driblar.
 */
export type DocumentPreviewSource =
  | DocumentPreviewResolved
  | (() => Observable<DocumentPreviewResolved> | Promise<DocumentPreviewResolved>);

/** Um arquivo do visualizador. */
export interface DocumentPreviewItem {
  readonly source: DocumentPreviewSource;
  /**
   * Nome do arquivo baixado. A EXTENSÃO final é decidida pelos BYTES (ex.: um contrato
   * AUTO assinado se declara DOCX mas é PDF) — se o nome trouxer outra, ela é trocada.
   */
  readonly fileName: string;
  /** Só uma dica. Quem decide o formato são os primeiros bytes do arquivo. */
  readonly mimeType?: string;
  /** Título no topo do modal. Padrão: `fileName`. */
  readonly title?: string;
  /** Linha de apoio sob o título (ex.: o ângulo da foto). */
  readonly caption?: string;
  /** Texto quando o carregador falha sem mensagem do servidor. */
  readonly errorMessage?: string;
}

/** Vários arquivos navegáveis (galeria de fotos de vistoria). */
export interface DocumentPreviewGallery {
  readonly items: readonly DocumentPreviewItem[];
  readonly startIndex?: number;
  /** Título fixo da galeria. Sem ele, vale o título de cada item. */
  readonly title?: string;
}

export type DocumentPreviewRequest = DocumentPreviewItem | DocumentPreviewGallery;

/** Formato decidido pelos bytes. */
export type DocumentFormat = 'pdf' | 'docx' | 'jpeg' | 'png' | 'webp' | 'gif' | 'heic' | 'unknown';

/** Normaliza as duas formas de pedido para a galeria (um item = galeria de um). */
export function toGallery(request: DocumentPreviewRequest): DocumentPreviewGallery {
  if ('items' in request) return request;
  return { items: [request], startIndex: 0 };
}
