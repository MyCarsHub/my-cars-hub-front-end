import type { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import type { BlogPostListItem, BlogPostStatus } from '../../../types/blog.types';
import { blogCategoryLabel } from '../../../types/blog.types';
import { formatFullDate, formatTime, parseServerTime } from '../../../utils/server-time';

/** Pílula de situação da lista do blog. */
export type BlogStatusFilter = 'ALL' | BlogPostStatus;
/** Select "Categoria: X"; `ALL` = todas. */
export type BlogCategoryFilter = 'ALL' | BlogPostListItem['category'];

export interface BlogFilters {
  readonly term: string;
  readonly status: BlogStatusFilter;
  readonly category: BlogCategoryFilter;
}

export interface BlogRow {
  readonly post: BlogPostListItem;
  readonly path: string;
  readonly category: string;
  readonly status: { readonly label: string; readonly tone: StatusChipTone };
  /** "Publicado em 18/11/2026" (ou "Criado em", no rascunho). */
  readonly date: string;
  /** Data e hora exatas, para o balão do mouse e o CSV: "18/11/2026 às 14:32". */
  readonly dateExact: string;
  readonly reading: string;
}

/** Cor só no chip: publicado verde, rascunho neutro. */
export function blogStatus(status: BlogPostStatus): BlogRow['status'] {
  return status === 'PUBLISHED'
    ? { label: 'Publicado', tone: 'green' }
    : { label: 'Rascunho', tone: 'neutral' };
}

/**
 * Data e hora exatas de um instante do servidor no fuso do negócio: "18/11/2026 às 14:32".
 * `LocalDateTime` da API vem em UTC sem sufixo; `new Date(iso)` leria como hora local do
 * navegador e erraria 3 h (e o dia, depois das 21h de Brasília). `parseServerTime` lê certo.
 */
export function exactDateTime(value: string | null | undefined): string | null {
  const date = parseServerTime(value);
  return date ? `${formatFullDate(date)} às ${formatTime(date)}` : null;
}

/** Só a data, no fuso do negócio: "18/11/2026"; "—" sem data. */
export function exactDate(value: string | null | undefined): string {
  return formatFullDate(parseServerTime(value));
}

export function toBlogRow(post: BlogPostListItem): BlogRow {
  const published = post.status === 'PUBLISHED' && !!post.publishedAt;
  const when = published ? post.publishedAt : post.createdDate;
  return {
    post,
    path: `/blog/${post.slug}`,
    category: blogCategoryLabel(post.category),
    status: blogStatus(post.status),
    date: `${published ? 'Publicado em' : 'Criado em'} ${exactDate(when)}`,
    dateExact: exactDateTime(when) ?? '—',
    reading: `${post.readingMinutes} min de leitura`,
  };
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchesTerm(row: BlogRow, term: string): boolean {
  const t = normalize(term);
  if (!t) return true;
  return normalize(row.post.title).includes(t) || row.post.slug.includes(t);
}

/** Busca (título ou slug, sem acento) + categoria + situação. */
export function filterBlogRows(rows: readonly BlogRow[], f: BlogFilters): BlogRow[] {
  return rows.filter(
    (r) =>
      (f.status === 'ALL' || r.post.status === f.status) &&
      (f.category === 'ALL' || r.post.category === f.category) &&
      matchesTerm(r, f.term),
  );
}

/** Quantos aparecem em cada pílula, com a busca e a categoria já aplicadas. */
export function blogStatusCounts(
  rows: readonly BlogRow[],
  f: BlogFilters,
): Record<BlogStatusFilter, number> {
  const base = filterBlogRows(rows, { ...f, status: 'ALL' });
  return {
    ALL: base.length,
    PUBLISHED: base.filter((r) => r.post.status === 'PUBLISHED').length,
    DRAFT: base.filter((r) => r.post.status === 'DRAFT').length,
  };
}

/**
 * Linha de datas do editor: "Publicado em 18/11/2026 às 14:32 · editado em 19/11/2026 às 09:10".
 * Rascunho mostra quando foi criado. `null` quando o servidor não mandou data nenhuma.
 */
export function editorDatesLine(post: {
  status: BlogPostStatus;
  publishedAt: string | null;
  createdDate: string | null;
  modifyDate: string | null;
}): string | null {
  const parts: string[] = [];
  const published = post.status === 'PUBLISHED' ? exactDateTime(post.publishedAt) : null;
  if (published) parts.push(`Publicado em ${published}`);
  else {
    const created = exactDateTime(post.createdDate);
    if (created) parts.push(`Criado em ${created}`);
  }
  const edited = exactDateTime(post.modifyDate);
  if (edited) parts.push(`${parts.length ? 'editado' : 'Editado'} em ${edited}`);
  return parts.length ? parts.join(' · ') : null;
}
