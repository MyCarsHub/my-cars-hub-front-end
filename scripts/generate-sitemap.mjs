/**
 * Post-build SEO artefact generator. Wired as `postbuild` in package.json, so
 * `npm run build` (what Vercel runs) always executes it after `ng build`.
 *
 * IT DOES THREE THINGS, ALL OFFLINE:
 *
 *  1. Rewrites `robots.txt` and `sitemap.xml` IN THE BUILD OUTPUT so every absolute URL
 *     uses the canonical origin. `public/robots.txt` and `public/sitemap.xml` stay the
 *     committed source of truth for CONTENT (the Disallow list, the legal pages' real
 *     `lastmod`); only the origin is substituted. That is what makes changing the
 *     canonical host genuinely one line — `SITE_ORIGIN` in `services/seo.service.ts`.
 *
 *  2. Prunes prerendered blog pages that froze an ERROR state into static HTML. If the
 *     API answered `getPrerenderParams` but failed during the render itself, the emitted
 *     document is "Post não encontrado" served with HTTP 200 — strictly worse for
 *     indexing than no document at all. Deleting it makes the path fall through to the
 *     client-rendered shell, i.e. today's behaviour.
 *
 *  3. Appends a `<url>` entry for every blog page that SURVIVED that check, with a real
 *     `lastmod` read out of the page's own `BlogPosting` JSON-LD (`dateModified` else
 *     `datePublished`). Deriving the sitemap from the rendered output rather than from a
 *     second API call is deliberate: it is impossible to list a URL that does not exist
 *     or that renders an error, and there is no second chance for the API to disagree
 *     with itself between two calls. A post with no date gets no `lastmod` — never an
 *     invented one.
 *
 * FAILURE POLICY: this script must never fail the build. Every step is individually
 * guarded; anything unexpected logs a warning, leaves the static files that
 * `angular.json`'s assets glob already copied from `public/` untouched, and exits 0.
 * There is no network access here at all, so there is nothing to time out.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Marker `SeoService.setJsonLd` writes for the post schema (`blog-detail.ts`). */
const POST_JSONLD_MARKER = 'data-seo-jsonld="blog-posting"';

/**
 * The blog components' failure branches, matched ONLY as a rendered `class` attribute.
 *
 * A bare substring search does not work: Angular inlines each component's stylesheet into
 * the prerendered document, so `.blog-list__error { … }` is present in the `<style>` block
 * of every blog page whether or not the branch rendered. Keying on `class="…"` is what
 * separates "this page shows an error" from "this page merely has a rule for one".
 */
const ERROR_MARKER = /class="[^"]*\b(?:blog-list|blog-detail)__error\b/;

/**
 * Proof that `/blog` actually rendered POSTS, not just a page.
 *
 * `blog-list.html` has four branches and only one of them is worth indexing. The error
 * branch is caught by `ERROR_MARKER`, but the other two failures render happily: the
 * skeleton (`blog-card--skeleton`, when the fetch never resolved before serialization)
 * and the empty state ("Ainda sem posts por aqui."). Both produce a valid HTML page with
 * zero links and zero content — a thin page, submitted to Google in the sitemap. The
 * negative lookahead is what separates a real card from a skeleton, since both carry the
 * `blog-card` class; `blog-card__cover` does not match, because `_` is a word character.
 */
const POST_CARD_MARKER = /class="[^"]*\bblog-card\b(?![^"]*\bblog-card--skeleton\b)/;

const log = (message) => console.log(`[sitemap] ${message}`);
const warn = (message) => console.warn(`[sitemap] ${message}`);

main();

function main() {
  try {
    const origin = resolveOrigin();
    if (origin === null) {
      warn('Could not determine SITE_ORIGIN; leaving the committed static files as they are.');
      return;
    }

    const outDir = resolveOutputDir();
    if (outDir === null) {
      warn('Could not locate the build output; nothing to generate.');
      return;
    }
    log(`origin=${origin} out=${outDir}`);

    writeRobots(outDir, origin);

    const { urls: blogUrls, listPruned } = collectBlogUrls(outDir, origin);
    writeSitemap(outDir, origin, blogUrls, listPruned);
  } catch (error) {
    warn(`Unexpected failure, keeping the static sitemap/robots: ${describe(error)}`);
  }
}

/* ------------------------------------------------------------------ origin */

/**
 * `SITE_ORIGIN` env override, else the single source of truth in the TypeScript.
 * Returns `null` rather than a guess — an invented origin would poison every canonical.
 */
function resolveOrigin() {
  const fromEnv = process.env['SITE_ORIGIN']?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '');
  }
  try {
    const source = readFileSync(join(ROOT, 'src/app/services/seo.service.ts'), 'utf8');
    const match = /export const SITE_ORIGIN\s*=\s*'([^']+)'/.exec(source);
    return match ? match[1].replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- paths */

