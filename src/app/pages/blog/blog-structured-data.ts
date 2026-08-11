import { BlogPostDetail, blogCategoryLabel } from '../../types/blog.types';
import { ORGANIZATION_ID, organizationRef } from '../landing/landing-structured-data';
import { absoluteUrl } from '../../services/structured-data';

/**
 * `BlogPosting` for `/blog/:slug`.
 *
 * RULE (same as the landing blocks): every field comes from the `BlogPostDetail` the page
 * already fetched and renders. Nullable API fields are OMITTED when null rather than
 * defaulted — a wrong `datePublished` is worse than an absent one, because it contradicts
 * the visible date and trains Google to distrust the whole block.
 *
 * Deliberately absent:
 * - a Person `author`. `BlogPostDetail.authorId` is a UUID, not a name, and the page
 *   renders no byline. The honest author is the publisher itself, so `author` is the
 *   MyCarsHub Organization — the one entity the page really attributes the post to.
 * - `wordCount`. The body arrives as sanitized HTML; counting tags-and-all would be a
 *   made-up number.
 */
export function blogPostingJsonLd(post: BlogPostDetail): unknown {
  const pageUrl = absoluteUrl(`/blog/${post.slug}`);
  const description = post.metaDescription ?? post.excerpt;

  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${pageUrl}#post`,
    headline: post.title,
    url: pageUrl,
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    inLanguage: 'pt-BR',
    articleSection: blogCategoryLabel(post.category),
    author: organizationRef(),
    publisher: { '@id': ORGANIZATION_ID },
    ...(description ? { description } : {}),
    ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
    // `modifyDate` is the row's last update; it only means anything once the post is live.
    ...(post.modifyDate && post.publishedAt ? { dateModified: post.modifyDate } : {}),
    // The cover the article really shows. `coverUrl` may already be an absolute CDN URL.
    ...(post.coverUrl ? { image: absoluteUrl(post.coverUrl) } : {}),
    ...(post.readingMinutes > 0 ? { timeRequired: `PT${post.readingMinutes}M` } : {}),
  };
}
