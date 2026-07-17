export type BlogPostStatus = 'DRAFT' | 'PUBLISHED';

export type BlogPostCategory =
  | 'OPERACAO'
  | 'COBRANCAS'
  | 'LGPD'
  | 'INTEGRACOES'
  | 'CASES'
  | 'PRODUTO';

/** Rótulos amigáveis pras categorias, usados em pills e filtros. */
export const BLOG_CATEGORIES: Array<{ value: BlogPostCategory; label: string }> = [
  { value: 'OPERACAO', label: 'Operação' },
  { value: 'COBRANCAS', label: 'Cobranças' },
  { value: 'LGPD', label: 'LGPD' },
  { value: 'INTEGRACOES', label: 'Integrações' },
  { value: 'CASES', label: 'Cases' },
  { value: 'PRODUTO', label: 'Produto' },
];

export function blogCategoryLabel(cat: BlogPostCategory | string): string {
  return BLOG_CATEGORIES.find((c) => c.value === cat)?.label ?? cat;
}

export interface BlogPostListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverUrl: string | null;
  category: BlogPostCategory;
  status: BlogPostStatus;
  publishedAt: string | null;
  createdDate: string;
  readingMinutes: number;
}

export interface BlogPostDetail extends BlogPostListItem {
  modifyDate: string | null;
  authorId: string | null;
  bodyMarkdown: string;
  bodyHtml: string;
  metaDescription: string | null;
}

export interface BlogPostRequest {
  slug: string;
  title: string;
  excerpt?: string;
  coverUrl?: string;
  category: BlogPostCategory;
  bodyMarkdown: string;
  metaDescription?: string;
}
