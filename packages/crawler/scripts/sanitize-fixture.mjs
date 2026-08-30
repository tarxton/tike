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

/**
 * Office Shoes puts identity in schema.org microdata rather than JSON-LD, so the subset
 * worth keeping is the Product scope's own attribute-bearing elements plus the size list.
 * The whole scope is far too much: it contains recommendation carousels with their own
 * prices, which is precisely what a fixture must not teach the parser to accept.
 */
export function sanitizeOfficeshoesFixture(html) {
  const $ = cheerio.load(html);
  const scope = $('[itemtype="http://schema.org/Product"]').first();

  const meta = scope
    .find('meta[itemprop], link[itemprop]')
    .toArray()
    .map((el) => $.html(el))
    .join('\n');
  const heading = scope.find('h1').first().toString() ?? '';
  const price = scope.find('.product-price').first().toString() ?? '';

  // `rel` on a size is the shop's stock count for it. tike stores availability, not
  // quantities, so republishing the numbers in a public repository would be handing out
  // a competitor's inventory for no reason. The parser never reads it.
  const sizeList = scope.find('ul.sizes').first();
  sizeList.find('li[rel]').removeAttr('rel');
  const sizes = sizeList.toString() ?? '';

  return [
    '<!doctype html>',
    '<html lang="bs">',
    '<head>',
    `<title>${$('title').first().text()}</title>`,
    '</head>',
    '<body>',
    '<section class="productpage" itemscope itemtype="http://schema.org/Product">',
    meta,
    heading,
    price,
    sizes,
    '</section>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

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