/** `dist/<project>/browser`, read from angular.json so a rename cannot silently no-op. */
function resolveOutputDir() {
  let name = 'my-cars-hub-front-end';
  try {
    const angular = JSON.parse(readFileSync(join(ROOT, 'angular.json'), 'utf8'));
    const projects = Object.keys(angular.projects ?? {});
    const project = projects[0];
    if (project) {
      name = angular.projects[project].architect?.build?.options?.outputPath ?? project;
    }
  } catch {
    /* fall through to the default below */
  }
  const candidate = name.startsWith('dist') ? join(ROOT, name) : join(ROOT, 'dist', name);
  const browser = join(candidate, 'browser');
  if (existsSync(browser)) return browser;
  if (existsSync(candidate)) return candidate;
  return null;
}

/* ------------------------------------------------------------------ robots */

/**
 * Re-emits `robots.txt` with the canonical origin. The rule set itself is copied
 * verbatim from `public/robots.txt`; ONLY the origin already present in the file (found
 * via its own `Sitemap:` line) is substituted, so a new Disallow added to the committed
 * file needs no change here.
 */
function writeRobots(outDir, origin) {
  const sourcePath = join(ROOT, 'public/robots.txt');
  if (!existsSync(sourcePath)) {
    warn('public/robots.txt is missing; skipped.');
    return;
  }
  const source = readFileSync(sourcePath, 'utf8');
  const current = /^\s*Sitemap:\s*(https?:\/\/[^/\s]+)/im.exec(source)?.[1];
  if (!current) {
    warn('public/robots.txt has no `Sitemap:` line to read the current origin from; copied as is.');
    writeFileSync(join(outDir, 'robots.txt'), source, 'utf8');
    return;
  }
  const output = source.split(current).join(origin);
  writeFileSync(join(outDir, 'robots.txt'), output, 'utf8');
  log(current === origin ? 'robots.txt origin already canonical.' : `robots.txt ${current} -> ${origin}`);
}

/* -------------------------------------------------------- prerendered blog */

/**
 * Walks `<out>/blog/**\/index.html`, deletes the ones that froze an error state, and
 * returns `{ path, lastmod }` for the survivors. `/blog` itself is checked too: a list
 * page that rendered "não foi possível carregar" is the same indexing hazard.
 */
