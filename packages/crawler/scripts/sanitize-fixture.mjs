/**
 * Reduce a captured page to the parts the parser actually reads.
 *
 * Shop pages carry third-party credentials in inline scripts — Google Maps keys,
 * Flowplayer JWTs, a Facebook access token, values literally named ClientSecret.
 * Redacting them one pattern at a time is a losing game: every new shop brings new
 * scripts, and a missed one lands in a public repository.
 *
 * So fixtures keep only what the adapter parses:
 *   - schema.org JSON-LD (identity, price)
 *   - the product size list (per-size availability)
 *   - breadcrumbs and title (gender detection)
 *
 * Everything else — scripts, styles, iframes, inline event handlers — is dropped.
 * That removes the entire class of problem, and shrinks fixtures by ~99%.
 */

import * as cheerio from 'cheerio';

export function sanitizeFixture(html) {
  const $ = cheerio.load(html);

  // Keep JSON-LD; drop every other script, and all styles and embeds.
  $('script').each((_, el) => {
    if ($(el).attr('type') !== 'application/ld+json') $(el).remove();
  });
  $('style, link[rel="stylesheet"], iframe, noscript, svg, source, picture').remove();

  // Inline handlers and data blobs can carry tokens too.
  $('*').each((_, el) => {
    const attribs = el.attribs ?? {};
    for (const name of Object.keys(attribs)) {
      if (name.startsWith('on')) $(el).removeAttr(name);
    }
  });

  const ld = $('script[type="application/ld+json"]')
    .toArray()
    .map((el) => `<script type="application/ld+json">${$(el).contents().text()}</script>`)
    .join('\n');

  const title = $('title').first().text();
  const breadcrumb = $('.breadcrumb').first().toString() ?? '';
  const sizes = $('.product-attributes-wrapper').first().toString() ?? '';
  const heading = $('h1').first().toString() ?? '';

  return [
    '<!doctype html>',
    '<html lang="bs">',
    '<head>',
    `<title>${title}</title>`,
    ld,
    '</head>',
    '<body>',
    heading,
    breadcrumb,
    sizes,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
