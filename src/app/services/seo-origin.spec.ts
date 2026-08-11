import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SITE_ORIGIN } from './seo.service';

/**
 * Guards the canonical host across the files that CANNOT import `SITE_ORIGIN`.
 *
 * `SITE_ORIGIN` (`seo.service.ts`) is the single source of truth for every URL the app
 * emits at runtime — canonical, `og:url`, and every `@id` in the JSON-LD. Three static
 * files repeat that origin as literal text:
 *
 *   - `public/robots.txt`   — header comment + the `Sitemap:` line
 *   - `public/sitemap.xml`  — every `<loc>`
 *   - `src/index.html`      — `og:url`, `og:image`, `twitter:image`
 *
 * `scripts/generate-sitemap.mjs` now re-emits the first two into the build output with
 * the origin substituted, so those two self-heal at build time. `src/index.html` does
 * NOT — it is the prerender template, and nothing rewrites it. So this spec is what makes
 * changing the canonical host genuinely one line: flip `SITE_ORIGIN`, and any file that
 * did not follow fails here by name instead of silently shipping a split ranking signal.
 *
 * Why exact-match and not "contains the host": `https://www.mycarshub.app.br` and
 * `https://mycarshub.app.br` are DIFFERENT URLs to Google. A substring check would pass
 * on the wrong one, which is the exact bug this is here to catch.
 */

/** Any absolute URL on the project's own domain, whatever the sub-domain or scheme. */
const OWN_ORIGIN = /https?:\/\/[a-z0-9.-]*mycarshub\.app\.br/gi;

function workspaceRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth++) {
    if (existsSync(join(dir, 'angular.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find angular.json walking up from ${process.cwd()}`);
}

function read(relativePath: string): string {
  const full = resolve(workspaceRoot(), relativePath);
  expect(existsSync(full), `${relativePath} is missing`).toBe(true);
  return readFileSync(full, 'utf8');
}

/** Every absolute self-referencing origin in the file, de-duplicated. */
function originsIn(content: string): string[] {
  return [...new Set(Array.from(content.matchAll(OWN_ORIGIN), (m) => m[0]))];
}

describe('canonical origin drift across the static files', () => {
  const files = ['public/robots.txt', 'public/sitemap.xml', 'src/index.html'];

  for (const file of files) {
    it(`${file} uses SITE_ORIGIN and nothing else`, () => {
      const found = originsIn(read(file));

      expect(found.length, `${file} references no absolute MyCarsHub URL at all`).toBeGreaterThan(
        0,
      );
      expect(found).toEqual([SITE_ORIGIN]);
    });
  }

  /**
   * `generate-sitemap.mjs` finds the origin to replace by reading the `Sitemap:` line and
   * the first `<loc>`. If those anchors ever disappear the script copies the file through
   * unchanged — silently, because it must never fail the build. This is where that shows.
   */
  it('keeps the anchors generate-sitemap.mjs reads the current origin from', () => {
    expect(read('public/robots.txt')).toMatch(/^\s*Sitemap:\s*https?:\/\//im);
    expect(read('public/sitemap.xml')).toMatch(/<loc>\s*https?:\/\//i);
    expect(read('public/sitemap.xml')).toContain('</urlset>');
  });

  /** The literal the generator greps out of the TypeScript must stay greppable. */
  it('keeps SITE_ORIGIN declared as a plain string literal', () => {
    const source = read('src/app/services/seo.service.ts');
    const match = /export const SITE_ORIGIN\s*=\s*'([^']+)'/.exec(source);

    expect(match?.[1]).toBe(SITE_ORIGIN);
  });
});