function collectBlogUrls(outDir, origin) {
  const blogDir = join(outDir, 'blog');
  if (!existsSync(blogDir)) {
    log('No prerendered blog output; the sitemap keeps only the static entries.');
    return { urls: [], listPruned: false };
  }

  // `/blog` must have prerendered an error-free page that really lists posts. A skeleton
  // or an empty state is not a lesser success, it is a thin page: pruning it drops the
  // file so the path falls back to client rendering, and drops the sitemap entry so we
  // are not submitting a contentless URL to Google in the meantime.
  let listPruned = false;
  const listPage = join(blogDir, 'index.html');
  if (existsSync(listPage)) {
    const listHtml = readFileSync(listPage, 'utf8');
    if (looksBroken(listHtml) || !POST_CARD_MARKER.test(listHtml)) {
      rmSync(listPage);
      listPruned = true;
      warn('Removed /blog: it prerendered no posts. The path falls back to client rendering.');
    }
  }

  const urls = [];
  for (const entry of readdirSync(blogDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(blogDir, entry.name, 'index.html');
    if (!existsSync(file)) continue;

    const html = readFileSync(file, 'utf8');
    if (looksBroken(html) || !html.includes(POST_JSONLD_MARKER)) {
      rmSync(join(blogDir, entry.name), { recursive: true, force: true });
      warn(`Removed /blog/${entry.name}: no usable post in the prerendered HTML.`);
      continue;
    }
    urls.push({ loc: `${origin}/blog/${entry.name}`, lastmod: readPostDate(html) });
  }
  return { urls, listPruned };
}

function looksBroken(html) {
  return ERROR_MARKER.test(html);
}

/**
 * `dateModified` else `datePublished` from the page's own `BlogPosting` block, reduced to
 * `YYYY-MM-DD`. Returns `null` when the post carries neither — `blog-structured-data.ts`
 * omits them when the API sends null, and an omitted `lastmod` is the honest output.
 */
function readPostDate(html) {
  const blocks = html.matchAll(
    /<script[^>]*data-seo-jsonld="blog-posting"[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    try {
      const data = JSON.parse(block[1].replace(/\\u003c/g, '<'));
      const raw = data.dateModified ?? data.datePublished;
      if (typeof raw !== 'string') continue;
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) continue;
      return date.toISOString().slice(0, 10);
    } catch {
      /* a block we cannot parse contributes no date, rather than a wrong one */
    }
  }
  return null;
}

/* ----------------------------------------------------------------- sitemap */

/**
 * Rebuilds `sitemap.xml` = the committed static entries (origin-substituted, everything
 * else preserved byte for byte) + one entry per surviving prerendered post.
 */
function writeSitemap(outDir, origin, blogUrls, listPruned = false) {
  const sourcePath = join(ROOT, 'public/sitemap.xml');
  if (!existsSync(sourcePath)) {
    warn('public/sitemap.xml is missing; skipped.');
    return;
  }
  const source = readFileSync(sourcePath, 'utf8');
  const current = /<loc>\s*(https?:\/\/[^/\s<]+)/i.exec(source)?.[1];
  if (!current) {
    warn('public/sitemap.xml has no <loc> to read the current origin from; copied as is.');
    writeFileSync(join(outDir, 'sitemap.xml'), source, 'utf8');
    return;
  }

  let rebased = source.split(current).join(origin);
  if (listPruned) {
    rebased = dropUrlEntry(rebased, `${origin}/blog`);
    log('Dropped the /blog entry: the list page prerendered no posts.');
  }
  if (blogUrls.length === 0) {
    writeFileSync(join(outDir, 'sitemap.xml'), rebased, 'utf8');
    log(`sitemap.xml written with static entries only (origin ${current} -> ${origin}).`);
    return;
  }

  const closing = rebased.lastIndexOf('</urlset>');
  if (closing === -1) {
    warn('public/sitemap.xml has no </urlset>; wrote it unchanged rather than corrupting it.');
    writeFileSync(join(outDir, 'sitemap.xml'), rebased, 'utf8');
    return;
  }

  const entries = blogUrls
    .sort((a, b) => a.loc.localeCompare(b.loc))
    .map(
      ({ loc, lastmod }) =>
        '  <url>\n' +
        `    <loc>${escapeXml(loc)}</loc>\n` +
        (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '') +
        '    <changefreq>monthly</changefreq>\n' +
        '    <priority>0.5</priority>\n' +
        '  </url>\n',
    )
    .join('');

  const output = `${rebased.slice(0, closing)}${entries}${rebased.slice(closing)}`;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'sitemap.xml'), output, 'utf8');
  log(`sitemap.xml written with ${blogUrls.length} prerendered blog post(s).`);
}

/**
 * Removes the one `<url>` block whose `<loc>` is exactly `loc`, leaving the rest of the
 * document byte for byte. Anchored on an exact `<loc>` so `/blog` cannot take
 * `/blog/algum-post` with it.
 */
function dropUrlEntry(xml, loc) {
  const target = loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(
    `\\n?[ \\t]*<url>(?:(?!<\\/url>)[\\s\\S])*?<loc>\\s*${target}\\s*<\\/loc>[\\s\\S]*?<\\/url>`,
    'i',
  );
  return xml.replace(block, '');
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function describe(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
